/**
 * Money handling. Amounts are INTEGER minor units (cents) in SQLite; there is
 * no float anywhere in the money path. Storing money as Float is the bug this
 * design avoids.
 *
 * Rounding is half-even (banker's), so imported decimal amounts land on the
 * same cents they were written with.
 */

import Decimal from "decimal.js";

// Half-even, and enough precision that intermediate conversions never lose cents.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });

/** Minor units per major unit. All three supported currencies are 2 dp. */
export const MINOR_SCALE = 100;

/**
 * The largest amount a user may enter, in major units (FIN-52). Well above any
 * real balance, and far enough below the point where minor units stop being
 * exact integers that every amount stored is exact.
 */
export const MAX_MONEY_MAJOR = new Decimal(10_000_000);

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

/**
 * A message for an amount the user typed, or null when it is usable (FIN-52).
 *
 * Rules: a number, at most 2 decimal places, and within 10,000,000 in either
 * direction. An empty field is the caller's concern (optional fields), so it is
 * reported here as invalid like any other non-number.
 */
export function moneyError(raw: string): string | null {
  const value = parseMoney(raw.trim());
  if (!value) return "Please enter a valid amount.";
  if (value.decimalPlaces() > 2) return "Use at most 2 decimal places.";
  if (value.abs().greaterThan(MAX_MONEY_MAJOR)) return "Amount must be at most 10,000,000.";
  return null;
}

/**
 * Major units -> integer minor units. Throws on unparseable input, and on any
 * amount whose minor units are not a safe integer: past that point the number
 * silently loses cents, which is the failure this check exists to stop.
 */
export function toMinorUnits(value: MoneyInput): number {
  const rounded = roundMoney(value);
  if (!rounded) {
    throw new Error(`cannot convert ${String(value)} to minor units`);
  }
  const minor = rounded.times(MINOR_SCALE).toNumber();
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`amount ${String(value)} is too large to store exactly`);
  }
  return minor;
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
