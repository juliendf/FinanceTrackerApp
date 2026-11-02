/** KPI tile with a label, a value and an optional subtitle. */

import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  icon?: string;
  accent?: "success" | "primary";
  small?: boolean;
  /** Adds `stat-number-money`, which sizes currency amounts. */
  money?: boolean;
}

export function StatCard({ label, value, subtitle, icon, accent, small = true, money = false }: Props) {
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
      <div className={`stat-number${money ? " stat-number-money" : ""}`}>{value}</div>
      {subtitle ? <div className="stat-subtitle">{subtitle}</div> : null}
    </div>
  );
}
