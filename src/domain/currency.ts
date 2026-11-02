/**
 * Currency conversion.
 *
 * Two behaviours:
 *
 *   * `convertStrict`: same currency, a direct rate, or the inverse of the
 *     opposite pair; anything else throws. The asset list summary uses it and
 *     hides its combined total when it throws.
 *   * `CurrencyConverter.convert` is the dashboard path: direct, then a hop
 *     through EUR/USD/CHF, then — rather than crash a page — the *unconverted*
 *     amount, recorded so the UI can badge it.
 *
 * Amounts are Decimal in major units. Rates are TEXT decimals in the database.
 */

import Decimal from "decimal.js";

export interface RateRow {
  from_currency: string;
  to_currency: string;
  rate: string;
}

export class NoRateError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`No exchange rate available for ${from} to ${to}`);
    this.name = "NoRateError";
  }
}

export class RateTable {
  private readonly direct = new Map<string, Decimal>();

  constructor(rows: readonly RateRow[]) {
    for (const row of rows) {
      const rate = new Decimal(row.rate);
      if (rate.isFinite() && rate.greaterThan(0)) {
        this.direct.set(`${row.from_currency}>${row.to_currency}`, rate);
      }
    }
  }

  /** `ExchangeRate.get_rate`: identity, direct, inverse, else null. */
  find(from: string, to: string): Decimal | null {
    if (from === to) return new Decimal(1);

    const direct = this.direct.get(`${from}>${to}`);
    if (direct) return direct;

    const inverse = this.direct.get(`${to}>${from}`);
    if (inverse) return new Decimal(1).dividedBy(inverse);

    return null;
  }

  /** `get_exchange_rate`: like `find` but throws instead of returning null. */
  get(from: string, to: string): Decimal {
    const rate = this.find(from, to);
    if (rate === null) throw new NoRateError(from, to);
    return rate;
  }
}

/** `convert_amount`. Throws {@link NoRateError} when no direct or inverse rate exists. */
export function convertStrict(
  amount: Decimal.Value,
  from: string,
  to: string,
  rates: RateTable,
): Decimal {
  const value = new Decimal(amount);
  if (from === to) return value;
  return value.times(rates.get(from, to));
}

/** Currencies tried as a bridge when no direct route exists. */
const FALLBACK_INTERMEDIATES = ["EUR", "USD", "CHF"] as const;

/**
 * The currencies the app understands. Every money path assumes 2 dp
 * (`src/domain/money.ts`); the importer validates against this set.
 */
export const SUPPORTED_CURRENCIES = ["EUR", "USD", "CHF"] as const;

export function isSupportedCurrency(code: string): boolean {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

/**
 * The rate pairs the list and edit screens always show, created at rate 0 when
 * missing. `RateTable` ignores non-positive rates, so such a pair behaves as "no
 * rate" until the user sets one.
 */
export const REQUIRED_RATE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["CHF", "USD"],
  ["USD", "CHF"],
];

/** Which required pairs are absent, given the `[from, to]` pairs already stored. */
export function missingRatePairs(
  existing: Iterable<readonly [string, string]>,
): Array<readonly [string, string]> {
  const seen = new Set<string>();
  for (const [from, to] of existing) seen.add(`${from}>${to}`);
  return REQUIRED_RATE_PAIRS.filter(([from, to]) => !seen.has(`${from}>${to}`));
}

export interface ConversionWarning {
  from: string;
  to: string;
}

/** `CurrencyConverter`: direct, then a bridge, then unconverted. */
export class CurrencyConverter {
  /** Pairs that fell through to the unconverted amount, for an "unconverted" badge. */
  readonly warnings: ConversionWarning[] = [];

  constructor(
    private readonly rates: RateTable,
    readonly baseCurrency: string,
  ) {}

  convert(amount: Decimal.Value, from: string, to?: string): Decimal {
    const target = to ?? this.baseCurrency;
    const value = new Decimal(amount);
    if (from === target) return value;

    const direct = this.rates.find(from, target);
    if (direct) return value.times(direct);

    for (const middle of FALLBACK_INTERMEDIATES) {
      if (middle === from || middle === target) continue;
      const first = this.rates.find(from, middle);
      const second = this.rates.find(middle, target);
      if (first && second) return value.times(first).times(second);
    }

    // Log and return the amount unchanged rather than crash.
    if (!this.warnings.some((w) => w.from === from && w.to === target)) {
      this.warnings.push({ from, to: target });
    }
    return value;
  }

  get hasWarnings(): boolean {
    return this.warnings.length > 0;
  }
}
