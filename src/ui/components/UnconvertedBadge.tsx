/** Shown when a conversion had no rate path and the amount was used as is. */

import type { ConversionWarning } from "../../domain/currency";
import { describeUnconverted } from "../../lib/useDashboardData";

export function UnconvertedBadge({ warnings }: { warnings: readonly ConversionWarning[] }) {
  if (warnings.length === 0) return null;
  const pairs = describeUnconverted(warnings);
  return (
    <span
      className="badge rounded-pill bg-warning text-dark ms-2"
      title={`No exchange rate for ${pairs}. Those amounts are shown unconverted. Add a rate in Settings.`}
    >
      <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
      unconverted
    </span>
  );
}
