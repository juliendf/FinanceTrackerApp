/**
 * Toasts — replaces the server-side `flash()` flow.
 *
 * The web app flashes a message and redirects, so the message survives one
 * request. There is no request boundary here, so a toast queue is the
 * equivalent, keeping the same alert markup and the 5 s auto-dismiss the source
 * uses in `flash_messages.html`.
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

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  title?: string;
}

const ALERT_META: Record<ToastType, { icon: string; title: string }> = {
  success: { icon: "bi-check-circle", title: "Success!" },
  info: { icon: "bi-info-circle", title: "Info:" },
  warning: { icon: "bi-exclamation-triangle", title: "Warning:" },
  danger: { icon: "bi-x-circle", title: "Error:" },
};

interface ToastApi {
  push: (type: ToastType, message: string, title?: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
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
    (type: ToastType, message: string, title?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, type, message, title }]);
      // The source auto-closes alerts after 5 seconds.
      const timer = window.setTimeout(() => dismiss(id), 5000);
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
      success: (message) => push("success", message),
      error: (message) => push("danger", message),
      info: (message) => push("info", message),
      warning: (message) => push("warning", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="alert-container">
        <div className="container mt-3">
          {toasts.map((toast) => {
            const meta = ALERT_META[toast.type];
            return (
              <div
                className={`alert alert-${toast.type} alert-dismissible fade show`}
                role="alert"
                key={toast.id}
              >
                <i className={`bi ${meta.icon} me-2`} aria-hidden="true" />
                <strong>{toast.title ?? meta.title}</strong> {toast.message}
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
