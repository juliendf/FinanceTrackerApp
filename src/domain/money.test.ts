import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  fromMinorUnits,
  isExactAtTwoDecimals,
  parseMoney,
  roundMoney,
  sumMinor,
  toMinorUnits,
} from "./money";

describe("parseMoney", () => {
  it("accepts numbers, strings and Decimal", () => {
    expect(parseMoney(12.5)?.toString()).toBe("12.5");
    expect(parseMoney("12.50")?.toString()).toBe("12.5");
    expect(parseMoney(new Decimal("12.5"))?.toString()).toBe("12.5");
  });

  it("returns null for null, undefined, empty and garbage", () => {
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney(Number.NaN)).toBeNull();
    expect(parseMoney(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("roundMoney", () => {
  it("rounds half-even", () => {
    // Half-even only differs from half-up on exact ties at the 3rd decimal.
    expect(roundMoney("2.505")?.toString()).toBe("2.5"); // 0 is even
    expect(roundMoney("2.515")?.toString()).toBe("2.52"); // 1 is odd
    expect(roundMoney("0.125")?.toString()).toBe("0.12");
    expect(roundMoney("0.135")?.toString()).toBe("0.14");
    expect(roundMoney("2.675")?.toString()).toBe("2.68");
  });

  it("passes through null", () => {
    expect(roundMoney(null)).toBeNull();
  });
});

describe("toMinorUnits / fromMinorUnits", () => {
  it("converts major to integer minor units", () => {
    expect(toMinorUnits(12.5)).toBe(1250);
    expect(toMinorUnits("0.01")).toBe(1);
    expect(toMinorUnits("1234.56")).toBe(123456);
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits("-12.34")).toBe(-1234);
  });

  it("round-trips minor units", () => {
    expect(fromMinorUnits(123456)?.toString()).toBe("1234.56");
    expect(fromMinorUnits(1)?.toString()).toBe("0.01");
    expect(fromMinorUnits(0)?.toString()).toBe("0");
    expect(fromMinorUnits(null)).toBeNull();
  });

  it("throws rather than silently writing a bad amount", () => {
    expect(() => toMinorUnits("abc")).toThrow();
    expect(() => toMinorUnits(null)).toThrow();
  });
});

describe("sumMinor", () => {
  it("sums without float drift", () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in minor units it is exact.
    expect(sumMinor([10, 20])).toBe(30);
    expect(sumMinor([1, 1, 1])).toBe(3);
  });

  it("sums an empty collection to zero", () => {
    expect(sumMinor([])).toBe(0);
  });

  it("stays exact for a large portfolio", () => {
    const values = Array.from({ length: 1000 }, () => 123456789);
    expect(sumMinor(values)).toBe(123456789000);
  });
});

describe("isExactAtTwoDecimals", () => {
  it("is true for values already on 2 dp", () => {
    expect(isExactAtTwoDecimals("12.34")).toBe(true);
    expect(isExactAtTwoDecimals(12.3)).toBe(true);
    expect(isExactAtTwoDecimals(0)).toBe(true);
    expect(isExactAtTwoDecimals("1.00")).toBe(true);
  });

  it("is false for sub-cent values", () => {
    expect(isExactAtTwoDecimals("12.345")).toBe(false);
    expect(isExactAtTwoDecimals(0.001)).toBe(false);
  });
});

// FIN-52: bounds on amounts a user enters, and exact storage.
import { moneyError, MAX_MONEY_MAJOR, toMinorUnits as toMinor } from "./money";

describe("moneyError (FIN-52)", () => {
  it("accepts up to two decimals and the 10,000,000 ceiling", () => {
    expect(moneyError("12.34")).toBeNull();
    expect(moneyError("10000000")).toBeNull();
    expect(moneyError("-10000000")).toBeNull();
    expect(moneyError("0.01")).toBeNull();
  });
  it("refuses more than two decimals rather than rounding", () => {
    expect(moneyError("1.005")).toBe("Use at most 2 decimal places.");
  });
  it("refuses amounts above the ceiling in either direction", () => {
    expect(moneyError("10000000.01")).toBe("Amount must be at most 10,000,000.");
    expect(moneyError("-10000001")).toBe("Amount must be at most 10,000,000.");
    expect(MAX_MONEY_MAJOR.toString()).toBe("10000000");
  });
  it("refuses what is not a number", () => {
    expect(moneyError("abc")).toBe("Please enter a valid amount.");
    expect(moneyError("")).toBe("Please enter a valid amount.");
    expect(moneyError("Infinity")).toBe("Please enter a valid amount.");
  });
});

describe("toMinorUnits safe-integer guard (FIN-52)", () => {
  it("stores amounts exactly within the safe range", () => {
    expect(toMinor("10000000")).toBe(1_000_000_000);
    expect(toMinor("123.45")).toBe(12345);
  });
  it("throws rather than storing a value that has lost cents", () => {
    // 100 trillion major units is 1e16 minor units, past Number.MAX_SAFE_INTEGER.
    expect(() => toMinor("100000000000000")).toThrow(/too large to store exactly/);
  });
});
