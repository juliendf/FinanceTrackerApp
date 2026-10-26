/**
 * First-run seed gate.
 *
 * Runs `seedFirstRun()` once before the router mounts, so every screen can
 * assume settings, rates, a provider and a profile row exist. It is idempotent:
 * on later launches it inserts nothing.
 */

import { useEffect, useState, type ReactNode } from "react";
import { seedFirstRun, type SeedCounts } from "../../db/seed";

type State =
  | { status: "running" }
  | { status: "ready"; counts: SeedCounts }
  | { status: "error"; error: string };

export function SeedGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "running" });

  useEffect(() => {
    let cancelled = false;

    seedFirstRun()
      .then((counts) => {
        if (!cancelled) setState({ status: "ready", counts });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "running") {
    return (
      <div className="d-flex vh-100 align-items-center justify-content-center">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading…</span>
          </div>
          <p className="text-muted mt-3 mb-0">Preparing your database…</p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="container py-5">
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-x-circle me-2" aria-hidden="true" />
          <strong>Error:</strong> could not prepare the database.
          <pre className="mt-2 mb-0 small">{state.error}</pre>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
