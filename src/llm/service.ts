/**
 * Chat orchestration — the parts of `chat_service.py` that touch the database:
 * assembling the prompt, persisting the exchange, and the pending-action
 * lifecycle.
 *
 * Everything that talks to a provider goes through an injected transport, so the
 * tests drive the whole flow without Rust or a network.
 */

import {
  appendMessage,
  claimPendingAction,
  getConversation,
  getPendingAction,
  listMessages,
  listPendingActions,
  listRecentMessages,
  renameConversation,
  resolvePendingAction,
} from "../db/repositories/chat";
import { getDefaultProvider, type LlmProvider } from "../db/repositories/llmProviders";
import { createMemory, getProfile, listGoals, listMemories, listTopMemories } from "../db/repositories/profile";
import { createSnapshot, getSnapshotOn, updateSnapshot } from "../db/repositories/snapshots";
import { getAllSettings } from "../db/repositories/settings";
import { displayName } from "../domain/assets";
import { todayIso } from "../domain/dates";
import { formatNumber, formatSymbolAmount } from "../domain/format";
import { buildHistoryMessages } from "./history";
import { runTurn, type ChatTransport } from "./chatLoop";
import { buildExtractionMessages, buildKnownContext, buildSystemPrompt } from "./prompts";
import { executeTool, type ToolResult } from "./tools";
import { fromMinorUnits } from "../domain/money";
import Decimal from "decimal.js";
import { listAssets } from "../db/repositories/assets";

/** `CHAT_HISTORY_LIMIT`. */
export const HISTORY_LIMIT = 60;
/** `MEMORY_PROMPT_LIMIT`. */
export const MEMORY_LIMIT = 10;
/** User messages are capped at 4000 characters, as the route does. */
export const MAX_MESSAGE_CHARS = 4000;

/** The stored row, as the confirm/reject flow needs it. */
type PendingActionRow = Awaited<ReturnType<typeof getPendingAction>> extends infer T
  ? T extends null
    ? never
    : T
  : never;

export interface PendingActionView {
  id: number;
  action_type: "create_snapshot" | "create_memory";
  asset_name?: string;
  amount?: number;
  currency?: string;
  date?: string;
  category?: string;
  key?: string;
  content?: string;
  importance?: number;
  existing_snapshot_warning?: string;
}

/** Turn a tool result into the card the UI renders. */
export function toPendingActionView(raw: unknown): PendingActionView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = Number(record.pending_action_id);
  if (!Number.isInteger(id)) return null;
  if (record.action_type === "create_memory") {
    return {
      id,
      action_type: "create_memory",
      category: String(record.category ?? ""),
      key: String(record.key ?? ""),
      content: String(record.content ?? ""),
      importance: Number(record.importance ?? 3),
    };
  }
  return {
    id,
    action_type: "create_snapshot",
    asset_name: String(record.asset_name ?? ""),
    amount: Number(record.amount ?? 0),
    currency: String(record.currency ?? ""),
    date: String(record.date ?? ""),
    ...(record.existing_snapshot_warning
      ? { existing_snapshot_warning: String(record.existing_snapshot_warning) }
      : {}),
  };
}

export class NoProviderError extends Error {
  constructor() {
    super("No LLM provider is configured. Add one under Settings → LLM Providers.");
    this.name = "NoProviderError";
  }
}

export interface SendOptions {
  conversationId: number;
  text: string;
  transport: ChatTransport;
  /** Overrides the conversation's provider, used by the model picker. */
  provider?: LlmProvider | null;
  modelOverride?: string | null;
  requestId: string;
  onEvent?: Parameters<typeof runTurn>[0]["onEvent"];
  /** Injected in tests; defaults to the repository-backed executor. */
  execute?: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  today?: string;
}

export interface SendResult {
  answer: string;
  pendingActions: PendingActionView[];
  cancelled: boolean;
  rounds: number;
}

/**
 * `process_message`. Persists the user message first (so a crash mid-stream
 * keeps the question), runs the loop, and saves each step as it happens.
 */
