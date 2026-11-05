/** Profile (single row), memories and goals. Typed SQL only. */

import { executeWrite, getDb } from "../client";
import { runTransaction } from "../transaction";
import { sqlInt, sqlText } from "../literals";

export interface Profile {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  financial_goals: string | null;
  birth_date: string | null;
  /** ISO 3166-1 alpha-2, e.g. `CH`. The assistant uses it for tax-aware answers. */
  tax_residence: string | null;
  /** Monthly living costs, in the profile currency. Nothing else gives a savings rate. */
  monthly_expenses_minor: number | null;
  /** How many people depend on this income; `0` means an explicit "none". */
  dependants_count: number | null;
  /** Their ages as typed, e.g. `4, 7`. Free text because ages are not amounts. */
  dependant_ages: string | null;
  /** `employed`, `self_employed`, `retired`, `student`, `between_jobs`, `other`. */
  employment_status: string | null;
  /** `single`, `married`, `registered_partnership`, `divorced`, `widowed`. */
  marital_status: string | null;
  /** `participation_aux_acquets`, `separation_de_biens`, `communaute_de_biens`, `unknown`. */
  marital_regime: string | null;
  /** `null` not stated, `0` no, `1` yes — "no will" is an action, "not stated" a question. */
  has_will: number | null;
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
  tax_residence: null,
  monthly_expenses_minor: null,
  dependants_count: null,
  dependant_ages: null,
  employment_status: null,
  marital_status: null,
  marital_regime: null,
  has_will: null,
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

/**
 * The profile row.
 *
 * **Every column the interface declares must be listed here.** `saveProfile`
 * writes `job_title`, `financial_goals` and `birth_date`, but this query used to
 * omit them: the form loaded them as empty, showed an empty field, and the next
 * save wrote `NULL` back over them. The chat prompt lost them too, since it reads
 * the profile through this function. `profile.test.ts` now compares the column
 * list with `EMPTY_PROFILE`, so a forgotten column fails the suite instead of
 * quietly erasing what the user typed.
 */
export async function getProfile(): Promise<Profile> {
  const db = await getDb();
  const rows = await db.select<Profile[]>(
    `SELECT first_name, last_name, job_title, financial_goals, birth_date, tax_residence,
            monthly_expenses_minor, dependants_count, dependant_ages, employment_status,
            marital_status, marital_regime, has_will,
            currency, timezone, date_format, salary_minor,
            monthly_savings_target_minor, risk_profile, ai_tone, ai_verbosity, ai_expertise
       FROM profile WHERE id = 1`,
  );
  return rows[0] ?? EMPTY_PROFILE;
}

export async function saveProfile(input: Profile): Promise<void> {
  await runTransaction([
    `INSERT INTO profile (id, first_name, last_name, job_title, financial_goals, birth_date, tax_residence,
                         monthly_expenses_minor, dependants_count, dependant_ages, employment_status,
                         marital_status, marital_regime, has_will,
                         currency, timezone, date_format, salary_minor, monthly_savings_target_minor,
                         risk_profile, ai_tone, ai_verbosity, ai_expertise)
     VALUES (1, ${sqlText(input.first_name)}, ${sqlText(input.last_name)}, ${sqlText(input.job_title)},
             ${sqlText(input.financial_goals)}, ${sqlText(input.birth_date)}, ${sqlText(input.tax_residence)},
             ${sqlInt(input.monthly_expenses_minor)}, ${sqlInt(input.dependants_count)},
             ${sqlText(input.dependant_ages)}, ${sqlText(input.employment_status)},
             ${sqlText(input.marital_status)}, ${sqlText(input.marital_regime)},
             ${sqlInt(input.has_will)},
             ${sqlText(input.currency)},
             ${sqlText(input.timezone)}, ${sqlText(input.date_format)}, ${sqlInt(input.salary_minor)},
             ${sqlInt(input.monthly_savings_target_minor)}, ${sqlText(input.risk_profile)},
             ${sqlText(input.ai_tone)}, ${sqlText(input.ai_verbosity)}, ${sqlText(input.ai_expertise)})
     ON CONFLICT(id) DO UPDATE SET
       first_name = excluded.first_name, last_name = excluded.last_name,
       job_title = excluded.job_title, financial_goals = excluded.financial_goals,
       birth_date = excluded.birth_date, tax_residence = excluded.tax_residence,
       monthly_expenses_minor = excluded.monthly_expenses_minor,
       dependants_count = excluded.dependants_count, dependant_ages = excluded.dependant_ages,
       employment_status = excluded.employment_status,
       marital_status = excluded.marital_status, marital_regime = excluded.marital_regime,
       has_will = excluded.has_will,
       currency = excluded.currency,
       timezone = excluded.timezone, date_format = excluded.date_format, salary_minor = excluded.salary_minor,
       monthly_savings_target_minor = excluded.monthly_savings_target_minor,
       risk_profile = excluded.risk_profile, ai_tone = excluded.ai_tone,
       ai_verbosity = excluded.ai_verbosity, ai_expertise = excluded.ai_expertise,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ]);
}

// --- memories -----------------------------------------------------------------

/** Marital status: it decides who inherits by default, and how income is taxed. */
export const MARITAL_STATUS_CHOICES = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "registered_partnership", label: "Registered partnership" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
] as const;

/**
 * Matrimonial regime.
 *
 * "Married" alone is not an answer: where the concept exists, the regime decides
 * what actually transfers, and it is not always the default.
 *
 * The labels are the neutral English names — gain sharing is *participation aux
 * acquêts* in France and Switzerland and *Zugewinngemeinschaft* in Germany. A
 * common-law jurisdiction has no such concept and leaves the field unset. The
 * stored keys keep their original spelling: renaming them would be a data
 * migration for a label.
 */
export const MARITAL_REGIME_CHOICES = [
  { value: "participation_aux_acquets", label: "Gain sharing" },
  { value: "separation_de_biens", label: "Separation of property" },
  { value: "communaute_de_biens", label: "Community of property" },
  { value: "unknown", label: "Not sure" },
] as const;

/** Three states, because "no will" is an action and "not stated" is a question. */
export const HAS_WILL_CHOICES = [
  { value: "", label: "Not stated" },
  { value: "1", label: "Yes" },
  { value: "0", label: "No" },
] as const;

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
  const result = await executeWrite(
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
  await executeWrite(
    `UPDATE user_memories SET category = ?, key = ?, content = ?, importance = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [input.category, input.key, input.content, input.importance, id],
  );
}

export async function deleteMemory(id: number): Promise<void> {
  await executeWrite(`DELETE FROM user_memories WHERE id = ?`, [id]);
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
  const result = await executeWrite(
    `INSERT INTO user_goals (label, target_amount_minor, target_date, priority, category)
     VALUES (?, ?, ?, ?, ?)`,
    [input.label, input.target_amount_minor, input.target_date, input.priority, input.category],
  );
  return Number(result.lastInsertId);
}

export async function updateGoal(id: number, input: GoalInput): Promise<void> {
  await executeWrite(
    `UPDATE user_goals SET label = ?, target_amount_minor = ?, target_date = ?, priority = ?, category = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [input.label, input.target_amount_minor, input.target_date, input.priority, input.category, id],
  );
}

export async function deleteGoal(id: number): Promise<void> {
  await executeWrite(`DELETE FROM user_goals WHERE id = ?`, [id]);
}
