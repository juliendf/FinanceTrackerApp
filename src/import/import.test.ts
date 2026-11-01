/**
 * Importer tests: envelope validation, pre-flight planning, SQL generation.
 *
 * Fixtures are synthetic (tests/fixtures/backup-v2-small.json). A real backup is
 * only used when FINANCETRACKER_BACKUP points at one, so the suite stays
 * self-contained:
 *
 *   FINANCETRACKER_BACKUP=~/Downloads/backup.json npx vitest run src/import
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildImportPlan } from "./plan";
import { parseBackup } from "./schema";
import { buildImportStatements } from "./execute";
import { amountMinor, decimalText, rateText, sqlBool, sqlInt, sqlText } from "./sql";

const FIXTURE = "tests/fixtures/backup-v2-small.json";
const fixtureRaw = readFileSync(FIXTURE, "utf8");

describe("parseBackup", () => {
  it("accepts a v2 export and keeps the payload", () => {
    const backup = parseBackup(fixtureRaw);
    expect(backup.version).toBe(2);
    expect(backup.exportedAt).toBe("2026-01-15T10:00:00.000000");
    expect(backup.data.assets).toHaveLength(2);
  });

  it("accepts v3 with the extra entities", () => {
    const v3 = {
      version: 3,
      exported_at: "2026-02-01T00:00:00",
      data: {
        institutions: [],
        categories: [{ id: 1, name: "Cash", system_role: "cash" }],
        memories: [{ category: "personal", key: "kids", content: "Two children" }],
        goals: [{ label: "House", target_amount: 100000 }],
      },
    };
    const backup = parseBackup(JSON.stringify(v3));
    expect(backup.version).toBe(3);
    expect(backup.data.memories).toHaveLength(1);
    expect(backup.data.goals).toHaveLength(1);
    expect(backup.data.categories[0].system_role).toBe("cash");
  });

  it("rejects a newer version with an actionable message", () => {
    const newer = JSON.stringify({ version: 99, data: {} });
    expect(() => parseBackup(newer)).toThrow(/version 99/);
    expect(() => parseBackup(newer)).toThrow(/Update the app/);
  });

  it("rejects a version older than 2", () => {
    expect(() => parseBackup(JSON.stringify({ version: 1, data: {} }))).toThrow(
      /Re-export it from FinanceTracker/,
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => parseBackup("{not json")).toThrow(/not valid JSON/);
  });

  it("rejects a file with no version", () => {
    expect(() => parseBackup(JSON.stringify({ data: {} }))).toThrow(/no backup version/);
  });

  it("reports where a malformed row fails", () => {
    const broken = JSON.stringify({
      version: 2,
      data: { assets: [{ id: "not-a-number", product_name: "x" }] },
    });
    expect(() => parseBackup(broken)).toThrow(/malformed at data.assets.0/);
  });
});

describe("buildImportPlan", () => {
  const plan = buildImportPlan(parseBackup(fixtureRaw));

  it("counts every entity", () => {
    expect(plan.counts).toEqual({
      institutions: 2,
      categories: 2,
      tags: 1,
      assets: 2,
      snapshots: 3,
      exchangeRates: 2,
      providers: 1,
      settings: 3,
      memories: 0,
      goals: 0,
      profile: 1,
    });
  });

  it("accepts a clean file", () => {
    expect(plan.errors).toEqual([]);
  });

  it("flags categories without a system role, as v2 always does", () => {
    expect(plan.categoriesMissingRole).toEqual(["Assurance Vie", "Epargne"]);
    expect(plan.warnings.join(" ")).toMatch(/system role/);
  });

  it("promises to move API keys to the Keychain", () => {
    expect(plan.providersWithKeys).toEqual([{ id: 2, name: "Gemini" }]);
    expect(plan.warnings.join(" ")).toMatch(/Keychain/);
  });

  it("lists what the backup cannot carry", () => {
    // A v2 export has no memories or goals arrays, and the account fields have no
    // column. The profile's job title and free-text aspirations *are* carried now
    // (migration 5), so they must not be listed as lost.
    const lost = plan.notImported.join(" ");
    expect(lost).toMatch(/memories/);
    expect(lost).toMatch(/goals/);
    expect(lost).toMatch(/username and email/);
    expect(lost).not.toMatch(/job title/);
    expect(lost).not.toMatch(/financial goals/);
  });

  it("blocks an asset pointing at a missing institution", () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.assets[0].institution_id = 999;
    const result = buildImportPlan(parseBackup(JSON.stringify(broken)));
    expect(result.errors.join(" ")).toMatch(/institution 999/);
  });

  it("blocks an asset pointing at a missing category", () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.assets[0].category_id = 999;
    expect(buildImportPlan(parseBackup(JSON.stringify(broken))).errors.join(" ")).toMatch(
      /category 999/,
    );
  });

  it("blocks a snapshot pointing at a missing asset", () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.snapshots[0].asset_id = 999;
    expect(buildImportPlan(parseBackup(JSON.stringify(broken))).errors.join(" ")).toMatch(
      /asset 999/,
    );
  });

  it("blocks two snapshots for the same asset and date", () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.snapshots[1].date = broken.data.snapshots[0].date;
    expect(buildImportPlan(parseBackup(JSON.stringify(broken))).errors.join(" ")).toMatch(
      /two snapshots dated/,
    );
  });

  it("blocks an unsupported currency", () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.assets[0].currency = "GBP";
    expect(buildImportPlan(parseBackup(JSON.stringify(broken))).errors.join(" ")).toMatch(
      /GBP/,
    );
  });

  it("blocks duplicate institution names, since uniques are global now", () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.institutions[1].name = broken.data.institutions[0].name;
    expect(buildImportPlan(parseBackup(JSON.stringify(broken))).errors.join(" ")).toMatch(
      /two institutions named/,
    );
  });

  it("blocks more than one default provider", () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.llm_providers.push({ ...broken.data.llm_providers[0], id: 3, name: "Other" });
    expect(buildImportPlan(parseBackup(JSON.stringify(broken))).errors.join(" ")).toMatch(
      /more than one LLM provider/,
    );
  });

  it("blocks a malformed rate", () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.exchange_rates[0].rate = -1;
    expect(buildImportPlan(parseBackup(JSON.stringify(broken))).errors.join(" ")).toMatch(
      /invalid rate/,
    );
  });

  it("reports amounts that are not exact at 2 decimals", () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.snapshots[0].amount = 10000.505;
    const result = buildImportPlan(parseBackup(JSON.stringify(broken)));
    expect(result.roundingIssues).toHaveLength(1);
    expect(result.roundingIssues[0]).toMatchObject({
      entity: "snapshot",
      id: 900,
      value: "10000.505",
    });
  });
});

describe("sql helpers", () => {
  it("escapes quotes by doubling them", () => {
    expect(sqlText("O'Brien")).toBe("'O''Brien'");
    expect(sqlText("'; DROP TABLE assets; --")).toBe("'''; DROP TABLE assets; --'");
  });

  it("keeps newlines and semicolons inside the literal", () => {
    expect(sqlText("line1\nline2;")).toBe("'line1\nline2;'");
  });

  it("maps null and undefined to NULL", () => {
    expect(sqlText(null)).toBe("NULL");
    expect(sqlText(undefined)).toBe("NULL");
    expect(sqlInt(null)).toBe("NULL");
  });

  it("refuses non-integer ids rather than emitting broken SQL", () => {
    expect(() => sqlInt(1.5)).toThrow(/non-integer/);
  });

  it("maps booleans to 0/1", () => {
    expect(sqlBool(true)).toBe("1");
    expect(sqlBool(false)).toBe("0");
    expect(sqlBool(undefined)).toBe("NULL");
  });

  it("keeps rates at full precision as text", () => {
    expect(rateText(1.0730765)).toBe("1.0730765");
    expect(rateText("0.9319")).toBe("0.9319");
  });

  it("keeps decimal columns as text or NULL", () => {
    expect(decimalText(0.85)).toBe("'0.85'");
    expect(decimalText(null)).toBe("NULL");
    expect(decimalText("nonsense")).toBe("NULL");
  });

  it("converts major units to integer minor units", () => {
    expect(amountMinor(10000.5)).toBe("1000050");
    expect(amountMinor("10120.25")).toBe("1012025");
    expect(amountMinor(0)).toBe("0");
  });
});

describe("buildImportStatements", () => {
  const backup = parseBackup(fixtureRaw);
  const statements = buildImportStatements(backup, new Map([[2, "provider:2"]]));
  const joined = statements.join("\n");

  it("writes one statement per row plus the tag links", () => {
    // 2 institutions + 2 categories + 1 tag + 2 assets + 1 asset_tag
    // + 3 snapshots + 2 rates + 1 provider + 3 settings + 1 profile = 18
    expect(statements).toHaveLength(18);
  });

  it("preserves ids so foreign keys line up without a remap", () => {
    expect(joined).toContain("INSERT INTO institutions (id, name, description");
    expect(joined).toContain("(53, 26, 10, 'EUR'");
  });

  it("links tags by name", () => {
    expect(joined).toContain("INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (53, 5)");
  });

  it("stores the Keychain reference instead of the API key", () => {
    expect(joined).toContain("'provider:2'");
    expect(joined).not.toContain("test-key-not-a-real-secret");
  });

  it("trims a trailing slash from the base URL", () => {
    expect(joined).toContain("'https://generativelanguage.googleapis.com/v1beta'");
  });

  it("converts profile money to minor units", () => {
    expect(joined).toContain("850050"); // salary 8500.50
    expect(joined).toContain("150000"); // savings target 1500
  });

  it("keeps the profile's free text but drops the account fields", () => {
    expect(joined).toContain("Engineer"); // job title
    expect(joined).toContain("Buy a house"); // free-text aspirations
    expect(joined).not.toContain("test@example.com");
    expect(joined).not.toContain("testuser");
  });

  it("keeps apostrophes in French text intact", () => {
    expect(joined).toContain("'Compte épargne'");
  });
});

describe("real backup (opt-in)", () => {
  const realPath = process.env.FINANCETRACKER_BACKUP;
  const hasReal = Boolean(realPath && existsSync(realPath));

  it.skipIf(!hasReal)("parses and plans without blocking errors", () => {
    const raw = readFileSync(realPath as string, "utf8");
    const backup = parseBackup(raw);
    const plan = buildImportPlan(backup);

    // eslint-disable-next-line no-console
    console.log("real backup counts:", plan.counts, "warnings:", plan.warnings.length);
    expect(plan.errors).toEqual([]);
    expect(plan.counts.assets).toBeGreaterThan(0);
    expect(plan.counts.snapshots).toBeGreaterThan(0);

    // Hand the exact statement list to the Rust transaction test:
    //   IMPORT_SQL=/tmp/ft-import.sql cargo test --test import_sql -- --ignored
    const sqlOut = process.env.IMPORT_SQL_OUT;
    if (sqlOut) {
      const statements = buildImportStatements(backup, new Map());
      writeFileSync(sqlOut, JSON.stringify(statements, null, 0), "utf8");
      // eslint-disable-next-line no-console
      console.log(`wrote ${statements.length} statements to ${sqlOut}`);
    }
  });
});
