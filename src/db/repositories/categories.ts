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

export interface CategoryWithCount extends Category {
  asset_count: number;
}

export async function listCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.select<Category[]>(
    `SELECT id, name, description, color, system_role, created_at, updated_at
       FROM categories
      ORDER BY name COLLATE NOCASE ASC`,
  );
}

export async function listCategoriesWithCounts(): Promise<CategoryWithCount[]> {
  const db = await getDb();
  return db.select<CategoryWithCount[]>(
    `SELECT c.id, c.name, c.description, c.color, c.system_role,
            c.created_at, c.updated_at,
            COUNT(a.id) AS asset_count
       FROM categories c
       LEFT JOIN assets a ON a.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE ASC`,
  );
}

export async function createCategory(
  name: string,
  color = "#6c757d",
  systemRole: string | null = null,
  description: string | null = null,
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO categories (name, description, color, system_role) VALUES (?, ?, ?, ?)`,
    [name.trim(), description, color, systemRole],
  );
  return Number(result.lastInsertId);
}

export async function updateCategory(
  id: number,
  name: string,
  color: string,
  systemRole: string | null,
  description: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE categories
        SET name = ?, color = ?, system_role = ?, description = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    [name.trim(), color, systemRole, description, id],
  );
}

/** `assets.category_id` is `ON DELETE RESTRICT`, so this fails while in use. */
export async function deleteCategory(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM categories WHERE id = ?`, [id]);
}

export async function countAssetsForCategory(id: number): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM assets WHERE category_id = ?`,
    [id],
  );
  return rows[0]?.n ?? 0;
}

export async function countCategories(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM categories`,
  );
  return rows[0]?.n ?? 0;
}

export async function categoryNameExists(
  name: string,
  excludeId?: number,
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM categories WHERE name = ? AND id <> ?`,
    [name.trim(), excludeId ?? -1],
  );
  return (rows[0]?.n ?? 0) > 0;
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
