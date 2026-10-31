/**
 * Last line of defence for render errors.
 *
 * React Router's default error screen prints a minified stack (#31, "Objects are
 * not valid as a React child"), which told us nothing about where the bug was.
 * This shows the message and a reload, and keeps the rest of the shell intact.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only sink: no telemetry, by design.
    // eslint-disable-next-line no-console
    console.error("Render error:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="card card-finance">
        <div className="card-body">
          <h4 className="card-title text-danger">
            <i className="bi bi-exclamation-octagon me-2" aria-hidden="true" />
            This page hit an error
          </h4>
          <p className="text-muted">
            The rest of the app still works. The details below are also in the developer console.
          </p>
          <pre className="bg-body-tertiary border rounded p-3 small text-wrap" style={{ whiteSpace: "pre-wrap" }}>
            {error.message}
          </pre>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
              Reload the app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
