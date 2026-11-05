// @vitest-environment jsdom
/** Chat page: the AI opt-in gate and the confirm/reject cards. */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
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
  setConversationPinned: vi.fn(),
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
  setConversationPinned: (...a: unknown[]) => repo.setConversationPinned(...a),
  listPendingActions: vi.fn(),
}));
vi.mock("../../../db/repositories/llmProviders", () => ({
  listActiveProviders: () => repo.listActiveProviders(),
  getDefaultProvider: () => repo.getDefaultProvider(),
  getProviderKey: () => repo.getProviderKey(),
  listEnabledModels: async () => ["qwen"],
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
const transportCancel = vi.hoisted(() => vi.fn());
vi.mock("../../../llm/transport", () => ({
  rustTransport: () => Object.assign(async () => ({ content: "", toolCalls: [], cancelled: false }), { cancel: transportCancel }),
}));

import { ChatPage } from "./ChatPage";
import { clearRunningTurns } from "./runningTurns";
import { ToastProvider } from "../../layout/Toasts";

const PROVIDER = { id: 2, name: "Ollama", base_url: "http://localhost:11434/v1", model: "qwen", provider_type: "openai", keychain_ref: null, is_default: 1, is_active: 1, created_at: "", updated_at: "" };
const CONVERSATION = { id: 5, provider_id: 2, model_override: null, title: "Portfolio question", pinned_at: null, created_at: "", updated_at: "" };

/** Test-only: lets a test walk to another conversation without a real router. */
function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go to {to}
    </button>
  );
}

function renderChat(start = "/chat/5") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[start]}>
          <GoTo to="/chat/6" />
          <GoTo to="/chat/5" />
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
  clearRunningTurns();
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

  it("edits a sent message, rewinds to it and asks again", async () => {
    const user = userEvent.setup();
    repo.deleteMessageFrom.mockResolvedValue(undefined);
    repo.sendMessage.mockResolvedValue({ answer: "New answer", pendingActions: [], cancelled: false, rounds: 1 });
    renderChat();
    await waitFor(() => expect(screen.getByText("set my account to 1234")).toBeTruthy());

    await user.click(screen.getByTitle("Edit this message and regenerate the answer"));
    // The rewind is destructive, so the editor says so before the click.
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();

    const box = screen.getByDisplayValue("set my account to 1234");
    await user.clear(box);
    await user.type(box, "set my account to 4321");
    await user.click(screen.getByRole("button", { name: /save & regenerate/i }));

    await waitFor(() => expect(repo.deleteMessageFrom).toHaveBeenCalledWith(1));
    await waitFor(() => expect(repo.sendMessage).toHaveBeenCalled());
    // Rewind first, then ask: the new question must not be sent into the old branch.
    expect(repo.deleteMessageFrom.mock.invocationCallOrder[0])
      .toBeLessThan(repo.sendMessage.mock.invocationCallOrder[0]);
    expect(repo.sendMessage.mock.calls[0][0].text).toBe("set my account to 4321");
  });

  it("cancels an edit without touching the conversation", async () => {
    const user = userEvent.setup();
    renderChat();
    await waitFor(() => expect(screen.getByText("set my account to 1234")).toBeTruthy());

    await user.click(screen.getByTitle("Edit this message and regenerate the answer"));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(repo.deleteMessageFrom).not.toHaveBeenCalled();
    expect(screen.getByText("set my account to 1234")).toBeTruthy();
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

  it("never shows tool calls or a thinking placeholder", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    repo.sendMessage.mockImplementation(async (options: { onEvent: (event: unknown) => void }) => {
      options.onEvent({ type: "toolCall", id: "c1", name: "get_portfolio_summary", arguments: "{}" });
      options.onEvent({ type: "delta", content: "Your portfolio is " });
      options.onEvent({ type: "delta", content: "406,860.98 CHF." });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "Your portfolio is 406,860.98 CHF.", pendingActions: [], cancelled: false, rounds: 1 };
    });

    const { container } = renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    // The box stays disabled until the provider list has loaded.
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(container.textContent).toContain("406,860.98 CHF"));
    expect(container.textContent).not.toMatch(/using/i);
    expect(container.textContent).not.toMatch(/thinking/i);
    expect(container.textContent).not.toContain("get_portfolio_summary");

    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
  });

  it("renders markdown tables from the answer", async () => {
    repo.listMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "compare", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
      {
        id: 2,
        conversation_id: 5,
        role: "assistant",
        content: "| Asset | Value |\n| --- | ---: |\n| Bourse | 113,627.08 |\n| SCPI | 32,553.13 |",
        tool_calls: null,
        tool_call_id: null,
        created_at: "",
        updated_at: "",
      },
    ]);
    const { container } = renderChat();
    await waitFor(() => expect(container.querySelector(".msg-assistant table")).toBeTruthy());
    const rows = container.querySelectorAll(".msg-assistant table tr");
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain("Bourse");
    expect(rows[1].textContent).toContain("113,627.08");

    // A wide table scrolls inside the bubble; it must not widen the conversation,
    // which used to force a sideways drag to read a row.
    const wrapper = container.querySelector(".msg-assistant .md-table-scroll");
    expect(wrapper).toBeTruthy();
    expect(wrapper?.querySelector("table")).toBeTruthy();
  });

  it("shows a spinner and no partial text when streaming is turned off", async () => {
    const user = userEvent.setup();
    repo.getAllSettings.mockResolvedValue({ ai_enabled: true, chat_streaming: false, base_currency: "CHF" });

    let release!: () => void;
    let emit!: (event: unknown) => void;
    repo.sendMessage.mockImplementation(async (options: { onEvent: (event: unknown) => void }) => {
      emit = options.onEvent;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "Full answer.", pendingActions: [], cancelled: false, rounds: 0 };
    });

    const { container } = renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("status", { name: "Generating" })).toBeTruthy();

    // Tokens arrive but must not be rendered while the setting is off.
    emit({ type: "delta", content: "Full answ" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).not.toContain("Full answ");
    expect(screen.getByRole("status", { name: "Generating" })).toBeTruthy();

    release();
    await waitFor(() => expect(screen.queryByRole("status", { name: "Generating" })).toBeNull());
  });

  it("clears the preamble when a tool round starts", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    let emit!: (event: unknown) => void;
    repo.sendMessage.mockImplementation(async (options: { onEvent: (event: unknown) => void }) => {
      emit = options.onEvent;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "Final.", pendingActions: [], cancelled: false, rounds: 1 };
    });

    const { container } = renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    emit({ type: "delta", content: "Let me look that up. " });
    await waitFor(() => expect(container.textContent).toContain("Let me look that up."));

    emit({ type: "toolCall", id: "c1", name: "get_portfolio_summary", arguments: "{}" });
    await waitFor(() => expect(container.textContent).not.toContain("Let me look that up."));

    emit({ type: "delta", content: "Your portfolio is 406,860.98 CHF." });
    await waitFor(() => expect(container.textContent).toContain("Your portfolio is 406,860.98 CHF."));
    expect(container.textContent).not.toContain("Let me look that up.");

    release();
  });

  it("batches streamed tokens into one bubble", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    let emit!: (event: unknown) => void;
    repo.sendMessage.mockImplementation(async (options: { onEvent: (event: unknown) => void }) => {
      emit = options.onEvent;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "done", pendingActions: [], cancelled: false, rounds: 1 };
    });

    const { container } = renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    // 40 tokens in the same tick: one flush, one bubble, no repeated rerenders.
    const words = Array.from({ length: 40 }, (_, index) => `w${index} `);
    for (const word of words) emit({ type: "delta", content: word });
    await waitFor(() => expect(container.textContent).toContain("w39"));

    // The transcript already holds one answer; the streaming one is the last.
    const assistantBubbles = container.querySelectorAll(".msg-bubble.msg-assistant");
    const streaming = assistantBubbles[assistantBubbles.length - 1];
    expect(streaming.textContent).toContain("w0 w1 ");
    expect(streaming.textContent).toContain("w39 ");
    // One copy of the text, not one per delta.
    expect(container.textContent?.match(/w0 /g)).toHaveLength(1);
    // Plain text while streaming, so nothing re-parses markdown per flush.
    expect(streaming.querySelector("p")).toBeNull();

    release();
  });

  it("does not carry a running answer into another conversation", async () => {
    // The bug: a turn belongs to the conversation it started in, but its spinner,
    // its Stop button and its text followed the user into whichever chat they
    // opened next.
    const user = userEvent.setup();
    let release!: () => void;
    let emit!: (event: unknown) => void;
    repo.sendMessage.mockImplementation(async (options: { onEvent: (event: unknown) => void }) => {
      emit = options.onEvent;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "Old answer", pendingActions: [], cancelled: true, rounds: 1 };
    });

    const { container } = renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    emit({ type: "delta", content: "Old answer" });
    await waitFor(() => expect(container.textContent).toContain("Old answer"));

    await user.click(screen.getByRole("button", { name: /go to \/chat\/6/ }));

    // The new conversation shows neither the spinner nor the previous text.
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.textContent).not.toContain("Old answer");
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();

    // Late deltas from the abandoned turn do not appear here either.
    emit({ type: "delta", content: "still arriving" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(container.textContent).not.toContain("still arriving");

    release();
  });

  it("keeps generating after the user leaves, and re-attaches on return", async () => {
    // The bug: leaving the chat cancelled the request, so a slow local model
    // pinned the user to the screen until the answer arrived.
    const user = userEvent.setup();
    let release!: () => void;
    let emit!: (event: unknown) => void;
    repo.sendMessage.mockImplementation(async (options: { onEvent: (event: unknown) => void }) => {
      emit = options.onEvent;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "Saved answer", pendingActions: [], cancelled: false, rounds: 1 };
    });

    renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    emit({ type: "delta", content: "Partial" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy());

    // Leaving the conversation no longer cancels the turn.
    await user.click(screen.getByRole("button", { name: /go to \/chat\/6/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    expect(transportCancel).not.toHaveBeenCalled();

    // Coming back while it still runs re-attaches, so Stop is reachable again.
    await user.click(screen.getByRole("button", { name: /go to \/chat\/5/ }));
    expect(await screen.findByRole("button", { name: "Stop" })).toBeTruthy();

    release();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
  });

  it("announces an answer that lands while the user is elsewhere, with a way back", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    repo.sendMessage.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "Saved answer", pendingActions: [], cancelled: false, rounds: 1 };
    });

    renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    // Walk away, then let the turn finish.
    await user.click(screen.getByRole("button", { name: /go to \/chat\/6/ }));
    release();

    await waitFor(() => expect(screen.getByText("Answer ready")).toBeTruthy());
    expect(screen.getByText(/"Portfolio question" is ready\./)).toBeTruthy();
    // A hash route, so the interceptor leaves it alone and it navigates in-app.
    expect(screen.getByRole("link", { name: "Open chat" }).getAttribute("href")).toBe("#/chat/5");
  });

  it("stays quiet when the answer lands on the page the user is on", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    repo.sendMessage.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "Saved answer", pendingActions: [], cancelled: false, rounds: 1 };
    });

    renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    release();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    // The answer is on screen; a notification would be noise.
    expect(screen.queryByText("Answer ready")).toBeNull();
  });

  it("says what it is doing while a tool runs", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    let emit!: (event: unknown) => void;
    repo.sendMessage.mockImplementation(async (options: { onEvent: (event: unknown) => void }) => {
      emit = options.onEvent;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "Your portfolio is 406,860.98 CHF.", pendingActions: [], cancelled: false, rounds: 1 };
    });

    const { container } = renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    emit({ type: "toolCall", id: "c1", name: "get_portfolio_summary", arguments: "{}" });
    expect(await screen.findByText("Looking up your portfolio…")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Looking up your portfolio…" })).toBeTruthy();

    // Streaming on: the status disappears as soon as words arrive. The words
    // themselves land on the next flush (~60 ms), not on the same tick.
    emit({ type: "delta", content: "Your portfolio is " });
    await waitFor(() => expect(screen.queryByText("Looking up your portfolio…")).toBeNull());
    await waitFor(() => expect(container.textContent).toContain("Your portfolio is"));

    release();
  });

  it("names the tool in the spinner even with streaming off", async () => {
    const user = userEvent.setup();
    repo.getAllSettings.mockResolvedValue({ ai_enabled: true, chat_streaming: false, base_currency: "CHF" });
    let release!: () => void;
    let emit!: (event: unknown) => void;
    repo.sendMessage.mockImplementation(async (options: { onEvent: (event: unknown) => void }) => {
      emit = options.onEvent;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { answer: "done", pendingActions: [], cancelled: false, rounds: 1 };
    });

    renderChat();
    const input = (await screen.findByPlaceholderText("Ask about your finances...")) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.type(input, "how much?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    emit({ type: "toolCall", id: "c1", name: "get_allocation", arguments: "{}" });
    expect(await screen.findByText("Breaking down your allocation…")).toBeTruthy();

    emit({ type: "delta", content: "Here it is" });
    expect(await screen.findByText("Writing the answer…")).toBeTruthy();
    release();
  });

  it("lists sessions with a header and a search box", async () => {
    renderChat();
    expect(await screen.findByText("Sessions")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search")).toBeTruthy();
    // The single mocked conversation is the active one.
    expect(await screen.findByRole("button", { name: "Portfolio question" })).toBeTruthy();
  });

  it("filters the session list by title", async () => {
    const user = userEvent.setup();
    repo.listConversations.mockResolvedValue([
      CONVERSATION,
      { id: 6, provider_id: 2, model_override: null, title: "Allocation check", created_at: "", updated_at: "" },
    ]);
    renderChat();
    await screen.findByText("Allocation check");
    await user.type(screen.getByPlaceholderText("Search"), "alloc");
    await waitFor(() => expect(screen.queryByText("Portfolio question")).toBeNull());
    expect(screen.getByText("Allocation check")).toBeTruthy();

    await user.clear(screen.getByPlaceholderText("Search"));
    await user.type(screen.getByPlaceholderText("Search"), "zzz");
    expect(await screen.findByText("No session matches.")).toBeTruthy();
  });

  it("offers the suggested prompts", async () => {
    renderChat();
    expect(await screen.findByText("Portfolio review")).toBeTruthy();
    expect(screen.getByText("Stress test")).toBeTruthy();
  });
});
