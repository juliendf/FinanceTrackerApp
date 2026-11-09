import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  categoryHasHoldings,
  cleanHoldings,
  compositionGap,
  holdingValue,
  holdingsTotal,
  priceError,
  isinCheckDigitValid,
  isinError,
  normaliseIsin,
  normaliseQuantity,
  quantityError,
  totalQuantity,
  validateHoldings,
} from "./holdings";

describe("ISIN", () => {
  // Real ISINs: L'Oréal, iShares MSCI World, SAP.
  const VALID = ["FR0000120073", "IE00B4L5Y983", "DE0007164600"];

  it("accepts real ISINs, check digit included", () => {
    for (const isin of VALID) {
      expect(isinError(isin)).toBeNull();
      expect(isinCheckDigitValid(isin)).toBe(true);
    }
  });

  it("rejects a transposed or mistyped check digit", () => {
    expect(isinError("FR0000120074")).toMatch(/check digit/);
    expect(isinError("DE0007164601")).toMatch(/check digit/);
  });

  it("rejects the wrong shape before it looks at the digit", () => {
    expect(isinError("")).toBe("An ISIN is required");
    expect(isinError("FR00001200")).toMatch(/12 characters/);
    expect(isinError("1R0000120073")).toMatch(/12 characters/);
    expect(isinError("FR000012007A")).toMatch(/12 characters/);
  });

  it("cleans up what people paste", () => {
    expect(normaliseIsin(" fr 0000 1200 73 ")).toBe("FR0000120073");
    expect(normaliseIsin("fr-0000120073")).toBe("FR0000120073");
    expect(isinError("fr 0000 1200 73")).toBeNull();
  });
});

describe("quantity", () => {
  it("accepts fractions, integers and a comma", () => {
    expect(quantityError("12.5")).toBeNull();
    expect(quantityError("12,5")).toBeNull();
    expect(quantityError("3")).toBeNull();
    expect(quantityError("0.00000001")).toBeNull();
  });

  it("refuses nothing, zero, negatives and noise", () => {
    expect(quantityError("")).toBe("A quantity is required");
    expect(quantityError("0")).toMatch(/greater than zero/);
    expect(quantityError("-2")).toMatch(/greater than zero/);
    expect(quantityError("abc")).toMatch(/is a number/);
    expect(quantityError("1.123456789")).toMatch(/8 decimal places/);
  });

  it("stores the shortest exact form", () => {
    expect(normaliseQuantity("12.50")).toBe("12.5");
    expect(normaliseQuantity(" 1,25 ")).toBe("1.25");
    expect(normaliseQuantity("3")).toBe("3");
  });
});

describe("a whole list", () => {
  it("marks each row's own problem by index", () => {
    const problems = validateHoldings([
      { isin: "FR0000120073", label: "", quantity: "1", price: "" },
      { isin: "", label: "", quantity: "1", price: "" },
      { isin: "IE00B4L5Y983", label: "", quantity: "0", price: "" },
    ]);
    expect(Object.keys(problems).sort()).toEqual(["1", "2"]);
    expect(problems[1].isin).toBe("An ISIN is required");
    expect(problems[2].quantity).toMatch(/greater than zero/);
  });

  it("refuses the same ISIN twice, however it was typed", () => {
    const problems = validateHoldings([
      { isin: "FR0000120073", label: "", quantity: "1", price: "" },
      { isin: "fr 0000 1200 73", label: "", quantity: "2", price: "" },
    ]);
    expect(problems[1].isin).toBe("Already listed on line 1");
  });

  it("normalises before writing", () => {
    expect(
      cleanHoldings([{ isin: " fr0000120073 ", label: " iShares World ", quantity: "12.50", price: "45.20" }]),
    ).toEqual([{ isin: "FR0000120073", label: "iShares World", quantity: "12.5", price: "45.2" }]);
  });

  it("leaves the name empty rather than writing whitespace", () => {
    expect(cleanHoldings([{ isin: "FR0000120073", label: "   ", quantity: "1", price: "" }])[0].label).toBeNull();
    expect(validateHoldings([{ isin: "FR0000120073", label: "x".repeat(81), quantity: "1", price: "" }])[0].label).toBe(
      "At most 80 characters",
    );
  });

  it("values a line as quantity × price, and nothing without a price", () => {
    expect(holdingValue({ quantity: "12", price: "45.20" })?.toString()).toBe("542.4");
    expect(holdingValue({ quantity: "12", price: "" })).toBeNull();
    expect(holdingValue({ quantity: "", price: "45" })).toBeNull();
    expect(priceError("0")).toMatch(/greater than zero/);
    expect(priceError("-1")).toMatch(/greater than zero/);
    expect(priceError("abc")).toMatch(/is a number/);
    expect(priceError("")).toBeNull();
    expect(priceError("45,20")).toBeNull();
  });

  it("totals only the priced lines and says so", () => {
    const rows = [
      { isin: "FR0000120073", label: "", quantity: "12", price: "45" },
      { isin: "IE00B4L5Y983", label: "", quantity: "2", price: "100" },
      { isin: "DE0007164600", label: "", quantity: "1", price: "" },
    ];
    const total = holdingsTotal(rows);
    expect(total?.total.toString()).toBe("740");
    expect(total?.allPriced).toBe(false);
    expect(total?.priced).toBe(2);
    expect(holdingsTotal([{ isin: "A", label: "", quantity: "1", price: "" }])).toBeNull();
  });

  it("compares the composition with the snapshot only when every line is priced", () => {
    const priced = [
      { isin: "FR0000120073", label: "", quantity: "10", price: "10" },
      { isin: "IE00B4L5Y983", label: "", quantity: "10", price: "10" },
    ];
    // 200 against a 190 snapshot: 10/190 ≈ 5.3%
    expect(compositionGap(priced, new Decimal(190))?.toFixed(4)).toBe("0.0526");
    expect(compositionGap(priced, new Decimal(200))?.isZero()).toBe(true);
    // A line without a price makes the total partial: never compared.
    expect(compositionGap([...priced, { isin: "X", label: "", quantity: "1", price: "" }], new Decimal(190))).toBeNull();
    expect(compositionGap(priced, null)).toBeNull();
  });

  it("sums the quantities for the card's subtitle", () => {
    expect(totalQuantity([])).toBeNull();
    expect(totalQuantity([{ isin: "A", label: "", quantity: "1.5", price: "" }, { isin: "B", label: "", quantity: "2", price: "" }])?.toString()).toBe("3.5");
  });
});

describe("which categories hold instruments", () => {
  it("is stocks and bonds, nothing else", () => {
    expect(categoryHasHoldings("stocks")).toBe(true);
    expect(categoryHasHoldings("bonds")).toBe(true);
    for (const role of ["cash", "emergency_fund", "real_estate", "retirement", "alternative", "other", null]) {
      expect(categoryHasHoldings(role)).toBe(false);
    }
  });
});
