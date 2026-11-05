/**
 * Dashboard aggregations: summary tiles, distribution, portfolio evolution and
 * the Résumé.
 *
 * Everything is pure and takes "today" as an argument, so results are
 * reproducible with the clock pinned. Amounts are Decimal major units
 * internally; results are rounded to 2 dp half-even where they are displayed.
 *
 * The evolution sorts once and sweeps with a running total rather than
 * re-scanning every snapshot for every date, with the same output.
 */

import Decimal from "decimal.js";
import type { CurrencyConverter } from "./currency";
import { addDays } from "./dates";
import { fromMinorUnits } from "./money";
import { SYSTEM_ROLES, SYSTEM_ROLE_LABELS } from "./systemCategory";

/** One snapshot with every dimension a dashboard groups by. */
export interface Fact {
  asset_id: number;
  date: string;
  amount_minor: number;
  currency: string;
  institution_name: string;
  category_name: string;
  product_name: string;
  system_role: string | null;
}

const major = (minor: number): Decimal => fromMinorUnits(minor) ?? new Decimal(0);
const round2 = (value: Decimal): Decimal => value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

/** Days between two ISO calendar dates (`b - a`). */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

// --- latest / first / as-of ---------------------------------------------------

/** Each asset's snapshot on its latest date at or before `asOf` (no bound when omitted). */
export function latestPerAsset(facts: readonly Fact[], asOf?: string): Fact[] {
  const best = new Map<number, Fact>();
  for (const fact of facts) {
    if (asOf !== undefined && fact.date > asOf) continue;
    const current = best.get(fact.asset_id);
    if (!current || fact.date > current.date) best.set(fact.asset_id, fact);
  }
  return [...best.values()];
}

const convertedSum = (rows: readonly Fact[], converter: CurrencyConverter): Decimal =>
  rows.reduce((sum, row) => sum.plus(converter.convert(major(row.amount_minor), row.currency)), new Decimal(0));

// --- summary tiles ---------------------------------------------------------------

export interface DashboardSummary {
  totalAssets: number;
  portfolioValue: Decimal;
  /**
   * Cash and emergency fund only — what is available now.
   *
   * Not "everything convertible": bonds, shares and property can be sold, but
   * counting them as liquid is how someone concludes they have four years of
   * runway when they have four months.
   */
  liquidValue: Decimal;
  /**
   * Whether any asset is classified as cash or emergency fund.
   *
   * Without this, a zero liquid value is indistinguishable from "the categories
   * were never given a system role" — and the assistant reported the second as
   * if it were the first.
   */
  liquidClassified: boolean;
  currencyCount: number;
  currencies: string[];
  /** Whole days since the newest snapshot; 0 when there are none (`days_since or 0`). */
  daysSinceUpdate: number;
}

/**
 * Summary tiles: total value, per-currency totals and counts.
 *
 * `assetCurrencies` is every asset's currency, snapshot or not: the tiles count
 * the distinct currencies of the assets table.
 */
export function summarise(
  facts: readonly Fact[],
  assetCurrencies: readonly string[],
  converter: CurrencyConverter,
  today: string,
): DashboardSummary {
  const latest = latestPerAsset(facts);
  const newest = facts.reduce<string | null>((max, f) => (max === null || f.date > max ? f.date : max), null);
  const currencies = [...new Set(assetCurrencies)].sort();
  const liquid = latest.filter(
    (row) => row.system_role === SYSTEM_ROLES.CASH || row.system_role === SYSTEM_ROLES.EMERGENCY_FUND,
  );
  return {
    totalAssets: assetCurrencies.length,
    portfolioValue: round2(convertedSum(latest, converter)),
    liquidValue: round2(convertedSum(liquid, converter)),
    liquidClassified: liquid.length > 0,
    currencyCount: currencies.length,
    currencies,
    daysSinceUpdate: newest ? daysBetween(newest, today) : 0,
  };
}

// --- distribution ------------------------------------------------------------------

export type DistributionGroup = "category" | "currency" | "institution" | "product";

export interface DistributionSlice {
  label: string;
  /** Major units, rounded to 2 dp. In the base currency, except for `currency`. */
  amount: Decimal;
  percent: Decimal;
}

/**
 * Distribution: the latest snapshot of each asset, summed per group.
 *
 * By currency the amounts stay native (no conversion). Slices keep first-seen
 * order; the UI sorts for display.
 */
