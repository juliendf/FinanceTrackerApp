// @vitest-environment jsdom
/**
 * Providers page: the AI opt-in lives here, next to the endpoints it governs.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  listProviders: vi.fn(),
  getAllSettings: vi.fn(),
  setSettings: vi.fn(),
  setSetting: vi.fn(),
  setDefaultProvider: vi.fn(),
  deleteProvider: vi.fn(),
  getProviderKey: vi.fn(),
}));
vi.mock("../../../db/repositories/llmProviders", () => ({
  listProviders: () => repo.listProviders(),
  setDefaultProvider: (...a: unknown[]) => repo.setDefaultProvider(...a),
  deleteProvider: (...a: unknown[]) => repo.deleteProvider(...a),
  getProviderKey: () => repo.getProviderKey(),
}));
vi.mock("../../../db/repositories/settings", () => ({
  getAllSettings: () => repo.getAllSettings(),
  setSettings: (...a: unknown[]) => repo.setSettings(...a),
  setSetting: (...a: unknown[]) => repo.setSetting(...a),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => "reachable" }));

import { LlmProvidersPage } from "./LlmProvidersPage";
import { ToastProvider } from "../../layout/Toasts";

const PROVIDER = {
  id: 2,
  name: "Gemini",
  base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
  model: "gemini-3.8-flash",
  provider_type: "gemini",
  keychain_ref: "provider:2",
  is_default: 1,
  is_active: 1,
  created_at: "",
  updated_at: "",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <LlmProvidersPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  repo.listProviders.mockResolvedValue([PROVIDER]);
  repo.getAllSettings.mockResolvedValue({ ai_enabled: false, chat_streaming: true });
  repo.setSettings.mockResolvedValue(2);
  repo.setSetting.mockResolvedValue(undefined);
});

describe("LlmProvidersPage", () => {
  it("shows the AI switches with the stored values", async () => {
    renderPage();
    const enable = (await screen.findByLabelText("Enable AI features")) as HTMLInputElement;
    const stream = screen.getByLabelText("Stream answers as they arrive") as HTMLInputElement;
    expect(enable.checked).toBe(false);
    expect(stream.checked).toBe(true);
    // Streaming is meaningless while AI is off.
    expect(stream.disabled).toBe(true);
  });

  it("saves both switches and the standing instructions together", async () => {
    const user = userEvent.setup();
    renderPage();
    const enable = (await screen.findByLabelText("Enable AI features")) as HTMLInputElement;
    await user.click(enable);
    expect((screen.getByLabelText("Stream answers as they arrive") as HTMLInputElement).disabled).toBe(false);
    await user.type(
      screen.getByLabelText("Standing instructions"),
      "Show three risk categories.",
    );
    await user.click(screen.getByRole("button", { name: /save ai settings/i }));
    await waitFor(() =>
      expect(repo.setSettings).toHaveBeenCalledWith({
        ai_enabled: true,
        chat_streaming: true,
        custom_instructions: "Show three risk categories.",
      }),
    );
  });

  it("keeps Save disabled until something changes", async () => {
    renderPage();
    const button = (await screen.findByRole("button", { name: /save ai settings/i })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
