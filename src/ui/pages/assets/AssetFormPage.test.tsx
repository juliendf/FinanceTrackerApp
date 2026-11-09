// @vitest-environment jsdom
/**
 * New / edit asset form: validation messages, what reaches the repository, the
 * initial-snapshot rules, tag selection, and the currency-change confirmation.
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAsset = vi.fn();
const updateAsset = vi.fn();
const deleteAsset = vi.fn();
const getAsset = vi.fn();
vi.mock("../../../db/repositories/assets", () => ({
  createAsset: (...a: unknown[]) => createAsset(...a),
  updateAsset: (...a: unknown[]) => updateAsset(...a),
  deleteAsset: (...a: unknown[]) => deleteAsset(...a),
  getAsset: (...a: unknown[]) => getAsset(...a),
}));
vi.mock("../../../db/repositories/institutions", () => ({
  listInstitutions: async () => [{ id: 1, name: "UBS" }, { id: 2, name: "Boursorama" }],
  createInstitution: async () => 9,
  institutionNameExists: async () => false,
}));
vi.mock("../../../db/repositories/categories", () => ({
  listCategories: async () => [
    { id: 1, name: "Cash", system_role: "cash" },
    { id: 2, name: "Investments", system_role: "stocks" },
  ],
  createCategory: async () => 9,
  categoryNameExists: async () => false,
}));
vi.mock("../../../db/repositories/tags", () => ({
  listTags: async () => [{ id: 1, name: "Liquid", color: null }, { id: 2, name: "Illiquide", color: null }],
  listTagIdsForAsset: async () => [2],
  createTag: async () => 9,
  tagNameExists: async () => false,
}));
vi.mock("../../../db/repositories/holdings", () => ({
  listHoldingsForAsset: async () => [],
}));
vi.mock("../../../db/repositories/snapshots", () => ({
  listSnapshotsForAsset: async () => [
    { id: 1, asset_id: 5, date: "2025-01-01", amount_minor: 100_00 },
    { id: 2, asset_id: 5, date: "2026-01-01", amount_minor: 150_00 },
  ],
}));

import { AssetFormPage } from "./AssetFormPage";
import { ToastProvider } from "../../layout/Toasts";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/assets/new" element={<AssetFormPage />} />
            <Route path="/assets/:assetId/edit" element={<AssetFormPage />} />
            <Route path="/assets/:assetId" element={<output data-testid="detail">detail page</output>} />
            <Route path="/assets" element={<output data-testid="list">list page</output>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

async function fillMinimum() {
  await screen.findByRole("option", { name: "UBS" });
  await userEvent.selectOptions(screen.getByLabelText(/^institution/i), "1");
  await userEvent.selectOptions(screen.getByLabelText(/^category/i), "2");
  await userEvent.type(screen.getByLabelText(/product name/i), "ETF World");
}

describe("AssetFormPage — holdings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAsset.mockResolvedValue(42);
  });

  it("offers holdings only for a category whose role is stocks or bonds", async () => {
    renderAt("/assets/new");
    await screen.findByRole("option", { name: "UBS" });

    await userEvent.selectOptions(screen.getByLabelText(/^category/i), "1");
    expect(screen.queryByText("Holdings")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText(/^category/i), "2");
    expect(await screen.findByText("Holdings")).toBeTruthy();
  });

  it("validates an ISIN before writing anything", async () => {
    renderAt("/assets/new");
    await fillMinimum();
    // Untick the first snapshot: it is required while ticked, and it is not
    // what this test is about.
    await userEvent.click(screen.getByLabelText(/create initial snapshot/i));
    await userEvent.click(screen.getByRole("button", { name: /add a holding/i }));
    await userEvent.type(screen.getByLabelText("ISIN, line 1"), "FR0000120074");
    await userEvent.type(screen.getByLabelText("Quantity, line 1"), "1");
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));

    expect(await screen.findByText(/check digit/)).toBeTruthy();
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("writes the normalised rows with the asset", async () => {
    renderAt("/assets/new");
    await fillMinimum();
    await userEvent.click(screen.getByLabelText(/create initial snapshot/i));
    await userEvent.click(screen.getByRole("button", { name: /add a holding/i }));
    await userEvent.type(screen.getByLabelText("Name, line 1"), "  iShares World  ");
    await userEvent.type(screen.getByLabelText("ISIN, line 1"), "fr 0000 1200 73");
    await userEvent.type(screen.getByLabelText("Quantity, line 1"), "12,50");
    await userEvent.type(screen.getByLabelText("Price, line 1"), "45.20");
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));

    await waitFor(() => expect(createAsset).toHaveBeenCalledTimes(1));
    expect((createAsset.mock.calls[0][0] as { holdings: unknown }).holdings).toEqual([
      { isin: "FR0000120073", label: "iShares World", quantity: "12.5", price: "45.2" },
    ]);
  });
});

describe("AssetFormPage — create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAsset.mockResolvedValue(42);
  });

  it("shows the validation messages and writes nothing", async () => {
    renderAt("/assets/new");
    await screen.findByRole("option", { name: "UBS" });
    // untick so only the required selects and name are in play
    await userEvent.click(screen.getByLabelText(/create initial snapshot/i));
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));

    expect(await screen.findByText("Please select an institution.")).toBeTruthy();
    expect(screen.getByText("Please select a category.")).toBeTruthy();
    expect(screen.getByText("Please enter a product name")).toBeTruthy();
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("creates an asset, with its tags and first snapshot, then opens its page", async () => {
    renderAt("/assets/new");
    await fillMinimum();
    await userEvent.selectOptions(screen.getByLabelText(/^currency/i), "CHF");
    await userEvent.type(screen.getByLabelText(/interest rate/i), "1.75");
    await userEvent.click(screen.getByLabelText("Liquid"));
    await userEvent.type(screen.getByLabelText(/initial amount/i), "2500.50");
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));

    await waitFor(() => expect(createAsset).toHaveBeenCalledTimes(1));
    expect(createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        institution_id: 1,
        category_id: 2,
        currency: "CHF",
        product_name: "ETF World",
        name: null,
        interest_rate: "1.75",
        cost_charges: null,
        tag_ids: [1],
      }),
    );
    // jsdom canonicalises a number input's value ("2500.50" -> "2500.5"); either is exact.
    expect(Number((createAsset.mock.calls[0][0] as { initial_amount: string }).initial_amount)).toBe(2500.5);
    expect((createAsset.mock.calls[0][0] as { initial_date: string }).initial_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByTestId("detail")).toBeTruthy();
  });

  it("requires an amount while 'Create Initial Snapshot' is ticked", async () => {
    renderAt("/assets/new");
    await fillMinimum();
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));

    expect(
      await screen.findByText('Please enter an initial amount or uncheck "Create Initial Snapshot".'),
    ).toBeTruthy();
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("creates no snapshot when the box is unticked", async () => {
    renderAt("/assets/new");
    await fillMinimum();
    await userEvent.click(screen.getByLabelText(/create initial snapshot/i));
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));

    await waitFor(() => expect(createAsset).toHaveBeenCalled());
    expect(createAsset.mock.calls[0][0]).toMatchObject({ initial_amount: null, initial_date: null });
  });

  it("rejects an amount below 0.01", async () => {
    renderAt("/assets/new");
    await fillMinimum();
    await userEvent.type(screen.getByLabelText(/initial amount/i), "0");
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));
    expect(await screen.findByText("Amount must be greater than 0")).toBeTruthy();
  });

  it("limits cost/charges to 0..100", async () => {
    renderAt("/assets/new");
    await fillMinimum();
    await userEvent.click(screen.getByLabelText(/create initial snapshot/i));
    await userEvent.type(screen.getByLabelText(/cost\/charges/i), "150");
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));
    expect(await screen.findByText(/Cost\/Charges must be between 0 and 100/)).toBeTruthy();
  });

  it("keeps the user on the form and shows the error when the write fails", async () => {
    createAsset.mockRejectedValue(new Error("statement 2 of 3 failed: boom"));
    renderAt("/assets/new");
    await fillMinimum();
    await userEvent.click(screen.getByLabelText(/create initial snapshot/i));
    await userEvent.click(screen.getByRole("button", { name: /create asset/i }));

    expect(await screen.findByText(/Error creating asset: statement 2 of 3 failed: boom/)).toBeTruthy();
    expect(screen.queryByTestId("detail")).toBeNull();
  });

  it("offers a quick-add for the institution and selects the new one", async () => {
    renderAt("/assets/new");
    await screen.findByRole("option", { name: "UBS" });
    await userEvent.click(screen.getByRole("button", { name: /add new institution/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/institution name/i), "PostFinance");
    await userEvent.click(within(dialog).getByRole("button", { name: /add institution/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("AssetFormPage — edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateAsset.mockResolvedValue(undefined);
    getAsset.mockResolvedValue({
      id: 5, institution_id: 1, category_id: 1, currency: "EUR", product_name: "Savings",
      name: null, description: null, notes: "keep", code_nin: null, cost_charges: "0.85",
      interest_rate: null, created_at: "2025-01-01T00:00:00Z", updated_at: "",
    });
  });

  it("pre-fills every field, including the saved tags", async () => {
    renderAt("/assets/5/edit");
    await screen.findByDisplayValue("Savings");
    expect((screen.getByLabelText(/^institution/i) as HTMLSelectElement).value).toBe("1");
    expect((screen.getByLabelText(/notes/i) as HTMLTextAreaElement).value).toBe("keep");
    expect((screen.getByLabelText(/cost\/charges/i) as HTMLInputElement).value).toBe("0.85");
    expect((screen.getByLabelText("Illiquide") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Liquid") as HTMLInputElement).checked).toBe(false);
  });

  it("has no initial-snapshot section, and shows the current values card", async () => {
    renderAt("/assets/5/edit");
    await screen.findByDisplayValue("Savings");
    expect(screen.queryByLabelText(/initial amount/i)).toBeNull();
    expect(screen.getByText("Current Values")).toBeTruthy();
    expect(await screen.findByText("€150.00")).toBeTruthy();
  });

  it("updates the asset and its tags", async () => {
    renderAt("/assets/5/edit");
    await screen.findByDisplayValue("Savings");
    await userEvent.click(screen.getByLabelText("Liquid"));
    await userEvent.click(screen.getByRole("button", { name: /update asset/i }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalledTimes(1));
    expect(updateAsset).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ product_name: "Savings", cost_charges: "0.85", tag_ids: [2, 1] }),
    );
    expect(await screen.findByTestId("detail")).toBeTruthy();
  });

  it("asks before changing the currency, because snapshots are not converted", async () => {
    renderAt("/assets/5/edit");
    await screen.findByDisplayValue("Savings");
    await userEvent.selectOptions(screen.getByLabelText(/^currency/i), "USD");
    await userEvent.click(screen.getByRole("button", { name: /update asset/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/will not convert existing snapshot values/i)).toBeTruthy();
    expect(updateAsset).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: /change currency/i }));
    await waitFor(() => expect(updateAsset).toHaveBeenCalledWith(5, expect.objectContaining({ currency: "USD" })));
  });

  it("does not save when the currency change is declined", async () => {
    renderAt("/assets/5/edit");
    await screen.findByDisplayValue("Savings");
    await userEvent.selectOptions(screen.getByLabelText(/^currency/i), "USD");
    await userEvent.click(screen.getByRole("button", { name: /update asset/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it("explains an unknown asset instead of rendering an empty form", async () => {
    getAsset.mockResolvedValue(null);
    renderAt("/assets/99/edit");
    expect(await screen.findByText(/requested asset was not found/i)).toBeTruthy();
  });

  it("deletes from the header after confirmation", async () => {
    deleteAsset.mockResolvedValue(undefined);
    renderAt("/assets/5/edit");
    await screen.findByDisplayValue("Savings");
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /yes, delete permanently/i }));
    await waitFor(() => expect(deleteAsset).toHaveBeenCalledWith(5));
    expect(await screen.findByTestId("list")).toBeTruthy();
  });
});
