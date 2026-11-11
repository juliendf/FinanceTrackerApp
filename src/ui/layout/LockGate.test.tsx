// @vitest-environment jsdom
/**
 * The lock gate.
 *
 * The property under test is the one the feature exists for: while the gate is up,
 * the app is not mounted at all — not hidden, not blurred, not behind a modal.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getAllSettings: vi.fn(),
  setSetting: vi.fn(),
}));
vi.mock("../../db/repositories/settings", () => ({
  getAllSettings: () => repo.getAllSettings(),
  setSetting: (...args: unknown[]) => repo.setSetting(...args),
}));

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { LockGate } from "./LockGate";

const UNLOCKED_APP = <div>secret dashboard</div>;
/** A throwaway PIN, not a credential: it never leaves this test. */
const SAMPLE_PIN = "1234";

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LockGate>{UNLOCKED_APP}</LockGate>
    </QueryClientProvider>,
  );
}

const settingsWith = (overrides: Record<string, unknown>) => ({
  base_currency: "CHF",
  items_per_page: "20",
  lock_enabled: false,
  lock_idle_minutes: "5",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  repo.getAllSettings.mockResolvedValue(settingsWith({}));
});

afterEach(cleanup);

describe("LockGate", () => {
  it("mounts the app when the lock is off", async () => {
    renderGate();

    expect(await screen.findByText("secret dashboard")).toBeTruthy();
    expect(screen.queryByLabelText("PIN")).toBeNull();
    // Nothing was asked of the Keychain, or of anything else: the feature is inert.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows nothing of the app when the lock is on", async () => {
    repo.getAllSettings.mockResolvedValue(settingsWith({ lock_enabled: true }));
    invoke.mockResolvedValue({ pinSet: true });

    renderGate();

    expect(await screen.findByText("Finance Tracker is locked")).toBeTruthy();
    expect(screen.queryByText("secret dashboard")).toBeNull();
  });

  it("does not mount the app while the settings are still loading", async () => {
    let resolveSettings: (value: unknown) => void = () => {};
    repo.getAllSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );
    invoke.mockResolvedValue({ pinSet: true });

    renderGate();

    expect(screen.queryByText("secret dashboard")).toBeNull();
    expect(screen.getByText("Starting…")).toBeTruthy();

    resolveSettings(settingsWith({ lock_enabled: true }));
    expect(await screen.findByText("Finance Tracker is locked")).toBeTruthy();
    expect(screen.queryByText("secret dashboard")).toBeNull();
  });

  it("only accepts four digits in the PIN field", async () => {
    repo.getAllSettings.mockResolvedValue(settingsWith({ lock_enabled: true }));
    invoke.mockResolvedValue({ pinSet: true });

    renderGate();

    const input = (await screen.findByLabelText("PIN")) as HTMLInputElement;
    await userEvent.type(input, "12ab3456");

    expect(input.value).toBe("1234");
  });

  it("keeps the app unmounted after a wrong PIN and says so", async () => {
    repo.getAllSettings.mockResolvedValue(settingsWith({ lock_enabled: true }));
    invoke.mockImplementation(async (command: string) => {
      if (command === "app_lock_status") return { pinSet: true };
      if (command === "app_lock_verify") {
        return { unlocked: false, retryAfterSeconds: 0 };
      }
      throw new Error(`unexpected command ${command}`);
    });

    renderGate();

    const input = await screen.findByLabelText("PIN");
    await userEvent.type(input, "9999");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect((await screen.findByRole("alert")).textContent).toBe("That PIN is not right.");
    expect(screen.queryByText("secret dashboard")).toBeNull();
    // The field is cleared so the next attempt starts clean.
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("reveals the app on the right PIN", async () => {
    repo.getAllSettings.mockResolvedValue(settingsWith({ lock_enabled: true }));
    invoke.mockImplementation(async (command: string) => {
      if (command === "app_lock_status") return { pinSet: true };
      if (command === "app_lock_verify") return { unlocked: true, retryAfterSeconds: 0 };
      throw new Error(`unexpected command ${command}`);
    });

    renderGate();

    await userEvent.type(await screen.findByLabelText("PIN"), SAMPLE_PIN);
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("secret dashboard")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("app_lock_verify", { pin: SAMPLE_PIN });
  });

  it("offers to set a PIN when the Keychain item is gone", async () => {
    repo.getAllSettings.mockResolvedValue(settingsWith({ lock_enabled: true }));
    invoke.mockResolvedValue({ pinSet: false });

    renderGate();

    expect(await screen.findByText("The lock is on, but its PIN is missing")).toBeTruthy();
    expect(screen.queryByText("secret dashboard")).toBeNull();
    // Both ways out are offered: set one, or turn the lock off.
    expect(screen.getByRole("button", { name: /Set the PIN and continue/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Turn the lock off instead/ })).toBeTruthy();
  });

  it("refuses an incomplete new PIN, without calling Rust", async () => {
    repo.getAllSettings.mockResolvedValue(settingsWith({ lock_enabled: true }));
    invoke.mockResolvedValue({ pinSet: false });

    renderGate();

    await userEvent.type(await screen.findByLabelText("New PIN"), "12");
    await userEvent.type(screen.getByLabelText("Again"), "12");
    await userEvent.click(screen.getByRole("button", { name: /Set the PIN and continue/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("4 digits"),
    );
    expect(invoke).not.toHaveBeenCalledWith("app_lock_set", expect.anything());
  });
});
