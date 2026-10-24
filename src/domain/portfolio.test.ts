import { describe, expect, it } from "vitest";
import type { SnapshotPoint } from "./portfolio";
import { buildPortfolioSeries, daysSince, freshness, summariseAssets } from "./portfolio";

const point = (
  asset_id: number,
  date: string,
  amount_minor: number,
  currency = "EUR",
): SnapshotPoint => ({ asset_id, date, amount_minor, currency });

describe("buildPortfolioSeries", () => {
  it("returns nothing for no snapshots", () => {
    const series = buildPortfolioSeries([]);
    expect(series.points).toEqual([]);
    expect(series.mixedCurrencies).toBe(false);
  });

  it("emits one point per date and carries values forward", () => {
    const series = buildPortfolioSeries([
      point(1, "2025-01-01", 100_00),
      point(2, "2025-01-01", 50_00),
      point(1, "2025-02-01", 120_00),
      point(2, "2025-03-01", 60_00),
    ]);

    expect(series.points).toEqual([
      { date: "2025-01-01", totalMinor: 150_00 },
      { date: "2025-02-01", totalMinor: 170_00 },
      // Asset 2 carries its 50 forward, then updates to 60.
      { date: "2025-03-01", totalMinor: 180_00 },
    ]);
  });

  it("sums multiple snapshots on the same date before emitting", () => {
    const series = buildPortfolioSeries([
      point(1, "2025-01-01", 10_00),
      point(2, "2025-01-01", 20_00),
      point(3, "2025-01-01", 30_00),
    ]);

    expect(series.points).toHaveLength(1);
    expect(series.points[0].totalMinor).toBe(60_00);
  });

  it("sorts unsorted input", () => {
    const series = buildPortfolioSeries([
      point(1, "2025-03-01", 30_00),
      point(1, "2025-01-01", 10_00),
      point(1, "2025-02-01", 20_00),
    ]);

    expect(series.points.map((p) => p.date)).toEqual([
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
    ]);
  });

  it("flags mixed currencies instead of converting them", () => {
    const series = buildPortfolioSeries([
      point(1, "2025-01-01", 10_00, "EUR"),
      point(2, "2025-01-01", 10_00, "CHF"),
    ]);

    expect(series.mixedCurrencies).toBe(true);
    expect(series.currencies).toEqual(["CHF", "EUR"]);
  });

  it("does not mutate its input", () => {
    const input = [point(1, "2025-02-01", 20_00), point(1, "2025-01-01", 10_00)];
    const copy = [...input];
    buildPortfolioSeries(input);
    expect(input).toEqual(copy);
  });
});

describe("summariseAssets", () => {
  it("groups by currency and tracks the date range", () => {
    const summary = summariseAssets([
      { currency: "EUR", latest_amount_minor: 100_00, latest_date: "2025-01-15" },
      { currency: "EUR", latest_amount_minor: 50_00, latest_date: "2025-02-20" },
      { currency: "CHF", latest_amount_minor: 70_00, latest_date: "2025-03-01" },
    ]);

    expect(summary.totalAssets).toBe(3);
    expect(summary.byCurrency).toEqual([
      { currency: "CHF", totalMinor: 70_00, assetCount: 1, snapshotCount: 1 },
      { currency: "EUR", totalMinor: 150_00, assetCount: 2, snapshotCount: 2 },
    ]);
    expect(summary.dateRange).toEqual({
      start: "2025-01-15",
      end: "2025-03-01",
    });
  });

  it("counts assets with no snapshots", () => {
    const summary = summariseAssets([
      { currency: "EUR", latest_amount_minor: null, latest_date: null },
      { currency: "EUR", latest_amount_minor: 10_00, latest_date: "2025-01-01" },
    ]);

    expect(summary.totalAssets).toBe(2);
    expect(summary.assetsWithoutSnapshots).toBe(1);
    expect(summary.byCurrency[0].assetCount).toBe(1);
  });
});

describe("daysSince", () => {
  const today = new Date("2025-06-15T10:30:00Z");

  it("counts whole days", () => {
    expect(daysSince("2025-06-15", today)).toBe(0);
    expect(daysSince("2025-06-14", today)).toBe(1);
    expect(daysSince("2025-05-16", today)).toBe(30);
  });

  it("clamps future dates to zero, as filters.py does", () => {
    expect(daysSince("2025-07-01", today)).toBe(0);
  });

  it("returns zero for a missing date", () => {
    expect(daysSince(null, today)).toBe(0);
  });
});

describe("freshness", () => {
  const today = new Date("2025-06-15T00:00:00Z");

  it("matches the source thresholds: <=30 current, <=90 outdated, else stale", () => {
    expect(freshness("2025-06-15", today)).toBe("current");
    expect(freshness("2025-05-16", today)).toBe("current"); // 30 days
    expect(freshness("2025-05-15", today)).toBe("outdated"); // 31 days
    expect(freshness("2025-03-17", today)).toBe("outdated"); // 90 days
    expect(freshness("2025-03-16", today)).toBe("stale"); // 91 days
  });

  it("reports no-data without a date", () => {
    expect(freshness(null, today)).toBe("no-data");
  });
});
