/**
 * Exchange-rate validation.
 *
 * Rates are positive decimals stored as TEXT, displayed with six places. The
 * validator rejects anything below 0.000001.
 */

import Decimal from "decimal.js";
import { SUPPORTED_CURRENCIES } from "./currency";

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

// --- European Central Bank rates ---------------------------------------------

/** What `fetch_ecb_rates` returns: units of each currency per 1 EUR. */
export interface EcbRates {
  /** Publication date, `YYYY-MM-DD`. */
  as_of: string;
  per_eur: Record<string, string>;
}

export interface DerivedRate {
  from: string;
  to: string;
  rate: string;
}

/** Cross rates are rounded here, not by the ECB: 6 dp is well past any amount
 *  this app multiplies, and it keeps the stored text readable. */
const CROSS_RATE_DP = 6;

/**
 * Units of one currency per euro, with the euro itself by definition.
 *
 * Returns null when the ECB did not publish that currency — better to leave a
 * pair alone than to invent a rate for it.
 */
function unitsPerEuro(code: string, perEur: Record<string, string>): Decimal | null {
  if (code === "EUR") return new Decimal(1);
  const text = perEur[code];
  if (!text) return null;
  try {
    const value = new Decimal(text);
    return value.isFinite() && value.greaterThan(0) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Every directed pair among the supported currencies, from EUR-based rates.
 *
 * `a -> b = (b per EUR) / (a per EUR)`. The ECB publishes only the second
 * number, so a cross rate like USD->CHF is a division, and dividing the wrong
 * way is a silent error of tens of percent — hence the test.
 */
export function derivedRatePairs(perEur: Record<string, string>): DerivedRate[] {
  const units = new Map<string, Decimal>();
  for (const code of SUPPORTED_CURRENCIES) {
    const value = unitsPerEuro(code, perEur);
    if (value) units.set(code, value);
  }

  const pairs: DerivedRate[] = [];
  for (const [from, perFrom] of units) {
    for (const [to, perTo] of units) {
      if (from === to) continue;
      pairs.push({
        from,
        to,
        rate: perTo.dividedBy(perFrom).toDecimalPlaces(CROSS_RATE_DP, Decimal.ROUND_HALF_EVEN).toFixed(),
      });
    }
  }
  return pairs;
}

/**
 * Which of the derived pairs to write.
 *
 * `existing` is the stored table. A pair is kept as it is when the user has a
 * usable rate there, unless `replace` says otherwise: a rate typed from a bank
 * statement must not disappear because someone pressed Fetch.
 */
export function ratesToWrite(
  derived: readonly DerivedRate[],
  existing: ReadonlyArray<{ from_currency: string; to_currency: string; rate: string }>,
  replace: boolean,
): DerivedRate[] {
  if (replace) return [...derived];
  const usable = new Set<string>();
  for (const row of existing) {
    const value = Number(row.rate);
    if (Number.isFinite(value) && value > 0) usable.add(`${row.from_currency}>${row.to_currency}`);
  }
  return derived.filter((pair) => !usable.has(`${pair.from}>${pair.to}`));
}

/** Two rate texts are the same number, whatever their formatting. */
export function sameRate(a: string, b: string): boolean {
  try {
    return new Decimal(a).eq(new Decimal(b));
  } catch {
    return false;
  }
}

/**
 * Whether the stored table still holds exactly what the last ECB fetch produced.
 *
 * This is what makes "nothing to do" mean nothing to do. Comparing the *date* of
 * the last attempt instead would disable the button for the rest of the day,
 * including after the user edits a rate by hand and wants the published figure
 * back.
 *
 * Extra pairs the user added are ignored: they are not the fetch's business.
 */
export function ratesMatchLastFetch(
  current: ReadonlyArray<{ from_currency: string; to_currency: string; rate: string }>,
  lastFetchJson: string,
): boolean {
  if (!lastFetchJson) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastFetchJson);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return false;

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) return false;
    const pair = item as { from?: unknown; to?: unknown; rate?: unknown };
    if (typeof pair.from !== "string" || typeof pair.to !== "string" || typeof pair.rate !== "string") {
      return false;
    }
    const row = current.find(
      (entry) => entry.from_currency === pair.from && entry.to_currency === pair.to,
    );
    if (!row || !sameRate(row.rate, pair.rate)) return false;
  }
  return true;
}
