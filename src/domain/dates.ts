/**
 * Calendar-date helpers on ISO `YYYY-MM-DD` strings.
 *
 * Dates here are *calendar* dates (a snapshot is "on 2026-09-30"), so they are
 * compared as strings and shifted in UTC to avoid DST and timezone surprises.
 */

/** The user's local calendar date, the equivalent of Python's `date.today()`. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Shift an ISO date by whole days. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** True for a well-formed, real calendar date (rejects 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The snapshot forms' rule: `date > date.today() + timedelta(days=1)` is
 * rejected. The extra day absorbs a server/client timezone difference, so "today
 * plus one" is still accepted.
 */
export function isFutureSnapshotDate(iso: string, today: string = todayIso()): boolean {
  return iso > addDays(today, 1);
}
