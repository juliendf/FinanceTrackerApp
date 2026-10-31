/** One asset's value over time — the "Value Evolution" card on the detail page. */

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useThemeName } from "../../lib/useTheme";
import { formatCurrency } from "../../domain/format";
import { mergeConfig, themeConfig } from "./chartTheme";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

export interface EvolutionPoint {
  date: string;
  amountMinor: number;
}

export function AssetEvolutionChart({
  points,
  currency,
  height = 280,
}: {
  /** Any order; sorted oldest first here. */
  points: EvolutionPoint[];
  currency: string;
  height?: number;
}) {
  const theme = useThemeName();

  const config = useMemo<ChartConfiguration<"line">>(() => {
    const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
    const base = mergeConfig(
      "line",
      {
        labels: ordered.map((point) => point.date),
        // Chart.js needs numbers; this is the display boundary.
        datasets: [{ label: "Asset Value", data: ordered.map((p) => p.amountMinor / 100), fill: true }],
      },
      {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (context) => formatCurrency(context.parsed.y, currency) } },
        },
        scales: {
          x: { display: true, title: { display: true, text: "Date" } },
          y: {
            display: true,
            beginAtZero: false,
            title: { display: true, text: `Amount (${currency})` },
            ticks: { callback: (value) => formatCurrency(Number(value), currency) },
          },
        },
      } as ChartConfiguration<"line">["options"],
    );
    return themeConfig(base);
    // `theme` on purpose: themeConfig() reads CSS tokens.
  }, [points, currency, theme]);

  if (points.length === 0) {
    return <p className="text-muted text-center py-5 mb-0">No snapshots to plot yet.</p>;
  }

  return (
    <div style={{ height }}>
      <Line data={config.data} options={config.options} key={theme} />
    </div>
  );
}
