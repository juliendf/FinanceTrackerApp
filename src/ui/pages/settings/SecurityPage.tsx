/**
 * Security settings: the app lock.
 *
 * This page owns the configuration only — `lock_enabled` and `lock_idle_minutes`
 * in `settings`. The PIN is set here but stored in the Keychain by Rust, so nothing
 * on this page can read it back, and no backup can carry it.
 *
 * Every PIN change asks for the current one. That is the whole reason the page does
 * not simply offer "set a new PIN": an unlocked machine at the keyboard must not be
 * enough to take the lock over.
 *
 * Four digits is the product decision, and the copy says what it buys: a deterrent
 * against someone at the keyboard, not encryption of the file.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "react-bootstrap";
import { useSettings, useUpdateSetting } from "../../../lib/useSettings";
import { requestLock } from "../../../lib/appLock";
import { clearLockPin, lockStatus, setLockPin } from "../../../lib/appLockApi";
import { LOCK_IDLE_CHOICES } from "../../../domain/settings";
import { LOCK_SCOPE_NOTE, PIN_LENGTH, acceptPinInput, confirmPin } from "../../../domain/lock";
import { useToast } from "../../layout/Toasts";
import { SettingsLayout } from "./SettingsLayout";

type Prompt =
  | { kind: "closed" }
  | { kind: "enable" }
  | { kind: "change" }
  | { kind: "disable" };

export function SecurityPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const update = useUpdateSetting();
  const [prompt, setPrompt] = useState<Prompt>({ kind: "closed" });

  const status = useQuery({ queryKey: ["lock-status"], queryFn: lockStatus });
  const pinSet = status.data === true;
  const enabled = settings.lock_enabled === true;
  const idleMinutes = String(settings.lock_idle_minutes ?? "5");

  // A Keychain item without `lock_enabled` (or the reverse) is a state the page
  // must not pretend away: it happens after an import, and after a Keychain
  // deletion. Say what is true and let the user act.
  const inconsistent = !status.isLoading && status.data !== undefined && enabled !== pinSet;

  const setEnabled = (next: boolean) => {
    update.mutate(
      { key: "lock_enabled", value: next },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ["lock-status"] });
          toast.success(next ? "The app lock is on." : "The app lock is off.");
        },
        onError: (error: unknown) =>
          toast.error(
            `Could not change the lock: ${error instanceof Error ? error.message : String(error)}`,
          ),
      },
    );
  };

  const setIdle = (value: string) => {
    update.mutate(
      { key: "lock_idle_minutes", value },
      {
        onError: (error: unknown) =>
          toast.error(
            `Could not save the delay: ${error instanceof Error ? error.message : String(error)}`,
          ),
      },
    );
  };

  const onToggled = (next: boolean) => {
    if (next === enabled) return;
    if (next) {
      // A PIN is already stored (the lock was turned off, or a backup restored the
      // setting): turning it back on needs no new one.
      if (pinSet) setEnabled(true);
      else setPrompt({ kind: "enable" });
    } else {
      setPrompt({ kind: "disable" });
    }
  };

  const close = () => setPrompt({ kind: "closed" });

  return (
    <SettingsLayout
      title="Security"
      subtitle="Lock the app behind a 4-digit PIN"
      actions={
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!enabled}
          onClick={() => requestLock()}
        >
          <i className="bi bi-lock me-2" aria-hidden="true" />
          Lock now
        </button>
      }
    >
      {inconsistent ? (
        <div className="alert alert-warning" role="alert">
          {enabled
            ? "The lock is on, but this Mac's Keychain has no PIN for it. It will ask you to set one the next time it starts."
            : "A PIN is stored, but the lock is off. Turn it on, or remove the PIN below."}
        </div>
      ) : null}

      <div className="form-section">
        <h5 className="mb-3">
          <i className="bi bi-shield-lock me-2" aria-hidden="true" />
          App lock
        </h5>

        <div className="form-check form-switch mb-2">
          <input
            id="lock_enabled"
            type="checkbox"
            role="switch"
            className="form-check-input"
            checked={enabled}
            onChange={(event) => onToggled(event.target.checked)}
          />
          <label htmlFor="lock_enabled" className="form-check-label">
            Ask for a {PIN_LENGTH}-digit PIN when the app opens
          </label>
        </div>
        <div className="form-text mb-3">{LOCK_SCOPE_NOTE}</div>

        <div className="row mb-3">
          <div className="col-md-6">
            <label htmlFor="lock_idle_minutes" className="form-label">
              Lock automatically
            </label>
            <select
              id="lock_idle_minutes"
              className="form-select"
              value={idleMinutes}
              onChange={(event) => setIdle(event.target.value)}
            >
              {LOCK_IDLE_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
            <div className="form-text">
              Counted from the last click or key, and from the moment the window lost focus.
            </div>
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPrompt({ kind: pinSet ? "change" : "enable" })}
          >
            <i className="bi bi-key me-2" aria-hidden="true" />
            {pinSet ? "Change PIN" : "Set a PIN"}
          </button>
          {enabled ? (
            <button type="button" className="btn btn-outline-secondary" onClick={() => requestLock()}>
              <i className="bi bi-lock me-2" aria-hidden="true" />
              Lock now
            </button>
          ) : null}
        </div>

        <p className="small text-muted mt-3 mb-0">
          <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>L</kbd> locks from anywhere in the app.
        </p>
      </div>

      <PinPrompt
        prompt={prompt}
        onClose={close}
        onDone={() => void queryClient.invalidateQueries({ queryKey: ["lock-status"] })}
        setEnabled={setEnabled}
      />
    </SettingsLayout>
  );
}

function PinPrompt({
  prompt,
  onClose,
  onDone,
  setEnabled,
}: {
  prompt: Prompt;
  onClose: () => void;
  onDone: () => void;
  setEnabled: (next: boolean) => void;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kind = prompt.kind;
  const open = kind !== "closed";
  const wantsNew = kind === "enable" || kind === "change";
  const wantsCurrent = kind === "change" || kind === "disable";

  // Every opening starts clean: a stale PIN in a modal is a trap.
  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setNext("");
    setConfirmation("");
    setProblem(null);
    setBusy(false);
  }, [open, kind]);

  const title =
    kind === "disable"
      ? "Turn the app lock off"
      : kind === "change"
        ? "Change the PIN"
        : "Set a PIN";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (wantsCurrent && current.length !== PIN_LENGTH) {
      setProblem(`Enter the current ${PIN_LENGTH}-digit PIN.`);
      return;
    }
    if (wantsNew) {
      const invalid = confirmPin(next, confirmation);
      if (invalid) {
        setProblem(invalid);
        return;
      }
    }

    setBusy(true);
    setProblem(null);
    try {
      if (kind === "disable") {
        await clearLockPin(current);
        setEnabled(false);
        toast.success("The app lock is off.");
      } else {
        await setLockPin(next, wantsCurrent ? current : undefined);
        // Enabling is two facts: the PIN exists, and the setting says so. If the
        // second write fails, the next start shows the recovery screen rather than
        // an unlocked app — which is the safe direction.
        if (kind === "enable") setEnabled(true);
        toast.success(kind === "enable" ? "The app lock is on." : "PIN changed.");
      }
      onDone();
      onClose();
    } catch (cause: unknown) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const pinField = (
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    options: { autoFocus?: boolean; invalid?: boolean } = {},
  ) => (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        className={`form-control lock-pin${options.invalid ? " is-invalid" : ""}`}
        value={value}
        autoFocus={options.autoFocus}
        disabled={busy}
        onChange={(event) => onChange(acceptPinInput(event.target.value))}
      />
    </div>
  );

  return (
    <Modal show={open} onHide={onClose} centered>
      <form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {kind === "disable" ? (
            <p className="text-muted small">
              The data stays where it is. The PIN and its Keychain item are removed.
            </p>
          ) : (
            <p className="text-muted small">
              {PIN_LENGTH} digits. A forgotten PIN cannot be recovered: deleting its Keychain
              item makes the app ask for a new one, and the data is untouched. The PIN locks the
              screen, not the file.
            </p>
          )}

          {wantsCurrent
            ? pinField("lock-current", "Current PIN", current, setCurrent, { autoFocus: true })
            : null}

          {wantsNew ? (
            <>
              {pinField("lock-next", "New PIN", next, setNext, { autoFocus: !wantsCurrent })}
              {pinField("lock-confirm", "Again", confirmation, setConfirmation, {
                invalid: problem !== null,
              })}
            </>
          ) : null}

          {problem ? (
            <div className="invalid-feedback d-block" role="alert">
              {problem}
            </div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : kind === "disable" ? "Turn it off" : "Save"}
          </button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
