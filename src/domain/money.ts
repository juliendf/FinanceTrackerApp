/**
 * Money handling. Amounts are INTEGER minor units (cents) in SQLite; there is
 * no float anywhere in the money path.
 *
 * The source app stores Float on Postgres (`Snapshot.amount`,
 * `ExchangeRate.rate`, `cost_charges`, `interest_rate`), which is the bug this
 * port fixes. See docs/ANALYSIS.md section 2.
 *
 * Rounding is half-even (banker's), matching Python's `Decimal` default so the
 * importer's numbers line up with what the Flask app displayed.
 */

import Decimal from "decimal.js";

// Half-even, and enough precision that intermediate conversions never lose cents.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });

/** Minor units per major unit. All three supported currencies are 2 dp. */
export const MINOR_SCALE = 100;

export type MoneyInput = Decimal.Value | null | undefined;

/** Parse anything money-shaped. Returns null for null/empty/invalid input. */
export function parseMoney(value: MoneyInput): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  try {
    const parsed = new Decimal(value as Decimal.Value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/** Round a major-unit amount to 2 dp, half-even. */
export function roundMoney(value: MoneyInput): Decimal | null {
  const parsed = parseMoney(value);
  return parsed ? parsed.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN) : null;
}

/** Major units -> integer minor units. Throws on unparseable input. */
export function toMinorUnits(value: MoneyInput): number {
  const rounded = roundMoney(value);
  if (!rounded) {
    throw new Error(`cannot convert ${String(value)} to minor units`);
  }
  return rounded.times(MINOR_SCALE).toNumber();
}

/** Integer minor units -> Decimal major units. */
export function fromMinorUnits(minor: number | null | undefined): Decimal | null {
  if (minor === null || minor === undefined) return null;
  return new Decimal(minor).dividedBy(MINOR_SCALE).toDecimalPlaces(2);
}

/**
 * Sum minor units exactly. Callers pass plain numbers, but the addition happens
 * in Decimal so large portfolios cannot drift.
 */
export function sumMinor(values: Iterable<number>): number {
  let total = new Decimal(0);
  for (const value of values) total = total.plus(value);
  return total.toNumber();
}

/** True when the value already sits exactly on 2 dp (used by the importer). */
export function isExactAtTwoDecimals(value: MoneyInput): boolean {
  const parsed = parseMoney(value);
  if (!parsed) return false;
  return parsed.times(MINOR_SCALE).isInteger() || parsed.equals(0);
}
