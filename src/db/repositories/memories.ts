/** Memories and goals. */

import { getDb } from "../client";

export type MemoryCategory =
  | "personal"
  | "financial"
  | "goal"
  | "preference"
  | "life_event";

export interface Memory {
  id: number;
  category: MemoryCategory;
  key: string;
  content: string;
  source: "manual" | "ai_extracted";
  conversation_id: number | null;
  importance: number;
  created_at: string;
  updated_at: string;
}

export async function listMemories(): Promise<Memory[]> {
  const db = await getDb();
  return db.select<Memory[]>(
    `SELECT * FROM user_memories
      ORDER BY importance DESC, updated_at DESC`,
  );
}

export async function createMemory(input: {
  category: MemoryCategory;
  key: string;
  content: string;
  importance?: number;
  source?: "manual" | "ai_extracted";
  conversation_id?: number | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO user_memories
       (category, key, content, importance, source, conversation_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.category,
      input.key.trim(),
      input.content.trim(),
      input.importance ?? 3,
      input.source ?? "manual",
      input.conversation_id ?? null,
    ],
  );
  return Number(result.lastInsertId);
}

export async function deleteMemory(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM user_memories WHERE id = ?`, [id]);
}

export type GoalPriority = "low" | "medium" | "high";

export interface Goal {
  id: number;
  label: string;
  target_amount_minor: number | null;
  target_date: string | null;
  priority: GoalPriority;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export async function listGoals(): Promise<Goal[]> {
  const db = await getDb();
  return db.select<Goal[]>(
    `SELECT * FROM user_goals ORDER BY
       CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
       target_date IS NULL, target_date ASC`,
  );
}

export async function createGoal(input: {
  label: string;
  target_amount_minor?: number | null;
  target_date?: string | null;
  priority?: GoalPriority;
  category?: string | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO user_goals (label, target_amount_minor, target_date, priority, category)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.label.trim(),
      input.target_amount_minor ?? null,
      input.target_date ?? null,
      input.priority ?? "medium",
      input.category ?? null,
    ],
  );
  return Number(result.lastInsertId);
}

export async function deleteGoal(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM user_goals WHERE id = ?`, [id]);
}
