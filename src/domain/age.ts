/**
 * Age from a birth date.
 *
 * Stored as a date rather than a number so it never goes stale: the assistant
 * gets the age computed at prompt time.
 */

/** Completed years on `today`, or null for a missing/invalid/future date. */
export function ageFromBirthDate(birthDate: string | null | undefined, today: string): number | null {
  if (!birthDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const [tYear, tMonth, tDay] = today.split("-").map(Number);
  if (!Number.isFinite(tYear)) return null;

  let age = tYear - year;
  if (tMonth < month || (tMonth === month && tDay < day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}
