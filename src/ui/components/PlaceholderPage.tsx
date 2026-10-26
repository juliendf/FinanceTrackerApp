/**
 * Placeholder for screens not built yet.
 *
 * Phase 1 needs the shell and the component library, not every screen. Routes
 * exist so navigation never dead-ends; each is replaced phase by phase and each
 * has a row in docs/PARITY_CHECKLIST.md.
 */

import { PageHeader } from "./FormCard";

export function PlaceholderPage({
  title,
  phase,
  description,
  icon,
}: {
  title: string;
  phase: string;
  description: string;
  icon?: string;
}) {
  return (
    <>
      <PageHeader title={title} icon={icon} showDate={false} />
      <div className="card card-finance">
        <div className="card-body">
          <p className="mb-1">
            <span className="badge bg-secondary">{phase}</span>
          </p>
          <p className="text-muted mb-0">{description}</p>
        </div>
      </div>
    </>
  );
}
