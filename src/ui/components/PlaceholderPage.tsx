/**
 * Placeholder for screens not built yet.
 *
 * Keeps navigation from dead-ending until the real screen exists.
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
