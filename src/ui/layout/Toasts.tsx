/**
 * Toasts: a queue of short-lived messages.
 *
 * A toast renders each message with the alert markup and dismisses it
 * automatically after 5 s.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastType = "success" | "info" | "warning" | "danger";

/**
 * A way out of the message: a hash route the user can follow.
 *
 * A plain href rather than a callback, because the toast layer sits above the
 * router and has no navigation to hand out, and because `#/…` is left alone by
 * the link interceptor — it navigates in-app instead of opening a browser.
 */
export interface ToastAction {
  href: string;
  label: string;
}

export interface ToastOptions {
  /** Replaces the type's default bold prefix. */
  title?: string;
  action?: ToastAction;
  /** How long the message stays; 5 s unless given. */
  durationMs?: number;
}

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  title?: string;
  action?: ToastAction;
  durationMs: number;
}

const DEFAULT_DURATION_MS = 5000;

const ALERT_META: Record<ToastType, { icon: string; title: string }> = {
  success: { icon: "bi-check-circle", title: "Success!" },
  info: { icon: "bi-info-circle", title: "Info:" },
  warning: { icon: "bi-exclamation-triangle", title: "Warning:" },
  danger: { icon: "bi-x-circle", title: "Error:" },
};

interface ToastApi {
  push: (type: ToastType, message: string, options?: ToastOptions) => void;
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string) => void;
  info: (message: string, options?: ToastOptions) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
      setToasts((current) => {
        // The same sentence twice is one message, not two: pressing a button that
        // changes nothing should not build a wall of identical toasts. Replacing
        // also restarts the timer, so the feedback stays up while it is repeated.
        const rest = current.filter((toast) => !(toast.type === type && toast.message === message));
        return [...rest, { id, type, message, title: options.title, action: options.action, durationMs }];
      });
      const timer = window.setTimeout(() => dismiss(id), durationMs);
      timers.current.push(timer);
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (message, options) => push("success", message, options),
      error: (message) => push("danger", message),
      info: (message, options) => push("info", message, options),
      warning: (message) => push("warning", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="alert-container" aria-live="polite">
        {toasts.map((toast) => {
            const meta = ALERT_META[toast.type];
            // No `alert-dismissible`: it positions the close button absolutely,
            // which put it on top of the message and its link in a flex row.
            // Here the close is an ordinary flex item.
            return (
              <div
                className={`alert alert-${toast.type} fade show`}
                role="alert"
                key={toast.id}
              >
                <i className={`bi ${meta.icon}`} aria-hidden="true" />
                <div className="alert-body">
                  <strong>{toast.title ?? meta.title}</strong> {toast.message}
                  {toast.action ? (
                    <a className="alert-link alert-action" href={toast.action.href}>
                      {toast.action.label}
                    </a>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => dismiss(toast.id)}
                />
              </div>
            );
          })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
