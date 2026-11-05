/**
 * The arithmetic the assistant is not allowed to do itself.
 *
 * Every other number in this app is computed here or in a sibling domain module,
 * and handed to the model as a finished string. Projections, runway and goal
 * gaps were the exception: the stress-test and retirement prompts ask for them,
 * and the model was doing the multiplication.
 *
 * Two deliberate constraints:
 *
 *   * **named operations, not an expression evaluator.** A model that cannot
 *     multiply is also poor at writing the right formula, so an `eval`-style tool
 *     would just move the error from the answer to the input — and would need a
 *     parser nobody asked for. Filling a schema is something small models do
 *     reliably.
 *   * **`decimal.js`, never floats.** Money arithmetic is decimal here for the
 *     same reason it is everywhere else in the app.
 *
 * Every operation refuses rather than improvises: a division by zero returns a
 * sentence the model can relay, not `Infinity`.
 */

import Decimal from "decimal.js";

export type CalculationOp =
  | "percent_change"
  | "percentage_of"
  | "compound_growth"
  | "runway"
  | "goal_gap"
  | "apply_rate";

export const CALCULATION_OPS: readonly CalculationOp[] = [
  "percent_change",
  "percentage_of",
  "compound_growth",
  "runway",
  "goal_gap",
  "apply_rate",
];

/**
 * Results, grouped by how they should be formatted.
 *
 * The caller knows the currency; this module does not. Grouping means the tool
 * layer formats each number once, without a per-operation switch that would have
 * to be kept in step with the operations themselves.
 */
export interface Calculation {
  /** Money amounts, to be shown with the caller's currency. */
  money: Record<string, Decimal>;
  /** Percentages, shown to two decimals with a `%` sign. */
  percent: Record<string, Decimal>;
  /** Unitless quantities — months, years. */
  count: Record<string, Decimal>;
}

export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculationError";
  }
}

/** A required, finite number. Refuses rather than coercing a stray string. */
function number(input: unknown, name: string): Decimal {
  if (input === null || input === undefined || input === "") {
    throw new CalculationError(`${name} is required.`);
  }
  let value: Decimal;
  try {
    value = new Decimal(input as Decimal.Value);
  } catch {
    throw new CalculationError(`${name} must be a number.`);
  }
  if (!value.isFinite()) throw new CalculationError(`${name} must be a number.`);
  return value;
}

/** An optional number, defaulting to zero — a missing monthly saving is zero. */
function optionalNumber(input: unknown, name: string, fallback = "0"): Decimal {
  if (input === null || input === undefined || input === "") return new Decimal(fallback);
  return number(input, name);
}

/**
 * Growth of a lump sum plus a monthly contribution.
 *
 * Monthly compounding at `annual_rate_pct / 12`, which is what a savings plan
 * usually quotes. With a zero rate the annuity formula divides by zero, so that
 * case is the plain sum.
 */
function compoundGrowth(inputs: Record<string, unknown>): Calculation {
  const principal = number(inputs.principal, "principal");
  const monthly = optionalNumber(inputs.monthly_contribution, "monthly_contribution");
  const ratePct = optionalNumber(inputs.annual_rate_pct, "annual_rate_pct");
  const years = number(inputs.years, "years");

  if (years.lessThanOrEqualTo(0)) throw new CalculationError("years must be greater than zero.");
  if (ratePct.lessThanOrEqualTo(-100)) {
    throw new CalculationError("annual_rate_pct must be greater than -100.");
  }

  const months = years.times(12);
  const monthlyRate = ratePct.dividedBy(1200);
  const contributed = principal.plus(monthly.times(months));

  let value: Decimal;
  if (monthlyRate.isZero()) {
    value = contributed;
  } else {
    const growthFactor = new Decimal(1).plus(monthlyRate).pow(months);
    value = principal.times(growthFactor).plus(
      monthly.times(growthFactor.minus(1).dividedBy(monthlyRate)),
    );
  }

  return {
    money: {
      value: value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN),
      contributed: contributed.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN),
      growth: value.minus(contributed).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN),
    },
    percent: {},
    count: { months },
  };
}

/**
 * Run one calculation.
 *
 * `inputs` are the raw tool arguments; each operation validates what it needs, so
 * a missing field produces a sentence rather than `NaN`.
 */
export function calculate(op: CalculationOp, inputs: Record<string, unknown>): Calculation {
  switch (op) {
    case "percent_change": {
      const from = number(inputs.from, "from");
      const to = number(inputs.to, "to");
      if (from.isZero()) {
        throw new CalculationError("A percentage change from zero is undefined.");
      }
      const absolute = to.minus(from);
      return {
        money: { absolute: absolute.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN) },
        percent: {
          percent: absolute.dividedBy(from.abs()).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN),
        },
        count: {},
      };
    }

    case "percentage_of": {
      const part = number(inputs.part, "part");
      const whole = number(inputs.whole, "whole");
      if (whole.isZero()) throw new CalculationError("A share of zero is undefined.");
      return {
        money: {},
        percent: {
          percent: part.dividedBy(whole).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN),
        },
        count: {},
      };
    }

    case "compound_growth":
      return compoundGrowth(inputs);

    case "runway": {
      const liquid = number(inputs.liquid_amount, "liquid_amount");
      const expenses = number(inputs.monthly_expenses, "monthly_expenses");
      if (expenses.lessThanOrEqualTo(0)) {
        throw new CalculationError("monthly_expenses must be greater than zero.");
      }
      const months = liquid.dividedBy(expenses);
      return {
        money: {},
        percent: {},
        count: {
          months: months.toDecimalPlaces(1, Decimal.ROUND_HALF_EVEN),
          years: months.dividedBy(12).toDecimalPlaces(1, Decimal.ROUND_HALF_EVEN),
        },
      };
    }

    case "goal_gap": {
      const target = number(inputs.target, "target");
      const current = optionalNumber(inputs.current, "current");
      const monthly = optionalNumber(inputs.monthly_saving, "monthly_saving");

      const gap = Decimal.max(target.minus(current), 0);
      const count: Record<string, Decimal> = {};
      if (monthly.greaterThan(0)) {
        count.months = gap.dividedBy(monthly).ceil();
      }
      // With no monthly saving the gap is still the answer; the months are simply
      // not knowable, and guessing them would be worse than omitting them.
      return {
        money: { gap: gap.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN) },
        percent: {},
        count,
      };
    }

    case "apply_rate": {
      const amount = number(inputs.amount, "amount");
      const ratePct = number(inputs.rate_pct, "rate_pct");
      if (ratePct.lessThanOrEqualTo(-100)) {
        throw new CalculationError("rate_pct must be greater than -100.");
      }
      const change = amount.times(ratePct).dividedBy(100);
      return {
        money: {
          value: amount.plus(change).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN),
          change: change.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN),
        },
        percent: {},
        count: {},
      };
    }

    default:
      throw new CalculationError(`Unknown operation "${String(op)}".`);
  }
}
