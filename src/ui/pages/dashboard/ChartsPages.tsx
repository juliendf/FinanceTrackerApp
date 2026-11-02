/** Chart pages: distribution and per-asset evolution. */

import { useMemo, useState } from "react";
import {
  assetEvolution,
  distribution,
  EVOLUTION_RANGES,
  portfolioEvolution,
  summarise,
  type DistributionGroup,
  type EvolutionRange,
} from "../../../domain/dashboard";
import { displayName } from "../../../domain/assets";
import { useQuery } from "@tanstack/react-query";
import { listAssets } from "../../../db/repositories/assets";
import { useDashboardData } from "../../../lib/useDashboardData";
import { DistributionPie } from "../../charts/DistributionPie";
import { EvolutionLineChart } from "../../charts/EvolutionLineChart";
import { PageHeader } from "../../components/FormCard";
import { UnconvertedBadge } from "../../components/UnconvertedBadge";

const GROUPS: Array<[DistributionGroup, string]> = [
  ["institution", "By Institution"],
  ["category", "By Category"],
  ["currency", "By Currency"],
  ["product", "By Product"],
];

export function DistributionChartPage() {
  const data = useDashboardData();
  const [group, setGroup] = useState<DistributionGroup>("institution");

  const view = useMemo(() => {
    const converter = data.makeConverter();
    return { slices: distribution(data.facts, group, converter), warnings: [...converter.warnings] };
  }, [data.facts, data.makeConverter, group]);

  if (data.isLoading) return <p className="text-muted">Loading…</p>;

  return (
    <>
      <PageHeader
        title={`Distribution Charts (in ${data.baseCurrency})`}
        icon="pie-chart"
        showDate={false}
        actions={<UnconvertedBadge warnings={view.warnings} />}
      />
      <div className="mb-3" style={{ maxWidth: 360 }}>
        <label htmlFor="groupSelect" className="form-label">Group By</label>
        <select id="groupSelect" className="form-select" value={group} onChange={(e) => setGroup(e.target.value as DistributionGroup)}>
          {GROUPS.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>
      <DistributionPie slices={view.slices} currency={group === "currency" ? "native" : data.baseCurrency} height={380} showLegendList={false} />
    </>
  );
}

/**
 * Per-asset evolution. The title names the series' currency, since an asset
 * need not be in the base currency.
 */
export function AssetEvolutionPage() {
  const data = useDashboardData();
  const assets = useQuery({ queryKey: ["assets"], queryFn: listAssets });
  const [selected, setSelected] = useState("portfolio");
  const [range, setRange] = useState<EvolutionRange>("1Y");

  const view = useMemo(() => {
    const converter = data.makeConverter();
    if (selected === "portfolio") {
      const summary = summarise(data.facts, data.assetCurrencies, converter, data.today);
      const evolution = portfolioEvolution(data.facts, converter, range, data.today, summary.portfolioValue);
      return {
        points: evolution.points.map((p) => ({ label: p.date, value: p.value.toNumber() })),
        currency: data.baseCurrency,
        warnings: [...converter.warnings],
      };
    }
    const asset = (assets.data ?? []).find((a) => String(a.id) === selected);
    return {
      points: assetEvolution(data.facts, Number(selected)).map((p) => ({ label: p.date, value: p.value.toNumber() })),
      currency: asset?.currency ?? data.baseCurrency,
      warnings: [],
    };
  }, [data.facts, data.assetCurrencies, data.makeConverter, data.today, data.baseCurrency, assets.data, selected, range]);

  if (data.isLoading || assets.isLoading) return <p className="text-muted">Loading…</p>;

  return (
    <>
      <PageHeader
        title={`Asset Evolution (in ${view.currency})`}
        icon="graph-up"
        showDate={false}
        actions={<UnconvertedBadge warnings={view.warnings} />}
      />
      <div className="d-flex flex-wrap gap-3 align-items-end mb-3">
        <div style={{ minWidth: 280 }}>
          <label htmlFor="assetSelect" className="form-label">Select Asset</label>
          <select id="assetSelect" className="form-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="portfolio">Total Portfolio</option>
            {(assets.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>{displayName(a)}</option>
            ))}
          </select>
        </div>
        {selected === "portfolio" ? (
          <div className="btn-group btn-group-sm" role="group" aria-label="Range">
            {EVOLUTION_RANGES.map((value) => (
              <button
                key={value}
                type="button"
                className={`btn btn-outline-secondary${range === value ? " active" : ""}`}
                aria-pressed={range === value}
                onClick={() => setRange(value)}
              >
                {value}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <EvolutionLineChart points={view.points} currency={view.currency} beginAtZero={selected === "portfolio"} height={380} />
    </>
  );
}
