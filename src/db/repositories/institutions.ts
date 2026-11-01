/** Reference data: institutions. Typed SQL only, no business logic. */

import { executeWrite, getDb } from "../client";

export interface Institution {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstitutionWithCount extends Institution {
  asset_count: number;
}

export async function listInstitutions(): Promise<Institution[]> {
  const db = await getDb();
  return db.select<Institution[]>(
    `SELECT id, name, description, created_at, updated_at
       FROM institutions
      ORDER BY name COLLATE NOCASE ASC`,
  );
}

/** Institutions plus how many assets reference each one (for the list screen). */
export async function listInstitutionsWithCounts(): Promise<InstitutionWithCount[]> {
  const db = await getDb();
  return db.select<InstitutionWithCount[]>(
    `SELECT i.id, i.name, i.description, i.created_at, i.updated_at,
            COUNT(a.id) AS asset_count
       FROM institutions i
       LEFT JOIN assets a ON a.institution_id = i.id
      GROUP BY i.id
      ORDER BY i.name COLLATE NOCASE ASC`,
  );
}

export async function createInstitution(
  name: string,
  description: string | null = null,
): Promise<number> {
  const result = await executeWrite(
    `INSERT INTO institutions (name, description) VALUES (?, ?)`,
    [name.trim(), description],
  );
  return Number(result.lastInsertId);
}

export async function updateInstitution(
  id: number,
  name: string,
  description: string | null,
): Promise<void> {
  await executeWrite(
    `UPDATE institutions
        SET name = ?, description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    [name.trim(), description, id],
  );
}

/**
 * Delete an institution.
 *
 * `assets.institution_id` is `ON DELETE RESTRICT`, so this fails at the database
 * level while assets still point at it. The list screen checks first and shows a
 * readable message; this is the backstop.
 */
export async function deleteInstitution(id: number): Promise<void> {
  await executeWrite(`DELETE FROM institutions WHERE id = ?`, [id]);
}

export async function countAssetsForInstitution(id: number): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM assets WHERE institution_id = ?`,
    [id],
  );
  return rows[0]?.n ?? 0;
}

export async function countInstitutions(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM institutions`,
  );
  return rows[0]?.n ?? 0;
}

/** Names already taken, used for pre-submit uniqueness feedback. */
export async function institutionNameExists(
  name: string,
  excludeId?: number,
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM institutions WHERE name = ? AND id <> ?`,
    [name.trim(), excludeId ?? -1],
  );
  return (rows[0]?.n ?? 0) > 0;
}
