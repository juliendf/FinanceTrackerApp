/** A value-over-time line, themed like the web app's charts. */

import { useMemo } from "react";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { formatCurrency } from "../../domain/format";
import { useThemeName } from "../../lib/useTheme";
import { mergeConfig, themeConfig } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

export interface LinePoint {
  label: string;
  value: number;
}

interface Props {
  points: readonly LinePoint[];
  currency: string;
  seriesLabel?: string;
  beginAtZero?: boolean;
  height?: number;
  emptyMessage?: string;
}

export function EvolutionLineChart({
  points,
  currency,
  seriesLabel = "Value",
  beginAtZero = true,
  height = 280,
  emptyMessage = "No snapshots in this period.",
}: Props) {
  const theme = useThemeName();

  const config = useMemo<ChartConfiguration<"line">>(() => {
    const base = mergeConfig(
      "line",
      {
        labels: points.map((p) => p.label),
        datasets: [{ label: seriesLabel, data: points.map((p) => p.value), fill: true }],
      },
      {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (context) => formatCurrency(context.parsed.y, currency) } },
        },
        scales: {
          y: { beginAtZero, ticks: { callback: (value) => formatCurrency(Number(value), currency) } },
        },
      } as ChartConfiguration<"line">["options"],
    );
    return themeConfig(base);
    // `theme` is a dependency on purpose: themeConfig() reads CSS tokens.
  }, [points, currency, seriesLabel, beginAtZero, theme]);

  if (points.length === 0) {
    return <p className="text-muted mb-0 py-5 text-center">{emptyMessage}</p>;
  }

  return (
    <div style={{ height }}>
      <Line data={config.data} options={config.options} key={theme} />
    </div>
  );
}
