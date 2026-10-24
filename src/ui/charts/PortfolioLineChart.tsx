/** Portfolio value over time, themed like the web app's charts. */

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartConfiguration,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useThemeName } from "../../lib/useTheme";
import { formatCurrency } from "../../domain/format";
import type { PortfolioSeries } from "../../domain/portfolio";
import { mergeConfig, themeConfig } from "./chartTheme";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
);

interface Props {
  series: PortfolioSeries;
  /** Currency used for tick and tooltip formatting. */
  currency?: string;
  height?: number;
}

export function PortfolioLineChart({ series, currency = "EUR", height = 280 }: Props) {
  // Rebuild the config on theme change. React owns the instance, so there is no
  // need to mutate a live chart the way ChartUtils.retheme() does.
  const theme = useThemeName();

  const config = useMemo<ChartConfiguration<"line">>(() => {
    const labels = series.points.map((point) => point.date.slice(5));
    const values = series.points.map((point) => point.totalMinor / 100);

    const base = mergeConfig(
      "line",
      {
        labels,
        datasets: [
          {
            label: "Portfolio value",
            data: values,
            fill: true,
          },
        ],
      },
      {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) =>
                formatCurrency(context.parsed.y, currency),
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (value) => formatCurrency(Number(value), currency),
            },
          },
        },
      } as ChartConfiguration<"line">["options"],
    );

    return themeConfig(base);
    // `theme` is a dependency on purpose: themeConfig() reads CSS tokens.
  }, [series, currency, theme]);

  if (series.points.length === 0) {
    return (
      <p className="text-muted mb-0 py-5 text-center">
        No snapshots yet, so there is nothing to plot.
      </p>
    );
  }

  return (
    <div style={{ height }}>
      <Line
        data={config.data}
        options={config.options}
        // Chart.js keeps its own canvas state; give it a fresh mount per theme.
        key={theme}
      />
    </div>
  );
}
