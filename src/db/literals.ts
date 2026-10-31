/**
 * SQL literal builders for multi-statement transactions (importer, asset writes).
 *
 * Why raw literals instead of bind parameters: `tauri-plugin-sql` exposes no
 * transaction handle, and a `BEGIN … COMMIT` split across separate `execute`
 * calls can land on different pooled connections. One `execute` call carrying
 * the whole batch runs on one connection, so wrapping it in `BEGIN … COMMIT`
 * gives real atomicity — at the cost of inlining values.
 *
 * Every value therefore goes through one of the helpers below, and text is
 * escaped by doubling single quotes. `sqlText` is unit-tested against quotes,
 * newlines, semicolons and a deliberate injection attempt.
 */

import Decimal from "decimal.js";
import { toMinorUnits } from "../domain/money";

/** Quote and escape a text value. `null`/`undefined` become NULL. */
export function sqlText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

/** Integers only; anything else is a bug in the caller. */
export function sqlInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (!Number.isInteger(value)) {
    throw new Error(`sqlInt received a non-integer: ${value}`);
  }
  return String(value);
}

/** Booleans as SQLite 0/1, matching the CHECK constraints. */
export function sqlBool(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  return value ? "1" : "0";
}

/**
 * Keep a rate as a decimal string, exactly as exported.
 *
 * Rates are stored as TEXT precisely so full precision survives; the export
 * carries them as floats, so the shortest round-trip representation is the best
 * available fidelity.
 */
export function rateText(value: number | string): string {
  return typeof value === "string" ? value : String(value);
}

/** Optional decimal columns (cost/charges, interest rate) as TEXT or NULL. */
export function decimalText(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  const text = typeof value === "string" ? value : String(value);
  if (!Number.isFinite(Number(text))) return "NULL";
  return sqlText(text);
}

/** Amounts: float major units in the file, INTEGER minor units in the database. */
export function amountMinor(value: number | string): string {
  return sqlInt(toMinorUnits(String(value)));
}

/** A rate that must stay exact through intermediate maths. */
export function exactMinor(value: Decimal): string {
  return sqlInt(value.toNumber());
}

/**
 * Guard for identifiers that are interpolated (table/column names are static
 * in this module, but ids come from the file).
 */
export function assertKnownCurrency(currency: string): string {
  if (!["EUR", "USD", "CHF"].includes(currency)) {
    throw new Error(`unsupported currency: ${currency}`);
  }
  return currency;
}
