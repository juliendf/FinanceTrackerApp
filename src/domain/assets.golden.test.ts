/**
 * Opt-in parity check against the imported database.
 *
 *   ASSET_ROWS=/tmp/ft-rows.json ASSET_TAGS=/tmp/ft-tags.json ORACLE=/tmp/oracle.json \
 *     npx vitest run src/domain/assets.golden.test.ts
 *
 * ASSET_ROWS / ASSET_TAGS are the repository's own queries run through sqlite3
 * against the app database; ORACLE comes from tests/oracle/asset_filters.py,
 * which re-implements `list_assets` straight from the backup JSON. They share no
 * code, so agreement means the import, the schema and the TypeScript filter all
 * reproduce the source query.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, filterAssets, type AssetRow } from "./assets";

const rowsPath = process.env.ASSET_ROWS;
const tagsPath = process.env.ASSET_TAGS;
const oraclePath = process.env.ORACLE;
const enabled = Boolean(rowsPath && tagsPath && oraclePath && existsSync(rowsPath) && existsSync(tagsPath) && existsSync(oraclePath));

const FILTERS: Record<string, Partial<typeof EMPTY_FILTERS>> = {
  "search=boursorama": { search: "boursorama" },
  "currency=CHF": { currency: "CHF" },
  "category=Courant + institution=Credit Mutuel": { category: "Courant", institution: "Credit Mutuel" },
  "tag=Illiquide": { tag: "Illiquide" },
  "search=courant + currency=EUR": { search: "courant", currency: "EUR" },
  "search=SCPI (matches institution, product and category)": { search: "SCPI" },
  "no filters": {},
};

describe("asset filters against the real imported data", () => {
  it.skipIf(!enabled)("match the independent oracle on every filter set", () => {
    const rows = JSON.parse(readFileSync(rowsPath as string, "utf8")) as Omit<AssetRow, "tags">[];
    const links = JSON.parse(readFileSync(tagsPath as string, "utf8")) as Array<{
      asset_id: number; id: number; name: string; color: string | null;
    }>;
    const assets: AssetRow[] = rows.map((row) => ({
      ...row,
      tags: links.filter((l) => l.asset_id === row.id).map((l) => ({ id: l.id, name: l.name, color: l.color })),
    }));

    const oracle = JSON.parse(readFileSync(oraclePath as string, "utf8")) as Array<{
      label: string; count: number; ids: number[];
    }>;

    for (const expected of oracle) {
      const filters = FILTERS[expected.label];
      expect(filters, `unknown filter set ${expected.label}`).toBeDefined();
      const got = filterAssets(assets, { ...EMPTY_FILTERS, ...filters });
      // eslint-disable-next-line no-console
      console.log(`${String(got.length).padStart(3)}  ${expected.label}`);
      expect(got.map((r) => r.id).sort((a, b) => a - b), expected.label).toEqual(expected.ids);
      expect(got.length).toBe(expected.count);
    }
  });
});
