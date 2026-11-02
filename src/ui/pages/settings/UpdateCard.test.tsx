// @vitest-environment jsdom
/**
 * Update card: a check only reports, installing is explicit and restarts.
 *
 * Guards the flow the app relies on: `check()` finds a version, the card shows
 * it, "Install and restart" downloads with progress and relaunches, and a
 * failure surfaces instead of restarting.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updater = vi.hoisted(() => ({ check: vi.fn() }));
const relaunch = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => updater.check() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.1" }));

import { UpdateCard } from "./UpdateCard";
import { ToastProvider } from "../../layout/Toasts";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  relaunch.mockResolvedValue(undefined);
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <UpdateCard />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("UpdateCard", () => {
  it("reports the latest version when there is nothing to install", async () => {
    updater.check.mockResolvedValue(null);
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    expect(await screen.findByText(/latest version \(0\.4\.1\)/i)).toBeTruthy();
  });

  it("installs on request and relaunches once the download is verified", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 2_097_152 } });
      onEvent({ event: "Progress", data: { chunkLength: 1_048_576 } });
      onEvent({ event: "Finished" });
    });
    updater.check.mockResolvedValue({ version: "0.4.2", downloadAndInstall });
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(await screen.findByText(/Version/i)).toBeTruthy();
    expect(screen.getByText("0.4.2")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /install and restart/i }));

    await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed install instead of restarting", async () => {
    const downloadAndInstall = vi.fn(async () => {
      throw new Error("signature mismatch");
    });
    updater.check.mockResolvedValue({ version: "0.4.2", downloadAndInstall });
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    await userEvent.click(await screen.findByRole("button", { name: /install and restart/i }));

    expect(await screen.findByText(/could not be installed/i)).toBeTruthy();
    expect(screen.getByText(/signature mismatch/i)).toBeTruthy();
    expect(relaunch).not.toHaveBeenCalled();
  });
});
