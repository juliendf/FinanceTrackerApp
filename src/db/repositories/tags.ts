/** Tags and their asset links. Typed SQL only. */

import { getDb } from "../client";

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export async function listTags(): Promise<Tag[]> {
  const db = await getDb();
  return db.select<Tag[]>(
    `SELECT id, name, color, created_at, updated_at
       FROM tags
      ORDER BY name COLLATE NOCASE ASC`,
  );
}

export async function createTag(name: string, color: string | null): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO tags (name, color) VALUES (?, ?)`,
    [name.trim(), color],
  );
  return Number(result.lastInsertId);
}

/** Tag ids attached to an asset. */
export async function listTagIdsForAsset(assetId: number): Promise<number[]> {
  const db = await getDb();
  const rows = await db.select<{ tag_id: number }[]>(
    `SELECT tag_id FROM asset_tags WHERE asset_id = ?`,
    [assetId],
  );
  return rows.map((row) => row.tag_id);
}

/** Replace an asset's tags in one shot. */
export async function setAssetTags(assetId: number, tagIds: number[]): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM asset_tags WHERE asset_id = ?`, [assetId]);
  for (const tagId of tagIds) {
    await db.execute(
      `INSERT INTO asset_tags (asset_id, tag_id) VALUES (?, ?)`,
      [assetId, tagId],
    );
  }
}

/** All asset/tag pairs, for list screens that show tag chips per asset. */
export async function listAllAssetTags(): Promise<
  Array<{ asset_id: number; tag_id: number }>
> {
  const db = await getDb();
  return db.select<Array<{ asset_id: number; tag_id: number }>>(
    `SELECT asset_id, tag_id FROM asset_tags`,
  );
}

export async function countTags(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM tags`);
  return rows[0]?.n ?? 0;
}
