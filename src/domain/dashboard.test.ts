import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { CurrencyConverter, RateTable } from "./currency";
import {
  assetEvolution,
  daysBetween,
  distribution,
  evolutionCutoff,
  latestPerAsset,
  portfolioEvolution,
  resumeMetrics,
  summarise,
  type Fact,
} from "./dashboard";

const fact = (asset_id: number, date: string, amount: number, over: Partial<Fact> = {}): Fact => ({
  asset_id,
  date,
  amount_minor: Math.round(amount * 100),
  currency: "EUR",
  institution_name: "UBS",
  category_name: "Cash",
  product_name: `P${asset_id}`,
  system_role: null,
  ...over,
});

const eur = () => new CurrencyConverter(new RateTable([]), "EUR");
const chf = () =>
  new CurrencyConverter(new RateTable([{ from_currency: "EUR", to_currency: "CHF", rate: "0.9" }]), "CHF");
const D = (n: number | string) => new Decimal(n);

describe("latestPerAsset", () => {
  const facts = [fact(1, "2026-01-01", 1), fact(1, "2026-03-01", 3), fact(2, "2026-02-01", 2)];
  it("takes each asset's newest snapshot", () => {
    expect(latestPerAsset(facts).map((f) => f.amount_minor).sort()).toEqual([200, 300]);
  });
  it("as of a date, ignores later snapshots", () => {
    expect(latestPerAsset(facts, "2026-02-15").map((f) => f.asset_id).sort()).toEqual([1, 2]);
    expect(latestPerAsset(facts, "2026-02-15").find((f) => f.asset_id === 1)?.amount_minor).toBe(100);
    expect(latestPerAsset(facts, "2025-12-31")).toEqual([]);
  });
});

describe("summarise", () => {
  it("converts to the base currency, counts assets and currencies, and ages the newest snapshot", () => {
    const facts = [fact(1, "2026-01-01", 100), fact(2, "2026-02-01", 50, { currency: "USD" })];
    const s = summarise(facts, ["EUR", "USD", "EUR"], new CurrencyConverter(new RateTable([{ from_currency: "USD", to_currency: "EUR", rate: "0.5" }]), "EUR"), "2026-02-11");
    expect(s.portfolioValue.toString()).toBe("125");
    expect(s.totalAssets).toBe(3);
    expect(s.currencies).toEqual(["EUR", "USD"]);
    expect(s.daysSinceUpdate).toBe(10);
  });
  it("is empty-safe", () => {
    const s = summarise([], [], eur(), "2026-01-01");
    expect(s.portfolioValue.toString()).toBe("0");
    expect(s.daysSinceUpdate).toBe(0);
  });
});

describe("distribution", () => {
  const facts = [
    fact(1, "2026-01-01", 100, { category_name: "A" }),
    fact(2, "2026-01-01", 100, { category_name: "A", currency: "USD" }),
    fact(3, "2026-01-01", 200, { category_name: "B" }),
  ];
  it("sums per group in the base currency and gives percentages", () => {
    const conv = new CurrencyConverter(new RateTable([{ from_currency: "USD", to_currency: "EUR", rate: "0.5" }]), "EUR");
    const slices = distribution(facts, "category", conv);
    expect(slices.map((s) => [s.label, s.amount.toString()])).toEqual([["A", "150"], ["B", "200"]]);
    expect(slices[0].percent.toFixed(2)).toBe("42.86");
  });
  it("by currency keeps native amounts", () => {
    const slices = distribution(facts, "currency", eur());
    expect(slices.map((s) => [s.label, s.amount.toString()])).toEqual([["EUR", "300"], ["USD", "100"]]);
  });
  it("uses only each asset's latest snapshot", () => {
    const slices = distribution([fact(1, "2026-01-01", 10), fact(1, "2026-02-01", 20)], "category", eur());
    expect(slices[0].amount.toString()).toBe("20");
  });
});

