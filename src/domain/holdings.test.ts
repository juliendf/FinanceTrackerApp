import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  categoryHasHoldings,
  cleanHoldings,
  holdingValue,
  priceError,
  valueHoldings,
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
    // Small and large values stay in plain digits, so the quantity CHECK accepts them (FIN-51).
    expect(normaliseQuantity("0.00000012")).toBe("0.00000012");
    expect(normaliseQuantity("0,0000001")).toBe("0.0000001");
    expect(normaliseQuantity("1000000000000000000000")).toBe("1000000000000000000000");
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

    // A small price is written in plain digits too, not as 1.2e-7 (FIN-51).
    const [small] = cleanHoldings([{ isin: "FR0000120073", label: "", quantity: "1", price: "0.00000012" }]);
    expect(small.price).toBe("0.00000012");
    expect(small.quantity).toBe("1");
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

  it("splits the snapshot by price when every line is priced", () => {
    const rows = [
      { isin: "FR0000120073", label: "", quantity: "12", price: "45" },
      { isin: "IE00B4L5Y983", label: "", quantity: "2", price: "100" },
    ];
    // 540 and 200: raw total 740, split across a snapshot of 1000.
    const valuation = valueHoldings(rows, new Decimal(1000));
    expect(valuation.scaled).toBe(true);
    expect(valuation.total?.toString()).toBe("1000");
    expect(valuation.lines[0].value?.toFixed(2)).toBe("729.73");
    expect(valuation.lines[0].share?.toFixed(4)).toBe("0.7297");
    expect(valuation.lines[1].value?.toFixed(2)).toBe("270.27");
  });

  it("leaves the raw values alone without a snapshot", () => {
    const rows = [
      { isin: "FR0000120073", label: "", quantity: "12", price: "45" },
      { isin: "IE00B4L5Y983", label: "", quantity: "2", price: "100" },
    ];
    const valuation = valueHoldings(rows, null);
    expect(valuation.scaled).toBe(false);
    expect(valuation.total?.toString()).toBe("740");
    expect(valuation.lines[0].value?.toString()).toBe("540");
  });

  it("never scales a partial composition: the unpriced lines would hand over their share", () => {
    const rows = [
      { isin: "FR0000120073", label: "", quantity: "12", price: "45" },
      { isin: "IE00B4L5Y983", label: "", quantity: "2", price: "" },
    ];
    const valuation = valueHoldings(rows, new Decimal(1000));
    expect(valuation.scaled).toBe(false);
    expect(valuation.allPriced).toBe(false);
    expect(valuation.total?.toString()).toBe("540");
    expect(valuation.lines[1]).toEqual({ value: null, share: null });
  });

  it("has nothing to say without a price at all", () => {
    const valuation = valueHoldings([{ isin: "FR0000120073", label: "", quantity: "1", price: "" }], new Decimal(1000));
    expect(valuation.total).toBeNull();
    expect(valuation.priced).toBe(0);
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
