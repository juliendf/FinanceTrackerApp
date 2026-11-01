// @vitest-environment jsdom
/**
 * The toolbar is not a second navigation.
 *
 * It carries the app name and the theme toggle, and no navigation: profile and
 * settings are both in the sidebar, and About sits next to the version.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({
  getName: async () => "FinanceTracker",
  getVersion: async () => "0.3.0",
  getTauriVersion: async () => "2",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => "/tmp/db" }));

import { Navbar } from "./Navbar";
import { ToastProvider } from "./Toasts";

afterEach(cleanup);

describe("Navbar", () => {
  it("holds no navigation at all", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <Navbar />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );

    // The theme toggle stays; destinations do not.
    expect(screen.getByRole("button", { name: /theme/i })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /you/i })).toBeNull();
  });
});
