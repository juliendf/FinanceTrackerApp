/**
 * The Rust side of the app lock, as four calls.
 *
 * Kept apart from `useAppLock` so the settings page can change a PIN without
 * owning a second copy of the lock's state machine. Every call that touches the
 * hash goes through Argon2 in Rust; none of them returns it.
 */

import { invoke } from "@tauri-apps/api/core";
import { markPinProved } from "./appLock";

interface LockStatus {
  pinSet: boolean;
}

export interface UnlockOutcome {
  unlocked: boolean;
  /** Seconds the next attempt has to wait; `0` when it may happen at once. */
  retryAfterSeconds: number;
  /** The wait alone refused it: the PIN was never checked. */
  blocked: boolean;
}

/** Whether a PIN is stored for this installation. */
export async function lockStatus(): Promise<boolean> {
  const status = await invoke<LockStatus>("app_lock_status");
  return status.pinSet;
}

/** Check a PIN. Returns the outcome, including any wait it earned. */
export async function verifyLockPin(pin: string): Promise<UnlockOutcome> {
  return invoke<UnlockOutcome>("app_lock_verify", { pin });
}

/**
 * Set or change the PIN.
 *
 * `current` is required as soon as one is stored, and ignored on the first set
 * (which is also how a Mac whose Keychain item was lost recovers).
 */
export async function setLockPin(next: string, current?: string): Promise<void> {
  await invoke("app_lock_set", {
    currentPin: current ?? null,
    newPin: next,
  });
  // The PIN was just typed twice: the gate should not ask for it again.
  markPinProved();
}

/** Remove the PIN. The caller turns `lock_enabled` off. */
export async function clearLockPin(current: string): Promise<void> {
  await invoke("app_lock_clear", { currentPin: current });
}
