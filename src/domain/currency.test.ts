/**
 * Currency conversion tests.
 *
 * Expected values come from `ExchangeRate.get_rate` and `CurrencyConverter` in
 * the source: identity, direct, inverse (`1 / rate`), then — for the converter
 * only — a hop through EUR/USD/CHF, then the unconverted amount.
 */

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { convertStrict, CurrencyConverter, NoRateError, RateTable } from "./currency";

const DEMO = new RateTable([
  { from_currency: "EUR", to_currency: "CHF", rate: "0.95" },
  { from_currency: "EUR", to_currency: "USD", rate: "1.1" },
]);

describe("RateTable.find — ExchangeRate.get_rate", () => {
  it("is 1 for the same currency", () => {
    expect(DEMO.find("EUR", "EUR")?.toString()).toBe("1");
  });

  it("uses a direct rate", () => {
    expect(DEMO.find("EUR", "CHF")?.toString()).toBe("0.95");
  });

  it("uses 1 / rate for the inverse pair", () => {
    expect(DEMO.find("CHF", "EUR")?.toString()).toBe(new Decimal(1).dividedBy("0.95").toString());
  });

  it("prefers a stored direct rate over the inverse of the opposite one", () => {
    const both = new RateTable([
      { from_currency: "EUR", to_currency: "CHF", rate: "0.95" },
      { from_currency: "CHF", to_currency: "EUR", rate: "1.0526" },
    ]);
    expect(both.find("CHF", "EUR")?.toString()).toBe("1.0526");
  });

  it("returns null with no path, and does not hop", () => {
    expect(DEMO.find("CHF", "USD")).toBeNull();
  });

  it("ignores unusable rates", () => {
    const bad = new RateTable([
      { from_currency: "EUR", to_currency: "CHF", rate: "0" },
      { from_currency: "EUR", to_currency: "USD", rate: "-2" },
    ]);
    expect(bad.find("EUR", "CHF")).toBeNull();
    expect(bad.find("EUR", "USD")).toBeNull();
  });
});

describe("convertStrict — convert_amount", () => {
  it("returns the amount unchanged for the same currency, without a rate", () => {
    expect(convertStrict("12.34", "EUR", "EUR", new RateTable([])).toString()).toBe("12.34");
  });

  it("multiplies by the rate", () => {
    expect(convertStrict(100, "EUR", "CHF", DEMO).toString()).toBe("95");
  });

  it("throws NoRateError when no direct or inverse rate exists", () => {
    expect(() => convertStrict(100, "CHF", "USD", DEMO)).toThrow(NoRateError);
    expect(() => convertStrict(100, "CHF", "USD", DEMO)).toThrow("No exchange rate available for CHF to USD");
  });
});

describe("CurrencyConverter.convert — dashboard path", () => {
  it("converts directly when it can", () => {
    const converter = new CurrencyConverter(DEMO, "CHF");
    expect(converter.convert(100, "EUR").toString()).toBe("95");
    expect(converter.hasWarnings).toBe(false);
  });

  it("falls back to a hop through a third currency", () => {
    // CHF -> USD: no direct pair, but CHF->EUR (inverse) then EUR->USD exists.
    const converter = new CurrencyConverter(DEMO, "USD");
    const expected = new Decimal(100).times(new Decimal(1).dividedBy("0.95")).times("1.1");
    expect(converter.convert(100, "CHF").toString()).toBe(expected.toString());
    expect(converter.hasWarnings).toBe(false);
  });

  it("returns the unconverted amount and records a warning when nothing works", () => {
    const converter = new CurrencyConverter(new RateTable([]), "CHF");
    expect(converter.convert(100, "EUR").toString()).toBe("100");
    expect(converter.warnings).toEqual([{ from: "EUR", to: "CHF" }]);
  });

  it("records each failing pair once", () => {
    const converter = new CurrencyConverter(new RateTable([]), "CHF");
    converter.convert(1, "EUR");
    converter.convert(2, "EUR");
    converter.convert(3, "USD");
    expect(converter.warnings).toHaveLength(2);
  });

  it("honours an explicit target currency", () => {
    const converter = new CurrencyConverter(DEMO, "CHF");
    expect(converter.convert(110, "USD", "EUR").toString()).toBe(new Decimal(110).times(new Decimal(1).dividedBy("1.1")).toString());
  });
});
