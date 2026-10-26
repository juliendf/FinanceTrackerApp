/** Reference data: categories. Typed SQL only, no business logic. */

import { getDb } from "../client";

export interface Category {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  system_role: string | null;
  created_at: string;
  updated_at: string;
}

export async function listCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.select<Category[]>(
    `SELECT id, name, description, color, system_role, created_at, updated_at
       FROM categories
      ORDER BY name COLLATE NOCASE ASC`,
  );
}

export async function createCategory(
  name: string,
  color = "#6c757d",
  systemRole: string | null = null,
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO categories (name, color, system_role) VALUES (?, ?, ?)`,
    [name.trim(), color, systemRole],
  );
  return Number(result.lastInsertId);
}

export async function countCategories(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM categories`,
  );
  return rows[0]?.n ?? 0;
}

/** Set (or clear) a category's system role. Used by the import role-mapping step. */
export async function updateCategoryRole(
  id: number,
  systemRole: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE categories SET system_role = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    [systemRole, id],
  );
}

/** Categories that still have no system role. */
export async function listCategoriesMissingRole(): Promise<Category[]> {
  const db = await getDb();
  return db.select<Category[]>(
    `SELECT id, name, description, color, system_role, created_at, updated_at
       FROM categories
      WHERE system_role IS NULL OR system_role = ''
      ORDER BY name COLLATE NOCASE ASC`,
  );
}
