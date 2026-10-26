/** Exchange rates. Stored as TEXT decimals, both directions seeded explicitly. */

import { getDb } from "../client";

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
  const db = await getDb();
  await db.execute(
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
