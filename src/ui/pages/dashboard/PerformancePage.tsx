/**
 * Performance analytics: an honest placeholder.
 *
 * Showing made-up returns in a finance app is worse than showing nothing, so
 * this page shows no figures at all; the real ones live on the Résumé screen.
 */

import { Link } from "react-router-dom";
import { PageHeader } from "../../components/FormCard";

export function PerformancePage() {
  return (
    <>
      <PageHeader title="Performance Analytics" icon="graph-up" showDate={false} />
      <div className="card card-finance">
        <div className="card-body">
          <p className="mb-2">
            <span className="badge bg-secondary">Not implemented</span>
          </p>
          <p className="text-muted">
            The original app never built this screen either. Absolute, net and annualised performance
            per period are on the Résumé page.
          </p>
          <Link to="/resume" className="btn btn-primary btn-sm">
            <i className="bi bi-file-text" aria-hidden="true" />
            Open the Résumé
          </Link>
        </div>
      </div>
    </>
  );
}
