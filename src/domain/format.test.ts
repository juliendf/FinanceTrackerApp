/**
 * `format.ts` tests.
 *
 * The expected strings on the left of each case are the canonical output for
 * each input, cross-checked against an independent implementation of the same
 * rules rather than written by hand.
 */

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatMinorAsCurrency,
  formatPercentage,
  formatPercentValue,
  relativeDate,
} from "./format";

describe("formatCurrency", () => {
  const cases: Array<[Decimal.Value | null, string, string]> = [
    // value, currency, expected
    [null, "USD", "N/A"],
    [0, "USD", "$0.00"],
    [1234.5, "USD", "$1,234.50"],
    [1234.5, "EUR", "€1,234.50"],
    [1234.5, "CHF", "1,234.50 CHF "],
    [-1234.567, "USD", "$-1,234.57"],
    [1000000, "JPY", "1,000,000.00 ¥"],
    [12.355, "EUR", "€12.36"],
    ["42.5", "CHF", "42.50 CHF "],
    [1000000, "CAD", "C$1,000,000.00"],
    [99.999, "CHF", "100.00 CHF "],
    ["", "EUR", "N/A"],
    ["abc", "EUR", "N/A"],
  ];

  for (const [value, currency, expected] of cases) {
    it(`${String(value)} ${currency} -> ${JSON.stringify(expected)}`, () => {
      expect(formatCurrency(value, currency)).toBe(expected);
    });
  }

  it("puts the minus sign after the symbol", () => {
    expect(formatCurrency(-1234.567, "USD")).toBe("$-1,234.57");
    expect(formatCurrency(-1234.567, "EUR")).toBe("€-1,234.57");
    expect(formatCurrency(-1234.567, "CHF")).toBe("-1,234.57 CHF ");
  });

  it("defaults to USD when no currency is given", () => {
    expect(formatCurrency(10)).toBe("$10.00");
  });

  it("treats an unknown currency as a suffix code", () => {
    expect(formatCurrency(10, "SEK")).toBe("10.00 SEK ");
  });
});

describe("formatCurrency — half-even tie rounding", () => {
  /**
   * A value whose decimal expansion sits exactly on a half-rounding tie is
   * parsed by its shortest decimal representation and rounds half-even on that
   * decimal value, so 12.345 -> 12.34 and 0.005 -> 0.00, rather than drifting
   * with a binary float representation.
   *
   * These inputs cannot occur through the app: amounts are stored as INTEGER
   * minor units and rates as decimal strings, so every value reaching this
   * function is exact at 2 dp. The cases are pinned so the behaviour is explicit.
   */
  it("12.345 EUR rounds half-even to 12.34", () => {
    expect(formatCurrency(12.345, "EUR")).toBe("€12.34");
  });

  it("0.005 EUR rounds half-even to 0.00", () => {
    expect(formatCurrency(0.005, "EUR")).toBe("€0.00");
  });

  it("0.015 EUR rounds half-even to 0.02", () => {
    expect(formatCurrency(0.015, "EUR")).toBe("€0.02");
  });
});

describe("formatMinorAsCurrency", () => {
  it("formats integer minor units", () => {
    expect(formatMinorAsCurrency(123450, "EUR")).toBe("€1,234.50");
    expect(formatMinorAsCurrency(0, "CHF")).toBe("0.00 CHF ");
  });

  it("returns N/A for a missing value", () => {
    expect(formatMinorAsCurrency(null, "EUR")).toBe("N/A");
    expect(formatMinorAsCurrency(undefined, "EUR")).toBe("N/A");
  });
});

