/** Read models for the dashboards: typed SQL only. */

import { getDb } from "../client";
import type { Fact } from "../../domain/dashboard";

/** Every snapshot with the dimensions the dashboards group by. */
export async function listFacts(): Promise<Fact[]> {
  const db = await getDb();
  return db.select<Fact[]>(
    `SELECT s.asset_id, s.date, s.amount_minor, a.currency, a.product_name,
            i.name AS institution_name, c.name AS category_name, c.system_role
       FROM snapshots s
       JOIN assets a       ON a.id = s.asset_id
       JOIN institutions i ON i.id = a.institution_id
       JOIN categories c   ON c.id = a.category_id
      ORDER BY s.date ASC, s.asset_id ASC`,
  );
}

/** The currency of every asset, snapshot or not (the "Currencies" tile counts these). */
export async function listAssetCurrencies(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ currency: string }[]>(`SELECT currency FROM assets`);
  return rows.map((row) => row.currency);
}
