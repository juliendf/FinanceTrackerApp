/**
 * Portfolio aggregations. Pure functions, no Tauri imports, unit-tested.
 *
 * Phase 0 covers the two things the spike needs: a portfolio value series for
 * the chart and the summary tiles for the asset list. The full port
 * (`latest-per-asset`, distribution by dimension, résumé/annualised
 * performance) is Phase 5 and will extend this module.
 *
 * Deliberate limitation, tracked in docs/DEVIATIONS.md: there is no currency
 * conversion yet (the exchange_rates table arrives in Phase 1), so the series
 * sums raw minor units across currencies. `mixedCurrencies` is surfaced so the
 * UI can say so instead of showing a silently wrong total.
 */

import Decimal from "decimal.js";
import { daysSince } from "./format";
import { sumMinor } from "./money";

export interface SnapshotPoint {
  asset_id: number;
  date: string;
  amount_minor: number;
  currency: string;
}

export interface PortfolioPoint {
  date: string;
  totalMinor: number;
}

export interface PortfolioSeries {
  points: PortfolioPoint[];
  currencies: string[];
  mixedCurrencies: boolean;
}

/**
 * Total portfolio value over time, carrying each asset's last known value
 * forward.
 *
 * One pass over the points sorted by date, instead of the source's
 * O(dates x assets x snapshots) loop in `routes/api.py:74-157`. Output is the
 * same: a point per date that has at least one snapshot, each asset
 * contributing its most recent value on or before that date.
 */
export function buildPortfolioSeries(
  points: readonly SnapshotPoint[],
): PortfolioSeries {
  const ordered = [...points].sort((a, b) =>
    a.date === b.date ? a.asset_id - b.asset_id : a.date.localeCompare(b.date),
  );

  const lastPerAsset = new Map<number, number>();
  const currencies = new Set<string>();
  const series: PortfolioPoint[] = [];

  let index = 0;
  while (index < ordered.length) {
    const date = ordered[index].date;

    // Apply every snapshot recorded on this date before emitting a point.
    while (index < ordered.length && ordered[index].date === date) {
      const point = ordered[index];
      lastPerAsset.set(point.asset_id, point.amount_minor);
      currencies.add(point.currency);
      index += 1;
    }

    series.push({
      date,
      totalMinor: sumMinor(lastPerAsset.values()),
    });
  }

  return {
    points: series,
    currencies: [...currencies].sort(),
    mixedCurrencies: currencies.size > 1,
  };
}

export interface CurrencyTotal {
  currency: string;
  totalMinor: number;
  snapshotCount: number;
  assetCount: number;
}

export interface AssetSummaryInput {
  currency: string;
  latest_amount_minor: number | null;
  latest_date: string | null;
}

export interface AssetSummary {
  totalAssets: number;
  byCurrency: CurrencyTotal[];
  dateRange: { start: string | null; end: string | null };
  assetsWithoutSnapshots: number;
}

/**
 * KPI tiles for the asset list, mirroring `list_assets()` in
 * `app/routes/assets.py` minus the cross-currency conversion.
 */
export function summariseAssets(
  rows: readonly AssetSummaryInput[],
): AssetSummary {
  const buckets = new Map<string, CurrencyTotal>();
  let withoutSnapshots = 0;
  let start: string | null = null;
  let end: string | null = null;

  for (const row of rows) {
    if (row.latest_amount_minor === null) {
      withoutSnapshots += 1;
      continue;
    }

    const bucket = buckets.get(row.currency) ?? {
      currency: row.currency,
      totalMinor: 0,
      snapshotCount: 0,
      assetCount: 0,
    };
    bucket.totalMinor = new Decimal(bucket.totalMinor)
      .plus(row.latest_amount_minor)
      .toNumber();
    bucket.assetCount += 1;
    bucket.snapshotCount += 1;
    buckets.set(row.currency, bucket);

    if (row.latest_date) {
      if (!start || row.latest_date < start) start = row.latest_date;
      if (!end || row.latest_date > end) end = row.latest_date;
    }
  }

  return {
    totalAssets: rows.length,
    byCurrency: [...buckets.values()].sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
    dateRange: { start, end },
    assetsWithoutSnapshots: withoutSnapshots,
  };
}

/** Whole days between a date and today. Negative clamps to 0, as `filters.py` does. */
export { daysSince };

export type FreshnessStatus = "current" | "outdated" | "stale" | "no-data";

/**
 * Source thresholds from `templates/assets/list.html`: green under 30 days,
 * yellow under 90, red beyond. Kept identical so the badges read the same.
 */
export function freshness(date: string | null, today = new Date()): FreshnessStatus {
  if (!date) return "no-data";
  const days = daysSince(date, today);
  if (days <= 30) return "current";
  if (days <= 90) return "outdated";
  return "stale";
}
