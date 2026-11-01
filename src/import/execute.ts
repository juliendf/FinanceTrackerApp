/**
 * Apply a parsed backup.
 *
 * Strategy:
 *   1. pre-flight (buildImportPlan) must be clean, so structural problems are
 *      reported before anything is touched;
 *   2. providers and their API keys are restored by one Rust command, which
 *      binds each key to the origin of its base URL; the generic SQL path
 *      refuses to write those tables;
 *   3. the whole dataset is executed by the Rust `run_transaction` command:
 *      one real sqlx transaction on one connection, with foreign keys enforced.
 *      (The SQL plugin cannot do this — see src-tauri/src/commands/db.rs.);
 *   4. if it fails, the transaction rolls back and the Keychain items are
 *      removed again, so a failure leaves no trace.
 *
 * Row ids from the file are preserved rather than remapped. The import only runs
 * on an empty database, so there is nothing to collide with, and preserving them
 * keeps `asset_tags` / `snapshots` foreign keys correct without an id map.
 */

import { invoke } from "@tauri-apps/api/core";
import { resetDatabase } from "../db/reset";
import { buildImportPlan, type ImportCounts, type ImportPlan } from "./plan";
import type { ParsedBackup } from "./schema";
import { amountMinor, decimalText, rateText, sqlInt, sqlText } from "./sql";

export interface ImportResult {
  counts: ImportCounts;
  keysToKeychain: number;
  statements: number;
  durationMs: number;
}

export class ImportBlockedError extends Error {
  constructor(public readonly plan: ImportPlan) {
    super(
      `Import blocked by ${plan.errors.length} problem${plan.errors.length === 1 ? "" : "s"}:\n${plan.errors.join("\n")}`,
    );
    this.name = "ImportBlockedError";
  }
}

