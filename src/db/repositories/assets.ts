/** Assets: typed SQL only, no business logic. */

import { getDb } from "../client";
import { toMinorUnits } from "../../domain/money";

/** Row shape returned by the list query: asset + joined labels + latest value. */
export interface AssetListRow {
  id: number;
  institution_id: number;
  category_id: number;
  currency: string;
  product_name: string;
  name: string | null;
  description: string | null;
  notes: string | null;
  code_nin: string | null;
  cost_charges: string | null;
  interest_rate: string | null;
  created_at: string;
  updated_at: string;
  institution_name: string;
  category_name: string;
  category_color: string | null;
  latest_amount_minor: number | null;
  latest_date: string | null;
}

export interface AssetRecord {
  id: number;
  institution_id: number;
  category_id: number;
  currency: string;
  product_name: string;
  name: string | null;
  description: string | null;
  notes: string | null;
  code_nin: string | null;
  cost_charges: string | null;
  interest_rate: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAssetInput {
  institution_id: number;
  category_id: number;
  currency: string;
  product_name: string;
  name?: string | null;
  description?: string | null;
  notes?: string | null;
  code_nin?: string | null;
  /** Decimal string, e.g. "0.25". */
  cost_charges?: string | null;
  /** Decimal string, e.g. "1.75". */
  interest_rate?: string | null;
  /** Initial snapshot in major units; omitted means no snapshot. */
  initial_amount?: string | null;
  initial_date?: string | null;
}

const LIST_SQL = `
  SELECT a.id, a.institution_id, a.category_id, a.currency, a.product_name,
         a.name, a.description, a.notes, a.code_nin, a.cost_charges,
         a.interest_rate, a.created_at, a.updated_at,
         i.name AS institution_name,
         c.name AS category_name,
         c.color AS category_color,
         s.amount_minor AS latest_amount_minor,
         s.date AS latest_date
    FROM assets a
    JOIN institutions i ON i.id = a.institution_id
    JOIN categories  c ON c.id = a.category_id
    LEFT JOIN snapshots s
      ON s.asset_id = a.id
     AND s.date = (SELECT MAX(date) FROM snapshots WHERE asset_id = a.id)
   ORDER BY i.name COLLATE NOCASE ASC, a.product_name COLLATE NOCASE ASC
`;

export async function listAssets(): Promise<AssetListRow[]> {
  const db = await getDb();
  return db.select<AssetListRow[]>(LIST_SQL);
}

export async function getAsset(id: number): Promise<AssetRecord | null> {
  const db = await getDb();
  const rows = await db.select<AssetRecord[]>(
    `SELECT * FROM assets WHERE id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Create an asset, optionally with its first snapshot.
 *
 * The SQL plugin exposes no transaction handle, so a failed snapshot insert is
 * compensated by deleting the asset. Phase 1 adds a real transaction path.
 */
export async function createAsset(input: CreateAssetInput): Promise<number> {
  const db = await getDb();

  const result = await db.execute(
    `INSERT INTO assets
       (institution_id, category_id, currency, product_name, name,
        description, notes, code_nin, cost_charges, interest_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.institution_id,
      input.category_id,
      input.currency,
      input.product_name.trim(),
      input.name?.trim() || null,
      input.description?.trim() || null,
      input.notes?.trim() || null,
      input.code_nin?.trim() || null,
      input.cost_charges ?? null,
      input.interest_rate ?? null,
    ],
  );

  const assetId = Number(result.lastInsertId);

  if (input.initial_amount) {
    const date = input.initial_date ?? new Date().toISOString().slice(0, 10);
    try {
      await db.execute(
        `INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (?, ?, ?)`,
        [assetId, date, toMinorUnits(input.initial_amount)],
      );
    } catch (error) {
      await db.execute(`DELETE FROM assets WHERE id = ?`, [assetId]);
      throw error;
    }
  }

  return assetId;
}

export async function deleteAsset(id: number): Promise<void> {
  const db = await getDb();
  // snapshots cascade via the foreign key (foreign_keys pragma is on).
  await db.execute(`DELETE FROM assets WHERE id = ?`, [id]);
}

export async function countAssets(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM assets`);
  return rows[0]?.n ?? 0;
}
