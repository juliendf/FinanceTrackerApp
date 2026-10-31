/** Settings key/value storage. Typed SQL only. */

import { getDb } from "../client";
import { runTransaction } from "../transaction";
import { sqlText } from "../literals";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  parseSettingValue,
  serializeSettingValue,
  type SettingValue,
} from "../../domain/settings";

export interface SettingRow {
  key: string;
  value: string;
}

export async function listSettingRows(): Promise<SettingRow[]> {
  const db = await getDb();
  return db.select<SettingRow[]>(`SELECT key, value FROM settings ORDER BY key`);
}

/** All settings, defaults merged under whatever is stored. */
export async function getAllSettings(): Promise<Record<string, SettingValue>> {
  return mergeSettings(await listSettingRows());
}

export async function getSetting(
  key: string,
): Promise<SettingValue | undefined> {
  const db = await getDb();
  const rows = await db.select<SettingRow[]>(
    `SELECT key, value FROM settings WHERE key = ?`,
    [key],
  );
  const row = rows[0];
  if (row) return parseSettingValue(row.value);
  return DEFAULT_SETTINGS[key];
}

/** Upsert one setting, matching `set_setting`. */
export async function setSetting(
  key: string,
  value: SettingValue,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [key, serializeSettingValue(value)],
  );
}

export async function countSettings(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM settings`,
  );
  return rows[0]?.n ?? 0;
}

/** True when a row exists for `key` (a default is not "stored"). */
export async function hasSetting(key: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM settings WHERE key = ?`,
    [key],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** Write several settings in one transaction, then report the count. */
export async function setSettings(
  values: Record<string, SettingValue>,
): Promise<number> {
  const entries = Object.entries(values);
  if (entries.length === 0) return 0;
  await runTransaction(
    entries.map(
      ([key, value]) =>
        `INSERT INTO settings (key, value) VALUES (${sqlText(key)}, ${sqlText(serializeSettingValue(value))})
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ),
  );
  return entries.length;
}

/** `reset_settings_to_defaults`: delete every row, so the defaults apply again. */
export async function resetSettings(): Promise<void> {
  await runTransaction([`DELETE FROM settings`]);
}
