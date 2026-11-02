/**
 * Display formatting: currency, relative dates, day counts, dates and
 * percentages. Pure functions, unit-tested.
 */

import Decimal from "decimal.js";
import { fromMinorUnits } from "./money";

const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  CHF: "CHF ",
  GBP: "£",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
};

/** Currencies whose symbol is printed before the amount. */
const SYMBOL_FIRST = new Set(["USD", "EUR", "GBP", "CAD", "AUD"]);

/** Comma thousands, dot decimals, always 2 dp. */
export function formatNumber(value: Decimal): string {
  // The sign comes from the original value, so a value that rounds to zero
  // keeps it (-0.004 -> "-0.00"); decide the sign before rounding.
  const sign = value.isNegative() ? "-" : "";
  const fixed = value.abs().toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${fraction}`;
}

export type CurrencyInput = Decimal.Value | null | undefined;

/**
 * Format an amount as currency: "N/A" for null, empty or non-numeric input,
 * otherwise the symbol and the grouped amount.
 */
export function formatCurrency(
  value: CurrencyInput,
  currencyCode = "USD",
): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "string" && value.trim() === "") return "N/A";

  let amount: Decimal;
  try {
    amount = new Decimal(value as Decimal.Value);
  } catch {
    return "N/A";
  }
  if (!amount.isFinite()) return "N/A";

  const code = currencyCode.toUpperCase();
  const symbol = SYMBOLS[code] ?? `${currencyCode} `;
  const formatted = formatNumber(amount);

  // The symbol is prefixed to the formatted number, so the minus sign lands
  // after the symbol for $-style currencies: `$-1,234.57`, not `-$1,234.57`.
  return SYMBOL_FIRST.has(code) ? `${symbol}${formatted}` : `${formatted} ${symbol}`;
}

/** Convenience for the common case: minor units straight to a display string. */
export function formatMinorAsCurrency(
  minor: number | null | undefined,
  currencyCode = "USD",
): string {
  if (minor === null || minor === undefined) return "N/A";
  return formatCurrency(fromMinorUnits(minor) ?? 0, currencyCode);
}

/**
 * `percentage` filter: multiplies by 100 and appends '%'.
 *
 * Note this differs from the `percentage` column type in `table.html`, which
 * formats the raw value without scaling — the two are intentionally separate.
 */
export function formatPercentage(
  value: Decimal.Value | null | undefined,
  decimalPlaces = 2,
): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "string" && value.trim() === "") return "N/A";

  let amount: Decimal;
  try {
    amount = new Decimal(value as Decimal.Value);
  } catch {
    return "N/A";
  }
  if (!amount.isFinite()) return "N/A";

  const percentage = amount
    .times(100)
    .toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_EVEN);
  return `${percentage.toFixed(decimalPlaces)}%`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parse an ISO `YYYY-MM-DD` date as UTC midnight. Null when unparseable. */
function parseIsoDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Format an ISO date with strftime tokens. Default format is `%Y-%m-%d`.
 * Supports the strftime tokens the app actually uses: %Y %m %d %B %b %H %M %S.
 */
export function formatDate(
  value: string | null | undefined,
  formatString = "%Y-%m-%d",
): string {
  if (value === null || value === undefined) return "N/A";
  const date = parseIsoDate(value);
  if (!date) return "Invalid date";

  const pad = (input: number) => String(input).padStart(2, "0");
  const month = date.getUTCMonth();
  return formatString
    .replace(/%B/g, MONTH_NAMES[month])
    .replace(/%b/g, MONTH_NAMES[month].slice(0, 3))
    .replace(/%Y/g, String(date.getUTCFullYear()))
    .replace(/%m/g, pad(date.getUTCMonth() + 1))
    .replace(/%d/g, pad(date.getUTCDate()))
    .replace(/%H/g, pad(date.getUTCHours()))
    .replace(/%M/g, pad(date.getUTCMinutes()))
    .replace(/%S/g, pad(date.getUTCSeconds()));
}

/** Whole days between an ISO date and today. Negative clamps to 0. */
export function daysSince(date: string | null, today = new Date()): number {
  if (!date) return 0;
  const then = new Date(`${date}T00:00:00Z`).getTime();
  const now = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const days = Math.floor((now - then) / 86_400_000);
  return days < 0 ? 0 : days;
}

/**
 * `relative_date` filter: 'Never', 'Today', 'Yesterday', 'N days ago',
 * 'N week(s) ago', 'N month(s) ago', 'N year(s) ago'.
 *
 * Only weeks/months/years are pluralised: "days" is always plural for 2..6.
 */
export function relativeDate(
  value: string | null | undefined,
  today = new Date(),
): string {
  if (value === null || value === undefined) return "Never";
  if (!parseIsoDate(value)) return "Invalid date";

  const days = daysSince(value, today);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? "s" : ""} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

/**
 * A stored percentage *value* (1.25 means 1.25 %) for display.
 *
 * Distinct from {@link formatPercentage}, which treats its input as a fraction
 * and scales by 100. Interest rate and cost/charges are stored as percentage
 * values (1.25 means 1.25 %), not fractions, so they must not be scaled.
 */
export function formatPercentValue(value: Decimal.Value | null | undefined): string {
  if (value === null || value === undefined || value === "") return "N/A";
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    return "N/A";
  }
  if (!amount.isFinite()) return "N/A";
  // Two places as a floor, up to four as the form allows.
  const four = amount.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
  const text = four.decimalPlaces() <= 2 ? four.toFixed(2) : four.toString();
  return `${text}%`;
}

/**
 * Symbol, a space, then the grouped amount: "CHF 1,234.50". Note this is *not*
 * `formatCurrency` — CHF stays a prefix here, so it prints "CHF 1,234.50"
 * rather than "1,234.50 CHF".
 */
export function formatSymbolAmount(symbol: string, major: Decimal.Value): string {
  return `${symbol} ${formatNumber(new Decimal(major))}`;
}
