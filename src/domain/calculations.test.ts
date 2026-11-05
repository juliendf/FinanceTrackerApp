import { describe, expect, it } from "vitest";
import { calculate, CalculationError } from "./calculations";

const value = (op: Parameters<typeof calculate>[0], inputs: Record<string, unknown>, group: "money" | "percent" | "count", name: string) =>
  calculate(op, inputs)[group][name].toFixed(2);

describe("calculate — percent_change", () => {
  it("reports the change and the percentage", () => {
    expect(value("percent_change", { from: 406860.98, to: 325488.78 }, "money", "absolute")).toBe("-81372.20");
    expect(value("percent_change", { from: 406860.98, to: 325488.78 }, "percent", "percent")).toBe("-20.00");
  });

  it("uses the absolute starting value for the percentage, so a fall from a negative is not inverted", () => {
    // -1000 to -800 is a 20% improvement, not -20%.
    expect(value("percent_change", { from: -1000, to: -800 }, "percent", "percent")).toBe("20.00");
  });

  it("refuses a change from zero rather than returning Infinity", () => {
    expect(() => calculate("percent_change", { from: 0, to: 10 })).toThrow(CalculationError);
  });
});

describe("calculate — percentage_of", () => {
  it("takes a share of a whole", () => {
    expect(value("percentage_of", { part: 62897, whole: 71948 }, "percent", "percent")).toBe("87.42");
  });

  it("refuses a whole of zero", () => {
    expect(() => calculate("percentage_of", { part: 1, whole: 0 })).toThrow(/undefined/i);
  });
});

describe("calculate — compound_growth", () => {
  it("grows a lump sum and a monthly contribution, and separates the growth", () => {
    // 10 000 at 4% for 10 years with 500/month, monthly compounding.
    const inputs = { principal: 10000, monthly_contribution: 500, annual_rate_pct: 4, years: 10 };
    expect(value("compound_growth", inputs, "money", "contributed")).toBe("70000.00");
    expect(value("compound_growth", inputs, "money", "value")).toBe("88533.23");
    expect(value("compound_growth", inputs, "money", "growth")).toBe("18533.23");
    expect(value("compound_growth", inputs, "count", "months")).toBe("120.00");
  });

  it("is the plain sum when the rate is zero", () => {
    // The annuity formula divides by the monthly rate, so zero needs its own path.
    const inputs = { principal: 1000, monthly_contribution: 100, annual_rate_pct: 0, years: 1 };
    expect(value("compound_growth", inputs, "money", "value")).toBe("2200.00");
    expect(value("compound_growth", inputs, "money", "growth")).toBe("0.00");
  });

  it("refuses a horizon of zero or a rate at or below -100%", () => {
    expect(() => calculate("compound_growth", { principal: 1, years: 0 })).toThrow(/greater than zero/i);
    expect(() => calculate("compound_growth", { principal: 1, years: 1, annual_rate_pct: -100 })).toThrow(
      /greater than -100/i,
    );
  });
});

describe("calculate — runway", () => {
  it("turns a pot and a monthly cost into months and years", () => {
    const inputs = { liquid_amount: 24000, monthly_expenses: 4000 };
    expect(value("runway", inputs, "count", "months")).toBe("6.00");
    expect(value("runway", inputs, "count", "years")).toBe("0.50");
  });

  it("refuses zero expenses", () => {
    expect(() => calculate("runway", { liquid_amount: 1, monthly_expenses: 0 })).toThrow(/greater than zero/i);
  });
});

describe("calculate — goal_gap", () => {
  it("reports the gap and rounds the months up, because a partial month does not reach the goal", () => {
    const inputs = { target: 1000000, current: 421135.48, monthly_saving: 3000 };
    expect(value("goal_gap", inputs, "money", "gap")).toBe("578864.52");
    expect(value("goal_gap", inputs, "count", "months")).toBe("193.00");
  });

  it("is zero when the goal is already met", () => {
    expect(value("goal_gap", { target: 100, current: 150 }, "money", "gap")).toBe("0.00");
  });

  it("omits the months when nothing is being saved, rather than inventing them", () => {
    const result = calculate("goal_gap", { target: 100, current: 0, monthly_saving: 0 });
    expect(result.count.months).toBeUndefined();
    expect(result.money.gap.toFixed(2)).toBe("100.00");
  });
});

describe("calculate — apply_rate", () => {
  it("applies a fall", () => {
    const inputs = { amount: 406860.98, rate_pct: -20 };
    expect(value("apply_rate", inputs, "money", "value")).toBe("325488.78");
    expect(value("apply_rate", inputs, "money", "change")).toBe("-81372.20");
  });

  it("applies a rise", () => {
    expect(value("apply_rate", { amount: 1000, rate_pct: 7.5 }, "money", "value")).toBe("1075.00");
  });

  it("refuses a rate that would remove more than everything", () => {
    expect(() => calculate("apply_rate", { amount: 100, rate_pct: -100 })).toThrow(/greater than -100/i);
  });
});

describe("calculate — bad input", () => {
  it("names the missing field instead of returning NaN", () => {
    expect(() => calculate("percent_change", { from: 1 })).toThrow(/to is required/i);
    expect(() => calculate("compound_growth", {})).toThrow(/principal is required/i);
  });

  it("refuses text where a number belongs", () => {
    expect(() => calculate("percent_change", { from: "abc", to: 2 })).toThrow(/must be a number/i);
  });

  it("refuses an operation it does not have", () => {
    expect(() => calculate("integrate" as never, {})).toThrow(/unknown operation/i);
  });
});
