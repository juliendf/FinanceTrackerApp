// @vitest-environment jsdom
/**
 * Provider form: models are a curated list, not free text.
 *
 * Guards the behaviour the form was rebuilt for — loading the endpoint's models,
 * switching some off, and saving that selection with the provider.
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getProvider: vi.fn(),
  listProviderModels: vi.fn(),
  getProviderKey: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  setDefaultProvider: vi.fn(),
}));
vi.mock("../../../db/repositories/llmProviders", () => ({
  getProvider: () => repo.getProvider(),
  listProviderModels: () => repo.listProviderModels(),
  getProviderKey: () => repo.getProviderKey(),
  createProvider: (...args: unknown[]) => repo.createProvider(...args),
  updateProvider: (...args: unknown[]) => repo.updateProvider(...args),
  deleteProvider: () => repo.deleteProvider(),
  setDefaultProvider: (...args: unknown[]) => repo.setDefaultProvider(...args),
}));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { LlmProviderFormPage } from "./LlmProviderFormPage";
import { ToastProvider } from "../../layout/Toasts";

const PROVIDER = {
  id: 2,
  name: "Ollama",
  base_url: "http://localhost:11434/v1",
  model: "qwen3.5:4b",
  provider_type: "openai",
  keychain_ref: null,
  is_default: 1,
  is_active: 1,
  created_at: "",
  updated_at: "",
};

function renderForm(path = "/settings/llm-providers/2/edit") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/settings/llm-providers/:providerId/edit" element={<LlmProviderFormPage />} />
            <Route path="/settings/llm-providers/new" element={<LlmProviderFormPage />} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  repo.getProvider.mockResolvedValue(PROVIDER);
  repo.getProviderKey.mockResolvedValue(null);
  repo.updateProvider.mockResolvedValue(undefined);
  repo.listProviderModels.mockResolvedValue([
    { provider_id: 2, model: "qwen3.5:4b", enabled: 1 },
    { provider_id: 2, model: "llama3.1:8b", enabled: 0 },
  ]);
  invoke.mockImplementation(async (command: string) => {
    if (command === "list_models") return ["qwen3.5:4b", "llama3.1:8b", "ministral-3:8b"];
    return "reachable";
  });
});

describe("LlmProviderFormPage", () => {
  it("shows the provider's models with their saved switches", async () => {
    renderForm();
    const group = await screen.findByRole("group", { name: "Available models" });
    const boxes = within(group).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    const byLabel = (model: string) =>
      within(group).getByText(model).closest("label")!.querySelector("input") as HTMLInputElement;
    expect(byLabel("qwen3.5:4b").checked).toBe(true);
    expect(byLabel("llama3.1:8b").checked).toBe(false);
    // Fetched models the form has not seen before arrive enabled.
    expect(byLabel("ministral-3:8b").checked).toBe(true);
  });

  it("asks the provider's own endpoint, not the form default", async () => {
    // The regression: the automatic load on open ran before the draft was seeded
    // and queried the default localhost URL, pulling one provider's models into
    // another provider's form.
    repo.getProvider.mockResolvedValue({
      ...PROVIDER,
      id: 2,
      name: "Gemini",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.8-flash",
    });
    renderForm();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("list_models", {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: null,
      }),
    );
    // And the default model stays the provider's own, not the first fetched.
    expect((screen.getByLabelText("Default model") as HTMLSelectElement).value).toBe("gemini-3.8-flash");
  });

  it("keeps the list when the endpoint answers with nothing", async () => {
    invoke.mockImplementation(async (command: string) => (command === "list_models" ? [] : "reachable"));
    renderForm();
    const group = await screen.findByRole("group", { name: "Available models" });
    // The saved rows survive an empty answer.
    expect(within(group).getByText("qwen3.5:4b")).toBeTruthy();
    expect(within(group).getByText("llama3.1:8b")).toBeTruthy();
  });

  it("saves the enabled selection with the provider", async () => {
    const user = userEvent.setup();
    renderForm();
    const group = await screen.findByRole("group", { name: "Available models" });
    const row = within(group).getByText("ministral-3:8b").closest("label")!;
    await user.click(within(row).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /save provider/i }));

    await waitFor(() => expect(repo.updateProvider).toHaveBeenCalledTimes(1));
    const [id, input] = repo.updateProvider.mock.calls[0] as [number, { models: Array<{ model: string; enabled: boolean }> }];
    expect(id).toBe(2);
    expect(input.models).toEqual([
      { model: "qwen3.5:4b", enabled: true },
      { model: "llama3.1:8b", enabled: false },
      { model: "ministral-3:8b", enabled: false },
    ]);
  });

  it("turns every model off and refuses to save", async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByRole("group", { name: "Available models" });
    await user.click(screen.getByRole("button", { name: "Disable all" }));
    await user.click(screen.getByRole("button", { name: /save provider/i }));
    expect(await screen.findByText("Enable at least one model")).toBeTruthy();
    expect(repo.updateProvider).not.toHaveBeenCalled();
  });

  it("offers Save in the page header, not only at the end of the form", async () => {
    renderForm();
    const headerSave = await screen.findByRole("button", { name: "Save" });
    expect(headerSave.getAttribute("form")).toBe("provider-form");
    expect(document.getElementById("provider-form")).toBeTruthy();
  });

  it("asks for no provider type and detects Gemini from the URL", async () => {
    const user = userEvent.setup();
    repo.getProvider.mockResolvedValue({ ...PROVIDER, base_url: "https://generativelanguage.googleapis.com/v1beta/openai" });
    renderForm();
    expect(screen.queryByLabelText("Provider Type")).toBeNull();
    expect(await screen.findByText(/Gemini detected/)).toBeTruthy();

    // Switching the URL back to a local endpoint removes the note.
    const url = screen.getByLabelText("Base URL") as HTMLInputElement;
    await user.clear(url);
    await user.type(url, "http://localhost:1234/v1");
    await waitFor(() => expect(screen.queryByText(/Gemini detected/)).toBeNull());
  });
});
