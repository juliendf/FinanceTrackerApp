/**
 * Dev-only sample data.
 *
 * Ports the *spirit* of `app/demo_data.py` (deterministic, seeded, never runs
 * on its own) without the user/profile/chat parts, which have no tables yet.
 * Exists so the spike chart has something to draw and so screenshots look real.
 * Phase 1 replaces this with the "Load sample data" action in Settings.
 */

import { executeWrite } from "../db/client";
import { toMinorUnits } from "../domain/money";

/** Deterministic LCG — no Math.random, so repeated runs are identical. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function monthsAgo(count: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

interface SampleAsset {
  institution: string;
  category: string;
  currency: string;
  product_name: string;
  name: string | null;
  start: number;
  monthlyChange: number;
}

const SAMPLE_ASSETS: SampleAsset[] = [
  {
    institution: "UBS",
    category: "Savings",
    currency: "CHF",
    product_name: "Savings Account",
    name: null,
    start: 24_500,
    monthlyChange: 600,
  },
  {
    institution: "UBS",
    category: "Investments",
    currency: "CHF",
    product_name: "Global Equity Fund",
    name: "Pension portfolio",
    start: 48_000,
    monthlyChange: 850,
  },
  {
    institution: "Swissquote",
    category: "Investments",
    currency: "EUR",
    product_name: "ETF World",
    name: null,
    start: 31_000,
    monthlyChange: 410,
  },
];

/** Insert sample reference data, assets and 12 monthly snapshots each. */
export async function loadSampleData(): Promise<void> {
  const random = seeded(20_250_808);
  const dates = monthsAgo(12);

  const institutions = [...new Set(SAMPLE_ASSETS.map((a) => a.institution))];
  const categories = [...new Set(SAMPLE_ASSETS.map((a) => a.category))];

  const institutionIds = new Map<string, number>();
  for (const name of institutions) {
    const result = await executeWrite(
      `INSERT INTO institutions (name) VALUES (?)`,
      [name],
    );
    institutionIds.set(name, Number(result.lastInsertId));
  }

  const categoryIds = new Map<string, number>();
  const categoryColors: Record<string, string> = {
    Savings: "#0d9488",
    Investments: "#2563eb",
  };
  for (const name of categories) {
    const result = await executeWrite(
      `INSERT INTO categories (name, color, system_role) VALUES (?, ?, ?)`,
      [name, categoryColors[name] ?? "#6c757d", name === "Savings" ? "cash" : "stocks"],
    );
    categoryIds.set(name, Number(result.lastInsertId));
  }

  for (const sample of SAMPLE_ASSETS) {
    const result = await executeWrite(
      `INSERT INTO assets (institution_id, category_id, currency, product_name, name, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        institutionIds.get(sample.institution)!,
        categoryIds.get(sample.category)!,
        sample.currency,
        sample.product_name,
        sample.name,
        "Sample data",
      ],
    );
    const assetId = Number(result.lastInsertId);

    let value = sample.start;
    for (const date of dates) {
      // A little noise so the line is not perfectly straight.
      const wobble = 1 + (random() - 0.5) * 0.04;
      value = Math.round(value * wobble + sample.monthlyChange);
      await executeWrite(
        `INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (?, ?, ?)`,
        [assetId, date, toMinorUnits(String(value))],
      );
    }
  }
}

/** Remove everything, for repeated spike runs. */
export async function resetData(): Promise<void> {
  await executeWrite(`DELETE FROM snapshots`);
  await executeWrite(`DELETE FROM assets`);
  await executeWrite(`DELETE FROM categories`);
  await executeWrite(`DELETE FROM institutions`);
}
