/** A value-over-time line, themed from the design tokens. */

import { useEffect, useMemo, useRef } from "react";
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
import type { Chart as ChartInstance } from "chart.js";
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
  const chartRef = useRef<ChartInstance<"line"> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Chart.js only listens to window resizes. A card can change width without
  // one (a sibling wrapping, the sidebar collapsing), so observe the box.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => chartRef.current?.resize());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
    <div ref={containerRef} style={{ height }}>
      <Line ref={chartRef} data={config.data} options={config.options} key={theme} />
    </div>
  );
}