export function distribution(
  facts: readonly Fact[],
  group: DistributionGroup,
  converter: CurrencyConverter,
): DistributionSlice[] {
  const key = (f: Fact): string =>
    group === "category"
      ? f.category_name
      : group === "currency"
        ? f.currency
        : group === "institution"
          ? f.institution_name
          : f.product_name;

  const totals = new Map<string, Decimal>();
  for (const fact of latestPerAsset(facts)) {
    const native = major(fact.amount_minor);
    const value = group === "currency" ? native : converter.convert(native, fact.currency);
    totals.set(key(fact), (totals.get(key(fact)) ?? new Decimal(0)).plus(value));
  }

  const slices = [...totals.entries()].map(([label, total]) => ({ label, amount: round2(total) }));
  const sum = slices.reduce((s, x) => s.plus(x.amount), new Decimal(0));
  return slices.map((s) => ({
    ...s,
    percent: sum.greaterThan(0) ? s.amount.dividedBy(sum).times(100) : new Decimal(0),
  }));
}

// --- portfolio evolution -----------------------------------------------------------

export const EVOLUTION_RANGES = ["1W", "1M", "3M", "6M", "1Y", "YTD", "ALL"] as const;
export type EvolutionRange = (typeof EVOLUTION_RANGES)[number];

const RANGE_DAYS: Record<string, number> = { "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365 };

/** The cut-off date for a range, or null for "no lower bound". Unknown values mean no bound. */
export function evolutionCutoff(range: string, today: string): string | null {
  const upper = range.toUpperCase();
  if (upper === "YTD") return `${today.slice(0, 4)}-01-01`;
  const days = RANGE_DAYS[upper];
  return days === undefined ? null : addDays(today, -days);
}

export interface EvolutionPoint {
  date: string;
  value: Decimal;
}

export interface Evolution {
  points: EvolutionPoint[];
  /** First to last, in percent, 2 dp; null with fewer than two points or a zero start. */
  percentChange: Decimal | null;
}

export interface EvolutionOptions {
  /**
   * Start each asset from its last value *before* the cut-off (default true).
   *
   * With `false`, only snapshots on or after the cut-off are read, so an asset
   * whose last snapshot is older than that vanishes from the whole series and a
   * short range starts absurdly low (one year can read +737%). With `true`,
   * each asset is carried forward from its latest snapshot, which is what the
   * chart is meant to show.
   */
  carryIn?: boolean;
}

/**
 * Portfolio evolution over a range.
 *
 * One point per date that has a snapshot inside the range, each asset
 * contributing its most recent value up to that date, and the final point forced
 * to the summary value.
 */
export function portfolioEvolution(
  facts: readonly Fact[],
  converter: CurrencyConverter,
  range: string,
  today: string,
  summaryValue: Decimal,
  { carryIn = true }: EvolutionOptions = {},
): Evolution {
  const cutoff = evolutionCutoff(range, today);
  const inRange = (cutoff === null ? [...facts] : facts.filter((f) => f.date >= cutoff)).sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.asset_id - b.asset_id),
  );

  const lastValue = new Map<number, Decimal>();
  let running = new Decimal(0);

  if (carryIn && cutoff !== null) {
    const before = latestPerAsset(
      facts.filter((f) => f.date < cutoff),
    );
    for (const fact of before) {
      const value = converter.convert(major(fact.amount_minor), fact.currency);
      lastValue.set(fact.asset_id, value);
      running = running.plus(value);
    }
  }

  /** What the portfolio was worth when the range opens, before any in-range snapshot. */
  const carriedTotal = running;

  const points: EvolutionPoint[] = [];

  let i = 0;
  while (i < inRange.length) {
    const date = inRange[i].date;
    while (i < inRange.length && inRange[i].date === date) {
      const fact = inRange[i];
      const next = converter.convert(major(fact.amount_minor), fact.currency);
      running = running.minus(lastValue.get(fact.asset_id) ?? 0).plus(next);
      lastValue.set(fact.asset_id, next);
      i += 1;
    }
    points.push({ date, value: round2(running) });
  }

  // A range whose first snapshot is after the cut-off still has a value on the
  // day the range opens: the carried-in total. Without this point a week with a
  // single snapshot drew one dot, no line and no percent.
  if (carryIn && cutoff !== null && lastValue.size > 0) {
    if (points.length === 0) {
      points.push({ date: cutoff, value: round2(carriedTotal) });
      if (today > cutoff) points.push({ date: today, value: summaryValue });
    } else if (points[0].date !== cutoff) {
      points.unshift({ date: cutoff, value: round2(carriedTotal) });
    }
  }

  if (points.length > 0) points[points.length - 1].value = summaryValue;

  let percentChange: Decimal | null = null;
  if (points.length >= 2 && !points[0].value.isZero()) {
    const first = points[0].value;
    percentChange = round2(points[points.length - 1].value.minus(first).dividedBy(first).times(100));
  }
  return { points, percentChange };
}

