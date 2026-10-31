/**
 * The statements `createAsset` / `updateAsset` / `deleteAsset` send to the Rust
 * transaction. `src-tauri/tests/import_sql.rs` runs the same expressions against
 * real SQLite; this pins the TypeScript side to them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const runTransaction = vi.fn();
const select = vi.fn();
vi.mock("../transaction", async () => {
  const actual = await vi.importActual<typeof import("../transaction")>("../transaction");
  return { ...actual, runTransaction: (...a: unknown[]) => runTransaction(...a) };
});
vi.mock("../client", () => ({ getDb: async () => ({ select }) }));

import { createAsset, deleteAsset, updateAsset, type AssetWriteInput } from "./assets";

const NEXT_ID = "(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'assets'), 0) + 1)";
const JUST_INSERTED = "(SELECT seq FROM sqlite_sequence WHERE name = 'assets')";

const base: AssetWriteInput = {
  institution_id: 1, category_id: 2, currency: "CHF", product_name: "  O'Brien Fund ",
  name: null, description: "", notes: "line1\nline2", code_nin: null,
  cost_charges: "0.85", interest_rate: null, tag_ids: [3, 3, 4],
};

const sent = (): string[] => runTransaction.mock.calls[0][0] as string[];

describe("asset writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTransaction.mockResolvedValue(1);
    select.mockResolvedValue([{ seq: 7 }]);
  });

  it("allocates the id inside the transaction and links tags and snapshot to it", async () => {
    const id = await createAsset({ ...base, initial_amount: "2500.50", initial_date: "2026-01-01" });

    const statements = sent();
    expect(statements[0]).toContain(`VALUES (${NEXT_ID},`);
    // duplicate tag ids collapse to one link
    expect(statements.filter((s) => s.startsWith("INSERT INTO asset_tags"))).toEqual([
      `INSERT INTO asset_tags (asset_id, tag_id) VALUES (${JUST_INSERTED}, 3)`,
      `INSERT INTO asset_tags (asset_id, tag_id) VALUES (${JUST_INSERTED}, 4)`,
    ]);
    expect(statements[statements.length - 1]).toContain(`VALUES (${JUST_INSERTED}, '2026-01-01', 250050)`);
    expect(statements).toHaveLength(4);
    expect(id).toBe(7);
  });

  it("is a single transaction call, so nothing needs a compensating delete", async () => {
    await createAsset({ ...base, initial_amount: "10", initial_date: "2026-01-01" });
    expect(runTransaction).toHaveBeenCalledTimes(1);
  });

  it("writes no snapshot without an amount", async () => {
    await createAsset({ ...base, initial_amount: "" });
    expect(sent().some((s) => s.includes("INSERT INTO snapshots"))).toBe(false);
    await createAsset({ ...base });
    expect(runTransaction.mock.calls[1][0].some((s: string) => s.includes("INSERT INTO snapshots"))).toBe(false);
  });

  it("escapes text, trims the product, and stores decimals as text", async () => {
    await createAsset(base);
    const insert = sent()[0];
    expect(insert).toContain("'O''Brien Fund'");
    expect(insert).toContain("'line1\nline2'");
    expect(insert).toContain("'0.85'");
    // empty description and null name both become NULL
    expect(insert).toMatch(/'CHF', 'O''Brien Fund', NULL, NULL, 'line1\nline2', NULL, '0\.85', NULL\)/);
  });

  it("neutralises an injection attempt in a text field", async () => {
    await createAsset({ ...base, product_name: "x'); DROP TABLE assets; --" });
    expect(sent()[0]).toContain("'x''); DROP TABLE assets; --'");
  });

  it("updates the row and replaces its tags in one transaction", async () => {
    await updateAsset(5, { ...base, tag_ids: [1, 2] });
    const statements = sent();
    expect(statements[0]).toMatch(/^UPDATE assets\s+SET institution_id = 1/);
    expect(statements[0]).toContain("WHERE id = 5");
    expect(statements[1]).toBe("DELETE FROM asset_tags WHERE asset_id = 5");
    expect(statements.slice(2)).toEqual([
      "INSERT INTO asset_tags (asset_id, tag_id) VALUES (5, 1)",
      "INSERT INTO asset_tags (asset_id, tag_id) VALUES (5, 2)",
    ]);
  });

  it("deletes children explicitly, in order, in one transaction", async () => {
    await deleteAsset(5);
    expect(sent()).toEqual([
      "DELETE FROM asset_tags WHERE asset_id = 5",
      "DELETE FROM snapshots WHERE asset_id = 5",
      "DELETE FROM assets WHERE id = 5",
    ]);
  });

  it("refuses a non-integer id rather than emitting broken SQL", async () => {
    await expect(deleteAsset(1.5)).rejects.toThrow(/non-integer/);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