describe("formatPercentage", () => {
  it("scales by 100 and appends %", () => {
    expect(formatPercentage(0)).toBe("0.00%");
    expect(formatPercentage(12.3456)).toBe("1234.56%");
    expect(formatPercentage(-5.5)).toBe("-550.00%");
    expect(formatPercentage(100)).toBe("10000.00%");
    expect(formatPercentage("3.14159")).toBe("314.16%");
    expect(formatPercentage(0.005)).toBe("0.50%");
    expect(formatPercentage(1e-7)).toBe("0.00%");
  });

  it("returns N/A for a missing or unparseable value", () => {
    expect(formatPercentage(null)).toBe("N/A");
    expect(formatPercentage(undefined)).toBe("N/A");
    expect(formatPercentage("")).toBe("N/A");
    expect(formatPercentage("abc")).toBe("N/A");
  });

  it("honours the decimal-place argument", () => {
    expect(formatPercentage(0.12345, 4)).toBe("12.3450%");
    expect(formatPercentage(0.12345, 0)).toBe("12%");
  });
});

describe("formatDate", () => {
  it("defaults to %Y-%m-%d", () => {
    expect(formatDate("2026-10-01")).toBe("2026-10-01");
  });

  it("supports the strftime tokens the app uses", () => {
    expect(formatDate("2026-10-01", "%d/%m/%Y")).toBe("01/10/2026");
    expect(formatDate("2026-01-05", "%m-%d")).toBe("01-05");
  });

  it("returns N/A for null and Invalid date for garbage", () => {
    expect(formatDate(null)).toBe("N/A");
    expect(formatDate(undefined)).toBe("N/A");
    expect(formatDate("not-a-date")).toBe("Invalid date");
  });
});

describe("relativeDate", () => {
  const today = new Date("2026-10-24T12:00:00Z");

  it("returns Never for a missing date", () => {
    expect(relativeDate(null, today)).toBe("Never");
  });

  it("uses Today / Yesterday for the first two days", () => {
    expect(relativeDate("2026-10-24", today)).toBe("Today");
    expect(relativeDate("2026-10-23", today)).toBe("Yesterday");
  });

  it("uses days for under a week", () => {
    expect(relativeDate("2026-10-22", today)).toBe("2 days ago");
    expect(relativeDate("2026-10-18", today)).toBe("6 days ago");
  });

  it("switches to weeks, pluralising only the unit", () => {
    expect(relativeDate("2026-10-17", today)).toBe("1 week ago");
    expect(relativeDate("2026-10-10", today)).toBe("2 weeks ago");
  });

  it("switches to months", () => {
    expect(relativeDate("2026-09-24", today)).toBe("1 month ago");
    expect(relativeDate("2026-07-24", today)).toBe("3 months ago");
  });

  it("switches to years", () => {
    expect(relativeDate("2025-10-24", today)).toBe("1 year ago");
    expect(relativeDate("2023-10-24", today)).toBe("3 years ago");
  });

  it("clamps future dates to Today", () => {
    expect(relativeDate("2026-12-01", today)).toBe("Today");
  });
});

describe("formatDate — month names", () => {
  it("supports %B and %b, as the asset detail page's '%B %d, %Y' needs", () => {
    expect(formatDate("2026-10-01", "%B %d, %Y")).toBe("October 01, 2026");
    expect(formatDate("2026-03-15", "%b %d")).toBe("Mar 15");
  });
});

describe("formatPercentValue — a stored percentage, not a fraction", () => {
  it("shows 1.25 as 1.25%, where the scaling filter would say 125.00%", () => {
    expect(formatPercentValue("1.25")).toBe("1.25%");
    expect(formatPercentage("1.25")).toBe("125.00%");
  });

  it("keeps two decimals as a floor and four as a ceiling", () => {
    expect(formatPercentValue("0.85")).toBe("0.85%");
    expect(formatPercentValue("3")).toBe("3.00%");
    expect(formatPercentValue("0.1234")).toBe("0.1234%");
    expect(formatPercentValue("0.123456")).toBe("0.1235%");
  });

  it("returns N/A for nothing usable", () => {
    expect(formatPercentValue(null)).toBe("N/A");
    expect(formatPercentValue("")).toBe("N/A");
    expect(formatPercentValue("abc")).toBe("N/A");
  });
});
