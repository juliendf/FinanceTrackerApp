/** Snapshots: typed SQL only, no business logic. */

import { getDb } from "../client";
import { toMinorUnits } from "../../domain/money";

export interface SnapshotRow {
  id: number;
  asset_id: number;
  date: string;
  amount_minor: number;
  created_at: string;
  updated_at: string;
}

export interface SnapshotPoint {
  asset_id: number;
  date: string;
  amount_minor: number;
  currency: string;
}

export async function listSnapshotsForAsset(assetId: number): Promise<SnapshotRow[]> {
  const db = await getDb();
  return db.select<SnapshotRow[]>(
    `SELECT id, asset_id, date, amount_minor, created_at, updated_at
       FROM snapshots
      WHERE asset_id = ?
      ORDER BY date ASC`,
    [assetId],
  );
}

/**
 * Every snapshot joined to its asset currency, oldest first. One query for the
 * whole portfolio chart instead of one per asset.
 */
export async function listAllSnapshotPoints(): Promise<SnapshotPoint[]> {
  const db = await getDb();
  return db.select<SnapshotPoint[]>(
    `SELECT s.asset_id, s.date, s.amount_minor, a.currency
       FROM snapshots s
       JOIN assets a ON a.id = s.asset_id
      ORDER BY s.date ASC, s.asset_id ASC`,
  );
}

export async function createSnapshot(
  assetId: number,
  date: string,
  amount: string,
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (?, ?, ?)`,
    [assetId, date, toMinorUnits(amount)],
  );
  return Number(result.lastInsertId);
}

export async function countSnapshots(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM snapshots`,
  );
  return rows[0]?.n ?? 0;
}
