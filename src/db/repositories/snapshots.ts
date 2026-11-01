/** Snapshots: typed SQL only. Multi-row writes go through `run_transaction`. */

import { executeWrite, getDb } from "../client";
import { runTransaction } from "../transaction";
import { sqlInt, sqlText } from "../literals";
import type { SnapshotListRow } from "../../domain/snapshots";

export type { SnapshotListRow };

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

const LIST_SQL = `
  SELECT s.id, s.asset_id, s.date, s.amount_minor, s.created_at, s.updated_at,
         a.name AS asset_name, a.product_name, a.currency,
         i.id AS institution_id, i.name AS institution_name,
         c.name AS category_name
    FROM snapshots s
    JOIN assets a       ON a.id = s.asset_id
    JOIN institutions i ON i.id = a.institution_id
    JOIN categories c   ON c.id = a.category_id
`;

/** Every snapshot with the labels the list, detail and CSV export need. */
export async function listSnapshotRows(): Promise<SnapshotListRow[]> {
  const db = await getDb();
  return db.select<SnapshotListRow[]>(`${LIST_SQL} ORDER BY s.date DESC, s.id ASC`);
}

export async function getSnapshotRow(id: number): Promise<SnapshotListRow | null> {
  const db = await getDb();
  const rows = await db.select<SnapshotListRow[]>(`${LIST_SQL} WHERE s.id = ?`, [id]);
  return rows[0] ?? null;
}

/** The other snapshots of an asset, newest first (the detail page's timeline). */
export async function listRelatedSnapshots(
  assetId: number,
  excludeId: number,
  limit = 10,
): Promise<SnapshotRow[]> {
  const db = await getDb();
  return db.select<SnapshotRow[]>(
    `SELECT id, asset_id, date, amount_minor, created_at, updated_at
       FROM snapshots
      WHERE asset_id = ? AND id <> ?
      ORDER BY date DESC
      LIMIT ?`,
    [assetId, excludeId, limit],
  );
}

/** The asset's most recent snapshot, whatever the date (`previous_snapshot_api`). */
export async function latestSnapshotForAsset(assetId: number): Promise<SnapshotRow | null> {
  const db = await getDb();
  const rows = await db.select<SnapshotRow[]>(
    `SELECT id, asset_id, date, amount_minor, created_at, updated_at
       FROM snapshots
      WHERE asset_id = ?
      ORDER BY date DESC
      LIMIT 1`,
    [assetId],
  );
  return rows[0] ?? null;
}

/** Is there already a snapshot for this asset on this date? (`excludeId` for edits.) */
export async function snapshotExists(
  assetId: number,
  date: string,
  excludeId?: number,
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM snapshots WHERE asset_id = ? AND date = ? AND id <> ?`,
    [assetId, date, excludeId ?? -1],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** Asset ids that already have a snapshot on `date`, for the bulk duplicate check. */
export async function assetIdsWithSnapshotOn(date: string): Promise<Set<number>> {
  const db = await getDb();
  const rows = await db.select<{ asset_id: number }[]>(
    `SELECT asset_id FROM snapshots WHERE date = ?`,
    [date],
  );
  return new Set(rows.map((row) => row.asset_id));
}

/** Insert one snapshot. `amountMinor` is already an integer. */
export async function createSnapshot(
  assetId: number,
  date: string,
  amountMinor: number,
): Promise<number> {
  const result = await executeWrite(
    `INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (?, ?, ?)`,
    [assetId, date, amountMinor],
  );
  return Number(result.lastInsertId);
}

export async function updateSnapshot(
  id: number,
  date: string,
  amountMinor: number,
): Promise<void> {
  await executeWrite(
    `UPDATE snapshots
        SET date = ?, amount_minor = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    [date, amountMinor, id],
  );
}

export async function deleteSnapshot(id: number): Promise<void> {
  await executeWrite(`DELETE FROM snapshots WHERE id = ?`, [id]);
}

/** Delete several snapshots atomically. Returns how many ids were requested. */
export async function deleteSnapshots(ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const unique = [...new Set(ids)];
  await runTransaction(unique.map((id) => `DELETE FROM snapshots WHERE id = ${sqlInt(id)}`));
  return unique.length;
}

/**
 * Create many snapshots on one date, all or nothing.
 *
 * A failure on any row — a duplicate that slipped past validation, say — rolls
 * the whole batch back, so the bulk grid can never leave half a date recorded.
 */
export async function createSnapshotsBulk(
  date: string,
  rows: ReadonlyArray<{ assetId: number; amountMinor: number }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  await runTransaction(
    rows.map(
      (row) =>
        `INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (${sqlInt(row.assetId)}, ${sqlText(date)}, ${sqlInt(row.amountMinor)})`,
    ),
  );
  return rows.length;
}

/** Update many amounts at once, all or nothing. */
export async function updateSnapshotAmountsBulk(
  updates: ReadonlyArray<{ snapshotId: number; amountMinor: number }>,
): Promise<number> {
  if (updates.length === 0) return 0;
  await runTransaction(
    updates.map(
      (update) =>
        `UPDATE snapshots SET amount_minor = ${sqlInt(update.amountMinor)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ${sqlInt(update.snapshotId)}`,
    ),
  );
  return updates.length;
}

export async function countSnapshots(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM snapshots`);
  return rows[0]?.n ?? 0;
}

/** The snapshot for an asset on one date, if any (the confirm flow's upsert check). */
export async function getSnapshotOn(assetId: number, date: string): Promise<SnapshotRow | null> {
  const db = await getDb();
  const rows = await db.select<SnapshotRow[]>(
    `SELECT id, asset_id, date, amount_minor, created_at, updated_at
       FROM snapshots WHERE asset_id = ? AND date = ?`,
    [assetId, date],
  );
  return rows[0] ?? null;
}
