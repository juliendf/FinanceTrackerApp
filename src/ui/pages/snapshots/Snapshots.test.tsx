// @vitest-environment jsdom
/** Snapshot screens: list filters/delete, single form, bulk entry. Repositories are mocked. */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const snap = vi.hoisted(() => ({
  listSnapshotRows: vi.fn(),
  deleteSnapshot: vi.fn(),
  deleteSnapshots: vi.fn(),
  createSnapshot: vi.fn(),
  createSnapshotsBulk: vi.fn(),
  snapshotExists: vi.fn(),
  assetIdsWithSnapshotOn: vi.fn(),
  latestSnapshotForAsset: vi.fn(),
  listAllSnapshotPoints: vi.fn(),
  getSnapshotRow: vi.fn(),
  updateSnapshot: vi.fn(),
}));
vi.mock("../../../db/repositories/snapshots", () => snap);
const listAssets = vi.hoisted(() => vi.fn());
vi.mock("../../../db/repositories/assets", () => ({ listAssets: () => listAssets() }));
vi.mock("../../../db/repositories/institutions", () => ({
  listInstitutions: async () => [{ id: 1, name: "UBS" }, { id: 2, name: "Boursorama" }],
}));
vi.mock("../../../db/repositories/categories", () => ({
  listCategories: async () => [{ id: 1, name: "Cash" }],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { BulkEntryPage } from "./BulkEntryPage";
import { SnapshotFormPage } from "./SnapshotFormPage";
import { SnapshotListPage } from "./SnapshotListPage";
import { ToastProvider } from "../../layout/Toasts";

const asset = (id: number, over: Record<string, unknown> = {}) => ({
  id, institution_id: 1, category_id: 1, currency: "EUR", product_name: `P${id}`, name: null,
  institution_name: "UBS", category_name: "Cash", tags: [], ...over,
});
const srow = (id: number, over: Record<string, unknown> = {}) => ({
  id, asset_id: 1, date: "2026-01-01", amount_minor: 100_00, created_at: "", updated_at: "",
  asset_name: null, product_name: "P1", institution_id: 1, institution_name: "UBS",
  category_name: "Cash", currency: "EUR", ...over,
});

function Loc() {
  const l = useLocation();
  return <output data-testid="loc">{l.pathname + l.search}</output>;
}

function renderAt(path: string, element: React.ReactNode, route = path.split("?")[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={element} />
            <Route path="*" element={null} />
          </Routes>
          <Loc />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  listAssets.mockResolvedValue([asset(1), asset(2, { product_name: "P2", currency: "CHF" })]);
  snap.listAllSnapshotPoints.mockResolvedValue([
    { asset_id: 1, date: "2026-01-01", amount_minor: 100_00, currency: "EUR" },
    { asset_id: 1, date: "2026-02-01", amount_minor: 200_00, currency: "EUR" },
  ]);
  snap.assetIdsWithSnapshotOn.mockResolvedValue(new Set());
  snap.snapshotExists.mockResolvedValue(false);
  snap.latestSnapshotForAsset.mockResolvedValue(null);
});

describe("SnapshotListPage", () => {
  beforeEach(() => {
    snap.listSnapshotRows.mockResolvedValue([
      srow(1, { date: "2026-03-01" }),
      srow(2, { date: "2026-02-01", currency: "CHF", institution_id: 2, institution_name: "Boursorama", product_name: "P2", asset_id: 2 }),
    ]);
  });

  it("lists snapshots and filters by currency through the URL", async () => {
    renderAt("/snapshots?currency=CHF", <SnapshotListPage />, "/snapshots");
    await waitFor(() => expect(screen.getByRole("link", { name: /P2/ })).toBeTruthy());
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByTestId("loc").textContent).toBe("/snapshots?currency=CHF");
  });

  it("sorts by amount ascending on header click", async () => {
    const user = userEvent.setup();
    renderAt("/snapshots", <SnapshotListPage />, "/snapshots");
    await waitFor(() => screen.getByText(/Amount/, { selector: "th" }));
    await user.click(screen.getByText(/Amount/, { selector: "th" }));
    expect(screen.getByTestId("loc").textContent).toBe("/snapshots?sort_by=amount&sort_order=asc");
  });

  it("deletes one snapshot after confirmation", async () => {
    const user = userEvent.setup();
    snap.deleteSnapshot.mockResolvedValue(undefined);
    renderAt("/snapshots", <SnapshotListPage />, "/snapshots");
    await waitFor(() => screen.getAllByLabelText(/Delete snapshot 2026-03-01/));
    await user.click(screen.getAllByLabelText(/Delete snapshot 2026-03-01/)[0]);
    await user.click(await screen.findByRole("button", { name: /Delete Snapshot/ }));
    await waitFor(() => expect(snap.deleteSnapshot).toHaveBeenCalledWith(1));
  });

  it("bulk delete asks first, then deletes the selected ids", async () => {
    const user = userEvent.setup();
    snap.deleteSnapshots.mockResolvedValue(2);
    renderAt("/snapshots", <SnapshotListPage />, "/snapshots");
    await user.click(await screen.findByLabelText("Select all snapshots on this page"));
    await user.click(screen.getByRole("button", { name: /Bulk Delete/ }));
    expect(snap.deleteSnapshots).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: /Delete 2 snapshots/ }));
    await waitFor(() => expect(snap.deleteSnapshots).toHaveBeenCalledWith([1, 2]));
  });
});

