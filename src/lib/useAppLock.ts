/**
 * The app lock's state machine.
 *
 * Three phases: `checking` until Rust says whether a PIN is stored, `locked` when
 * the gate is up, `unlocked` when the app is usable. The gate owns the phase, both
 * timers and the calls into Rust; the screen it shows is `LockGate`'s.
 *
 * The timers are deliberately two: time since the last input, and time since the
 * window lost focus. The second is the one that matters — the feature exists for
 * the moment the user walks away, which is exactly when nothing is being clicked.
 *
 * macOS sleep and screen lock are not watched. Detecting those needs platform code
 * (an NSWorkspace watcher or a plugin), and the idle timer already covers the case
 * this feature is for. The gap is documented rather than faked.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { idleDelayMs, isIdle, retryMessage } from "../domain/lock";
import { clearPinProof, consumeRecentProof, useLockRequests } from "./appLock";
import { lockStatus, setLockPin, verifyLockPin } from "./appLockApi";

export type LockPhase = "checking" | "locked" | "unlocked";

export interface AppLock {
  phase: LockPhase;
  /** Whether a PIN is stored for this installation. */
  pinSet: boolean;
  /** Seconds the last wrong attempt bought, `0` when the next one is free. */
  retryAfterSeconds: number;
  /** The last failure, or Rust's explanation of one. */
  error: string | null;
  unlock: (pin: string) => Promise<boolean>;
  /** Set or change the PIN. `current` is required once one exists. */
  setPin: (next: string, current?: string) => Promise<void>;
  /** Drop the gate now. */
  lock: () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAppLock({
  enabled,
  idleMinutes,
}: {
  enabled: boolean;
  idleMinutes: number;
}): AppLock {
  const [phase, setPhase] = useState<LockPhase>("checking");
  const [pinSet, setPinSet] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const lastActivity = useRef(Date.now());
  const unfocusedAt = useRef<number | null>(null);

  const lock = useCallback(() => {
    setError(null);
    setRetryAfterSeconds(0);
    // A proof only ever excuses the enable flow that produced it: once the gate is
    // up, nothing may skip it.
    clearPinProof();
    // A lock request while the phase is still undecided must not pre-empt the
    // answer, and one while the lock is off is handled by the caller.
    setPhase((current) => (current === "checking" ? current : "locked"));
  }, []);

  // Ask Rust once per `enabled` change whether there is a PIN, and put the gate up
  // before anything renders.
  useEffect(() => {
    let cancelled = false;
    setPhase("checking");

    if (!enabled) {
      setPinSet(false);
      setPhase("unlocked");
      return;
    }

    lockStatus()
      .then((stored) => {
        if (cancelled) return;
        setPinSet(stored);
        if (stored && consumeRecentProof()) {
          lastActivity.current = Date.now();
          setPhase("unlocked");
          return;
        }
        setPhase("locked");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // An unreadable Keychain must not silently open the app, and must not
        // hide the app either: show the gate with the reason.
        setPinSet(true);
        setError(messageOf(cause));
        setPhase("locked");
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Inactivity and unfocus timers, armed only while the app is usable.
  useEffect(() => {
    if (!enabled || phase !== "unlocked" || idleDelayMs(idleMinutes) === 0) return;

    const check = () => {
      const now = Date.now();
      const since = document.hasFocus()
        ? lastActivity.current
        : (unfocusedAt.current ?? lastActivity.current);
      if (isIdle(now, since, idleMinutes)) lock();
    };

    const markActive = () => {
      lastActivity.current = Date.now();
    };
    const onBlur = () => {
      if (unfocusedAt.current === null) unfocusedAt.current = Date.now();
    };
    const onFocus = () => {
      unfocusedAt.current = null;
      markActive();
      // The window may have been away for longer than the delay: do not wait for
      // the next tick to hide the data.
      check();
    };

    const activity = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const event of activity) {
      window.addEventListener(event, markActive, { passive: true });
    }
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    const ticker = window.setInterval(check, 1_000);

    return () => {
      for (const event of activity) window.removeEventListener(event, markActive);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(ticker);
    };
  }, [enabled, phase, idleMinutes, lock]);

  // "Lock now" from the settings page or the shortcut.
  const requests = useLockRequests();
  const seenRequests = useRef(requests);
  useEffect(() => {
    if (requests === seenRequests.current) return;
    seenRequests.current = requests;
    if (enabled && phase === "unlocked") lock();
  }, [requests, enabled, phase, lock]);

  const unlock = useCallback(async (pin: string) => {
    setError(null);
    try {
      const outcome = await verifyLockPin(pin);
      setRetryAfterSeconds(outcome.retryAfterSeconds);
      if (outcome.unlocked) {
        lastActivity.current = Date.now();
        unfocusedAt.current = null;
        setPinSet(true);
        setPhase("unlocked");
        return true;
      }
      // A blocked attempt never looked at the PIN, so it must not claim the PIN
      // was wrong.
      setError(
        outcome.blocked
          ? "Too many attempts. Wait before trying again."
          : `That PIN is not right. ${retryMessage(outcome.retryAfterSeconds)}`.trim(),
      );
      return false;
    } catch (cause: unknown) {
      setError(messageOf(cause));
      return false;
    }
  }, []);

  const setPin = useCallback(async (next: string, current?: string) => {
    await setLockPin(next, current);
    setPinSet(true);
    setError(null);
    setRetryAfterSeconds(0);
  }, []);

  return {
    phase,
    pinSet,
    retryAfterSeconds,
    error,
    unlock,
    setPin,
    lock,
  };
}
