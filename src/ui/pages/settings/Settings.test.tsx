// @vitest-environment jsdom
/** Settings screens: general form, reset confirmation, rates, import, export. */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getAllSettings: vi.fn(),
  setSettings: vi.fn(),
  resetSettings: vi.fn(),
  hasSetting: vi.fn(),
  getSetting: vi.fn(),
  listExchangeRates: vi.fn(),
  ensureRequiredPairs: vi.fn(),
  saveRates: vi.fn(),
}));
vi.mock("../../../db/repositories/settings", () => ({
  getAllSettings: () => repo.getAllSettings(),
  setSettings: (...a: unknown[]) => repo.setSettings(...a),
  resetSettings: () => repo.resetSettings(),
  hasSetting: () => repo.hasSetting(),
  getSetting: () => repo.getSetting(),
}));
vi.mock("../../../db/repositories/exchangeRates", () => ({
  listExchangeRates: () => repo.listExchangeRates(),
  ensureRequiredPairs: () => repo.ensureRequiredPairs(),
  saveRates: (...a: unknown[]) => repo.saveRates(...a),
}));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { ExchangeRatesEditPage } from "./ExchangeRatesEditPage";
import { ExchangeRatesPage } from "./ExchangeRatesPage";
import { SettingsImportPage } from "./SettingsImportPage";
import { SettingsPage } from "./SettingsPage";
import { SettingsResetPage } from "./SettingsResetPage";
import { ToastProvider } from "../../layout/Toasts";

const SETTINGS = {
  base_currency: "CHF",
  show_converted_amounts: true,
  items_per_page: "20",
  date_format: "%d.%m.%Y",
  theme: "dark",
  enable_animations: false,
};

const RATES = [
  { id: 1, from_currency: "CHF", to_currency: "EUR", rate: "1.0730765", created_at: "", updated_at: "2026-08-10T08:07:46" },
  { id: 2, from_currency: "CHF", to_currency: "USD", rate: "0", created_at: "", updated_at: "2026-08-10T08:07:46" },
];

function renderAt(path: string, element: React.ReactNode, route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={element} />
            <Route path="*" element={<div>navigated</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  repo.getAllSettings.mockResolvedValue(SETTINGS);
  repo.listExchangeRates.mockResolvedValue(RATES);
  repo.ensureRequiredPairs.mockResolvedValue(0);
  invoke.mockResolvedValue("/tmp/out.json");
});

describe("SettingsPage", () => {
  it("shows the stored values and saves a change", async () => {
    const user = userEvent.setup();
    repo.setSettings.mockResolvedValue(1);
    renderAt("/settings", <SettingsPage />, "/settings");
    const base = (await screen.findByLabelText("Base Currency")) as HTMLSelectElement;
    expect(base.value).toBe("CHF");
    expect((screen.getByLabelText("Theme") as HTMLSelectElement).value).toBe("dark");
    expect((screen.getByLabelText("Enable Animations") as HTMLInputElement).checked).toBe(false);

    await user.selectOptions(base, "USD");
    await user.click(screen.getByRole("button", { name: /Save Settings/ }));
    await waitFor(() => expect(repo.setSettings).toHaveBeenCalledTimes(1));
    expect(repo.setSettings.mock.calls[0][0]).toMatchObject({ base_currency: "USD", theme: "dark" });
  });

  it("has no API key section", async () => {
    renderAt("/settings", <SettingsPage />, "/settings");
    await screen.findByLabelText("Base Currency");
    expect(screen.queryByText(/API/i)).toBeNull();
  });
});

describe("SettingsResetPage", () => {
  it("needs the checkbox before it will reset", async () => {
    const user = userEvent.setup();
    repo.resetSettings.mockResolvedValue(undefined);
    renderAt("/settings/reset", <SettingsResetPage />, "/settings/reset");
    const button = await screen.findByRole("button", { name: /Reset All Settings/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText(/I understand this will reset/));
    await user.click(button);
    await waitFor(() => expect(repo.resetSettings).toHaveBeenCalledTimes(1));
  });
});

describe("ExchangeRatesPage", () => {
  it("lists the pairs and flags an unset one", async () => {
    renderAt("/settings/exchange-rates", <ExchangeRatesPage />, "/settings/exchange-rates");
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3));
    expect(screen.getByText("unset")).toBeTruthy();
    expect(repo.ensureRequiredPairs).toHaveBeenCalled();
  });

  it("shows last-updated times in history mode", async () => {
    renderAt("/settings/exchange-rates/history", <ExchangeRatesPage />, "/settings/exchange-rates/history");
    expect(await screen.findByText("Last Updated")).toBeTruthy();
  });
});

describe("ExchangeRatesEditPage", () => {
  it("blocks a non-positive rate and saves valid ones in full precision", async () => {
    const user = userEvent.setup();
    repo.saveRates.mockResolvedValue(2);
    renderAt("/settings/exchange-rates/edit", <ExchangeRatesEditPage />, "/settings/exchange-rates/edit");

    const eur = (await screen.findByLabelText("Rate CHF to EUR")) as HTMLInputElement;
    expect(eur.value).toBe("1.0730765");
    await user.clear(screen.getByLabelText("Rate CHF to USD"));
    await user.type(screen.getByLabelText("Rate CHF to USD"), "0");
    await user.click(screen.getByRole("button", { name: /Save All Rates/ }));
    expect((await screen.findAllByText("Rate must be positive")).length).toBeGreaterThan(0);
    expect(repo.saveRates).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Rate CHF to USD"));
    await user.type(screen.getByLabelText("Rate CHF to USD"), "1.2197668");
    await user.click(screen.getByRole("button", { name: /Save All Rates/ }));
    await waitFor(() => expect(repo.saveRates).toHaveBeenCalledTimes(1));
    expect(repo.saveRates.mock.calls[0][0]).toEqual([
      { from_currency: "CHF", to_currency: "EUR", rate: "1.0730765" },
      { from_currency: "CHF", to_currency: "USD", rate: "1.2197668" },
    ]);
  });
});

describe("SettingsImportPage", () => {
  it("ignores unknown keys and writes the rest", async () => {
    const user = userEvent.setup();
    repo.setSettings.mockResolvedValue(1);
    renderAt("/settings/import", <SettingsImportPage />, "/settings/import");
    fireEvent.change(await screen.findByLabelText("Settings JSON"), {
      target: { value: '{ "base_currency": "USD", "auto_backup": "false" }' },
    });
    await user.click(screen.getByRole("button", { name: /Import Settings/ }));
    await waitFor(() => expect(repo.setSettings).toHaveBeenCalledWith({ base_currency: "USD" }));
  });

  it("refuses broken JSON", async () => {
    const user = userEvent.setup();
    renderAt("/settings/import", <SettingsImportPage />, "/settings/import");
    await user.type(await screen.findByLabelText("Settings JSON"), "not json");
    await user.click(screen.getByRole("button", { name: /Import Settings/ }));
    expect(await screen.findByText("That is not valid JSON.")).toBeTruthy();
    expect(repo.setSettings).not.toHaveBeenCalled();
  });
});
