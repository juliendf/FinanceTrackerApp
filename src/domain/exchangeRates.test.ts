import { describe, expect, it } from "vitest";
import {
  derivedRatePairs,
  formatRate,
  ratesMatchLastFetch,
  ratesToWrite,
  rateText,
  sameRate,
  validateRates,
} from "./exchangeRates";

describe("exchange rates", () => {
  it("shows up to 6 decimal places without trailing zeros", () => {
    expect(formatRate("0.9319")).toBe("0.9319");
    // Half-even: the 7th digit is 5, the 6th is even.
    expect(formatRate("1.0730765")).toBe("1.073076");
    expect(formatRate("0.900000")).toBe("0.9");
    expect(formatRate("0")).toBe("0");
  });

  it("requires a rate", () => {
    expect(validateRates([{ from: "EUR", to: "CHF", rate: "  " }])).toEqual([
      { pair: "EUR->CHF", message: "Rate is required" },
    ]);
    expect(validateRates([{ from: "EUR", to: "CHF", rate: "abc" }])[0].message).toBe("Rate is required");
  });

  it("requires a positive rate, down to six places", () => {
    expect(validateRates([{ from: "EUR", to: "CHF", rate: "0" }])[0].message).toBe("Rate must be positive");
    expect(validateRates([{ from: "EUR", to: "CHF", rate: "-1" }])[0].message).toBe("Rate must be positive");
    expect(validateRates([{ from: "EUR", to: "CHF", rate: "0.0000001" }])[0].message).toBe("Rate must be positive");
    expect(validateRates([{ from: "EUR", to: "CHF", rate: "0.000001" }])).toEqual([]);
  });

  it("stores full precision without an exponent", () => {
    expect(rateText("1.0730765")).toBe("1.0730765");
    expect(rateText("0.500000")).toBe("0.5");
  });
});

describe("derivedRatePairs", () => {
  const ecb = { USD: "1.1267", CHF: "0.9188" };

  it("derives both directions of every pair from EUR-based rates", () => {
    const pairs = derivedRatePairs(ecb);
    const find = (from: string, to: string) => pairs.find((p) => p.from === from && p.to === to)?.rate;

    // Published directly by the ECB.
    expect(find("EUR", "USD")).toBe("1.1267");
    expect(find("EUR", "CHF")).toBe("0.9188");
    // The inverse is a division, not a second publication.
    expect(find("USD", "EUR")).toBe("0.887548"); // 1 / 1.1267
    // The cross rate: CHF per USD = (CHF per EUR) / (USD per EUR).
    expect(find("USD", "CHF")).toBe("0.815479"); // 0.9188 / 1.1267
    expect(find("CHF", "USD")).toBe("1.226273");
    // Six directed pairs among three currencies, never a self-pair.
    expect(pairs).toHaveLength(6);
    expect(pairs.some((p) => p.from === p.to)).toBe(false);
  });

  it("round-trips: a pair times its inverse is one", () => {
    const pairs = derivedRatePairs(ecb);
    const forward = Number(pairs.find((p) => p.from === "USD" && p.to === "CHF")?.rate);
    const back = Number(pairs.find((p) => p.from === "CHF" && p.to === "USD")?.rate);
    expect(forward * back).toBeCloseTo(1, 5);
  });

  it("leaves out a currency the ECB did not publish", () => {
    const pairs = derivedRatePairs({ USD: "1.1267" });
    // CHF is absent, so no pair mentions it rather than a made-up rate.
    expect(pairs.some((p) => p.from === "CHF" || p.to === "CHF")).toBe(false);
    expect(pairs.find((p) => p.from === "EUR" && p.to === "USD")?.rate).toBe("1.1267");
  });

  it("ignores a zero or unreadable rate", () => {
    const pairs = derivedRatePairs({ USD: "0", CHF: "0.9188" });
    expect(pairs.some((p) => p.from === "USD" || p.to === "USD")).toBe(false);
  });
});

describe("ratesToWrite", () => {
  const derived = derivedRatePairs({ USD: "1.1267", CHF: "0.9188" });

  it("keeps a rate the user set, and fills the rest", () => {
    const existing = [{ from_currency: "USD", to_currency: "CHF", rate: "0.8" }];
    const written = ratesToWrite(derived, existing, false);
    expect(written.some((p) => p.from === "USD" && p.to === "CHF")).toBe(false);
    expect(written.some((p) => p.from === "EUR" && p.to === "USD")).toBe(true);
    expect(written).toHaveLength(5);
  });

  it("treats the zero placeholder as unset", () => {
    const existing = [{ from_currency: "USD", to_currency: "CHF", rate: "0" }];
    const written = ratesToWrite(derived, existing, false);
    expect(written.some((p) => p.from === "USD" && p.to === "CHF")).toBe(true);
  });

  it("replaces everything when asked", () => {
    const existing = [{ from_currency: "USD", to_currency: "CHF", rate: "0.8" }];
    expect(ratesToWrite(derived, existing, true)).toHaveLength(6);
  });
});

describe("ratesMatchLastFetch", () => {
  const stored = derivedRatePairs({ USD: "1.1267", CHF: "0.9188" }).map((pair) => ({
    from_currency: pair.from,
    to_currency: pair.to,
    rate: pair.rate,
  }));
  const lastFetch = JSON.stringify(derivedRatePairs({ USD: "1.1267", CHF: "0.9188" }));

  it("is true when the table still holds what the fetch wrote", () => {
    expect(ratesMatchLastFetch(stored, lastFetch)).toBe(true);
  });

  it("is false after the user edits one rate by hand", () => {
    // The reason this exists: the button must come back, so the published
    // figure can be restored without waiting for tomorrow.
    const edited = stored.map((row) =>
      row.from_currency === "USD" && row.to_currency === "CHF" ? { ...row, rate: "0.8" } : row,
    );
    expect(ratesMatchLastFetch(edited, lastFetch)).toBe(false);
  });

  it("compares numbers, not text", () => {
    const padded = stored.map((row) =>
      row.from_currency === "EUR" && row.to_currency === "USD" ? { ...row, rate: "1.126700" } : row,
    );
    expect(ratesMatchLastFetch(padded, lastFetch)).toBe(true);
    expect(sameRate("1.1267", "1.126700")).toBe(true);
    expect(sameRate("1.1267", "1.1268")).toBe(false);
  });

  it("is false for a missing, empty or unreadable record", () => {
    expect(ratesMatchLastFetch(stored, "")).toBe(false);
    expect(ratesMatchLastFetch(stored, "not json")).toBe(false);
    expect(ratesMatchLastFetch(stored, "[]")).toBe(false);
    expect(ratesMatchLastFetch([], lastFetch)).toBe(false);
  });
});
