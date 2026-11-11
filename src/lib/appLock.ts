/**
 * "Lock now", from anywhere.
 *
 * The lock's state machine belongs to `LockGate`, which sits above the router.
 * The Settings page and the keyboard shortcut are below it and must not import
 * it, so they raise a module-level counter instead and the gate watches it.
 */

import { useSyncExternalStore } from "react";

let lockRequests = 0;
const listeners = new Set<() => void>();

/** Ask the gate to lock at the next render. Harmless when the lock is off. */
export function requestLock(): void {
  lockRequests += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => lockRequests;

/** The number of lock requests so far. Watch it with an effect. */
export function useLockRequests(): number {
  return useSyncExternalStore(subscribe, current, current);
}

// --- proof of the PIN, in this session -------------------------------------
//
// Setting a PIN proves it. The gate must see that proof when the settings write
// flips `lock_enabled` on, or enabling the lock from Settings would drop the user
// straight back onto the gate they just satisfied.
//
// It expires: a proof is only good for the enable flow that follows it, not for
// the rest of the session.

const PROOF_WINDOW_MS = 60_000;
let provedAt = 0;

/** Record that the PIN was typed and accepted in this session. */
export function markPinProved(): void {
  provedAt = Date.now();
}

/** Consume a recent proof. True at most once per proof, and only for a minute. */
export function consumeRecentProof(now = Date.now()): boolean {
  const fresh = provedAt !== 0 && now - provedAt < PROOF_WINDOW_MS;
  provedAt = 0;
  return fresh;
}

/** Forget any proof: the gate is up again. */
export function clearPinProof(): void {
  provedAt = 0;
}
