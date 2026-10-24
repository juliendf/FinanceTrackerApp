/** Reference data: institutions. Typed SQL only, no business logic. */

import { getDb } from "../client";

export interface Institution {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export async function listInstitutions(): Promise<Institution[]> {
  const db = await getDb();
  return db.select<Institution[]>(
    `SELECT id, name, description, created_at, updated_at
       FROM institutions
      ORDER BY name COLLATE NOCASE ASC`,
  );
}

export async function createInstitution(
  name: string,
  description: string | null = null,
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO institutions (name, description) VALUES (?, ?)`,
    [name.trim(), description],
  );
  return Number(result.lastInsertId);
}

export async function countInstitutions(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM institutions`,
  );
  return rows[0]?.n ?? 0;
}