/** Build the SQL statements for the whole dataset, in foreign-key order. */
export function buildImportStatements(backup: ParsedBackup): string[] {
  const { data } = backup;
  const statements: string[] = [];

  for (const row of data.institutions) {
    statements.push(
      `INSERT INTO institutions (id, name, description, created_at, updated_at) VALUES (${[
        sqlInt(row.id),
        sqlText(row.name),
        sqlText(row.description),
        sqlText(row.created_at ?? null),
        sqlText(row.updated_at ?? null),
      ].join(", ")})`,
    );
  }

  for (const row of data.categories) {
    statements.push(
      `INSERT INTO categories (id, name, description, color, system_role, created_at, updated_at) VALUES (${[
        sqlInt(row.id),
        sqlText(row.name),
        sqlText(row.description),
        sqlText(row.color ?? null),
        sqlText(row.system_role ?? null),
        sqlText(row.created_at ?? null),
        sqlText(row.updated_at ?? null),
      ].join(", ")})`,
    );
  }

  for (const row of data.tags) {
    statements.push(
      `INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (${[
        sqlInt(row.id),
        sqlText(row.name),
        sqlText(row.color ?? null),
        sqlText(row.created_at ?? null),
        sqlText(row.updated_at ?? null),
      ].join(", ")})`,
    );
  }

  for (const row of data.assets) {
    statements.push(
      `INSERT INTO assets (id, institution_id, category_id, currency, product_name, name, description, notes, code_nin, cost_charges, interest_rate, created_at, updated_at) VALUES (${[
        sqlInt(row.id),
        sqlInt(row.institution_id),
        sqlInt(row.category_id),
        sqlText(row.currency),
        sqlText(row.product_name),
        sqlText(row.name),
        sqlText(row.description),
        sqlText(row.notes),
        sqlText(row.code_nin),
        decimalText(row.cost_charges),
        decimalText(row.interest_rate),
        sqlText(row.created_at ?? null),
        sqlText(row.updated_at ?? null),
      ].join(", ")})`,
    );
  }

  // Tags are referenced by name in the export; map them back to ids.
  const tagIdByName = new Map(data.tags.map((tag) => [tag.name, tag.id]));
  for (const asset of data.assets) {
    for (const tagName of asset.tag_names ?? []) {
      const tagId = tagIdByName.get(tagName);
      if (tagId === undefined) continue;
      statements.push(
        `INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (${sqlInt(asset.id)}, ${sqlInt(tagId)})`,
      );
    }
  }

  for (const row of data.snapshots) {
    statements.push(
      `INSERT INTO snapshots (id, asset_id, date, amount_minor, created_at, updated_at) VALUES (${[
        sqlInt(row.id),
        sqlInt(row.asset_id),
        sqlText(row.date),
        amountMinor(row.amount),
        sqlText(row.created_at ?? null),
        sqlText(row.updated_at ?? null),
      ].join(", ")})`,
    );
  }

  for (const row of data.exchange_rates) {
    statements.push(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate, created_at, updated_at) VALUES (${[
        sqlText(row.from_currency),
        sqlText(row.to_currency),
        sqlText(rateText(row.rate)),
        sqlText(row.created_at ?? null),
        sqlText(row.updated_at ?? null),
      ].join(", ")})`,
    );
  }



  for (const row of data.settings) {
    statements.push(
      `INSERT INTO settings (key, value, created_at, updated_at) VALUES (${[
        sqlText(row.key),
        sqlText(row.value),
        sqlText(row.created_at ?? null),
        sqlText(row.updated_at ?? null),
      ].join(", ")})`,
    );
  }

  const profile = data.profile ?? {};
  if (Object.keys(profile).length > 0) {
    statements.push(
      `INSERT INTO profile (id, first_name, last_name, job_title, financial_goals, birth_date, currency, timezone, date_format, salary_minor, monthly_savings_target_minor, risk_profile, ai_tone, ai_verbosity, ai_expertise) VALUES (${
        [
          sqlInt(1),
          sqlText(profile.first_name ?? null),
          sqlText(profile.last_name ?? null),
          sqlText(profile.job_title ?? null),
          sqlText(profile.financial_goals ?? null),
          sqlText(profile.birth_date ?? null),
          sqlText(profile.default_currency ?? "EUR"),
          sqlText(profile.timezone ?? "UTC"),
          sqlText(profile.date_format ?? "%Y-%m-%d"),
          profile.salary === null || profile.salary === undefined
            ? "NULL"
            : amountMinor(profile.salary),
          profile.monthly_savings_target === null ||
          profile.monthly_savings_target === undefined
            ? "NULL"
            : amountMinor(profile.monthly_savings_target),
          sqlText(profile.risk_profile ?? null),
          sqlText(profile.ai_tone ?? "encouraging"),
          sqlText(profile.ai_verbosity ?? "balanced"),
          sqlText(profile.ai_expertise ?? "intermediate"),
        ].join(", ")
      })`,
    );
  }

  for (const row of data.memories) {
    statements.push(
      `INSERT INTO user_memories (category, key, content, source, importance, created_at, updated_at) VALUES (${[
        sqlText(row.category),
        sqlText(row.key),
        sqlText(row.content),
        sqlText(row.source ?? "manual"),
        sqlInt(row.importance ?? 3),
        sqlText(row.created_at ?? null),
        sqlText(row.updated_at ?? null),
      ].join(", ")})`,
    );
  }

  for (const row of data.goals) {
    statements.push(
      `INSERT INTO user_goals (label, target_amount_minor, target_date, priority, category, created_at, updated_at) VALUES (${[
        sqlText(row.label),
        row.target_amount === null || row.target_amount === undefined
          ? "NULL"
          : amountMinor(row.target_amount),
        sqlText(row.target_date ?? null),
        sqlText(row.priority ?? "medium"),
        sqlText(row.category ?? null),
        sqlText(row.created_at ?? null),
        sqlText(row.updated_at ?? null),
      ].join(", ")})`,
    );
  }

  return statements;
}

/**
 * Import a backup into an empty database.
 *
 * Destructive by design: it resets first, so a half-imported database can never
 * confuse a retry.
 */
export async function executeImport(backup: ParsedBackup): Promise<ImportResult> {
  const started = performance.now();
  const plan = buildImportPlan(backup);
  if (plan.errors.length > 0) throw new ImportBlockedError(plan);

  await resetDatabase();

  const statements = buildImportStatements(backup);

  try {
    await invoke<number>("run_transaction", { statements });
  } catch (error) {
    // The transaction rolled back in Rust; nothing else has been written yet.
    throw error;
  }

  // Providers last: they are written on their own connection, and Rust binds each
  // key to its endpoint's origin. A key failure removes the keys it stored.
  const keysToKeychain = await invoke<number>("providers_restore", {
    rows: backup.data.llm_providers.map((row) => ({
      id: row.id,
      name: row.name,
      base_url: row.base_url.replace(/\/+$/, ""),
      model: row.model,
      provider_type: row.provider_type ?? "openai",
      is_default: row.is_default,
      is_active: row.is_active ?? true,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      api_key: row.api_key ?? null,
      models: [
        ...backup.data.provider_models
          .filter((model) => model.provider_id === row.id)
          .map((model) => ({ model: model.model, enabled: (model.enabled ?? true) ? true : false })),
      ],
    })),
  });

  return {
    counts: plan.counts,
    keysToKeychain,
    statements: statements.length,
    durationMs: Math.round(performance.now() - started),
  };
}
