/**
 * Chart.js theming.
 *
 * Charts read their colours from the CSS design tokens, so a light/dark switch
 * restyles every live chart instead of leaving a dark canvas with near-black
 * gridlines.
 *
 * Two implementation notes:
 *   * `mergeConfig` deep-copies the defaults with `structuredClone` rather than
 *     `JSON.parse(JSON.stringify(...))`, same isolation, fewer surprises.
 *   * `retheme()` is `useThemeName()`, which re-renders the React chart. React
 *     owns the chart instance, so reconfiguring in place is redundant.
 */

import type { ChartConfiguration, ChartOptions, ChartType } from "chart.js";

export interface ThemeColors {
  text: string;
  muted: string;
  grid: string;
  border: string;
  surface: string;
  accent: string;
  tooltipBg: string;
  tooltipText: string;
}

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

export function isDark(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

/** Resolved theme colours for chart chrome (axes, grid, labels, tooltips). */
export function themeColors(): ThemeColors {
  return {
    text: token("--text-secondary", "#475569"),
    muted: token("--text-muted", "#64748b"),
    grid: token("--border-color-light", "#f1f5f9"),
    border: token("--border-color", "#e2e8f0"),
    surface: token("--surface-1", "#ffffff"),
    accent: token("--accent", "#2563eb"),
    tooltipBg: isDark() ? "rgba(20, 24, 30, 0.96)" : "rgba(15, 23, 42, 0.94)",
    tooltipText: isDark() ? "#e9edf2" : "#ffffff",
  };
}

/** Categorical series palette, in the order slices/lines consume it. */
export function palette(): string[] {
  const names = [
    "--cat-1",
    "--cat-2",
    "--cat-3",
    "--cat-4",
    "--cat-5",
    "--cat-6",
    "--cat-7",
    "--cat-8",
  ];
  const fallback = [
    "#2563eb",
    "#0d9488",
    "#7c3aed",
    "#d97706",
    "#db2777",
    "#0891b2",
    "#65a30d",
    "#dc2626",
  ];
  return names.map((name, index) => token(name, fallback[index]));
}

/** Palette entry for index `i`, cycling when there are more series than colours. */
export function seriesColor(index: number): string {
  const colors = palette();
  return colors[index % colors.length];
}

/** Tokens are hex; convert so translucent area fills can be built. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

/** Shared default chart options. */
const defaultOptions: ChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: "bottom" },
    tooltip: { mode: "index", intersect: false },
  },
  interaction: { mode: "nearest", axis: "x", intersect: false },
};

/**
 * Merge a caller's config with the defaults. The defaults are deep-copied so a
 * caller mutating `options.plugins.*` cannot leak into the next chart.
 */
export function mergeConfig<T extends ChartType>(
  type: T,
  data: ChartConfiguration<T>["data"],
  options: ChartOptions<T> = {} as ChartOptions<T>,
): ChartConfiguration<T> {
  return {
    type,
    data,
    options: Object.assign(structuredClone(defaultOptions), options) as ChartOptions<T>,
  } as ChartConfiguration<T>;
}

/**
 * Recolour a config's datasets from the theme palette and apply the shared
 * axis/legend styling for its chart type.
 */
export function themeConfig<T extends ChartType>(
  config: ChartConfiguration<T>,
): ChartConfiguration<T> {
  const colors = themeColors();
  const type = config.type;
  const datasets = (config.data?.datasets ?? []) as Array<Record<string, unknown>>;

  if (type === "pie" || type === "doughnut") {
    for (const dataset of datasets) {
      const count = Array.isArray(dataset.data) ? dataset.data.length : 0;
      dataset.backgroundColor = Array.from({ length: count }, (_, i) => seriesColor(i));
      dataset.borderColor = colors.surface;
      dataset.borderWidth = 2;
      dataset.hoverOffset = dataset.hoverOffset ?? 6;
    }
    const options = (config.options ?? {}) as Record<string, unknown>;
    if (options.cutout === undefined) options.cutout = "58%";
    config.options = options as unknown as ChartConfiguration<T>["options"];
    return config;
  }

  datasets.forEach((dataset, index) => {
    const color = seriesColor(index);
    dataset.borderColor = color;
    dataset.pointBackgroundColor = color;
    dataset.pointBorderColor = colors.surface;
    dataset.pointBorderWidth = 1.5;
    dataset.pointRadius = 3;
    dataset.pointHoverRadius = 5;

    if (type === "line") {
      dataset.borderWidth = 2;
      dataset.backgroundColor = withAlpha(color, isDark() ? 0.18 : 0.1);
      if (dataset.fill === undefined) dataset.fill = true;
      if (dataset.tension === undefined) dataset.tension = 0.32;
    } else {
      dataset.backgroundColor = withAlpha(color, 0.85);
      dataset.borderWidth = 0;
      dataset.borderRadius = 4;
    }
  });

  const options = (config.options ?? {}) as Record<string, unknown>;
  const scales = (options.scales ?? {}) as Record<string, Record<string, unknown>>;

  for (const axis of ["x", "y"] as const) {
    const scale = (scales[axis] = scales[axis] ?? {});
    scale.ticks = Object.assign({ color: colors.muted, padding: 6 }, scale.ticks);
    scale.grid = Object.assign(
      {
        color: colors.grid,
        drawTicks: false,
        // Vertical gridlines add noise to a time series; keep horizontals only.
        display: axis === "y",
      },
      scale.grid,
    );
    scale.border = Object.assign(
      { color: colors.border, display: false },
      scale.border,
    );
  }

  options.scales = scales;
  config.options = options as unknown as ChartConfiguration<T>["options"];
  return config;
}
