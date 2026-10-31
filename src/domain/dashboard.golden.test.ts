/**
 * Opt-in parity check against the *source app's own output*.
 *
 *   FACTS=/tmp/ft-facts.json RATES=/tmp/ft-rates.json GOLDEN_DIR=/tmp/ft-golden \
 *     npx vitest run src/domain/dashboard.golden.test.ts
 *
 * GOLDEN_DIR holds `golden-<today>.json` files written by tests/oracle/dashboard.py,
 * which runs the real Flask code against the same backup with the clock frozen.
 * The two implementations share no code. Tolerance is one minor unit (0.01).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { CurrencyConverter, RateTable, type RateRow } from "./currency";
import {
  assetEvolution,
  distribution,
  EVOLUTION_RANGES,
  latestPerAsset,
  portfolioEvolution,
  resumeMetrics,
  summarise,
  type Fact,
} from "./dashboard";

const { FACTS, RATES, GOLDEN_DIR } = process.env;
const enabled = Boolean(FACTS && RATES && GOLDEN_DIR && existsSync(FACTS) && existsSync(RATES) && existsSync(GOLDEN_DIR));

const close = (got: Decimal | number | null, want: number | null, label: string) => {
  if (want === null) return expect(got, label).toBeNull();
  expect(got, label).not.toBeNull();
  expect(Math.abs(Number(got) - want), `${label}: got ${String(got)} want ${want}`).toBeLessThanOrEqual(0.0101);
};

describe("dashboards against the source app's output", () => {
  it.skipIf(!enabled)("match every captured endpoint at every pinned date", () => {
    const facts = JSON.parse(readFileSync(FACTS as string, "utf8")) as Fact[];
    const rates = JSON.parse(readFileSync(RATES as string, "utf8")) as { rates: RateRow[]; base: string; currencies: string[] };
    const files = readdirSync(GOLDEN_DIR as string).filter((f) => f.startsWith("golden-"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const gold = JSON.parse(readFileSync(`${GOLDEN_DIR}/${file}`, "utf8"));
      const today: string = gold.today;
      const converter = new CurrencyConverter(new RateTable(rates.rates), rates.base);

      // summary tiles
      const summary = summarise(facts, rates.currencies, converter, today);
      close(summary.portfolioValue, gold.summary.portfolio_value, `${today} portfolio_value`);
      expect(summary.totalAssets).toBe(gold.summary.total_assets);
      expect(summary.currencyCount).toBe(gold.summary.currency_count);
      expect(summary.daysSinceUpdate).toBe(gold.summary.days_since_update);

      // distributions, compared as label -> amount (the source's order is a SQL accident)
      for (const group of ["category", "currency", "institution", "product"] as const) {
        const want = gold.distribution[group];
        const got = new Map(distribution(facts, group, converter).map((s) => [s.label, s.amount]));
        expect([...got.keys()].sort(), `${today} ${group} labels`).toEqual([...want.labels].sort());
        want.labels.forEach((label: string, i: number) => close(got.get(label) ?? null, want.datasets[0].data[i], `${today} ${group}/${label}`));
      }
      const breakdown = new Map(distribution(facts, "category", converter).map((s) => [s.label, s.amount]));
      for (const item of gold.breakdown) close(breakdown.get(item.label) ?? null, item.value, `${today} breakdown/${item.label}`);

      // evolution, every range
      for (const range of EVOLUTION_RANGES) {
        const want = gold.portfolio[range];
        const got = portfolioEvolution(facts, converter, range, today, summary.portfolioValue, { carryIn: false });
        expect(got.points.map((p) => p.date), `${today} ${range} dates`).toEqual(want.labels);
        got.points.forEach((p, i) => close(p.value, want.datasets[0].data[i], `${today} ${range}[${i}]`));
        close(got.percentChange, want.percent_change, `${today} ${range} percent_change`);
      }

      // résumé, every range including an unknown one
      for (const [range, want] of Object.entries(gold.resume) as Array<[string, Record<string, unknown>]>) {
        const got = resumeMetrics(facts, converter, range, today);
        const label = `${today} resume ${range}`;
        expect(got.range, label).toBe(want.range);
        expect(got.startDate === null ? null : got.startDate, label).toBe(
          want.start_date === null ? null : new Date(want.start_date as string).toISOString().slice(0, 10),
        );
        expect(got.timeInMarket, label).toBe(want.time_in_market);
        close(got.totalValue, want.total_value as number, `${label} total`);
        close(got.investedCapital, want.invested_capital as number, `${label} invested`);
        close(got.netPerformanceAbs, want.net_performance_abs as number, `${label} abs`);
        close(got.netPerformancePct, want.net_performance_pct as number | null, `${label} pct`);
        close(got.annualizedPerformance, want.annualized_performance as number | null, `${label} annualized`);
        close(got.cashValue, want.cash_value as number, `${label} cash`);
        close(got.emergencyFundValue, want.emergency_fund_value as number, `${label} emergency`);
        const wantBreakdown = want.asset_breakdown as Array<{ label: string; value: number }>;
        expect(got.breakdown.map((b) => b.label), label).toEqual(wantBreakdown.map((b) => b.label));
        got.breakdown.forEach((b, i) => close(b.value, wantBreakdown[i].value, `${label} ${b.label}`));
      }

      // per-asset series (native amounts)
      for (const [id, want] of Object.entries(gold.asset) as Array<[string, { labels: string[]; datasets: Array<{ data: number[] }> }]>) {
        // The oracle database numbers assets afresh, so match by institution + product.
        const key = gold.asset_keys[id] as { institution: string; product: string };
        const match = facts.find((f) => f.institution_name === key.institution && f.product_name === key.product);
        const got = match ? assetEvolution(facts, match.asset_id) : [];
        expect(got.map((p) => p.date), `${today} asset ${id}`).toEqual(want.labels);
        got.forEach((p, i) => close(p.value, want.datasets[0].data[i], `${today} asset ${id}[${i}]`));
      }

      // sanity: the latest-per-asset rows are what the tile is built from
      expect(latestPerAsset(facts).length).toBeGreaterThan(0);
    }
  });
});