export async function sendMessage(options: SendOptions): Promise<SendResult> {
  const today = options.today ?? todayIso();
  const conversation = await getConversation(options.conversationId);
  if (!conversation) throw new Error("Conversation not found.");

  const provider = options.provider ?? (await getDefaultProvider());
  if (!provider) throw new NoProviderError();

  const text = options.text.slice(0, MAX_MESSAGE_CHARS);
  await appendMessage({ conversationId: conversation.id, role: "user", content: text });
  if (conversation.title === "New conversation") {
    await renameConversation(conversation.id, text.slice(0, 60));
  }

  const [settings, profile, goals, memories] = await Promise.all([
    getAllSettings(),
    getProfile(),
    listGoals(),
    listTopMemories(MEMORY_LIMIT),
  ]);
  const baseCurrency = String(settings.base_currency ?? "EUR");
  const systemPrompt = buildSystemPrompt({ today, baseCurrency, profile, goals, memories });

  const recent = await listRecentMessages(conversation.id, HISTORY_LIMIT);
  const history = buildHistoryMessages(recent);

  const execute =
    options.execute ??
    ((name, args) => executeTool(name, args, { conversationId: conversation.id, today }));

  const loop = await runTurn({
    requestId: options.requestId,
    messages: [{ role: "system", content: systemPrompt }, ...history],
    transport: options.transport,
    execute,
    onEvent: options.onEvent,
    onAssistantToolCalls: async ({ content, toolCalls }) => {
      await appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        content,
        toolCalls: JSON.stringify(
          toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
            ...(call.extraContent == null ? {} : { extra_content: call.extraContent }),
          })),
        ),
      });
    },
    onToolResult: async ({ call, result }) => {
      await appendMessage({
        conversationId: conversation.id,
        role: "tool",
        content: JSON.stringify(result.result),
        toolCallId: call.id,
      });
    },
  });

  if (loop.cancelled) {
    return { answer: "", pendingActions: [], cancelled: true, rounds: loop.rounds };
  }

  const answer = loop.finalContent || "The model didn't return a response. Try rephrasing.";
  await appendMessage({ conversationId: conversation.id, role: "assistant", content: answer });

  const pendingActions = loop.pendingActions
    .map(toPendingActionView)
    .filter((view): view is PendingActionView => view !== null);

  return { answer, pendingActions, cancelled: false, rounds: loop.rounds };
}

// --- pending actions ---------------------------------------------------------------

export interface ConfirmResult {
  success: boolean;
  resultMessage: string;
  wasUpdate?: boolean;
}

/**
 * `confirm_action`: the only path from a proposal to a snapshot or a memory.
 * Upserts the snapshot, marks the action, then narrates in the conversation.
 */
export async function confirmAction(actionId: number): Promise<ConfirmResult> {
  const action = await getPendingAction(actionId);
  if (!action) return { success: false, resultMessage: "Action not found." };

  // Claim it before writing anything: one conditional UPDATE, so a double click
  // (or two tabs) cannot write the snapshot or the memory twice.
  if (!(await claimPendingAction(actionId, "confirmed"))) {
    return { success: false, resultMessage: "That action was already resolved." };
  }

  try {
    return await applyConfirmedAction(action);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Marking the failure is best effort: it must not mask the original error.
    try {
      await resolvePendingAction(actionId, "failed", `Error: ${message}`);
    } catch {
      /* the action stays confirmed without a result message; the caller still sees the error */
    }
    return { success: false, resultMessage: message };
  }
}

async function applyConfirmedAction(action: PendingActionRow): Promise<ConfirmResult> {
  const payload = JSON.parse(action.payload) as Record<string, unknown>;

  if (action.action_type === "create_snapshot") {
    const assetId = Number(payload.asset_id);
    const amountMinor = Number(payload.amount_minor);
    const date = String(payload.date);
    const rows = await listAssets();
    const asset = rows.find((row) => row.id === assetId);
    if (!asset) {
      await resolvePendingAction(action.id, "failed", "Asset not found or not yours.");
      return { success: false, resultMessage: "Asset not found or access denied." };
    }

    const previous = await getSnapshotOn(assetId, date);

    const symbol = ({ EUR: "€", USD: "$", CHF: "CHF" } as Record<string, string>)[asset.currency] ?? asset.currency;
    const shown = formatSymbolAmount(symbol, fromMinorUnits(amountMinor) ?? 0);
    let message: string;
    let wasUpdate = false;
    if (previous) {
      await updateSnapshot(previous.id, date, amountMinor);
      message = `Snapshot for ${displayName(asset)} on ${date} updated from ${formatNumber(fromMinorUnits(previous.amount_minor) ?? new Decimal(0))} to ${shown}.`;
      wasUpdate = true;
    } else {
      await createSnapshot(assetId, date, amountMinor);
      message = `Snapshot created for ${displayName(asset)}: ${shown} on ${date}.`;
    }

    await resolvePendingAction(action.id, "confirmed", message);
    await appendMessage({ conversationId: action.conversation_id, role: "assistant", content: message });
    return { success: true, resultMessage: message, wasUpdate };
  }

  if (action.action_type === "create_memory") {
    await createMemory({
      category: String(payload.category),
      key: String(payload.key),
      content: String(payload.content),
      importance: Number(payload.importance ?? 3),
      source: "ai_extracted",
      conversationId: action.conversation_id,
    });
    const message = `Memory saved: [${String(payload.category)}] ${String(payload.content)}`;
    await resolvePendingAction(action.id, "confirmed", message);
    await appendMessage({ conversationId: action.conversation_id, role: "assistant", content: message });
    return { success: true, resultMessage: message };
  }

  return { success: false, resultMessage: `Unknown action type: ${action.action_type}` };
}

