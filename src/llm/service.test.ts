/**
 * Service-level behaviour, with the database mocked: what gets persisted, and
 * — the red-team property — that nothing is written until a card is confirmed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getConversation: vi.fn(),
  appendMessage: vi.fn(),
  renameConversation: vi.fn(),
  listRecentMessages: vi.fn(),
  listMessages: vi.fn(),
  getPendingAction: vi.fn(),
  claimPendingAction: vi.fn(),
  resolvePendingAction: vi.fn(),
  listPendingActions: vi.fn(),
  createPendingAction: vi.fn(),
  getDefaultProvider: vi.fn(),
  getProviderKey: vi.fn(),
  getProfile: vi.fn(),
  listGoals: vi.fn(),
  listTopMemories: vi.fn(),
  listMemories: vi.fn(),
  createMemory: vi.fn(),
  getAllSettings: vi.fn(),
  listAssets: vi.fn(),
  getSnapshotOn: vi.fn(),
  createSnapshot: vi.fn(),
  updateSnapshot: vi.fn(),
}));

vi.mock("../db/repositories/chat", () => ({
  getConversation: () => repo.getConversation(),
  appendMessage: (...a: unknown[]) => repo.appendMessage(...a),
  renameConversation: (...a: unknown[]) => repo.renameConversation(...a),
  listRecentMessages: () => repo.listRecentMessages(),
  listMessages: () => repo.listMessages(),
  getPendingAction: () => repo.getPendingAction(),
  claimPendingAction: (...a: unknown[]) => repo.claimPendingAction(...a),
  resolvePendingAction: (...a: unknown[]) => repo.resolvePendingAction(...a),
  listPendingActions: () => repo.listPendingActions(),
  createPendingAction: (...a: unknown[]) => repo.createPendingAction(...a),
}));
vi.mock("../db/repositories/llmProviders", () => ({
  getDefaultProvider: () => repo.getDefaultProvider(),
  getProviderKey: () => repo.getProviderKey(),
}));
vi.mock("../db/repositories/profile", () => ({
  getProfile: () => repo.getProfile(),
  listGoals: () => repo.listGoals(),
  listTopMemories: () => repo.listTopMemories(),
  listMemories: () => repo.listMemories(),
  createMemory: (...a: unknown[]) => repo.createMemory(...a),
}));
vi.mock("../db/repositories/settings", () => ({ getAllSettings: () => repo.getAllSettings() }));
vi.mock("../db/repositories/assets", () => ({ listAssets: () => repo.listAssets() }));
vi.mock("../db/repositories/snapshots", () => ({
  getSnapshotOn: (...a: unknown[]) => repo.getSnapshotOn(...a),
  createSnapshot: (...a: unknown[]) => repo.createSnapshot(...a),
  updateSnapshot: (...a: unknown[]) => repo.updateSnapshot(...a),
}));

import {
  confirmAction,
  extractMemories,
  loadPendingActions,
  rejectAction,
  sendMessage,
  summariseConversation,
  SUMMARY_HEADING,
} from "./service";
import type { ChatTransport } from "./chatLoop";

const transportWith = (
  responses: Array<{
    content?: string;
    calls?: Array<{ id: string; name: string; arguments: string; extraContent?: unknown }>;
  }>,
): ChatTransport => {
  let index = 0;
  return async () => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      content: response.content ?? "",
      toolCalls: (response.calls ?? []).map((call) => ({ ...call })),
      cancelled: false,
    };
  };
};

const PROVIDER = { id: 2, name: "Ollama", base_url: "http://localhost:11434/v1", model: "qwen", provider_type: "openai", keychain_ref: null, is_default: 1, is_active: 1, created_at: "", updated_at: "" };

beforeEach(() => {
  vi.clearAllMocks();
  repo.claimPendingAction.mockResolvedValue(true);
  // Implementations survive clearAllMocks, so reset the ones a test overrides.
  repo.getSnapshotOn.mockResolvedValue(null);
  repo.updateSnapshot.mockResolvedValue(undefined);
  repo.createSnapshot.mockResolvedValue(1);
  repo.resolvePendingAction.mockResolvedValue(undefined);
  repo.getConversation.mockResolvedValue({ id: 5, provider_id: 2, model_override: null, title: "New conversation", created_at: "", updated_at: "" });
  repo.getDefaultProvider.mockResolvedValue(PROVIDER);
  repo.getProfile.mockResolvedValue({
    first_name: "Julien", last_name: null, currency: "CHF", timezone: "Europe/Zurich", date_format: "%Y-%m-%d",
    salary_minor: null, monthly_savings_target_minor: null, risk_profile: null,
    ai_tone: "direct", ai_verbosity: "concise", ai_expertise: "expert",
  });
  repo.listGoals.mockResolvedValue([]);
  repo.listTopMemories.mockResolvedValue([]);
  repo.listMemories.mockResolvedValue([]);
  repo.getAllSettings.mockResolvedValue({ base_currency: "CHF" });
  repo.listRecentMessages.mockResolvedValue([]);
  repo.appendMessage.mockResolvedValue(1);
  repo.listAssets.mockResolvedValue([
    { id: 1, product_name: "P", name: null, currency: "CHF", institution_name: "UBS", category_name: "Cash" },
  ]);
});

describe("sendMessage", () => {
  it("persists the user message, titles the conversation and saves the answer", async () => {
    const result = await sendMessage({
      conversationId: 5,
      text: "How is my portfolio?",
      transport: transportWith([{ content: "Fine." }]),
      requestId: "r1",
      today: "2026-10-31",
    });
    expect(result.answer).toBe("Fine.");
    expect(repo.appendMessage).toHaveBeenNthCalledWith(1, { conversationId: 5, role: "user", content: "How is my portfolio?" });
    expect(repo.renameConversation).toHaveBeenCalledWith(5, "How is my portfolio?");
    expect(repo.appendMessage).toHaveBeenLastCalledWith({ conversationId: 5, role: "assistant", content: "Fine." });
  });

  it("sends a system prompt built from the profile and style", async () => {
    // The loop replays the persisted window, which now holds the user message.
    repo.listRecentMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "hi", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    ]);
    let seen: Array<{ role: string; content: string }> = [];
    const transport: ChatTransport = async (input) => {
      seen = [...(input.messages as Array<{ role: string; content: string }>)];
      return { content: "ok", toolCalls: [], cancelled: false };
    };
    await sendMessage({ conversationId: 5, text: "hi", transport, requestId: "r", today: "2026-10-31" });
    expect(seen[0].role).toBe("system");
    expect(seen[0].content).toContain("Today is 2026-10-31");
    expect(seen[0].content).toContain("Tone: direct. Verbosity: concise.");
    expect(seen[1]).toEqual({ role: "user", content: "hi" });
  });

  it("persists the tool exchange and returns the staged card without writing", async () => {
    const createSnapshot = vi.fn();
    const result = await sendMessage({
      conversationId: 5,
      text: "set my UBS account to 1234.56",
      transport: transportWith([
        { calls: [{ id: "c1", name: "propose_snapshot", arguments: '{"asset_id":1,"amount":1234.56}' }] },
        { content: "Confirm the card to save it." },
      ]),
      requestId: "r",
      today: "2026-10-31",
      execute: async () => ({
        result: {
          pending_action_id: 9,
          asset_name: "UBS - P (Cash)",
          amount: 1234.56,
          currency: "CHF",
          date: "2026-10-31",
          action_type: "create_snapshot",
        },
        summary: "proposed",
      }),
    });

    expect(createSnapshot).not.toHaveBeenCalled();
    expect(result.pendingActions).toEqual([
      { id: 9, action_type: "create_snapshot", asset_name: "UBS - P (Cash)", amount: 1234.56, currency: "CHF", date: "2026-10-31" },
    ]);
    // The tool-call assistant row and the tool row were persisted as they happened.
    const roles = repo.appendMessage.mock.calls.map((call) => (call[0] as { role: string }).role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
    const toolRow = repo.appendMessage.mock.calls[2][0] as { toolCallId: string; content: string };
    expect(toolRow.toolCallId).toBe("c1");
    expect(JSON.parse(toolRow.content).pending_action_id).toBe(9);
  });

  it("persists the thought signature so a replayed history keeps it", async () => {
    const signature = { google: { thought_signature: "sig-abc" } };
    await sendMessage({
      conversationId: 5,
      text: "use a tool",
      transport: transportWith([
        { calls: [{ id: "c1", name: "get_portfolio_summary", arguments: "{}", extraContent: signature }] },
        { content: "done" },
      ]),
      requestId: "r",
      execute: async () => ({ result: { total_value_base: 1 }, summary: "ok" }),
    });
    const assistantRow = repo.appendMessage.mock.calls.find(
      (call) => (call[0] as { role: string }).role === "assistant" && (call[0] as { toolCalls?: string }).toolCalls,
    );
    const stored = JSON.parse((assistantRow![0] as { toolCalls: string }).toolCalls);
    expect(stored[0].extra_content).toEqual(signature);
  });

  it("refuses without a provider", async () => {
    repo.getDefaultProvider.mockResolvedValue(null);
    await expect(
      sendMessage({ conversationId: 5, text: "hi", transport: transportWith([{ content: "x" }]), requestId: "r" }),
    ).rejects.toThrow(/No LLM provider/);
    expect(repo.appendMessage).not.toHaveBeenCalled();
  });

  it("caps the message at 4000 characters", async () => {
    await sendMessage({
      conversationId: 5,
      text: "x".repeat(5000),
      transport: transportWith([{ content: "ok" }]),
      requestId: "r",
    });
    expect((repo.appendMessage.mock.calls[0][0] as { content: string }).content).toHaveLength(4000);
  });

  it("returns cancelled and saves no answer when stopped", async () => {
    const transport: ChatTransport = async () => ({ content: "", toolCalls: [], cancelled: true });
    const result = await sendMessage({ conversationId: 5, text: "hi", transport, requestId: "r" });
    expect(result.cancelled).toBe(true);
    expect(repo.appendMessage).toHaveBeenCalledTimes(1); // only the user message
  });
});

describe("pending actions", () => {
  const snapshotAction = {
    id: 9,
    conversation_id: 5,
    action_type: "create_snapshot",
    payload: JSON.stringify({ asset_id: 1, amount_minor: 123456, amount: 1234.56, date: "2026-10-31" }),
    status: "pending",
    result_message: null,
    resolved_at: null,
    created_at: "",
    updated_at: "",
  };

  it("claims the action before writing, and refuses a second confirm", async () => {
    repo.getPendingAction.mockResolvedValue(snapshotAction);
    repo.getSnapshotOn.mockResolvedValue(null);
    repo.createSnapshot.mockResolvedValue(3);

    await confirmAction(9);
    expect(repo.claimPendingAction).toHaveBeenCalledWith(9, "confirmed");
    expect(repo.createSnapshot).toHaveBeenCalledTimes(1);

    // Someone else already took it: the conditional UPDATE matched no row.
    repo.claimPendingAction.mockResolvedValue(false);
    const second = await confirmAction(9);
    expect(second.success).toBe(false);
    expect(second.resultMessage).toMatch(/already resolved/i);
    expect(repo.createSnapshot).toHaveBeenCalledTimes(1);
  });

  it("marks the action failed when the write throws", async () => {
    repo.getPendingAction.mockResolvedValue(snapshotAction);
    repo.getSnapshotOn.mockResolvedValue(null);
    repo.createSnapshot.mockRejectedValue(new Error("disk full"));

    const result = await confirmAction(9);
    expect(result.success).toBe(false);
    expect(repo.resolvePendingAction).toHaveBeenCalledWith(9, "failed", expect.stringContaining("disk full"));
  });

  it("confirm writes the snapshot and narrates", async () => {
    repo.getPendingAction.mockResolvedValue(snapshotAction);
    repo.getSnapshotOn.mockResolvedValue(null);
    repo.createSnapshot.mockResolvedValue(3);

    const result = await confirmAction(9);
    expect(repo.createSnapshot).toHaveBeenCalledWith(1, "2026-10-31", 123456);
    expect(repo.resolvePendingAction).toHaveBeenCalledWith(9, "confirmed", expect.stringContaining("Snapshot created"));
    expect(result.resultMessage).toContain("CHF 1,234.56");
    expect(repo.appendMessage).toHaveBeenCalledWith({
      conversationId: 5,
      role: "assistant",
      content: expect.stringContaining("Snapshot created"),
    });
  });

  it("confirm updates an existing snapshot on the same date", async () => {
    repo.getPendingAction.mockResolvedValue(snapshotAction);
    repo.getSnapshotOn.mockResolvedValue({ id: 4, asset_id: 1, date: "2026-10-31", amount_minor: 100000, created_at: "", updated_at: "" });

    const result = await confirmAction(9);
    expect(repo.updateSnapshot).toHaveBeenCalledWith(4, "2026-10-31", 123456);
    expect(result.wasUpdate).toBe(true);
  });

  it("reject claims the action, then writes nothing but the narration", async () => {
    repo.getPendingAction.mockResolvedValue(snapshotAction);
    const result = await rejectAction(9);
    expect(repo.claimPendingAction).toHaveBeenCalledWith(9, "rejected");
    expect(result.success).toBe(true);
    expect(repo.createSnapshot).not.toHaveBeenCalled();
    expect(repo.updateSnapshot).not.toHaveBeenCalled();
    expect(repo.createMemory).not.toHaveBeenCalled();
    expect(repo.resolvePendingAction).toHaveBeenCalledWith(9, "rejected", "Cancelled, nothing was saved.");
  });

  it("a resolved action cannot be confirmed twice", async () => {
    // The row is gone from `pending`, so the conditional claim matches nothing.
    repo.getPendingAction.mockResolvedValue({ ...snapshotAction, status: "confirmed" });
    repo.claimPendingAction.mockResolvedValue(false);
    const result = await confirmAction(9);
    expect(result.success).toBe(false);
    expect(repo.createSnapshot).not.toHaveBeenCalled();
  });

  it("confirming a memory writes it and links the conversation", async () => {
    repo.getPendingAction.mockResolvedValue({
      ...snapshotAction,
      action_type: "create_memory",
      payload: JSON.stringify({ category: "goal", key: "house", content: "User is saving for a house", importance: 5 }),
    });
    const result = await confirmAction(9);
    expect(repo.createMemory).toHaveBeenCalledWith({
      category: "goal",
      key: "house",
      content: "User is saving for a house",
      importance: 5,
      source: "ai_extracted",
      conversationId: 5,
    });
    expect(result.resultMessage).toContain("[goal]");
  });

  it("loads pending cards from their payloads", async () => {
    repo.listPendingActions.mockResolvedValue([
      snapshotAction,
      { ...snapshotAction, id: 10, action_type: "create_memory", payload: JSON.stringify({ category: "goal", key: "k", content: "c", importance: 4 }) },
    ]);
    const cards = await loadPendingActions(5);
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({ id: 10, action_type: "create_memory", category: "goal", importance: 4 });
  });
});

describe("extractMemories", () => {
  it("parses a JSON array out of prose", async () => {
    repo.listMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "I have two kids", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    ]);
    const transport: ChatTransport = async () => ({
      content: 'Here you go:\n[{"category":"personal","key":"kids","content":"User has two children","importance":4}]\nDone.',
      toolCalls: [],
      cancelled: false,
    });
    const proposals = await extractMemories(5, transport, "x");
    expect(proposals).toEqual([{ category: "personal", key: "kids", content: "User has two children", importance: 4 }]);
  });

  it("returns nothing for an empty array or unparseable output", async () => {
    repo.listMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "hi", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    ]);
    expect(await extractMemories(5, async () => ({ content: "[]", toolCalls: [], cancelled: false }), "x")).toEqual([]);
    expect(await extractMemories(5, async () => ({ content: "no json here", toolCalls: [], cancelled: false }), "x")).toEqual([]);
  });

  it("sends the extraction as a user turn, not a system-only request", async () => {
    // Gemini's OpenAI-compatible endpoint answers a request with no user message
    // with `500 no user query found in messages`.
    repo.listMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "I have two kids", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
      { id: 2, conversation_id: 5, role: "assistant", content: "Noted.", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    ]);
    const transport = vi.fn(async () => ({ content: "[]", toolCalls: [], cancelled: false }));

    await extractMemories(5, transport as unknown as ChatTransport, "x");

    const request = (transport.mock.calls[0] as unknown[])[0] as { messages: Array<{ role: string; content: string }> };
    expect(request.messages[0].role).toBe("system");
    const user = request.messages.filter((message) => message.role === "user");
    expect(user).toHaveLength(1);
    expect(user[0].content).toContain("[User]: I have two kids");
    expect(user[0].content).toContain("[Assistant]: Noted.");
  });

  it("drops proposals that repeat what the app already knows", async () => {
    // The failure behind this: extraction proposed the user's own name, their
    // existing goals and assets already in the table.
    repo.listMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "I have two kids and I am 38", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    ]);
    repo.listMemories.mockResolvedValue([
      { id: 1, category: "personal", key: "kids", content: "User has two children", source: "manual", conversation_id: null, importance: 4, created_at: "", updated_at: "" },
    ]);
    const transport: ChatTransport = async () => ({
      content: JSON.stringify([
        { category: "personal", key: "children", content: "User has two children.", importance: 4 },
        { category: "personal", key: "age", content: "User is 38 years old", importance: 3 },
      ]),
      toolCalls: [],
      cancelled: false,
    });

    const proposals = await extractMemories(5, transport, "x");
    expect(proposals.map((proposal) => proposal.key)).toEqual(["age"]);
  });

  it("collapses a fact proposed twice in one batch", async () => {
    repo.listMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "I sail", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    ]);
    const transport: ChatTransport = async () => ({
      content: JSON.stringify([
        { category: "preference", key: "sailing", content: "User likes sailing", importance: 3 },
        { category: "preference", key: "sailing", content: "User likes sailing", importance: 3 },
      ]),
      toolCalls: [],
      cancelled: false,
    });

    expect(await extractMemories(5, transport, "x")).toHaveLength(1);
  });

  it("tells the model what is already known", async () => {
    repo.listMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "hello", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    ]);
    repo.getProfile.mockResolvedValue({
      first_name: "Julien", last_name: null, job_title: "SRE", financial_goals: null,
      birth_date: null, tax_residence: "CH", monthly_expenses_minor: null, dependants_count: null,
      dependant_ages: null, employment_status: null,
      currency: "CHF", timezone: "Europe/Zurich", date_format: "%Y-%m-%d",
      salary_minor: null, monthly_savings_target_minor: null, risk_profile: null,
      ai_tone: "direct", ai_verbosity: "concise", ai_expertise: "expert",
    });
    repo.listMemories.mockResolvedValue([
      { id: 1, category: "personal", key: "kids", content: "User has two children", source: "manual", conversation_id: null, importance: 4, created_at: "", updated_at: "" },
    ]);
    const transport = vi.fn(async () => ({ content: "[]", toolCalls: [], cancelled: false }));

    await extractMemories(5, transport as unknown as ChatTransport, "x");

    const request = (transport.mock.calls[0] as unknown[])[0] as { messages: Array<{ role: string; content: string }> };
    const system = request.messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("## Already known");
    expect(system).toContain("job: SRE");
    expect(system).toContain("- kids: User has two children");
    expect(system).toContain("- UBS - P (Cash)");
  });

  it("does not call the model on an empty conversation", async () => {
    repo.listMessages.mockResolvedValue([]);
    const transport = vi.fn();
    expect(await extractMemories(5, transport, "x")).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("summariseConversation", () => {
  it("stores the summary in the conversation, marked as a summary", async () => {
    repo.listMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "Should I pay off the mortgage?", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
      { id: 2, conversation_id: 5, role: "assistant", content: "It depends on the rate.", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    ]);
    const transport: ChatTransport = async () => ({
      content: "Decided to compare the rate first.",
      toolCalls: [],
      cancelled: false,
    });

    const summary = await summariseConversation(5, transport, "s1");

    expect(summary).toBe("Decided to compare the rate first.");
    const stored = repo.appendMessage.mock.calls[0][0] as { role: string; content: string };
    expect(stored.role).toBe("assistant");
    // The heading is what makes it read as an artefact, not as an answer.
    expect(stored.content.startsWith(SUMMARY_HEADING)).toBe(true);
    expect(stored.content).toContain("Decided to compare the rate first.");
  });

  it("refuses an empty conversation instead of asking the model", async () => {
    repo.listMessages.mockResolvedValue([]);
    const transport = vi.fn(async () => ({ content: "x", toolCalls: [], cancelled: false }));
    await expect(summariseConversation(5, transport as unknown as ChatTransport, "s1")).rejects.toThrow(
      /nothing to summarise/i,
    );
    expect(transport).not.toHaveBeenCalled();
    expect(repo.appendMessage).not.toHaveBeenCalled();
  });

  it("writes nothing when the model returns an empty answer", async () => {
    repo.listMessages.mockResolvedValue([
      { id: 1, conversation_id: 5, role: "user", content: "hello", tool_calls: null, tool_call_id: null, created_at: "", updated_at: "" },
    ]);
    const transport: ChatTransport = async () => ({ content: "   ", toolCalls: [], cancelled: false });
    await expect(summariseConversation(5, transport, "s1")).rejects.toThrow(/empty summary/i);
    expect(repo.appendMessage).not.toHaveBeenCalled();
  });
});
