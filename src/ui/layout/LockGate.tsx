/**
 * The app lock's gate.
 *
 * Sits between `SeedGate` and `RouterProvider` in `App.tsx`: while the gate is up,
 * no route is mounted and the shell does not exist, so there is nothing behind the
 * lock screen to see, screenshot or tab into. A flash of the dashboard behind a
 * blur would be a failure, which is why the children are not rendered at all until
 * the phase is `unlocked`.
 *
 * Three screens:
 *
 * * the lock screen, when a PIN is stored;
 * * a recovery screen when `settings` says the lock is on but the Keychain has no
 *   PIN for this installation — a restored backup, a deleted Keychain item, a
 *   migrated Mac. It explains and lets the user set a new PIN or turn the lock off,
 *   rather than bricking the app on a setting they cannot reach;
 * * nothing (a neutral backdrop) while the settings query is in flight, so the
 *   dashboard never renders for a moment before the gate decides.
 *
 * `Cmd+Shift+L` locks from anywhere; Settings → Security has the same button.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSettings, useUpdateSetting } from "../../lib/useSettings";
import { useAppLock } from "../../lib/useAppLock";
import { requestLock } from "../../lib/appLock";
import { PIN_LENGTH, acceptPinInput, confirmPin } from "../../domain/lock";
import { LOCK_IDLE_CHOICES } from "../../domain/settings";

/** Space above the router while the lock phase is decided. */
function LockBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="lock-stage">
      <div className="lock-card">{children}</div>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="text-center">
      <div className="spinner-border text-primary" role="status" aria-hidden="true" />
      <p className="text-muted mt-3 mb-0">{label}</p>
    </div>
  );
}

/** One PIN entry field, in the shape a 4-digit code wants. */
function PinInput({
  id,
  label,
  value,
  onChange,
  autoFocus = false,
  disabled = false,
  invalid = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <>
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        className={`form-control form-control-lg text-center lock-pin${invalid ? " is-invalid" : ""}`}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(event) => onChange(acceptPinInput(event.target.value))}
      />
    </>
  );
}

/**
 * The stored delay, or the default when the row holds something this build does
 * not offer (an older value, a hand-edited JSON import). `Number("abc")` is `NaN`,
 * which would silently mean "never lock".
 */
function idleMinutesOf(raw: unknown): number {
  const value = String(raw ?? "");
  const offered = LOCK_IDLE_CHOICES.find((choice) => choice.value === value);
  return offered ? Number(offered.value) : 5;
}

export function LockGate({ children }: { children: ReactNode }) {
  const { settings, isLoading, hasData, error } = useSettings();
  const enabled = settings.lock_enabled === true;
  const idleMinutes = idleMinutesOf(settings.lock_idle_minutes);
  const lock = useAppLock({ enabled, idleMinutes });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.shiftKey) return;
      // `code`, not `key`: the shortcut should follow the physical key, whatever
      // the layout calls it.
      if (event.code !== "KeyL") return;
      event.preventDefault();
      requestLock();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  // Nothing is mounted until the answer is known.
  if (isLoading) {
    return (
      <LockBackdrop>
        <Spinner label="Starting…" />
      </LockBackdrop>
    );
  }

  // Fail closed on a cold start: an unreadable settings row must not be read as
  // "the lock is off". Once rows have been read, a failed background refetch keeps
  // the last known state instead of tearing down the page the user is on.
  if (error && !hasData) {
    return (
      <LockBackdrop>
        <div className="alert alert-danger mb-0" role="alert">
          <strong>Cannot read your settings.</strong>
          <div className="small mt-2">{error instanceof Error ? error.message : String(error)}</div>
        </div>
      </LockBackdrop>
    );
  }

  if (!enabled) return <>{children}</>;

  if (lock.phase === "checking") {
    return (
      <LockBackdrop>
        <Spinner label="Checking the lock…" />
      </LockBackdrop>
    );
  }

  if (lock.phase === "unlocked") return <>{children}</>;

  return lock.pinSet ? (
    <LockScreen error={lock.error} retryAfterSeconds={lock.retryAfterSeconds} unlock={lock.unlock} />
  ) : (
    <MissingPinScreen error={lock.error} setPin={lock.setPin} unlock={lock.unlock} />
  );
}

