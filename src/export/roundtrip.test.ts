/**
 * Opt-in round-trip: export the *real* database, then hand the import
 * statements to the Rust transaction so a fresh database can be diffed against
 * the original row by row.
 *
 *   SQLITE_DB=~/Library/.../financetracker.db ROUNDTRIP_SQL_OUT=/tmp/ft-rt.sql \
 *     npx vitest run src/export/roundtrip.test.ts
 *
 * The SQL is read straight from the database here (same queries as the export
 * repository) because this test deliberately does not open the app's connection.
 * `tests/roundtrip/compare.py` does the diff afterwards.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildImportPlan } from "../import/plan";
import { buildImportStatements } from "../import/execute";
import { parseBackup } from "../import/schema";
import { backupJson, buildBackup } from "./backup";
import type { ExportRows } from "../db/repositories/export";

const db = process.env.SQLITE_DB;
const out = process.env.ROUNDTRIP_SQL_OUT;
const enabled = Boolean(db && out && existsSync(db));

const q = <T>(sql: string): T[] =>
  JSON.parse(execFileSync("sqlite3", ["-json", db as string, sql], { encoding: "utf8" }) || "[]") as T[];

describe("backup round-trip on the real database", () => {
  it.skipIf(!enabled)("produces statements that reproduce every row", () => {
    const rows: ExportRows = {
      institutions: q(`SELECT id, name, description, created_at, updated_at FROM institutions ORDER BY id`),
      categories: q(`SELECT id, name, description, color, system_role, created_at, updated_at FROM categories ORDER BY id`),
      tags: q(`SELECT id, name, color, created_at, updated_at FROM tags ORDER BY id`),
      assets: q<ExportRows["assets"][number]>(`SELECT a.id, a.institution_id, a.category_id, a.currency, a.product_name, a.name,
                        a.description, a.notes, a.code_nin, a.cost_charges, a.interest_rate,
                        a.created_at, a.updated_at, i.name AS institution_name,
                        c.name AS category_name
                   FROM assets a
                   JOIN institutions i ON i.id = a.institution_id
                   JOIN categories c ON c.id = a.category_id
                  ORDER BY a.id`)
        .map((asset) => ({
          ...asset,
          tag_names: q<{ name: string }>(
            `SELECT t.name FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ${Number(asset.id)} ORDER BY t.name`,
          ).map((row) => row.name),
        })),
      snapshots: q(`SELECT id, asset_id, date, amount_minor, created_at, updated_at FROM snapshots ORDER BY id`),
      exchange_rates: q(`SELECT id, from_currency, to_currency, rate, created_at, updated_at FROM exchange_rates ORDER BY id`),
      llm_providers: q(`SELECT id, name, base_url, model, provider_type, keychain_ref, is_default, is_active, created_at, updated_at FROM llm_providers ORDER BY id`),
      provider_models: q(`SELECT provider_id, model, enabled FROM provider_models ORDER BY provider_id, model`),
      settings: q(`SELECT id, key, value, created_at, updated_at FROM settings ORDER BY key`),
      profile: q<ExportRows["profile"]>(`SELECT first_name, last_name, job_title, financial_goals, birth_date, tax_residence, currency,
                         timezone, date_format, salary_minor, monthly_savings_target_minor, risk_profile,
                         ai_tone, ai_verbosity, ai_expertise FROM profile LIMIT 1`)[0] ?? null,
      memories: q(`SELECT id, category, key, content, source, importance, created_at, updated_at FROM user_memories ORDER BY id`),
      goals: q(`SELECT id, label, target_amount_minor, target_date, priority, category, created_at, updated_at FROM user_goals ORDER BY id`),
    };

    const envelope = buildBackup(rows, new Date().toISOString());
    const parsed = parseBackup(backupJson(envelope));
    const plan = buildImportPlan(parsed);
    expect(plan.errors).toEqual([]);

    // No key was exported, so nothing goes to the Keychain.
    const statements = buildImportStatements(parsed);
    writeFileSync(out as string, JSON.stringify(statements), "utf8");
    // eslint-disable-next-line no-console
    console.log(`wrote ${statements.length} statements to ${out}`);
    expect(statements.length).toBeGreaterThan(0);
  });
});
