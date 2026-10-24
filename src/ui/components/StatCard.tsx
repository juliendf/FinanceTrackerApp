/** KPI tile, mirroring the `stat-card` markup in templates/assets/list.html. */

import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  icon?: string;
  accent?: "success" | "primary";
  small?: boolean;
}

export function StatCard({ label, value, subtitle, icon, accent, small = true }: Props) {
  const classes = [
    "stat-card",
    small ? "stat-card-sm" : "",
    accent ? `accent-${accent}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="stat-label">{label}</div>
      {icon ? (
        <div className="stat-icon">
          <i className={`bi ${icon}`} aria-hidden="true" />
        </div>
      ) : null}
      <div className="stat-number">{value}</div>
      {subtitle ? <div className="stat-subtitle">{subtitle}</div> : null}
    </div>
  );
}
