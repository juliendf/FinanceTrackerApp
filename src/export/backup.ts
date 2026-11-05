/**
 * Write a backup in the app's own envelope, at version 3.
 *
 * Field names and shapes follow the v2 format exactly, so this app's own
 * importer can read what it writes: amounts as JSON numbers, rates as decimal
 * strings, denormalised labels kept for readability, ids preserved.
 *
 * Two deliberate choices:
 *   * **No API keys.** Keys live in the Keychain and are never exported; a
 *     plaintext `api_key` in an imported file is moved there and dropped.
 *   * **`system_role` on categories.** v2 has no roles, which is why importing a
 *     v2 backup asks the user to map them; this export carries them so a
 *     round-trip keeps the Résumé working.
 */

import type { ExportRows } from "../db/repositories/export";
import { fromMinorUnits } from "../domain/money";

export const EXPORT_VERSION = 3;

export const ENTITY_LABELS: Record<string, string> = {
  institutions: "Institutions",
  categories: "Categories",
  tags: "Tags",
  assets: "Assets",
  snapshots: "Snapshots",
  exchange_rates: "Exchange Rates",
  llm_providers: "LLM Providers",
  settings: "Application Settings",
  profile: "User Profile",
  memories: "Memories",
  goals: "Goals",
};

/** Groups that can be left out of an export; the UI offers them as checkboxes. */
export const SELECTABLE_ENTITIES = [
  "institutions",
  "categories",
  "tags",
  "assets",
  "snapshots",
  "exchange_rates",
  "llm_providers",
  "settings",
  "profile",
  "memories",
  "goals",
] as const;

const major = (minor: number | null): number | null =>
  minor === null || minor === undefined ? null : (fromMinorUnits(minor)?.toNumber() ?? null);

export interface BackupEnvelope {
  version: number;
  exported_at: string;
  data: Record<string, unknown>;
}

/** Build the envelope. Omit entity keys from `include` to leave them out. */
export function buildBackup(
  rows: ExportRows,
  exportedAt: string,
  include: readonly string[] = SELECTABLE_ENTITIES,
): BackupEnvelope {
  const wanted = new Set(include);
  const data: Record<string, unknown> = {};

  if (wanted.has("institutions")) {
    data.institutions = rows.institutions.map((row) => ({ ...row }));
  }
  if (wanted.has("categories")) {
    data.categories = rows.categories.map((row) => ({ ...row }));
  }
  if (wanted.has("tags")) {
    data.tags = rows.tags.map((row) => ({ ...row }));
  }
  if (wanted.has("assets")) {
    data.assets = rows.assets.map((row) => ({ ...row }));
  }
  if (wanted.has("snapshots")) {
    data.snapshots = rows.snapshots.map((row) => ({
      id: row.id,
      asset_id: row.asset_id,
      date: row.date,
      amount: major(row.amount_minor),
      created_at: row.created_at,
      updated_at: row.updated_at,
      asset_institution: row.asset_institution,
      asset_product: row.asset_product,
      asset_category: row.asset_category,
      asset_currency: row.asset_currency,
    }));
  }
  if (wanted.has("exchange_rates")) {
    data.exchange_rates = rows.exchange_rates.map((row) => ({ ...row }));
  }
  if (wanted.has("llm_providers")) {
    // `keychain_ref` is meaningless on another machine and `api_key` must never
    // leave this one; the importer treats a provider without a key as unkeyed.
    data.llm_providers = rows.llm_providers.map((row) => {
      const { keychain_ref: _ref, ...rest } = row;
      return { ...rest, is_default: !!row.is_default, is_active: !!row.is_active, api_key: null };
    });
    // Which models each provider offers, and which the user enabled for chat.
    data.provider_models = rows.provider_models.map((row) => ({
      provider_id: row.provider_id,
      model: row.model,
      enabled: !!row.enabled,
    }));
  }
  if (wanted.has("settings")) {
    data.settings = rows.settings.map((row) => ({ ...row }));
  }
  if (wanted.has("profile")) {
    const p = rows.profile;
    data.profile = p
      ? {
          first_name: p.first_name,
          last_name: p.last_name,
          job_title: p.job_title,
          financial_goals: p.financial_goals,
          birth_date: p.birth_date,
          tax_residence: p.tax_residence,
          monthly_expenses: major(p.monthly_expenses_minor),
          dependants_count: p.dependants_count,
          dependant_ages: p.dependant_ages,
          employment_status: p.employment_status,
          marital_status: p.marital_status,
          marital_regime: p.marital_regime,
          has_will: p.has_will,
          default_currency: p.currency,
          currency: p.currency,
          timezone: p.timezone,
          date_format: p.date_format,
          salary: major(p.salary_minor),
          salary_currency: p.currency,
          monthly_savings_target: major(p.monthly_savings_target_minor),
          risk_profile: p.risk_profile,
          ai_tone: p.ai_tone,
          ai_verbosity: p.ai_verbosity,
          ai_expertise: p.ai_expertise,
        }
      : {};
  }
  if (wanted.has("memories")) {
    data.memories = rows.memories.map((row) => ({ ...row }));
  }
  if (wanted.has("goals")) {
    data.goals = rows.goals.map((row) => ({ ...row, target_amount: major(row.target_amount_minor) }));
  }

  return { version: EXPORT_VERSION, exported_at: exportedAt, data };
}

/** `finance_tracker_data_{YYYYMMDD_HHMMSS}.json` */
export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `finance_tracker_data_${stamp}.json`;
}

/** Pretty-printed, like Python's `json.dumps(..., indent=2)`. */
export function backupJson(envelope: BackupEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}
