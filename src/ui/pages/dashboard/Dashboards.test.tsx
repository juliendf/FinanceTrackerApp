// @vitest-environment jsdom
/** Dashboard screens with the data layer mocked and the Chart.js wrappers stubbed. */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listFacts = vi.hoisted(() => vi.fn());
const listAssetCurrencies = vi.hoisted(() => vi.fn());
const listExchangeRates = vi.hoisted(() => vi.fn());
vi.mock("../../../db/repositories/dashboard", () => ({
  listFacts: () => listFacts(),
  listAssetCurrencies: () => listAssetCurrencies(),
}));
vi.mock("../../../db/repositories/exchangeRates", () => ({ listExchangeRates: () => listExchangeRates() }));
vi.mock("../../../db/repositories/settings", () => ({
  getAllSettings: async () => ({ base_currency: "CHF", enable_animations: false }),
}));
vi.mock("../../../domain/dates", async (original) => ({
  ...(await original<typeof import("../../../domain/dates")>()),
  todayIso: () => "2026-10-26",
}));
vi.mock("../../charts/EvolutionLineChart", () => ({
  EvolutionLineChart: ({ points }: { points: Array<{ label: string }> }) => <div data-testid="line">{points.map((p) => p.label).join(",")}</div>,
}));
vi.mock("../../charts/DistributionPie", () => ({
  DistributionPie: ({ slices }: { slices: Array<{ label: string }> }) => <div data-testid="pie">{slices.map((s) => s.label).join(",")}</div>,
}));

import { DashboardPage } from "./DashboardPage";
import { ResumePage } from "./ResumePage";

const fact = (asset_id: number, date: string, amount: number, over: Record<string, unknown> = {}) => ({
  asset_id, date, amount_minor: amount * 100, currency: "CHF", product_name: `P${asset_id}`,
  institution_name: "UBS", category_name: "Cash", system_role: null, ...over,
});

function renderAt(path: string, element: React.ReactNode, route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  listFacts.mockResolvedValue([
    fact(1, "2025-10-01", 1000),
    fact(1, "2026-10-01", 1500),
    fact(2, "2026-10-01", 100, { currency: "EUR", category_name: "Bourse" }),
  ]);
  listAssetCurrencies.mockResolvedValue(["CHF", "EUR", "CHF"]);
  listExchangeRates.mockResolvedValue([{ from_currency: "EUR", to_currency: "CHF", rate: "0.9" }]);
});

describe("DashboardPage", () => {
  it("shows the tiles in the base currency", async () => {
    renderAt("/", <DashboardPage />, "/");
    await waitFor(() => expect(screen.getByText("Portfolio Value")).toBeTruthy());
    // 1500 CHF + 100 EUR * 0.9
    expect(document.getElementById("portfolio-value")?.textContent?.trim()).toBe("1,590.00 CHF");
    expect(document.getElementById("total-assets")?.textContent).toBe("3");
    expect(document.getElementById("currency-count")?.textContent).toBe("2");
    expect(screen.getByText("CHF, EUR")).toBeTruthy();
    expect(document.getElementById("last-update")?.textContent).toBe("25");
  });

  it("switches the evolution range and shows the percent badge", async () => {
    const user = userEvent.setup();
    renderAt("/", <DashboardPage />, "/");
    await waitFor(() => expect(screen.getByTestId("line")).toBeTruthy());
    // 1Y: cut-off 2025-10-26. The only snapshot in range is 2026-10-01, so the
    // line opens at the cut-off with the value carried in from 2025-10-01.
    expect(screen.getByTestId("line").textContent).toBe("2025-10-26,2026-10-01");
    expect(document.getElementById("evoPercentBadge")?.textContent).toBe("+59.0%");
    await user.click(screen.getByRole("button", { name: "ALL" }));
    expect(screen.getByTestId("line").textContent).toBe("2025-10-01,2026-10-01");
    expect(document.getElementById("evoPercentBadge")?.textContent).toBe("+59.0%");
  });

  it("changes the breakdown group", async () => {
    const user = userEvent.setup();
    renderAt("/", <DashboardPage />, "/");
    await waitFor(() => expect(screen.getByTestId("pie").textContent).toBe("Cash,Bourse"));
    await user.click(screen.getByRole("button", { name: "Currency" }));
    expect(screen.getByTestId("pie").textContent).toBe("CHF,EUR");
  });

  it("badges an amount that could not be converted", async () => {
    listExchangeRates.mockResolvedValue([]);
    renderAt("/", <DashboardPage />, "/");
    expect(await screen.findByText("unconverted")).toBeTruthy();
  });
});

describe("ResumePage", () => {
  it("renders in French with the range from the URL", async () => {
    renderAt("/resume?range=1Y", <ResumePage />, "/resume");
    expect(await screen.findByText("Valeur totale du portefeuille")).toBeTruthy();
    expect(screen.getByRole("link", { name: "1 an" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Capital investi")).toBeTruthy();
  });

  it("computes performance from the value at the start of the period", async () => {
    renderAt("/resume?range=ALL", <ResumePage />, "/resume");
    const row = (await screen.findByText("Performance nette")).closest("div") as HTMLElement;
    // start 2025-10-01: 1000 CHF; end: 1590 -> +59.00 %
    expect(within(row).getByText("+59.00 %")).toBeTruthy();
    expect(screen.getByText("390 jours")).toBeTruthy();
  });

  it("shows N/A without a starting value", async () => {
    listFacts.mockResolvedValue([fact(1, "2026-10-20", 500)]);
    renderAt("/resume?range=1M", <ResumePage />, "/resume");
    expect((await screen.findAllByText("N/A")).length).toBe(2);
  });

  it("reveals the breakdown on demand", async () => {
    const user = userEvent.setup();
    renderAt("/resume", <ResumePage />, "/resume");
    await user.click(await screen.findByRole("button", { name: "Voir la répartition" }));
    expect(screen.getByText("Autre")).toBeTruthy();
  });
});
