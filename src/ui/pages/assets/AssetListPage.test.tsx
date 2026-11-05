// @vitest-environment jsdom
/**
 * Asset list behaviour: URL-backed filters, chips, summary tiles, pagination and
 * deletion. Repositories are mocked; the logic under test is the screen's.
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listAssets = vi.fn();
const deleteAsset = vi.fn();
vi.mock("../../../db/repositories/assets", () => ({
  listAssets: (...a: unknown[]) => listAssets(...a),
  deleteAsset: (...a: unknown[]) => deleteAsset(...a),
}));
const categoriesMock = vi.hoisted(() =>
  vi.fn(async (): Promise<Array<{ id: number; name: string; system_role: string | null }>> => [
    { id: 1, name: "Cash", system_role: "cash" },
    { id: 2, name: "Investments", system_role: "stocks" },
  ]),
);
vi.mock("../../../db/repositories/categories", () => ({ listCategories: () => categoriesMock() }));
vi.mock("../../../db/repositories/institutions", () => ({
  listInstitutions: async () => [{ id: 1, name: "UBS" }, { id: 2, name: "Boursorama" }],
}));
vi.mock("../../../db/repositories/tags", () => ({
  listTags: async () => [{ id: 1, name: "Liquid" }],
}));
const listExchangeRates = vi.fn();
vi.mock("../../../db/repositories/exchangeRates", () => ({
  listExchangeRates: (...a: unknown[]) => listExchangeRates(...a),
}));
vi.mock("../../../db/repositories/snapshots", () => ({
  listAllSnapshotPoints: async () => [
    { asset_id: 1, date: "2025-01-10", amount_minor: 1, currency: "CHF" },
    { asset_id: 1, date: "2026-02-20", amount_minor: 1, currency: "CHF" },
    { asset_id: 2, date: "2025-06-01", amount_minor: 1, currency: "EUR" },
  ],
}));
vi.mock("../../../db/repositories/settings", () => ({
  getAllSettings: async () => ({ base_currency: "EUR" }),
}));

import { AssetListPage } from "./AssetListPage";
import { ToastProvider } from "../../layout/Toasts";

function row(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id, institution_id: 1, category_id: 1, currency: "EUR", product_name: `Product ${id}`,
    name: null, description: null, notes: null, code_nin: null, cost_charges: null,
    interest_rate: null, created_at: "", updated_at: "", institution_name: "UBS",
    category_name: "Cash", category_color: null, latest_amount_minor: 100_00,
    latest_date: "2999-01-01", tags: [], ...overrides,
  };
}

const RATES = [
  { from_currency: "EUR", to_currency: "CHF", rate: "0.95" },
];

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderList(initial = "/assets") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initial]}>
          <AssetListPage />
          <Location />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const currentSearch = () => screen.getByTestId("location").textContent;

afterEach(cleanup);

describe("AssetListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listExchangeRates.mockResolvedValue(RATES);
    listAssets.mockResolvedValue([
      row(1, { institution_name: "UBS", product_name: "Savings", currency: "CHF", category_name: "Cash", latest_amount_minor: 1000_00, tags: [{ id: 1, name: "Liquid", color: "#198754" }] }),
      row(2, { institution_name: "Boursorama", product_name: "PEA", currency: "EUR", category_name: "Investments", latest_amount_minor: 2000_00 }),
      row(3, { institution_name: "Boursorama", product_name: "Courant", currency: "EUR", category_name: "Cash", latest_amount_minor: null, latest_date: null }),
    ]);
  });

  it("lists assets sorted by institution then product, with tags and statuses", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("Boursorama - PEA (Investments)")).toBeTruthy());

    const names = screen.getAllByRole("link").filter((a) => a.className.includes("cell-title")).map((a) => a.textContent);
    expect(names).toEqual([
      "Boursorama - Courant (Cash)",
      "Boursorama - PEA (Investments)",
      "UBS - Savings (Cash)",
    ]);
    // "Liquid" is also an option in the tag filter, so look inside the table.
    expect(within(screen.getByRole("table")).getByText("Liquid")).toBeTruthy();
    expect(screen.getByText("No data")).toBeTruthy();
    expect(screen.getByText(/Showing/).textContent).toContain("1–3 of 3 assets");
  });

  it("shows the combined total converted to the base currency, and per-currency tiles", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("Total Value")).toBeTruthy());
    // 1000 CHF -> EUR = 1000 / 0.95 = 1052.63; + 2000 EUR = 3052.63
    expect(screen.getByText("€3,052.63")).toBeTruthy();
    expect(screen.getByText(/All currencies, converted to EUR/)).toBeTruthy();
    // the CHF tile and the UBS row both show it
    expect(screen.getAllByText("1,000.00 CHF").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the real snapshot range on the Total Assets tile", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("Total Assets")).toBeTruthy());
    expect(screen.getByText("2025-01-10 – 2026-02-20")).toBeTruthy();
  });

  it("hides the combined total when a conversion rate is missing", async () => {
    listExchangeRates.mockResolvedValue([]);
    renderList();
    await waitFor(() => expect(screen.getByText("Total Assets")).toBeTruthy());
    expect(screen.queryByText("Total Value")).toBeNull();
  });

  it("reads filters from the URL, shows chips, and narrows the list", async () => {
    renderList("/assets?currency=EUR&category=Cash");
    await waitFor(() => expect(screen.getByText("Boursorama - Courant (Cash)")).toBeTruthy());

    expect(screen.queryByText("UBS - Savings (Cash)")).toBeNull();
    expect(screen.queryByText("Boursorama - PEA (Investments)")).toBeNull();
    expect(screen.getByText("Currency: EUR")).toBeTruthy();
    expect(screen.getByText("Category: Cash")).toBeTruthy();
  });

  it("applies a select as soon as it changes and goes back to page 1", async () => {
    renderList("/assets?page=2&per_page=10");
    // The currency choices are derived from the assets, so wait for them.
    await waitFor(() => expect(screen.getByText("UBS - Savings (Cash)")).toBeTruthy());

    await userEvent.selectOptions(screen.getByLabelText("Currency"), "CHF");

    await waitFor(() => expect(currentSearch()).toContain("currency=CHF"));
    const params = new URLSearchParams(currentSearch() ?? "");
    expect(params.has("page")).toBe(false);
    expect(params.get("per_page")).toBe("10");
    await waitFor(() => expect(screen.getByText("UBS - Savings (Cash)")).toBeTruthy());
    expect(screen.queryByText("Boursorama - PEA (Investments)")).toBeNull();
  });

  it("applies the search after a pause, with no Search button to press", async () => {
    renderList();
    await waitFor(() => expect(screen.getByLabelText("Search")).toBeTruthy());
    // Filtering is live, so a submit button would be a second way to do it.
    expect(screen.queryByRole("button", { name: /^search$/i })).toBeNull();

    await userEvent.type(screen.getByLabelText("Search"), "ubs");

    await waitFor(() => expect(currentSearch()).toContain("search=ubs"));
    await waitFor(() => expect(screen.getByText("UBS - Savings (Cash)")).toBeTruthy());
    expect(screen.queryByText("Boursorama - PEA (Investments)")).toBeNull();
  });

  it("keeps a partly typed search when another filter changes", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("UBS - Savings (Cash)")).toBeTruthy());

    await userEvent.type(screen.getByLabelText("Search"), "bours");
    // The select commits immediately, before the search debounce fires.
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");

    // The box keeps what was typed, and the search still lands.
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("bours");
    await waitFor(() => expect(currentSearch()).toContain("search=bours"));
    expect(currentSearch()).toContain("currency=EUR");
  });

  it("searches institutions, products, categories and code/NIN", async () => {
    renderList("/assets?search=investments");
    await waitFor(() => expect(screen.getByText("Boursorama - PEA (Investments)")).toBeTruthy());
    expect(screen.queryByText("UBS - Savings (Cash)")).toBeNull();
  });

  it("clears everything with Clear Filters", async () => {
    renderList("/assets?currency=EUR&search=pea");
    await waitFor(() => expect(screen.getByText("Currency: EUR")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    await waitFor(() => expect(currentSearch()).toBe(""));
    expect(screen.queryByText("Currency: EUR")).toBeNull();
  });

  it("explains an empty result and offers to clear the filters", async () => {
    renderList("/assets?search=zzzz");
    await waitFor(() => expect(screen.getByText("No assets match these filters")).toBeTruthy());
    expect(screen.getByText("No assets")).toBeTruthy();
  });

  it("offers a per-row shortcut to record a snapshot", async () => {
    renderList();
    const link = await screen.findByRole("link", { name: /record a snapshot for Boursorama - PEA \(Investments\)/i });
    expect(link.getAttribute("href")).toBe("/snapshots/new?asset_id=2");
  });

  it("points at the missing system role, once, when a category has none", async () => {
    categoriesMock.mockResolvedValueOnce([
      { id: 1, name: "Cash", system_role: null },
      { id: 2, name: "Investments", system_role: "stocks" },
    ]);
    renderList();
    await waitFor(() => expect(screen.getByRole("note")).toBeTruthy());
    expect(screen.getByRole("note").textContent).toContain("One category in use has no system role");
    expect(screen.getByRole("link", { name: /set them/i }).getAttribute("href")).toBe("/categories");
  });

  it("stays quiet when every category in use has a role", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("UBS - Savings (Cash)")).toBeTruthy());
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows the first-asset prompt when there are no assets at all", async () => {
    listAssets.mockResolvedValue([]);
    renderList();
    await waitFor(() => expect(screen.getByText("No assets yet")).toBeTruthy());
    expect(screen.getByRole("link", { name: /add your first asset/i })).toBeTruthy();
  });

  it("paginates and keeps the other filters in the URL", async () => {
    listAssets.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => row(i + 1, { product_name: `P${String(i + 1).padStart(2, "0")}` })),
    );
    renderList("/assets?per_page=10");
    await waitFor(() => expect(screen.getByText(/Showing/)).toBeTruthy());
    expect(screen.getByText(/Showing/).textContent).toContain("1–10 of 25 assets");

    const pager = screen.getByRole("navigation", { name: /asset pagination/i });
    await userEvent.click(within(pager).getByRole("button", { name: "3" }));
    await waitFor(() => expect(screen.getByText(/Showing/).textContent).toContain("21–25 of 25 assets"));
    expect(currentSearch()).toContain("page=3");
    expect(currentSearch()).toContain("per_page=10");
  });

  it("changes the page size and resets to page 1", async () => {
    listAssets.mockResolvedValue(Array.from({ length: 25 }, (_, i) => row(i + 1)));
    renderList("/assets?page=2&per_page=10");
    await waitFor(() => expect(screen.getByLabelText("Rows per page")).toBeTruthy());

    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "50");
    await waitFor(() => expect(screen.getByText(/Showing/).textContent).toContain("1–25 of 25 assets"));
    expect(currentSearch()).toBe("?per_page=50");
  });

  it("deletes an asset after the confirmation dialog", async () => {
    deleteAsset.mockResolvedValue(undefined);
    renderList();
    await waitFor(() => expect(screen.getByText("UBS - Savings (Cash)")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /delete UBS - Savings \(Cash\)/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/permanent and cannot be undone/i)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: /yes, delete permanently/i }));

    await waitFor(() => expect(deleteAsset).toHaveBeenCalledWith(1));
  });

  it("does not delete when the dialog is cancelled", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("UBS - Savings (Cash)")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /delete UBS - Savings \(Cash\)/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(deleteAsset).not.toHaveBeenCalled();
  });
});
