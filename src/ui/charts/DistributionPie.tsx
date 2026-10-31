/** Distribution pie plus the legend list beside it (home dashboard and charts page). */

import { useMemo, useState } from "react";
import { ArcElement, Chart as ChartJS, Legend, Tooltip, type ChartConfiguration } from "chart.js";
import { Pie } from "react-chartjs-2";
import type { DistributionSlice } from "../../domain/dashboard";
import { formatCurrency } from "../../domain/format";
import { useThemeName } from "../../lib/useTheme";
import { mergeConfig, seriesColor, themeConfig } from "./chartTheme";

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  slices: readonly DistributionSlice[];
  /** Currency for amounts, or "native" to format each slice in its own label (by currency). */
  currency: string | "native";
  height?: number;
  /** The legend list beside the pie; the charts page shows the chart legend instead. */
  showLegendList?: boolean;
}

const money = (amount: number, currency: string, label: string) =>
  formatCurrency(amount, currency === "native" ? label : currency);

export function DistributionPie({ slices, currency, height = 260, showLegendList = true }: Props) {
  const theme = useThemeName();
  const [sort, setSort] = useState<"amount-desc" | "name-asc">("amount-desc");

  const config = useMemo<ChartConfiguration<"pie">>(() => {
    const base = mergeConfig(
      "pie",
      {
        labels: slices.map((s) => s.label),
        datasets: [{ data: slices.map((s) => s.amount.toNumber()) }],
      },
      {
        plugins: {
          legend: { display: !showLegendList, position: "bottom" },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.label}: ${money(context.parsed, currency, context.label)} (${slices[context.dataIndex]?.percent.toFixed(1) ?? "0.0"}%)`,
            },
          },
        },
      } as ChartConfiguration<"pie">["options"],
    );
    return themeConfig(base);
  }, [slices, currency, showLegendList, theme]);

  // Colours follow the slice's position in the chart, so the legend matches it.
  const legend = useMemo(() => {
    const items = slices.map((slice, index) => ({ slice, color: seriesColor(index) }));
    return [...items].sort((a, b) =>
      sort === "amount-desc" ? b.slice.amount.comparedTo(a.slice.amount) : a.slice.label.localeCompare(b.slice.label),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slices, sort, theme]);

  if (slices.length === 0) {
    return <p className="text-muted mb-0 py-5 text-center">No snapshots yet, so there is nothing to show.</p>;
  }

  const chart = (
    <div style={{ height }}>
      <Pie data={config.data} options={config.options} key={theme} />
    </div>
  );
  if (!showLegendList) return chart;

  return (
    <div className="row">
      <div className="col-md-6">{chart}</div>
      <div className="col-md-6">
        <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
          <h6 className="mb-0">Breakdown</h6>
          <div className="segmented" role="group" aria-label="Sort breakdown">
            <button type="button" className={`btn legend-sort-btn${sort === "amount-desc" ? " active" : ""}`} onClick={() => setSort("amount-desc")}>
              Highest
            </button>
            <button type="button" className={`btn legend-sort-btn${sort === "name-asc" ? " active" : ""}`} onClick={() => setSort("name-asc")}>
              Name
            </button>
          </div>
        </div>
        <div className="list-group list-group-flush">
          {legend.map(({ slice, color }) => (
            <div key={slice.label} className="list-group-item d-flex justify-content-between align-items-center px-0">
              <div className="d-flex align-items-center">
                <span className="legend-dot me-2" style={{ backgroundColor: color }} />
                {slice.label}
              </div>
              <div className="d-flex align-items-center">
                <span className="text-muted legend-amount">{money(slice.amount.toNumber(), currency, slice.label)}</span>
                <span className="text-muted legend-percent ms-1">({slice.percent.toFixed(1)}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
