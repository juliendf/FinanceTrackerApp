/** The single-row profile table (former User profile fields). */

import { getDb } from "../client";

export interface Profile {
  id: number;
  first_name: string | null;
  last_name: string | null;
  currency: string;
  timezone: string;
  date_format: string;
  salary_minor: number | null;
  monthly_savings_target_minor: number | null;
  risk_profile: string | null;
  ai_tone: string | null;
  ai_verbosity: string | null;
  ai_expertise: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY: Omit<Profile, "created_at" | "updated_at"> = {
  id: 1,
  first_name: null,
  last_name: null,
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

/** Read the profile, falling back to column defaults when the row is absent. */
export async function getProfile(): Promise<Profile> {
  const db = await getDb();
  const rows = await db.select<Profile[]>(`SELECT * FROM profile WHERE id = 1`);
  if (rows[0]) return rows[0];
  return { ...EMPTY, created_at: "", updated_at: "" };
}

export async function saveProfile(
  patch: Partial<Omit<Profile, "id" | "created_at" | "updated_at">>,
): Promise<void> {
  const current = await getProfile();
  const next = { ...current, ...patch };
  const db = await getDb();
  await db.execute(
    `INSERT INTO profile
       (id, first_name, last_name, currency, timezone, date_format,
        salary_minor, monthly_savings_target_minor, risk_profile,
        ai_tone, ai_verbosity, ai_expertise)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       currency = excluded.currency,
       timezone = excluded.timezone,
       date_format = excluded.date_format,
       salary_minor = excluded.salary_minor,
       monthly_savings_target_minor = excluded.monthly_savings_target_minor,
       risk_profile = excluded.risk_profile,
       ai_tone = excluded.ai_tone,
       ai_verbosity = excluded.ai_verbosity,
       ai_expertise = excluded.ai_expertise,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [
      next.first_name,
      next.last_name,
      next.currency,
      next.timezone,
      next.date_format,
      next.salary_minor,
      next.monthly_savings_target_minor,
      next.risk_profile,
      next.ai_tone,
      next.ai_verbosity,
      next.ai_expertise,
    ],
  );
}
