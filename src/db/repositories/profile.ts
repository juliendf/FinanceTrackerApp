/** Profile (single row), memories and goals. Typed SQL only. */

import { getDb } from "../client";
import { runTransaction } from "../transaction";
import { sqlInt, sqlText } from "../literals";

export interface Profile {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  financial_goals: string | null;
  birth_date: string | null;
  currency: string;
  timezone: string;
  date_format: string;
  salary_minor: number | null;
  monthly_savings_target_minor: number | null;
  risk_profile: string | null;
  ai_tone: string;
  ai_verbosity: string;
  ai_expertise: string;
}

export const EMPTY_PROFILE: Profile = {
  first_name: null,
  last_name: null,
  job_title: null,
  financial_goals: null,
  birth_date: null,
  currency: "EUR",
  timezone: "UTC",
  date_format: "%Y-%m-%d",
  salary_minor: null,
  monthly_savings_target_minor: null,
  risk_profile: null,
  ai_tone: "encouraging",
  ai_verbosity: "balanced",
  ai_expertise: "intermediate",
};

export async function getProfile(): Promise<Profile> {
  const db = await getDb();
  const rows = await db.select<Profile[]>(
    `SELECT first_name, last_name, currency, timezone, date_format, salary_minor,
            monthly_savings_target_minor, risk_profile, ai_tone, ai_verbosity, ai_expertise
       FROM profile WHERE id = 1`,
  );
  return rows[0] ?? EMPTY_PROFILE;
}

export async function saveProfile(input: Profile): Promise<void> {
  await runTransaction([
    `INSERT INTO profile (id, first_name, last_name, job_title, financial_goals, birth_date, currency,
                         timezone, date_format, salary_minor, monthly_savings_target_minor, risk_profile,
                         ai_tone, ai_verbosity, ai_expertise)
     VALUES (1, ${sqlText(input.first_name)}, ${sqlText(input.last_name)}, ${sqlText(input.job_title)},
             ${sqlText(input.financial_goals)}, ${sqlText(input.birth_date)}, ${sqlText(input.currency)},
             ${sqlText(input.timezone)}, ${sqlText(input.date_format)}, ${sqlInt(input.salary_minor)},
             ${sqlInt(input.monthly_savings_target_minor)}, ${sqlText(input.risk_profile)},
             ${sqlText(input.ai_tone)}, ${sqlText(input.ai_verbosity)}, ${sqlText(input.ai_expertise)})
     ON CONFLICT(id) DO UPDATE SET
       first_name = excluded.first_name, last_name = excluded.last_name,
       job_title = excluded.job_title, financial_goals = excluded.financial_goals,
       birth_date = excluded.birth_date,
       currency = excluded.currency,
       timezone = excluded.timezone, date_format = excluded.date_format, salary_minor = excluded.salary_minor,
       monthly_savings_target_minor = excluded.monthly_savings_target_minor,
       risk_profile = excluded.risk_profile, ai_tone = excluded.ai_tone,
       ai_verbosity = excluded.ai_verbosity, ai_expertise = excluded.ai_expertise,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ]);
}

// --- memories -----------------------------------------------------------------

export const MEMORY_CATEGORIES = [
  { value: "personal", label: "Personal" },
  { value: "financial", label: "Financial" },
  { value: "goal", label: "Goal" },
  { value: "preference", label: "Preference" },
  { value: "life_event", label: "Life Event" },
] as const;

export interface Memory {
  id: number;
  category: string;
  key: string;
  content: string;
  source: string;
  conversation_id: number | null;
  importance: number;
  created_at: string;
  updated_at: string;
}

/** Ordered as the profile page shows them: most important first, then newest. */
export async function listMemories(): Promise<Memory[]> {
  const db = await getDb();
  return db.select<Memory[]>(
    `SELECT id, category, key, content, source, conversation_id, importance, created_at, updated_at
       FROM user_memories ORDER BY importance DESC, created_at DESC`,
  );
}

export async function listTopMemories(limit: number): Promise<Memory[]> {
  const db = await getDb();
  return db.select<Memory[]>(
    `SELECT id, category, key, content, source, conversation_id, importance, created_at, updated_at
       FROM user_memories ORDER BY importance DESC, created_at DESC LIMIT ?`,
    [limit],
  );
}

export interface MemoryInput {
  category: string;
  key: string;
  content: string;
  importance: number;
  source?: string;
  conversationId?: number | null;
}

export async function createMemory(input: MemoryInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO user_memories (category, key, content, source, conversation_id, importance)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.category,
      input.key,
      input.content,
      input.source ?? "manual",
      input.conversationId ?? null,
      input.importance,
    ],
  );
  return Number(result.lastInsertId);
}

export async function updateMemory(id: number, input: Omit<MemoryInput, "source" | "conversationId">): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE user_memories SET category = ?, key = ?, content = ?, importance = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [input.category, input.key, input.content, input.importance, id],
  );
}

export async function deleteMemory(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM user_memories WHERE id = ?`, [id]);
}

// --- goals ----------------------------------------------------------------------

export const GOAL_PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

export const GOAL_CATEGORIES = [
  { value: "", label: "-- None --" },
  { value: "retirement", label: "Retirement" },
  { value: "housing", label: "Housing" },
  { value: "education", label: "Education" },
  { value: "travel", label: "Travel" },
  { value: "emergency", label: "Emergency Fund" },
  { value: "debt", label: "Debt Payoff" },
  { value: "other", label: "Other" },
] as const;

export interface Goal {
  id: number;
  label: string;
  target_amount_minor: number | null;
  target_date: string | null;
  priority: string;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export async function listGoals(): Promise<Goal[]> {
  const db = await getDb();
  return db.select<Goal[]>(
    `SELECT id, label, target_amount_minor, target_date, priority, category, created_at, updated_at
       FROM user_goals ORDER BY created_at ASC, id ASC`,
  );
}

export interface GoalInput {
  label: string;
  target_amount_minor: number | null;
  target_date: string | null;
  priority: string;
  category: string | null;
}

export async function createGoal(input: GoalInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO user_goals (label, target_amount_minor, target_date, priority, category)
     VALUES (?, ?, ?, ?, ?)`,
    [input.label, input.target_amount_minor, input.target_date, input.priority, input.category],
  );
  return Number(result.lastInsertId);
}

export async function updateGoal(id: number, input: GoalInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE user_goals SET label = ?, target_amount_minor = ?, target_date = ?, priority = ?, category = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [input.label, input.target_amount_minor, input.target_date, input.priority, input.category, id],
  );
}

export async function deleteGoal(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM user_goals WHERE id = ?`, [id]);
}
