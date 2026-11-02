/**
 * Exchange-rate validation.
 *
 * Rates are positive decimals stored as TEXT, displayed with six places. The
 * validator rejects anything below 0.000001.
 */

import Decimal from "decimal.js";

export const MIN_RATE = new Decimal("0.000001");

/** Rate text as the edit grid shows it: up to 6 dp, trailing zeros trimmed. */
export function formatRate(rate: string): string {
  const value = new Decimal(rate);
  if (!value.isFinite()) return rate;
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toString();
}

export interface RateRow {
  label: string;
  rate: string;
}

export interface RateError {
  /** `From->To` so the grid can mark the right row. */
  pair: string;
  message: string;
}

/**
 * Validate every posted rate.
 *
 * A blank or unparseable rate is "Rate is required"; anything below 0.000001 is
 * "Rate must be positive".
 */
export function validateRates(rows: ReadonlyArray<{ from: string; to: string; rate: string }>): RateError[] {
  const errors: RateError[] = [];
  for (const row of rows) {
    const pair = `${row.from}->${row.to}`;
    const text = row.rate.trim();
    if (text === "") {
      errors.push({ pair, message: "Rate is required" });
      continue;
    }
    let value: Decimal;
    try {
      value = new Decimal(text);
    } catch {
      errors.push({ pair, message: "Rate is required" });
      continue;
    }
    if (!value.isFinite()) {
      errors.push({ pair, message: "Rate is required" });
      continue;
    }
    if (value.lessThan(MIN_RATE)) {
      errors.push({ pair, message: "Rate must be positive" });
    }
  }
  return errors;
}

/** Decimal text for storage: full precision, no exponent, no trailing zeros. */
export function rateText(rate: string): string {
  const value = new Decimal(rate.trim());
  return value.toFixed();
}
