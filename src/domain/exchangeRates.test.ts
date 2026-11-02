import { describe, expect, it } from "vitest";
import { formatRate, rateText, validateRates } from "./exchangeRates";

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
