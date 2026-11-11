// @vitest-environment jsdom
/**
 * Security settings.
 *
 * The page never sees the hash: it calls Rust to set or clear one, and only the two
 * settings rows live in SQLite. These tests pin that split, and the rule that a
 * change or a removal asks for the current PIN.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getAllSettings: vi.fn(),
  setSetting: vi.fn(),
}));
vi.mock("../../../db/repositories/settings", () => ({
  getAllSettings: () => repo.getAllSettings(),
  setSetting: (...args: unknown[]) => repo.setSetting(...args),
}));

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { SecurityPage } from "./SecurityPage";
import { ToastProvider } from "../../layout/Toasts";

/** Throwaway PINs, not credentials: nothing here reaches a Keychain. */
const SAMPLE_PIN = "1234";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/settings/security"]}>
          <SecurityPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.getAllSettings.mockResolvedValue({
    base_currency: "CHF",
    lock_enabled: false,
    lock_idle_minutes: "5",
  });
  repo.setSetting.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("SecurityPage", () => {
  it("starts off, and setting a PIN turns the setting on", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "app_lock_status") return { pinSet: false };
      if (command === "app_lock_set") return undefined;
      throw new Error(`unexpected command ${command}`);
    });

    renderPage();

    const toggle = (await screen.findByRole("switch")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await userEvent.click(toggle);
    await userEvent.type(await screen.findByLabelText("New PIN"), SAMPLE_PIN);
    await userEvent.type(screen.getByLabelText("Again"), SAMPLE_PIN);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("app_lock_set", {
        currentPin: null,
        newPin: SAMPLE_PIN,
      }),
    );
    await waitFor(() =>
      expect(repo.setSetting).toHaveBeenCalledWith("lock_enabled", true),
    );
  });

  it("asks for the current PIN before turning the lock off", async () => {
    repo.getAllSettings.mockResolvedValue({
      base_currency: "CHF",
      lock_enabled: true,
      lock_idle_minutes: "5",
    });
    invoke.mockImplementation(async (command: string) => {
      if (command === "app_lock_status") return { pinSet: true };
      if (command === "app_lock_clear") return undefined;
      throw new Error(`unexpected command ${command}`);
    });

    renderPage();

    await userEvent.click(await screen.findByRole("switch"));

    // The removal form has no "new PIN" field at all.
    expect(await screen.findByLabelText("Current PIN")).toBeTruthy();
    expect(screen.queryByLabelText("New PIN")).toBeNull();

    await userEvent.type(screen.getByLabelText("Current PIN"), SAMPLE_PIN);
    await userEvent.click(screen.getByRole("button", { name: "Turn it off" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("app_lock_clear", {
        currentPin: SAMPLE_PIN,
      }),
    );
    await waitFor(() =>
      expect(repo.setSetting).toHaveBeenCalledWith("lock_enabled", false),
    );
  });

  it("changes the delay with one setting write", async () => {
    invoke.mockResolvedValue({ pinSet: false });

    renderPage();

    const select = (await screen.findByLabelText("Lock automatically")) as HTMLSelectElement;
    await userEvent.selectOptions(select, "15");

    await waitFor(() =>
      expect(repo.setSetting).toHaveBeenCalledWith("lock_idle_minutes", "15"),
    );
  });

  it("says when the setting and the Keychain disagree", async () => {
    repo.getAllSettings.mockResolvedValue({
      base_currency: "CHF",
      lock_enabled: true,
      lock_idle_minutes: "5",
    });
    invoke.mockResolvedValue({ pinSet: false });

    renderPage();

    expect((await screen.findByRole("alert")).textContent).toContain("Keychain has no PIN");
  });
});
