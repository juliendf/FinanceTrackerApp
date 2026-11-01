// @vitest-environment jsdom
/**
 * The toolbar is not a second navigation.
 *
 * It carries the app name, the theme toggle and a direct link to your profile.
 * Settings stays in the sidebar, and About lives next to the version in the
 * sidebar footer.
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
  it("links straight to the profile and offers no menu", async () => {
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

    const you = screen.getByRole("link", { name: /you/i });
    expect(you.getAttribute("href")).toBe("/profile");
    // No dropdown, and no duplicate Settings entry.
    expect(screen.queryByRole("button", { name: /you/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
  });
});