describe("SnapshotFormPage (new)", () => {
  it("preselects the asset from ?asset_id and shows the previous value", async () => {
    snap.latestSnapshotForAsset.mockResolvedValue({ id: 9, asset_id: 2, date: "2026-02-01", amount_minor: 1234_50 });
    renderAt("/snapshots/new?asset_id=2", <SnapshotFormPage />, "/snapshots/new");
    const select = (await screen.findByLabelText("Asset")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("2"));
    expect((await screen.findByText(/Previous snapshot/)).textContent).toContain("CHF 1,234.50");
  });

  it("shows validation errors and writes nothing", async () => {
    const user = userEvent.setup();
    renderAt("/snapshots/new", <SnapshotFormPage />, "/snapshots/new");
    await user.click(await screen.findByRole("button", { name: /Create Snapshot/ }));
    expect(await screen.findByText("Please select an asset")).toBeTruthy();
    expect(screen.getByText("Please enter an amount")).toBeTruthy();
    expect(snap.createSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a duplicate date with the source's message", async () => {
    const user = userEvent.setup();
    snap.snapshotExists.mockResolvedValue(true);
    renderAt("/snapshots/new?asset_id=1", <SnapshotFormPage />, "/snapshots/new");
    await user.type(await screen.findByLabelText("Amount"), "10");
    await user.click(screen.getByRole("button", { name: /Create Snapshot/ }));
    expect(await screen.findByText(/already exists on/)).toBeTruthy();
    expect(snap.createSnapshot).not.toHaveBeenCalled();
  });

  it("creates in minor units and returns to the list", async () => {
    const user = userEvent.setup();
    snap.createSnapshot.mockResolvedValue(5);
    renderAt("/snapshots/new?asset_id=1", <SnapshotFormPage />, "/snapshots/new");
    await user.type(await screen.findByLabelText("Amount"), "2500.5");
    await user.click(screen.getByRole("button", { name: /Create Snapshot/ }));
    await waitFor(() => expect(snap.createSnapshot).toHaveBeenCalledWith(1, expect.any(String), 250050));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/snapshots"));
  });
});

describe("BulkEntryPage", () => {
  it("copies the latest strictly-earlier value and writes only filled rows atomically", async () => {
    const user = userEvent.setup();
    snap.createSnapshotsBulk.mockResolvedValue(1);
    renderAt("/snapshots/bulk", <BulkEntryPage />, "/snapshots/bulk");
    const input = (await screen.findByLabelText("Amount for UBS - P1 (Cash)")) as HTMLInputElement;
    await user.click(screen.getByRole("button", { name: "Copy previous" }));
    expect(input.value).toBe("200.00");
    await user.click(screen.getByRole("button", { name: /Create Snapshots/ }));
    await waitFor(() => expect(snap.createSnapshotsBulk).toHaveBeenCalledTimes(1));
    expect(snap.createSnapshotsBulk.mock.calls[0][1]).toEqual([{ assetId: 1, amountMinor: 20000 }]);
  });

  it("flags the duplicate row and writes nothing", async () => {
    const user = userEvent.setup();
    snap.assetIdsWithSnapshotOn.mockResolvedValue(new Set([1]));
    renderAt("/snapshots/bulk", <BulkEntryPage />, "/snapshots/bulk");
    await user.type(await screen.findByLabelText("Amount for UBS - P1 (Cash)"), "5");
    await user.click(screen.getByRole("button", { name: /Create Snapshots/ }));
    expect((await screen.findAllByText(/already exists on/)).length).toBeGreaterThan(0);
    expect(snap.createSnapshotsBulk).not.toHaveBeenCalled();
  });

  it("applies the same amount to every visible row and keeps filters in the URL", async () => {
    const user = userEvent.setup();
    renderAt("/snapshots/bulk", <BulkEntryPage />, "/snapshots/bulk");
    const currency = await screen.findByLabelText("Currency");
    await waitFor(() => expect(within(currency).getByRole("option", { name: "CHF" })).toBeTruthy());
    await user.selectOptions(currency, "CHF");
    expect(screen.getByTestId("loc").textContent).toBe("/snapshots/bulk?currency_filter=CHF");
    await user.type(screen.getByLabelText("Amount to apply"), "7");
    await user.click(screen.getByRole("button", { name: "Apply same amount" }));
    expect((screen.getByLabelText(/Amount for UBS - P2/) as HTMLInputElement).value).toBe("7");
    expect(screen.queryByLabelText(/Amount for UBS - P1/)).toBeNull();
  });

  it("renders 200 assets", async () => {
    listAssets.mockResolvedValue(Array.from({ length: 200 }, (_, i) => asset(i + 1)));
    renderAt("/snapshots/bulk", <BulkEntryPage />, "/snapshots/bulk");
    await waitFor(() => expect(screen.getAllByLabelText(/^Amount for /)).toHaveLength(200));
  });
});
