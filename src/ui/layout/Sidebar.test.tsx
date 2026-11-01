// @vitest-environment jsdom
/** Sidebar: navigation plus About next to the version it reports. */

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

import { Sidebar } from "./Sidebar";

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Sidebar collapsed={false} onToggle={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("Sidebar", () => {
  it("keeps Settings in the sidebar and About in the footer", async () => {
    renderSidebar();
    expect(await screen.findByRole("link", { name: /settings/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "About FinanceTracker" })).toBeTruthy();
  });

  it("opens the About box from the version line", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "About FinanceTracker" }));
    expect(await screen.findByText("About FinanceTracker", { selector: ".modal-title" })).toBeTruthy();
  });
});