describe("portfolioEvolution", () => {
  const facts = [fact(1, "2026-01-01", 100), fact(2, "2026-02-01", 50), fact(1, "2026-03-01", 120)];
  it("carries each asset's last value forward", () => {
    const e = portfolioEvolution(facts, eur(), "ALL", "2026-06-01", D(170));
    expect(e.points.map((p) => [p.date, p.value.toString()])).toEqual([
      ["2026-01-01", "100"],
      ["2026-02-01", "150"],
      ["2026-03-01", "170"],
    ]);
    expect(e.percentChange?.toString()).toBe("70");
  });
  it("forces the last point to the summary value", () => {
    const e = portfolioEvolution(facts, eur(), "ALL", "2026-06-01", D(999));
    expect(e.points[2].value.toString()).toBe("999");
  });
  it("carryIn: false drops assets whose last snapshot predates the cut-off", () => {
    const e = portfolioEvolution(facts, eur(), "1M", "2026-03-15", D(170), { carryIn: false });
    expect(e.points.map((p) => [p.date, p.value.toString()])).toEqual([["2026-03-01", "170"]]);
  });
  it("by default each asset starts from its last value before the cut-off", () => {
    const more = [...facts, fact(1, "2026-03-10", 130)];
    // 1M from 2026-03-15 -> cut-off 2026-02-13: asset 2 (50 on 2026-02-01) and asset 1 (100 on 01-01) carry in.
    const e = portfolioEvolution(more, eur(), "1M", "2026-03-15", D(180));
    expect(e.points.map((p) => [p.date, p.value.toString()])).toEqual([
      ["2026-02-13", "150"],
      ["2026-03-01", "170"],
      ["2026-03-10", "180"],
    ]);
    expect(e.percentChange?.toFixed(2)).toBe("20.00");
  });
  it("opens the range with the carried-in value when no snapshot is on the cut-off", () => {
    // One snapshot inside the window: without the opening point the chart had a
    // single dot and no line.
    const e = portfolioEvolution(facts, eur(), "1W", "2026-03-05", D(170));
    expect(e.points.map((p) => [p.date, p.value.toString()])).toEqual([
      ["2026-02-26", "150"],
      ["2026-03-01", "170"],
    ]);
    expect(e.percentChange?.toFixed(2)).toBe("13.33");
  });
  it("draws a flat line to today when the range holds no snapshot at all", () => {
    const e = portfolioEvolution(facts, eur(), "1W", "2026-12-01", D(170));
    expect(e.points.map((p) => p.date)).toEqual(["2026-11-24", "2026-12-01"]);
    expect(e.points[0].value.toString()).toBe("170");
    expect(e.percentChange?.toString()).toBe("0");
  });
  it("carry-in does not change ALL", () => {
    const a = portfolioEvolution(facts, eur(), "ALL", "2026-06-01", D(170));
    const b = portfolioEvolution(facts, eur(), "ALL", "2026-06-01", D(170), { carryIn: false });
    expect(a).toEqual(b);
  });
  it("has no percent when there is no data at all", () => {
    const e = portfolioEvolution([], eur(), "1W", "2026-12-01", D(0));
    expect(e.points).toEqual([]);
    expect(e.percentChange).toBeNull();
  });
  it("converts each value to the base currency", () => {
    const e = portfolioEvolution([fact(1, "2026-01-01", 100)], chf(), "ALL", "2026-02-01", D(90));
    expect(e.points[0].value.toString()).toBe("90");
  });
  it("handles a zero first value without dividing by zero", () => {
    const e = portfolioEvolution([fact(1, "2026-01-01", 0.0), fact(1, "2026-02-01", 5)], eur(), "ALL", "2026-03-01", D(5));
    expect(e.percentChange).toBeNull();
  });
  it("YTD starts on 1 January and unknown ranges have no bound", () => {
    expect(evolutionCutoff("YTD", "2026-10-26")).toBe("2026-01-01");
    expect(evolutionCutoff("1W", "2026-10-26")).toBe("2026-10-19");
    expect(evolutionCutoff("nope", "2026-10-26")).toBeNull();
  });
});

describe("resumeMetrics", () => {
  const facts = [fact(1, "2025-10-01", 100, { system_role: "cash" }), fact(1, "2026-10-01", 121, { system_role: "cash" }), fact(2, "2026-10-01", 50)];
  it("computes performance from the value at the start of the period", () => {
    const r = resumeMetrics(facts, eur(), "ALL", "2026-10-01");
    expect(r.startDate).toBe("2025-10-01");
    expect(r.investedCapital.toString()).toBe("100");
    expect(r.totalValue.toString()).toBe("171");
    expect(r.netPerformanceAbs.toString()).toBe("71");
    expect(r.netPerformancePct?.toString()).toBe("71");
    expect(r.timeInMarket).toBe(365);
    expect(r.annualizedPerformance?.toFixed(2)).toBe("71.06");
  });
  it("splits cash and breaks down by system role in French", () => {
    const r = resumeMetrics(facts, eur(), "ALL", "2026-10-01");
    expect(r.cashValue.toString()).toBe("121");
    expect(r.emergencyFundValue.toString()).toBe("0");
    // Sorted by role key: cash before other.
    expect(r.breakdown.map((b) => [b.label, b.value.toString()])).toEqual([
      ["Liquidités", "121"],
      ["Autre", "50"],
    ]);
  });
  it("has no percentage when nothing was held at the start", () => {
    const r = resumeMetrics([fact(1, "2026-10-01", 50)], eur(), "ALL", "2026-10-01");
    expect(r.investedCapital.toString()).toBe("50");
    expect(r.annualizedPerformance).toBeNull(); // start === end
    // First snapshot after the period start: nothing held at the start, so no percentage.
    const r3 = resumeMetrics([fact(1, "2026-10-10", 50)], eur(), "1M", "2026-10-15");
    expect(r3.investedCapital.toString()).toBe("0");
    expect(r3.netPerformancePct).toBeNull();
    expect(r3.annualizedPerformance).toBeNull();
  });
  it("is empty-safe", () => {
    const r = resumeMetrics([], eur(), "ALL", "2026-10-01");
    expect(r.startDate).toBeNull();
    expect(r.timeInMarket).toBeNull();
    expect(r.totalValue.toString()).toBe("0");
  });
});

describe("helpers", () => {
  it("daysBetween", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2026-02-01", "2026-01-01")).toBe(-31);
  });
  it("assetEvolution returns native amounts, oldest first", () => {
    const pts = assetEvolution([fact(1, "2026-02-01", 2), fact(1, "2026-01-01", 1), fact(2, "2026-01-01", 9)], 1);
    expect(pts.map((p) => [p.date, p.value.toString()])).toEqual([["2026-01-01", "1"], ["2026-02-01", "2"]]);
  });
});
