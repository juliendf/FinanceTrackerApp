// @vitest-environment jsdom
/** About modal: version, name and the database path, all from Tauri. */

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({
  getName: async () => "FinanceTracker",
  getVersion: async () => "0.1.0",
  getTauriVersion: async () => "2.12.4",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => "/Users/test/Library/Application Support/app.financetracker/financetracker.db",
}));

import { AboutModal } from "./AboutModal";

afterEach(cleanup);

describe("AboutModal", () => {
  it("shows the version and the database path", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AboutModal show onHide={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("About FinanceTracker")).toBeTruthy();
    expect(await screen.findByText(/Version 0.1.0/)).toBeTruthy();
    expect(screen.getByText(/Tauri 2.12.4/)).toBeTruthy();
    expect(await screen.findByText(/financetracker\.db/)).toBeTruthy();
  });
});