/** `reject_action`: marks it and narrates, writing nothing else. */
export async function rejectAction(actionId: number): Promise<ConfirmResult> {
  const action = await getPendingAction(actionId);
  if (!action) return { success: false, resultMessage: "Action not found." };

  // Same claim as confirming: whoever gets the row decides.
  if (!(await claimPendingAction(actionId, "rejected"))) {
    return { success: false, resultMessage: "That action was already resolved." };
  }

  const message = "Cancelled, nothing was saved.";
  await resolvePendingAction(action.id, "rejected", message);
  await appendMessage({ conversationId: action.conversation_id, role: "assistant", content: message });
  return { success: true, resultMessage: message };
}

export async function loadPendingActions(conversationId: number): Promise<PendingActionView[]> {
  const rows = await listPendingActions(conversationId);
  return rows
    .map((row) => {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      return toPendingActionView({
        ...payload,
        pending_action_id: row.id,
        action_type: row.action_type,
      });
    })
    .filter((view): view is PendingActionView => view !== null);
}

// --- memory extraction --------------------------------------------------------------

export interface MemoryProposal {
  category: string;
  key: string;
  content: string;
  importance: number;
}

/** `extract_memories`: the model proposes, the UI stages each as a card. */
/** Lower-case, letters and digits only: "Job title" and "job_title" compare equal. */
function normaliseFact(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Whether a proposal repeats something the app already knows.
 *
 * The prompt is told not to repeat, but a model can still return the user's own
 * name or an existing goal; this is the deterministic half, so a duplicate never
 * reaches the confirmation cards.
 */
export function isDuplicateMemory(
  proposal: { key: string; content: string },
  existing: ReadonlyArray<{ key: string; content: string }>,
): boolean {
  const key = normaliseFact(proposal.key);
  const content = normaliseFact(proposal.content);
  if (!content) return true;

  return existing.some((memory) => {
    const memoryKey = normaliseFact(memory.key);
    const memoryContent = normaliseFact(memory.content);
    if (!memoryContent) return false;
    // The same wording, or one is a rephrasing that contains the other.
    if (content === memoryContent) return true;
    if (key && key === memoryKey && content === memoryContent) return true;
    const shortest = Math.min(content.length, memoryContent.length);
    return shortest >= 24 && (content.includes(memoryContent) || memoryContent.includes(content));
  });
}

export async function extractMemories(
  conversationId: number,
  transport: ChatTransport,
  requestId: string,
): Promise<MemoryProposal[]> {
  const messages = await listMessages(conversationId);
  if (messages.length === 0) return [];
  const provider = await getDefaultProvider();
  if (!provider) throw new NoProviderError();

  // What the app already holds: the extraction must not rediscover it, and the
  // same facts must not come back as proposals.
  const [profile, goals, existingMemories, assets] = await Promise.all([
    getProfile(),
    listGoals(),
    listMemories(),
    listAssets(),
  ]);
  const known = buildKnownContext({
    profile,
    goals,
    memories: existingMemories,
    assets: assets.map((asset) => displayName(asset)),
  });

  const response = await transport({
    requestId,
    // Instruction and transcript as two turns: a system-only request is not a
    // chat, and Gemini rejects it with a 500.
    messages: buildExtractionMessages(messages, known),
    tools: [],
    onEvent: () => {},
  });
  const raw = response.content;
  if (!raw) return [];

  const match = /\[.*\]/s.exec(raw);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    const proposals = parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        category: String(item.category ?? "personal"),
        key: String(item.key ?? ""),
        content: String(item.content ?? ""),
        importance: Number(item.importance ?? 3),
      }))
      .filter((item) => item.key && item.content);

    // Drop what is already known, then what repeats itself inside this batch.
    const fresh: MemoryProposal[] = [];
    for (const proposal of proposals) {
      if (isDuplicateMemory(proposal, existingMemories)) continue;
      if (fresh.some((kept) => isDuplicateMemory(proposal, [kept]))) continue;
      fresh.push(proposal);
    }
    return fresh;
  } catch {
    return [];
  }
}
