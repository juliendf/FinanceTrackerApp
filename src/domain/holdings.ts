/**
 * Holdings: what an asset is made of, one line per instrument.
 *
 * A holding is an ISIN and a quantity. Nothing else — no price, no value, no
 * currency: the asset owns the currency and the snapshot owns the value. Adding
 * a valuation here would create a second, competing source of truth.
 *
 * Only `stocks` and `bonds` categories offer the section. That is decided from
 * `categories.system_role`, which is required at creation, so there is no
 * fallback case: every asset's category has a role.
 */

import Decimal from "decimal.js";

/** The two roles whose assets are made of instruments. */
export const HOLDING_ROLES: readonly string[] = ["stocks", "bonds"];

export function categoryHasHoldings(systemRole: string | null | undefined): boolean {
  return !!systemRole && HOLDING_ROLES.includes(systemRole);
}

/** `FR0000120073` — two letters, nine alphanumerics, one check digit. */
const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Trim, drop spaces, uppercase: people paste "fr 0000 1200 73". */
export function normaliseIsin(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * The ISO 6166 check digit (Luhn over the expanded digits).
 *
 * Worth checking: the common failure is a transposed character, and a wrong
 * ISIN is worse than none — it would be sent to a price feed later.
 */
export function isinCheckDigitValid(isin: string): boolean {
  if (!ISIN_SHAPE.test(isin)) return false;
  // Letters become two digits (A = 10 … Z = 35), then the whole string is
  // validated as a Luhn number, check digit included.
  const expanded = isin
    .slice(0, 11)
    .split("")
    .map((char) => (/[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55)))
    .join("");
  const full = expanded + isin[11];

  let sum = 0;
  for (let index = 0; index < full.length; index += 1) {
    let digit = Number(full[index]);
    // Double every second digit counting from the right.
    if ((full.length - 1 - index) % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** A message for the field, or null when the ISIN is usable. */
export function isinError(raw: string): string | null {
  const isin = normaliseIsin(raw);
  if (isin === "") return "An ISIN is required";
  if (!ISIN_SHAPE.test(isin)) return "An ISIN is 12 characters: 2 letters, 9 alphanumerics, 1 digit";
  if (!isinCheckDigitValid(isin)) return "This ISIN fails its check digit — check for a typo";
  return null;
}

/**
 * A message for the field, or null when the quantity is usable.
 *
 * Fractional shares are normal, so this is a decimal rather than an integer;
 * eight places is beyond any broker's precision.
 */
export function quantityError(raw: string): string | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return "A quantity is required";
  let value: Decimal;
  try {
    value = new Decimal(text);
  } catch {
    return "A quantity is a number, for example 12.5";
  }
  if (!value.isFinite()) return "A quantity is a number, for example 12.5";
  if (value.lessThanOrEqualTo(0)) return "A quantity must be greater than zero";
  if (value.decimalPlaces() > 8) return "At most 8 decimal places";
  return null;
}

/** Price per unit: optional, but positive when given. */
export function priceError(raw: string): string | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  let value: Decimal;
  try {
    value = new Decimal(text);
  } catch {
    return "A price is a number, for example 45.20";
  }
  if (!value.isFinite()) return "A price is a number, for example 45.20";
  if (value.lessThanOrEqualTo(0)) return "A price must be greater than zero";
  if (value.decimalPlaces() > 8) return "At most 8 decimal places";
  return null;
}

/** A message for the field, or null. The label is optional, so only length. */
export function labelError(raw: string): string | null {
  return raw.trim().length > 80 ? "At most 80 characters" : null;
}

/** Normalised quantity for storage: "12.50" → "12.5". */
export function normaliseQuantity(raw: string): string {
  return new Decimal(raw.trim().replace(",", ".")).toString();
}

export interface HoldingInput {
  isin: string;
  /** Optional: "iShares MSCI World". The ISIN identifies, the label reads. */
  label: string;
  quantity: string;
  /**
   * Last known price per unit, in the asset's currency. Optional, and not a
   * purchase price: it exists so the composition can be read as a share of the
   * asset. The snapshot stays the valuation.
   */
  price: string;
}

export interface HoldingRow extends HoldingInput {
  id: number;
  asset_id: number;
}

/**
 * Validate a whole list: each row, then the duplicates the database would refuse
 * anyway. Returns messages keyed by row index so the form can mark the field.
 */
export function validateHoldings(
  rows: readonly HoldingInput[],
): Record<number, { isin?: string; label?: string; quantity?: string; price?: string }> {
  const problems: Record<number, { isin?: string; label?: string; quantity?: string; price?: string }> = {};
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const isin = isinError(row.isin);
    const label = labelError(row.label);
    const quantity = quantityError(row.quantity);
    const price = priceError(row.price);
    if (isin) problems[index] = { ...problems[index], isin };
    if (label) problems[index] = { ...problems[index], label };
    if (quantity) problems[index] = { ...problems[index], quantity };
    if (price) problems[index] = { ...problems[index], price };

    const key = normaliseIsin(row.isin);
    if (!isin && key !== "") {
      const first = seen.get(key);
      if (first !== undefined) {
        problems[index] = { ...problems[index], isin: `Already listed on line ${first + 1}` };
      } else {
        seen.set(key, index);
      }
    }
  });

  return problems;
}

