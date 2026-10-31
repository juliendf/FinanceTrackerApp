// @vitest-environment jsdom
/**
 * Institutions screen behaviour.
 *
 * The repository layer is mocked; what is under test is the screen's logic and
 * the two rules from `routes/admin.py`: a duplicate name is reported on the
 * field, and a referenced institution cannot be deleted.
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listInstitutionsWithCounts = vi.fn();
const createInstitution = vi.fn();
const updateInstitution = vi.fn();
const deleteInstitution = vi.fn();
const institutionNameExists = vi.fn();

vi.mock("../../../db/repositories/institutions", () => ({
  listInstitutionsWithCounts: (...args: unknown[]) => listInstitutionsWithCounts(...args),
  createInstitution: (...args: unknown[]) => createInstitution(...args),
  updateInstitution: (...args: unknown[]) => updateInstitution(...args),
  deleteInstitution: (...args: unknown[]) => deleteInstitution(...args),
  institutionNameExists: (...args: unknown[]) => institutionNameExists(...args),
}));

import { InstitutionsPage } from "./InstitutionsPage";
import { ToastProvider } from "../../layout/Toasts";

const ROWS = [
  { id: 1, name: "UBS", description: "Main bank", created_at: "", updated_at: "", asset_count: 3 },
  { id: 2, name: "Swissquote", description: null, created_at: "", updated_at: "", asset_count: 0 },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <InstitutionsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("InstitutionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInstitutionsWithCounts.mockResolvedValue(ROWS);
  });

  it("lists institutions with their asset counts", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("UBS")).toBeTruthy());
    expect(screen.getByText("Swissquote")).toBeTruthy();
    expect(screen.getByText("Main bank")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("shows a dash when there is no description", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Swissquote")).toBeTruthy());
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("creates an institution", async () => {
    institutionNameExists.mockResolvedValue(false);
    createInstitution.mockResolvedValue(3);

    renderPage();
    await waitFor(() => expect(screen.getByText("UBS")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /new institution/i }));
    await userEvent.type(screen.getByLabelText(/institution name/i), "PostFinance");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(createInstitution).toHaveBeenCalledWith("PostFinance", null));
  });

  it("reports a duplicate name on the field, without saving", async () => {
    institutionNameExists.mockResolvedValue(true);

    renderPage();
    await waitFor(() => expect(screen.getByText("UBS")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /new institution/i }));
    await userEvent.type(screen.getByLabelText(/institution name/i), "UBS");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() =>
      expect(screen.getByText("An institution with this name already exists.")).toBeTruthy(),
    );
    expect(createInstitution).not.toHaveBeenCalled();
  });

  it("validates the name length before touching the database", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("UBS")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /new institution/i }));
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(screen.getByText("Institution name is required")).toBeTruthy());
    expect(institutionNameExists).not.toHaveBeenCalled();
  });

  it("refuses to delete an institution that has assets", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("UBS")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /delete UBS/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Cannot delete institution "UBS" - it has 3 associated assets/i),
      ).toBeTruthy(),
    );
    expect(deleteInstitution).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced institution after confirmation", async () => {
    deleteInstitution.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("Swissquote")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /delete Swissquote/i }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteInstitution).toHaveBeenCalledWith(2));
  });

  it("pre-fills the form when editing", async () => {
    institutionNameExists.mockResolvedValue(false);
    updateInstitution.mockResolvedValue(undefined);

    renderPage();
    await waitFor(() => expect(screen.getByText("UBS")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /edit UBS/i }));

    const nameInput = screen.getByLabelText(/institution name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("UBS");

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "UBS Switzerland");
    await userEvent.click(screen.getByRole("button", { name: /update/i }));

    await waitFor(() => expect(updateInstitution).toHaveBeenCalledWith(1, "UBS Switzerland", "Main bank"));
  });
});
