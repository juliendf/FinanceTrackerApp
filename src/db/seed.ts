/**
 * First-run seed — port of `app/services/user_defaults.py`.
 *
 * The source seeded a new *user*: settings, the six directional rate pairs and
 * one key-less LLM provider. There is one user here, so the same rules apply
 * globally and the function is idempotent: it inserts only what is missing.
 *
 * The seeded provider never carries a credential — an API key is opt-in and goes
 * to the Keychain, never to SQLite.
 */

import { getDb } from "./client";
import { getProfile } from "./repositories/profile";
import { serializeSettingValue, DEFAULT_SETTINGS } from "../domain/settings";

/** One-way pairs; each inverse is derived as `round(1 / rate, 4)`. */
export const DEFAULT_RATES: Array<[string, string, number]> = [
  ["EUR", "USD", 1.1],
  ["EUR", "CHF", 0.95],
  ["USD", "CHF", 0.86],
];

export const DEFAULT_PROVIDER_NAME = "Ollama (default)";

export const DEFAULT_PROVIDER = {
  baseUrl: "http://localhost:11434/v1",
  model: "qwen2.5:7b",
  providerType: "openai",
};

/** All six directional pairs, each one-way pair followed by its inverse. */
export function ratePairs(): Array<[string, string, string]> {
  const pairs: Array<[string, string, string]> = [];
  for (const [from, to, rate] of DEFAULT_RATES) {
    pairs.push([from, to, String(rate)]);
    pairs.push([to, from, String(Math.round((1 / rate) * 10_000) / 10_000)]);
  }
  return pairs;
}

export interface SeedCounts {
  settings: number;
  rates: number;
  provider: number;
  profile: number;
}

/**
 * Insert the defaults that are missing. Safe to call on every launch.
 *
 * Returns what it actually inserted, so the first-run screen can say "seeded"
 * rather than guessing from row counts.
 */
export async function seedFirstRun(): Promise<SeedCounts> {
  const db = await getDb();
  const counts: SeedCounts = { settings: 0, rates: 0, provider: 0, profile: 0 };

  // Settings: insert by key, leave any existing value alone.
  const existingSettings = new Set(
    (
      await db.select<Array<{ key: string }>>(`SELECT key FROM settings`)
    ).map((row) => row.key),
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existingSettings.has(key)) continue;
    await db.execute(`INSERT INTO settings (key, value) VALUES (?, ?)`, [
      key,
      serializeSettingValue(value),
    ]);
    counts.settings += 1;
  }

  // Exchange rates: insert by directional pair.
  const existingRates = new Set(
    (
      await db.select<Array<{ from_currency: string; to_currency: string }>>(
        `SELECT from_currency, to_currency FROM exchange_rates`,
      )
    ).map((row) => `${row.from_currency}->${row.to_currency}`),
  );
  for (const [from, to, rate] of ratePairs()) {
    if (existingRates.has(`${from}->${to}`)) continue;
    await db.execute(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate) VALUES (?, ?, ?)`,
      [from, to, rate],
    );
    counts.rates += 1;
  }

  // One default provider, only when there are none at all.
  const providerRows = await db.select<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM llm_providers`,
  );
  if ((providerRows[0]?.n ?? 0) === 0) {
    await db.execute(
      `INSERT INTO llm_providers (name, base_url, model, provider_type, is_default, is_active)
       VALUES (?, ?, ?, ?, 1, 1)`,
      [
        DEFAULT_PROVIDER_NAME,
        DEFAULT_PROVIDER.baseUrl,
        DEFAULT_PROVIDER.model,
        DEFAULT_PROVIDER.providerType,
      ],
    );
    counts.provider += 1;
  }

  // Profile row: the source created it at registration.
  const profileRows = await db.select<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM profile`,
  );
  if ((profileRows[0]?.n ?? 0) === 0) {
    const profile = await getProfile();
    await db.execute(
      `INSERT INTO profile (id, currency, timezone, date_format, ai_tone, ai_verbosity, ai_expertise)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      [
        profile.currency,
        profile.timezone,
        profile.date_format,
        profile.ai_tone,
        profile.ai_verbosity,
        profile.ai_expertise,
      ],
    );
    counts.profile += 1;
  }

  return counts;
}

/** True when nothing has been entered yet, used to pick first-run vs normal. */
export async function isEmptyDatabase(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<Array<{ n: number }>>(
    `SELECT
       (SELECT COUNT(*) FROM assets) +
       (SELECT COUNT(*) FROM institutions) +
       (SELECT COUNT(*) FROM snapshots) AS n`,
  );
  return (rows[0]?.n ?? 0) === 0;
}