/** Rows ready to write: normalised, in the order the user entered them. */
export function cleanHoldings(
  rows: readonly HoldingInput[],
): Array<{ isin: string; label: string | null; quantity: string; price: string | null }> {
  return rows.map((row) => ({
    isin: normaliseIsin(row.isin),
    label: row.label.trim() || null,
    quantity: normaliseQuantity(row.quantity),
    price: row.price.trim() === "" ? null : new Decimal(row.price.trim().replace(",", ".")).toString(),
  }));
}

/** `quantity × price`, or null when the line has no price (or is mid-typing). */
export function holdingValue(row: Pick<HoldingInput, "quantity" | "price">): Decimal | null {
  const price = row.price.trim();
  const quantity = row.quantity.trim();
  if (price === "" || quantity === "") return null;
  try {
    return new Decimal(quantity.replace(",", ".")).times(new Decimal(price.replace(",", ".")));
  } catch {
    return null;
  }
}

export interface HoldingsTotal {
  /** Sum of the lines that have a price. */
  total: Decimal;
  priced: number;
  rows: number;
  /** False when at least one line has no price: the total is then partial. */
  allPriced: boolean;
}

/** The valued part of the composition, or null when nothing is priced. */
export function holdingsTotal(rows: readonly HoldingInput[]): HoldingsTotal | null {
  let total = new Decimal(0);
  let priced = 0;
  for (const row of rows) {
    const value = holdingValue(row);
    if (value === null) continue;
    total = total.plus(value);
    priced += 1;
  }
  if (priced === 0) return null;
  return { total, priced, rows: rows.length, allPriced: priced === rows.length };
}

/** This line's share of the valued total, as a fraction (0.54), or null. */
export function holdingShare(row: Pick<HoldingInput, "quantity" | "price">, total: HoldingsTotal | null): Decimal | null {
  if (!total || total.total.isZero()) return null;
  const value = holdingValue(row);
  return value === null ? null : value.dividedBy(total.total);
}

/**
 * How far the valued composition is from the asset's snapshot, as a fraction.
 *
 * `null` when the composition is not fully priced, so a partial total is never
 * compared with a complete valuation.
 */
export function compositionGap(
  rows: readonly HoldingInput[],
  snapshot: Decimal | null,
): Decimal | null {
  const total = holdingsTotal(rows);
  if (!total || !total.allPriced || !snapshot || snapshot.isZero()) return null;
  return total.total.minus(snapshot).dividedBy(snapshot).abs();
}

/** Total quantity, for the card's subtitle. `null` when there are no rows. */
export function totalQuantity(rows: readonly HoldingInput[]): Decimal | null {
  if (rows.length === 0) return null;
  return rows.reduce((sum, row) => sum.plus(new Decimal(row.quantity)), new Decimal(0));
}
