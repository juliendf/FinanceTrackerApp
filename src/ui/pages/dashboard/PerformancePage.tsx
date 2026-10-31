/**
 * Performance analytics: a stub, as in the source.
 *
 * The source's page charts three hard-coded numbers ({1M: 2%, 3M: 5%, 1Y: 12%})
 * that have nothing to do with the user's data. Showing invented returns in a
 * finance app is worse than showing nothing, so this is an honest placeholder;
 * the real figures live on the Résumé screen. See docs/DEVIATIONS.md.
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
