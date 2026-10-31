/**
 * Opt-in parity check against the imported database.
 *
 *   SNAPSHOT_ROWS=/tmp/ft-snap-rows.json ORACLE_CSV=/tmp/ft-snap-oracle.csv \
 *   ORACLE_FILTERS=/tmp/ft-snap-oracle.json npx vitest run src/domain/snapshots.golden.test.ts
 *
 * The oracle (tests/oracle/snapshots_csv.py) rebuilds the export with Python's
 * csv module straight from the backup JSON. Byte equality means the import, the
 * schema, the sort and the CSV writer all reproduce the source.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterSnapshots, generateSnapshotsCsv, sortSnapshots, type SnapshotListRow } from "./snapshots";

const paths = [process.env.SNAPSHOT_ROWS, process.env.ORACLE_CSV, process.env.ORACLE_FILTERS];
const enabled = paths.every((p) => p && existsSync(p));

const NONE = { start_date: "", end_date: "", institution_id: null, currency: "", search: "", min_amount: "", max_amount: "" };
const SETS: Record<string, Partial<typeof NONE>> = {
  "no filters": {},
  "currency=CHF": { currency: "CHF" },
  "search=boursorama": { search: "boursorama" },
  "start=2026-06-01,end=2026-08-31": { start_date: "2026-06-01", end_date: "2026-08-31" },
  "min=10000,max=50000": { min_amount: "10000", max_amount: "50000" },
};

describe("snapshots against the real imported data", () => {
  it.skipIf(!enabled)("CSV export is byte-identical and filters match the oracle", () => {
    const rows = JSON.parse(readFileSync(paths[0] as string, "utf8")) as SnapshotListRow[];
    const sorted = sortSnapshots(rows, { sort_by: "date", sort_order: "desc" });
    expect(generateSnapshotsCsv(sorted)).toBe(readFileSync(paths[1] as string, "utf8"));

    const oracle = JSON.parse(readFileSync(paths[2] as string, "utf8")) as Array<{ label: string; ids: number[] }>;
    for (const expected of oracle) {
      const got = filterSnapshots(rows, { ...NONE, ...SETS[expected.label] }).map((r) => r.id).sort((a, b) => a - b);
      // eslint-disable-next-line no-console
      console.log(`${String(got.length).padStart(4)}  ${expected.label}`);
      expect(got, expected.label).toEqual(expected.ids);
    }
  });
});
