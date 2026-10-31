// @vitest-environment jsdom
/**
 * Data page: the counts and the export card.
 *
 * The regression this guards: the asset count was cached under `["assets"]`,
 * which every other screen fills with `AssetRow[]`, so the tile rendered a list
 * of objects and React threw #31 ("Objects are not valid as a React child").
 */

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  countAssets: vi.fn(),
  countSnapshots: vi.fn(),
}));
vi.mock("../../../db/repositories/assets", () => ({ countAssets: () => repo.countAssets() }));
vi.mock("../../../db/repositories/snapshots", () => ({ countSnapshots: () => repo.countSnapshots() }));
vi.mock("../../../db/repositories/export", () => ({ readExportRows: async () => ({}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => "/tmp/x.db" }));
vi.mock("@tauri-apps/api/app", () => ({ getName: async () => "FinanceTracker", getVersion: async () => "0.1.0", getTauriVersion: async () => "2" }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: async () => null }));
vi.mock("../import/ImportWizard", () => ({ ImportWizard: () => null }));
vi.mock("../../../db/seed", () => ({ seedFirstRun: async () => undefined }));
vi.mock("../../../db/reset", () => ({ resetDatabase: async () => undefined }));
vi.mock("../../../dev/sampleData", () => ({ loadSampleData: async () => undefined, resetData: async () => undefined }));

import { DataPage } from "./DataPage";
import { ToastProvider } from "../../layout/Toasts";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  repo.countAssets.mockResolvedValue(18);
  repo.countSnapshots.mockResolvedValue(118);
});

function renderWith(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <DataPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("DataPage", () => {
  it("shows the counts", async () => {
    renderWith(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    expect(await screen.findByText("18")).toBeTruthy();
    expect(screen.getByText("118")).toBeTruthy();
  });

  it("still renders when another screen has already cached the asset list under [\"assets\"]", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["assets"], [{ id: 1, institution_id: 1, currency: "CHF", product_name: "P" }]);
    renderWith(client);
    expect(await screen.findByText("18")).toBeTruthy();
    expect(screen.queryByText(/Objects are not valid/)).toBeNull();
    // The cached list is untouched.
    expect(client.getQueryData(["assets"])).toHaveLength(1);
  });
});
