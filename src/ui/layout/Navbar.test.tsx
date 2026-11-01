// @vitest-environment jsdom
/**
 * The account menu is not a second navigation.
 *
 * Navigation lives in the sidebar; the top-right menu is for the two things that
 * are not sections — your profile and the About box. It used to link to Settings
 * as well, which duplicated the sidebar entry.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("Navbar account menu", () => {
  it("offers Profile and About, but not Settings", async () => {
    const user = userEvent.setup();
    // AboutModal asks the app for its version and database path.
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

    await user.click(screen.getByRole("button", { name: /you/i }));
    expect(await screen.findByRole("link", { name: "Profile" })).toBeTruthy();
    expect(screen.getByText("About FinanceTracker")).toBeTruthy();
    // Settings belongs to the sidebar only.
    expect(screen.queryByRole("link", { name: /^settings$/i })).toBeNull();
  });
});