/** `/api/charts/asset-evolution/<id>`: native amounts, oldest first. */
export function assetEvolution(
  facts: readonly Pick<Fact, "asset_id" | "date" | "amount_minor">[],
  assetId: number,
): Array<{ date: string; value: Decimal }> {
  return facts
    .filter((f) => f.asset_id === assetId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((f) => ({ date: f.date, value: major(f.amount_minor) }));
}

// --- Résumé ---------------------------------------------------------------------------

export const RESUME_RANGES = ["ALL", "YTD", "1Y", "6M", "3M", "1M"] as const;

/** `_resolve_date_range`. `null` start means "from the first snapshot". */
export function resumeStart(range: string, today: string): string | null {
  const upper = range.toUpperCase();
  if (upper === "YTD") return `${today.slice(0, 4)}-01-01`;
  const days = ({ "1M": 30, "3M": 90, "6M": 180, "1Y": 365 } as Record<string, number>)[upper];
  return days === undefined ? null : addDays(today, -days);
}

export interface ResumeMetrics {
  range: string;
  startDate: string | null;
  endDate: string;
  timeInMarket: number | null;
  totalValue: Decimal;
  investedCapital: Decimal;
  netPerformanceAbs: Decimal;
  netPerformancePct: Decimal | null;
  annualizedPerformance: Decimal | null;
  cashValue: Decimal;
  emergencyFundValue: Decimal;
  netWorth: Decimal;
  breakdown: Array<{ label: string; value: Decimal }>;
}

/**
 * Résumé metrics for a range.
 *
 * "Invested capital" is the portfolio value at the start date, not money paid
 * in, so the performance includes any deposits made during the period. The
 * annualised figure uses 365.25-day years.
 */
export function resumeMetrics(
  facts: readonly Fact[],
  converter: CurrencyConverter,
  range: string,
  today: string,
): ResumeMetrics {
  let start = resumeStart(range, today);
  if (start === null && facts.length > 0) {
    start = facts.reduce((min, f) => (f.date < min ? f.date : min), facts[0].date);
  }

  const endRows = latestPerAsset(facts, today);
  const startRows = start ? latestPerAsset(facts, start) : [];

  const totalValue = round2(convertedSum(endRows, converter));
  const investedCapital = round2(convertedSum(startRows, converter));
  const netAbs = round2(totalValue.minus(investedCapital));

  let pct: Decimal | null = null;
  let annualized: Decimal | null = null;
  if (investedCapital.greaterThan(0)) {
    pct = round2(netAbs.dividedBy(investedCapital).times(100));
    if (start && start !== today) {
      const years = new Decimal(daysBetween(start, today)).dividedBy(365.25);
      if (years.greaterThan(0)) {
        annualized = round2(
          totalValue.dividedBy(investedCapital).pow(new Decimal(1).dividedBy(years)).minus(1).times(100),
        );
      }
    }
  }

  const byRole = new Map<string, Decimal>();
  for (const row of endRows) {
    const role = row.system_role || SYSTEM_ROLES.OTHER;
    byRole.set(role, (byRole.get(role) ?? new Decimal(0)).plus(converter.convert(major(row.amount_minor), row.currency)));
  }

  const sumRole = (role: string) =>
    round2(
      convertedSum(
        endRows.filter((r) => r.system_role === role),
        converter,
      ),
    );

  return {
    range: range.toUpperCase(),
    startDate: start,
    endDate: today,
    timeInMarket: start ? daysBetween(start, today) : null,
    totalValue,
    investedCapital,
    netPerformanceAbs: netAbs,
    netPerformancePct: pct,
    annualizedPerformance: annualized,
    cashValue: sumRole(SYSTEM_ROLES.CASH),
    emergencyFundValue: sumRole(SYSTEM_ROLES.EMERGENCY_FUND),
    netWorth: totalValue,
    breakdown: [...byRole.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([role, value]) => ({ label: SYSTEM_ROLE_LABELS[role] ?? role, value: round2(value) })),
  };
}
