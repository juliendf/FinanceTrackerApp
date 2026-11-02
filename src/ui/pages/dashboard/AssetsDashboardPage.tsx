/**
 * Asset breakdown: a distribution pie with a group selector.
 */

import { useMemo, useState } from "react";
import { distribution, type DistributionGroup } from "../../../domain/dashboard";
import { useDashboardData } from "../../../lib/useDashboardData";
import { DistributionPie } from "../../charts/DistributionPie";
import { PageHeader } from "../../components/FormCard";
import { UnconvertedBadge } from "../../components/UnconvertedBadge";

const GROUPS: Array<[DistributionGroup, string]> = [
  ["category", "By Category"],
  ["currency", "By Currency"],
  ["institution", "By Institution"],
];

export function AssetsDashboardPage() {
  const data = useDashboardData();
  const [group, setGroup] = useState<DistributionGroup>("category");

  const view = useMemo(() => {
    const converter = data.makeConverter();
    return { slices: distribution(data.facts, group, converter), warnings: [...converter.warnings] };
  }, [data.facts, data.makeConverter, group]);

  if (data.isLoading) return <p className="text-muted">Loading…</p>;

  return (
    <>
      <PageHeader title="Asset Breakdown" icon="pie-chart" showDate={false} />
      <div className="btn-group btn-group-sm mb-3" role="group" aria-label="Breakdown selector">
        {GROUPS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`btn btn-outline-primary${group === key ? " active" : ""}`}
            aria-pressed={group === key}
            onClick={() => setGroup(key)}
          >
            {label}
          </button>
        ))}
        <UnconvertedBadge warnings={view.warnings} />
      </div>
      <DistributionPie slices={view.slices} currency={group === "currency" ? "native" : data.baseCurrency} height={320} />
    </>
  );
}
