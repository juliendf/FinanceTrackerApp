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
  /**
   * Not in the source: a deliberate opt-in. Chat stays off until the user turns
   * it on here, because using it sends portfolio data to a provider.
   * See docs/DEVIATIONS.md.
   */
  ai_enabled: false,
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

// --- settings screen ---------------------------------------------------------

export const CURRENCY_CHOICES = [
  { value: "EUR", label: "Euro (EUR)" },
  { value: "USD", label: "US Dollar (USD)" },
  { value: "CHF", label: "Swiss Franc (CHF)" },
] as const;

export const ITEMS_PER_PAGE_CHOICES = [
  { value: "10", label: "10 items" },
  { value: "20", label: "20 items" },
  { value: "50", label: "50 items" },
  { value: "100", label: "100 items" },
] as const;

export const DATE_FORMAT_CHOICES = [
  { value: "%Y-%m-%d", label: "YYYY-MM-DD (2025-01-10)" },
  { value: "%d/%m/%Y", label: "DD/MM/YYYY (10/01/2025)" },
  { value: "%m/%d/%Y", label: "MM/DD/YYYY (01/10/2025)" },
  { value: "%d.%m.%Y", label: "DD.MM.YYYY (10.01.2025)" },
] as const;

export const THEME_CHOICES = [
  { value: "light", label: "Light Theme" },
  { value: "dark", label: "Dark Theme" },
  { value: "auto", label: "Auto (System Preference)" },
] as const;

/** The six fields `SettingsForm` edits, in template order. */
export const EDITABLE_SETTINGS = [
  "base_currency",
  "show_converted_amounts",
  "items_per_page",
  "date_format",
  "theme",
  "enable_animations",
] as const;

/** Port of `validate_setting`. */
export function validateSetting(key: string, value: SettingValue): boolean {
  if (!(key in DEFAULT_SETTINGS)) return false;
  const text = String(value);
  if (key === "base_currency") return CURRENCY_CHOICES.some((c) => c.value === text);
  if (key === "items_per_page") return ITEMS_PER_PAGE_CHOICES.some((c) => c.value === text);
  if (key === "theme") return THEME_CHOICES.some((c) => c.value === text);
  return true;
}

/** `export_settings`: the merged settings as indented JSON. */
export function exportSettingsJson(settings: Record<string, SettingValue>): string {
  return JSON.stringify(settings, null, 2);
}

export interface SettingsImport {
  /** Keys the source would accept, with their values coerced. */
  values: Record<string, SettingValue>;
  /** Keys dropped because this app has no default for them. */
  ignored: string[];
  error: string | null;
}

/**
 * `import_settings`: keep the keys this app knows, ignore the rest, and fail
 * with a readable message on anything that is not a JSON object.
 */
export function parseSettingsImport(raw: string): SettingsImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { values: {}, ignored: [], error: "That is not valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { values: {}, ignored: [], error: "Expected a JSON object of setting names to values." };
  }

  const values: Record<string, SettingValue> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in DEFAULT_SETTINGS)) {
      ignored.push(key);
      continue;
    }
    values[key] = typeof value === "boolean" ? value : typeof value === "number" ? value : String(value ?? "");
  }
  return { values, ignored, error: null };
}
