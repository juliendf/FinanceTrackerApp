/**
 * Import pre-flight: what will happen, what will be lost, what will fail.
 *
 * Pure. No database, no Tauri. The wizard shows this before touching anything,
 * and `executeImport` refuses to run when `errors` is non-empty — which is what
 * makes the "all or nothing" promise hold without a transaction handle.
 */

import { isExactAtTwoDecimals, roundMoney } from "../domain/money";
import { isSupportedCurrency } from "../domain/currency";
import type { BackupData, ParsedBackup } from "./schema";

export interface ImportCounts {
  institutions: number;
  categories: number;
  tags: number;
  assets: number;
  snapshots: number;
  exchangeRates: number;
  providers: number;
  settings: number;
  memories: number;
  goals: number;
  profile: number;
}

export interface RoundingIssue {
  entity: "snapshot" | "profile";
  id: number | string;
  value: string;
  rounded: string;
}

export interface ImportPlan {
  version: number;
  exportedAt: string | null;
  counts: ImportCounts;
  /** Blocking problems. Any entry means the import must not run. */
  errors: string[];
  /** Non-blocking notes shown in the report. */
  warnings: string[];
  roundingIssues: RoundingIssue[];
  /** Categories with no `system_role` (always the case for v2). */
  categoriesMissingRole: string[];
  /** Providers whose plaintext key will be moved to the Keychain. */
  providersWithKeys: Array<{ id: number; name: string }>;
  /** Settings that differ from this app's defaults. */
  settingsOverridden: Array<{ key: string; value: string }>;
  /** Things the backup does not carry, listed so nothing is silently dropped. */
  notImported: string[];
}

function collectDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/** Build the plan for a parsed backup. */
export function buildImportPlan(backup: ParsedBackup): ImportPlan {
  const data: BackupData = backup.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const roundingIssues: RoundingIssue[] = [];

  // --- referential integrity ------------------------------------------------
  const institutionIds = new Set(data.institutions.map((row) => row.id));
  const categoryIds = new Set(data.categories.map((row) => row.id));
  const assetIds = new Set(data.assets.map((row) => row.id));

  for (const asset of data.assets) {
    if (!institutionIds.has(asset.institution_id)) {
      errors.push(
        `Asset ${asset.id} ("${asset.product_name}") points at institution ${asset.institution_id}, which is not in the file.`,
      );
    }
    if (!categoryIds.has(asset.category_id)) {
      errors.push(
        `Asset ${asset.id} ("${asset.product_name}") points at category ${asset.category_id}, which is not in the file.`,
      );
    }
    if (!isSupportedCurrency(asset.currency)) {
      errors.push(
        `Asset ${asset.id} has currency "${asset.currency}". Only EUR, USD and CHF are supported.`,
      );
    }
  }

  const snapshotKeys = new Set<string>();
  for (const snapshot of data.snapshots) {
    if (!assetIds.has(snapshot.asset_id)) {
      errors.push(
        `Snapshot ${snapshot.id} points at asset ${snapshot.asset_id}, which is not in the file.`,
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date)) {
      errors.push(`Snapshot ${snapshot.id} has date "${snapshot.date}", expected YYYY-MM-DD.`);
    }
    const key = `${snapshot.asset_id}@${snapshot.date}`;
    if (snapshotKeys.has(key)) {
      errors.push(
        `Asset ${snapshot.asset_id} has two snapshots dated ${snapshot.date}; the database allows one.`,
      );
    }
    snapshotKeys.add(key);

    const amount = String(snapshot.amount);
    if (!isExactAtTwoDecimals(amount)) {
      const rounded = roundMoney(amount);
      if (!rounded) {
        errors.push(`Snapshot ${snapshot.id} has an unreadable amount "${amount}".`);
      } else {
        roundingIssues.push({
          entity: "snapshot",
          id: snapshot.id,
          value: amount,
          rounded: rounded.toFixed(2),
        });
      }
    }
  }

  for (const rate of data.exchange_rates) {
    if (!isSupportedCurrency(rate.from_currency) || !isSupportedCurrency(rate.to_currency)) {
      errors.push(
        `Exchange rate ${rate.from_currency}->${rate.to_currency} uses an unsupported currency.`,
      );
    }
    const parsed = Number(rate.rate);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      errors.push(
        `Exchange rate ${rate.from_currency}->${rate.to_currency} has an invalid rate "${rate.rate}".`,
      );
    }
  }

  // --- global uniques -------------------------------------------------------
  for (const [label, names] of [
    ["institution", data.institutions.map((row) => row.name)],
    ["category", data.categories.map((row) => row.name)],
    ["tag", data.tags.map((row) => row.name)],
    ["LLM provider", data.llm_providers.map((row) => row.name)],
    ["setting key", data.settings.map((row) => row.key)],
  ] as const) {
    for (const duplicate of collectDuplicates(names)) {
      errors.push(`The file has two ${label}s named "${duplicate}".`);
    }
  }

  const defaults = data.llm_providers.filter((row) => Boolean(row.is_default));
  if (defaults.length > 1) {
    errors.push("The file marks more than one LLM provider as default.");
  }

  // --- soft warnings --------------------------------------------------------
  const categoriesMissingRole = data.categories
    .filter((row) => !row.system_role)
    .map((row) => row.name);

  if (categoriesMissingRole.length > 0) {
    warnings.push(
      `${categoriesMissingRole.length} categor${categoriesMissingRole.length === 1 ? "y has" : "ies have"} no system role. The Résumé view needs them, so you will be asked to map them after the import.`,
    );
  }

  const providersWithKeys = data.llm_providers
    .filter((row) => typeof row.api_key === "string" && row.api_key.length > 0)
    .map((row) => ({ id: row.id, name: row.name }));

  if (providersWithKeys.length > 0) {
    warnings.push(
      `${providersWithKeys.length} provider API key will be moved to the macOS Keychain and will not be written to the database.`,
    );
  }

  const notImported: string[] = [];
  if (data.memories.length === 0) notImported.push("memories (not present in a v2 backup)");
  if (data.goals.length === 0) notImported.push("goals (not present in a v2 backup)");
  if (data.profile?.username || data.profile?.email) {
    notImported.push("account username and email (there is no account any more)");
  }

  const settingsOverridden = data.settings.map((row) => ({
    key: row.key,
    value: row.value,
  }));

  return {
    version: backup.version,
    exportedAt: backup.exportedAt,
    counts: {
      institutions: data.institutions.length,
      categories: data.categories.length,
      tags: data.tags.length,
      assets: data.assets.length,
      snapshots: data.snapshots.length,
      exchangeRates: data.exchange_rates.length,
      providers: data.llm_providers.length,
      settings: data.settings.length,
      memories: data.memories.length,
      goals: data.goals.length,
      profile: data.profile && Object.keys(data.profile).length > 0 ? 1 : 0,
    },
    errors,
    warnings,
    roundingIssues,
    categoriesMissingRole,
    providersWithKeys,
    settingsOverridden,
    notImported,
  };
}