function LockScreen({
  error,
  retryAfterSeconds,
  unlock,
}: {
  error: string | null;
  retryAfterSeconds: number;
  unlock: (pin: string) => Promise<boolean>;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  // A local countdown, so the button is honest about the wait instead of sending
  // attempts Rust will refuse.
  const [wait, setWait] = useState(retryAfterSeconds);

  useEffect(() => {
    setWait(retryAfterSeconds);
    if (retryAfterSeconds <= 0) return;
    const ticker = window.setInterval(() => {
      setWait((current) => (current <= 1 ? 0 : current - 1));
    }, 1_000);
    return () => window.clearInterval(ticker);
  }, [retryAfterSeconds]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || wait > 0 || pin.length !== PIN_LENGTH) return;
    setBusy(true);
    try {
      const unlocked = await unlock(pin);
      if (!unlocked) setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LockBackdrop>
      <div className="text-center mb-4">
        <i className="bi bi-lock-fill lock-icon" aria-hidden="true" />
        <h1 className="h4 mt-3 mb-1">Finance Tracker is locked</h1>
        <p className="text-muted mb-0">Enter your {PIN_LENGTH}-digit PIN to continue.</p>
      </div>

      <form onSubmit={submit} aria-label="Unlock Finance Tracker">
        <PinInput
          id="lock-pin"
          label="PIN"
          value={pin}
          onChange={setPin}
          // The lock screen is the only thing on screen: focus it like a login.
          autoFocus
          disabled={busy}
          invalid={error !== null}
        />
        {error ? (
          <div className="invalid-feedback d-block" role="alert">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary w-100 mt-3"
          disabled={busy || wait > 0 || pin.length !== PIN_LENGTH}
        >
          {busy ? "Checking…" : wait > 0 ? `Wait ${wait}s` : "Unlock"}
        </button>
      </form>

      {wait > 0 ? (
        <p className="text-muted small mt-3 mb-0" aria-live="polite">
          Three wrong attempts in a row make the app wait, doubling up to a minute. About{" "}
          {wait} second{wait === 1 ? "" : "s"} to go.
        </p>
      ) : null}

      <details className="mt-4">
        <summary className="small text-muted">Forgot your PIN?</summary>
        <p className="small text-muted mt-2 mb-0">
          There is no recovery, and none is needed: the PIN locks this screen, not the file.
          Quit the app, delete the <code>app.financetracker</code> lock item in{" "}
          <em>Keychain Access</em>, and reopen it — the app will offer to set a new PIN. Your
          data is untouched.
        </p>
      </details>
    </LockBackdrop>
  );
}

function MissingPinScreen({
  error,
  setPin,
  unlock,
}: {
  error: string | null;
  setPin: (next: string, current?: string) => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
}) {
  const update = useUpdateSetting();
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = confirmPin(next, confirmation);
    setProblem(invalid);
    if (invalid) return;

    setBusy(true);
    try {
      await setPin(next);
      // Straight into the app with the PIN just set.
      await unlock(next);
    } catch (cause: unknown) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LockBackdrop>
      <div className="text-center mb-4">
        <i className="bi bi-key lock-icon" aria-hidden="true" />
        <h1 className="h4 mt-3 mb-1">The lock is on, but its PIN is missing</h1>
        <p className="text-muted mb-0">
          This Mac&apos;s Keychain has no PIN for this installation — a restored backup, a deleted
          Keychain item, or a new machine. Set a new one to continue.
        </p>
      </div>

      {error ? (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      ) : null}

      <form onSubmit={submit} aria-label="Set a lock PIN">
        <PinInput id="lock-new-pin" label="New PIN" value={next} onChange={setNext} autoFocus disabled={busy} />

        <div className="mt-3">
          <PinInput
            id="lock-confirm-pin"
            label="Again"
            value={confirmation}
            onChange={setConfirmation}
            disabled={busy}
            invalid={problem !== null}
          />
        </div>
        {problem ? (
          <div className="invalid-feedback d-block" role="alert">
            {problem}
          </div>
        ) : null}

        <button type="submit" className="btn btn-primary w-100 mt-3" disabled={busy}>
          {busy ? "Saving…" : "Set the PIN and continue"}
        </button>
      </form>

      <button
        type="button"
        className="btn btn-link w-100 mt-2"
        disabled={busy || update.isPending}
        onClick={() => update.mutate({ key: "lock_enabled", value: false })}
      >
        Turn the lock off instead
      </button>
      <p className="small text-muted text-center mb-0">
        The lock protects the screen, not the file. Your data stays where it is either way.
      </p>
    </LockBackdrop>
  );
}
