/**
 * The app lock, as policy.
 *
 * Everything here is pure. The Keychain and Argon2 live in
 * `src-tauri/src/commands/lock.rs`, the timers live in `src/lib/useAppLock.ts`,
 * and what is left is the part worth testing without either: what makes a PIN
 * acceptable, when a session has been idle long enough, and what the lock screen
 * says.
 *
 * Four digits is a choice, not an accident: quick to type, and 10,000 times easier
 * to search than a passphrase. It holds up only because the gate protects the
 * screen and not the file — the same person who can read the Keychain item can read
 * the database.
 */

/** Mirrors `PIN_LENGTH` in `src-tauri/src/commands/lock.rs`. */
export const PIN_LENGTH = 4;

/**
 * The check the Rust side performs, repeated here so the form can answer without
 * a round trip. Rust still has the last word: this is a convenience, not the gate.
 */
export function validateNewPin(pin: string): string | null {
  if (!new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin)) {
    return `Use ${PIN_LENGTH} digits.`;
  }
  return null;
}

/** Whether two entries in the set-PIN form match. */
export function confirmPin(pin: string, confirmation: string): string | null {
  if (pin !== confirmation) return "The two PINs do not match.";
  return validateNewPin(pin);
}

/** What an input field holds at most: the PIN length, never more. */
export function acceptPinInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

/** The idle delay in milliseconds. `0` means the lock never fires on its own. */
export function idleDelayMs(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return minutes * 60_000;
}

/**
 * Whether a session that was last touched at `lastActivity` has run out of time.
 *
 * Both callers pass a timestamp rather than a duration — the inactivity timer and
 * the window-unfocused timer — so the same rule covers "away from the keyboard"
 * and "away from the app".
 */
export function isIdle(now: number, lastActivity: number, minutes: number): boolean {
  const delay = idleDelayMs(minutes);
  if (delay === 0) return false;
  return now - lastActivity >= delay;
}

/** The lock screen's copy after a wrong PIN. */
export function retryMessage(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds === 1) return "Try again in 1 second.";
  return `Try again in ${seconds} seconds.`;
}

/** The reminder the Security page shows under the toggle. */
export const LOCK_SCOPE_NOTE =
  "Locks the screen, not the file: the database stays readable on disk, so a " +
  "4-digit PIN is a deterrent, not encryption. A forgotten PIN cannot be recovered " +
  "— deleting its Keychain item makes the app ask for a new one, and the data is " +
  "never affected.";
