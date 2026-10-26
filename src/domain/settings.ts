/**
 * Application settings — port of `app/utils/settings.py`.
 *
 * Values are stored as TEXT in the `settings` table and coerced on read, exactly
 * like the source: 'true'/'false' become booleans, all-digit strings become
 * integers, otherwise a float is attempted, otherwise the string stays.
 *
 * The source cached per user in `flask.g`; there is one user here, so the
 * repository layer queries directly and TanStack Query caches for the UI.
 */

export type SettingValue = string | number | boolean;

/** Port of `DEFAULT_SETTINGS`. */
export const DEFAULT_SETTINGS: Record<string, SettingValue> = {
  base_currency: "EUR",
  show_converted_amounts: true,
  items_per_page: "20",
  date_format: "%Y-%m-%d",
  llm_timeout: "120",
  theme: "light",
  enable_animations: true,
};

/** Port of `_parse_setting_value`. */
export function parseSettingValue(raw: string): SettingValue {
  const lowered = raw.toLowerCase();
  if (lowered === "true") return true;
  if (lowered === "false") return false;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);

  // Python's float('') raises, so an empty string stays a string.
  if (raw.trim() === "") return raw;

  const asFloat = Number(raw);
  return Number.isNaN(asFloat) ? raw : asFloat;
}

/** Port of `_serialize_setting_value`: booleans are lowercase strings. */
export function serializeSettingValue(value: SettingValue): string {
  return typeof value === "boolean" ? String(value).toLowerCase() : String(value);
}

/** Merge stored rows over the defaults, as `get_all_settings` does. */
export function mergeSettings(
  rows: readonly { key: string; value: string }[],
): Record<string, SettingValue> {
  const merged: Record<string, SettingValue> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    merged[row.key] = parseSettingValue(row.value);
  }
  return merged;
}

/** Read one setting with the source's fallback chain: row, default, caller's. */
export function settingValue<K extends keyof typeof DEFAULT_SETTINGS & string>(
  settings: Record<string, SettingValue>,
  key: K,
): (typeof DEFAULT_SETTINGS)[K] {
  return (settings[key] ?? DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K];
}
