// @vitest-environment jsdom
/**
 * Import wizard state machine.
 *
 * Tauri is mocked at the two boundaries the wizard touches — the native dialog
 * and `invoke` — plus the repository layer. What is under test is the wizard's
 * own logic: it must show blocking errors instead of importing, must move to the
 * category-role step when the imported categories have no role, and must reach
 * the report when everything worked.
 */

import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openDialog = vi.fn();
const invoke = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialog(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const executeImport = vi.fn();
vi.mock("../../../import/execute", async () => {
  const actual = await vi.importActual<typeof import("../../../import/execute")>(
    "../../../import/execute",
  );
  return {
    ...actual,
    executeImport: (...args: unknown[]) => executeImport(...args),
  };
});

const listCategoriesMissingRole = vi.fn();
const updateCategoryRole = vi.fn();
vi.mock("../../../db/repositories/categories", () => ({
  listCategoriesMissingRole: (...args: unknown[]) => listCategoriesMissingRole(...args),
  updateCategoryRole: (...args: unknown[]) => updateCategoryRole(...args),
}));

import { ImportWizard } from "./ImportWizard";
import { ToastProvider } from "../../layout/Toasts";
import { ImportBlockedError } from "../../../import/execute";
import { buildImportPlan } from "../../../import/plan";
import { parseBackup } from "../../../import/schema";

const fixtureRaw = readFileSync("tests/fixtures/backup-v2-small.json", "utf8");
const backup = parseBackup(fixtureRaw);

function renderWizard(onImported = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ImportWizard show onClose={vi.fn()} onImported={onImported} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function pickFile() {
  openDialog.mockResolvedValue("/Users/test/backup.json");
  invoke.mockResolvedValue(fixtureRaw);
  await userEvent.click(screen.getByRole("button", { name: /choose a backup file/i }));
}

// Vitest runs without globals here, so RTL cannot auto-register its cleanup.
afterEach(cleanup);

describe("ImportWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens on the file picker", () => {
    renderWizard();
    expect(screen.getByRole("button", { name: /choose a backup file/i })).toBeTruthy();
  });

  it("reads the file and previews the counts", async () => {
    renderWizard();
    await pickFile();

    await waitFor(() => expect(screen.getByText(/backup version 2/i)).toBeTruthy());
    expect(screen.getByText("Institutions")).toBeTruthy();
    // The fixture holds 2 institutions, and the count column shows it.
    expect(screen.queryByText("18")).toBeNull();

    const importButton = screen.getByRole("button", { name: /import and replace local data/i });
    expect((importButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("warns about the API key and the missing system roles", async () => {
    renderWizard();
    await pickFile();

    await waitFor(() => expect(screen.getByText(/Keychain/i)).toBeTruthy());
    expect(screen.getByText(/system role/i)).toBeTruthy();
  });

  it("lists what the backup cannot carry", async () => {
    renderWizard();
    await pickFile();

    await waitFor(() => expect(screen.getByText(/Not included in this backup/i)).toBeTruthy());
    expect(screen.getAllByText(/memories/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/goals/i).length).toBeGreaterThan(0);
  });

  it("refuses to import a file with blocking errors", async () => {
    const broken = JSON.parse(fixtureRaw);
    broken.data.assets[0].institution_id = 999;
    openDialog.mockResolvedValue("/Users/test/broken.json");
    invoke.mockResolvedValue(JSON.stringify(broken));

    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: /choose a backup file/i }));

    await waitFor(() => expect(screen.getByText(/cannot be imported/i)).toBeTruthy());
    expect(screen.getByText(/institution 999/)).toBeTruthy();
    const importButton = screen.getByRole("button", { name: /import and replace local data/i });
    expect((importButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the error when the file is not a backup", async () => {
    openDialog.mockResolvedValue("/Users/test/notes.json");
    invoke.mockResolvedValue("{}");

    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: /choose a backup file/i }));

    await waitFor(() => expect(screen.getByText(/no backup version/i)).toBeTruthy());
  });

  it("imports, then asks for category roles, then reports", async () => {
    executeImport.mockResolvedValue({
      counts: {
        institutions: 2,
        categories: 2,
        tags: 1,
        assets: 2,
        snapshots: 3,
        exchangeRates: 2,
        providers: 1,
        settings: 3,
        memories: 0,
        goals: 0,
        profile: 1,
      },
      keysToKeychain: 1,
      statements: 18,
      durationMs: 42,
    });
    listCategoriesMissingRole.mockResolvedValue([
      { id: 10, name: "Assurance Vie", description: null, color: "#007bff", system_role: null, created_at: "", updated_at: "" },
    ]);

    const onImported = vi.fn();
    renderWizard(onImported);
    await pickFile();

    await waitFor(() => expect(screen.getByText(/backup version 2/i)).toBeTruthy());
    await userEvent.click(
      screen.getByRole("button", { name: /import and replace local data/i }),
    );

    // Role mapping step appears because v2 carries no system_role.
    await waitFor(() => expect(screen.getByText(/Assurance Vie/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeTruthy();

    await userEvent.selectOptions(screen.getByRole("combobox"), "cash");
    await userEvent.click(screen.getByRole("button", { name: /save roles/i }));

    await waitFor(() => expect(updateCategoryRole).toHaveBeenCalledWith(10, "cash"));
    expect(onImported).toHaveBeenCalled();
    expect(screen.getByText(/Import finished/i)).toBeTruthy();
  });

  it("goes straight to the report when no category lacks a role", async () => {
    executeImport.mockResolvedValue({
      counts: {
        institutions: 2, categories: 2, tags: 1, assets: 2, snapshots: 3,
        exchangeRates: 2, providers: 1, settings: 3, memories: 0, goals: 0, profile: 1,
      },
      keysToKeychain: 0,
      statements: 18,
      durationMs: 10,
    });
    listCategoriesMissingRole.mockResolvedValue([]);

    renderWizard();
    await pickFile();
    await waitFor(() => expect(screen.getByText(/backup version 2/i)).toBeTruthy());
    await userEvent.click(
      screen.getByRole("button", { name: /import and replace local data/i }),
    );

    await waitFor(() => expect(screen.getByText(/Import finished/i)).toBeTruthy());
    expect(screen.queryByText(/moved to the Keychain/i)).toBeNull();
  });

  it("returns to the preview when the import is blocked by the database", async () => {
    const plan = buildImportPlan({ ...backup, data: { ...backup.data, assets: [] } });
    executeImport.mockRejectedValue(new ImportBlockedError(plan));

    renderWizard();
    await pickFile();
    await waitFor(() => expect(screen.getByText(/backup version 2/i)).toBeTruthy());
    await userEvent.click(
      screen.getByRole("button", { name: /import and replace local data/i }),
    );

    await waitFor(() => expect(screen.getByText(/Import blocked by/i)).toBeTruthy());
  });
});
