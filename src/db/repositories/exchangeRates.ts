/** Exchange rates. Stored as TEXT decimals, both directions seeded explicitly. */

import { executeWrite, getDb } from "../client";
import { runTransaction } from "../transaction";
import { sqlText } from "../literals";
import { missingRatePairs } from "../../domain/currency";

export interface ExchangeRate {
  id: number;
  from_currency: string;
  to_currency: string;
  rate: string;
  created_at: string;
  updated_at: string;
}

export async function listExchangeRates(): Promise<ExchangeRate[]> {
  const db = await getDb();
  return db.select<ExchangeRate[]>(
    `SELECT id, from_currency, to_currency, rate, created_at, updated_at
       FROM exchange_rates
      ORDER BY from_currency ASC, to_currency ASC`,
  );
}

export async function upsertExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  rate: string,
): Promise<void> {
  await executeWrite(
    `INSERT INTO exchange_rates (from_currency, to_currency, rate) VALUES (?, ?, ?)
     ON CONFLICT(from_currency, to_currency)
     DO UPDATE SET rate = excluded.rate,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [fromCurrency, toCurrency, rate],
  );
}

export async function countExchangeRates(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM exchange_rates`,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Make sure the placeholder pairs exist, as `exchange_rate_list` does. The rule
 * for which pairs are required, and what "missing" means, lives in
 * `src/domain/currency.ts`; this function only reads and inserts.
 */
export async function ensureRequiredPairs(): Promise<number> {
  const db = await getDb();
  const existing = await db.select<{ from_currency: string; to_currency: string }[]>(
    `SELECT from_currency, to_currency FROM exchange_rates`,
  );
  const missing = missingRatePairs(existing.map((row) => [row.from_currency, row.to_currency] as const));
  if (missing.length === 0) return 0;
  await runTransaction(
    missing.map(
      ([from, to]) =>
        `INSERT INTO exchange_rates (from_currency, to_currency, rate) VALUES (${sqlText(from)}, ${sqlText(to)}, '0')`,
    ),
  );
  return missing.length;
}

/** Save many rates atomically. Rates are decimal text, as stored. */
export async function saveRates(
  updates: ReadonlyArray<{ from_currency: string; to_currency: string; rate: string }>,
): Promise<number> {
  if (updates.length === 0) return 0;
  await runTransaction(
    updates.map(
      (row) =>
        `INSERT INTO exchange_rates (from_currency, to_currency, rate) VALUES (${sqlText(row.from_currency)}, ${sqlText(row.to_currency)}, ${sqlText(row.rate)})
         ON CONFLICT(from_currency, to_currency) DO UPDATE SET rate = excluded.rate,
                                                             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ),
  );
  return updates.length;
}
