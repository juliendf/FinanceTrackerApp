// @vitest-environment jsdom
/** Chat page: the AI opt-in gate and the confirm/reject cards. */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  deleteMessageFrom: vi.fn(),
  renameConversation: vi.fn(),
  setConversationProvider: vi.fn(),
  setConversationModel: vi.fn(),
  listActiveProviders: vi.fn(),
  getDefaultProvider: vi.fn(),
  getProviderKey: vi.fn(),
  getAllSettings: vi.fn(),
  confirmAction: vi.fn(),
  rejectAction: vi.fn(),
  loadPendingActions: vi.fn(),
  sendMessage: vi.fn(),
  extractMemories: vi.fn(),
}));

vi.mock("../../../db/repositories/chat", () => ({
  listConversations: () => repo.listConversations(),
  getConversation: () => repo.getConversation(),
  listMessages: () => repo.listMessages(),
  createConversation: (...a: unknown[]) => repo.createConversation(...a),
  deleteConversation: (...a: unknown[]) => repo.deleteConversation(...a),
  deleteMessageFrom: (...a: unknown[]) => repo.deleteMessageFrom(...a),
  renameConversation: (...a: unknown[]) => repo.renameConversation(...a),
  setConversationProvider: (...a: unknown[]) => repo.setConversationProvider(...a),
  setConversationModel: (...a: unknown[]) => repo.setConversationModel(...a),
  listPendingActions: vi.fn(),
}));
vi.mock("../../../db/repositories/llmProviders", () => ({
  listActiveProviders: () => repo.listActiveProviders(),
  getDefaultProvider: () => repo.getDefaultProvider(),
  getProviderKey: () => repo.getProviderKey(),
}));
vi.mock("../../../db/repositories/settings", () => ({ getAllSettings: () => repo.getAllSettings() }));
vi.mock("../../../llm/service", () => ({
  sendMessage: (...a: unknown[]) => repo.sendMessage(...a),
  confirmAction: (...a: unknown[]) => repo.confirmAction(...a),
  rejectAction: (...a: unknown[]) => repo.rejectAction(...a),
  loadPendingActions: () => repo.loadPendingActions(),
  extractMemories: (...a: unknown[]) => repo.extractMemories(...a),
  providerApiKey: async () => null,
}));
vi.mock("../../../llm/transport", () => ({ rustTransport: () => Object.assign(async () => ({ content: "", toolCalls: [], cancelled: false }), { cancel: vi.fn() }) }));

import { ChatPage } from "./ChatPage";
import { ToastProvider } from "../../layout/Toasts";

const PROVIDER = { id: 2, name: "Ollama", base_url: "http://localhost:11434/v1", model: "qwen", provider_type: "openai", keychain_ref: null, is_default: 1, is_active: 1, created_at: "", updated_at: "" };
const CONVERSATION = { id: 5, provider_id: 2, model_override: null, title: "Portfolio question", created_at: "", updated_at: "" };

function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/chat/5"]}>
          <Routes>
            <Route path="/chat/:conversationId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  repo.getAllSettings.mockResolvedValue({ ai_enabled: true, base_currency: "CHF" });
  repo.listConversations.mockResolvedValue([CONVERSATION]);
  repo.getConversation.mockResolvedValue(CONVERSATION);
  repo.listMessages.mockResolvedValue([
    { id: 1, conversation_id: 5, role: "user", content: "set my account to 1234", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    { id: 2, conversation_id: 5, role: "assistant", content: "Confirm the card **below**.", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
  ]);
  repo.listActiveProviders.mockResolvedValue([PROVIDER]);
  repo.loadPendingActions.mockResolvedValue([
    { id: 9, action_type: "create_snapshot", asset_name: "UBS - Compte (Cash)", amount: 1234, currency: "CHF", date: "2026-10-31" },
  ]);
  repo.confirmAction.mockResolvedValue({ success: true, resultMessage: "Snapshot created." });
  repo.rejectAction.mockResolvedValue({ success: true, resultMessage: "Cancelled, nothing was saved." });
});

describe("ChatPage", () => {
  it("blocks chat until AI is enabled in settings", async () => {
    repo.getAllSettings.mockResolvedValue({ ai_enabled: false, base_currency: "CHF" });
    renderChat();
    expect(await screen.findByText(/AI is off/)).toBeTruthy();
    expect((screen.getByPlaceholderText("Ask about your finances...") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("renders the transcript with markdown", async () => {
    const { container } = renderChat();
    await waitFor(() => expect(container.querySelector(".msg-assistant strong")).toBeTruthy());
    expect(container.querySelector(".msg-assistant")?.textContent).toBe("Confirm the card below.");
  });

  it("shows the pending card and confirms it", async () => {
    const user = userEvent.setup();
    renderChat();
    expect(await screen.findByText(/UBS - Compte/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(repo.confirmAction).toHaveBeenCalledWith(9));
  });

  it("rejects without writing", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText(/UBS - Compte/);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(repo.rejectAction).toHaveBeenCalledWith(9));
    expect(repo.confirmAction).not.toHaveBeenCalled();
  });

  it("offers the suggested prompts", async () => {
    renderChat();
    expect(await screen.findByText("Portfolio review")).toBeTruthy();
    expect(screen.getByText("Stress test")).toBeTruthy();
  });
});
