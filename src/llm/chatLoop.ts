/**
 * The chat tool loop.
 *
 * The transport and the tool executor are injected, so tests can drive both
 * without Rust, a network or a database.
 */

import type { ChatMessage, StreamEvent, ToolCall } from "./client";
import { fenceData } from "./fence";
import { TOOL_DEFINITIONS, type ToolResult } from "./tools";

/** Five tool rounds per user turn. */
export const MAX_TOOL_ROUNDS = 5;

export interface TransportResponse {
  content: string;
  toolCalls: ToolCall[];
  cancelled: boolean;
}

export interface ChatTransport {
  (input: {
    requestId: string;
    messages: ChatMessage[];
    tools: typeof TOOL_DEFINITIONS;
    onEvent: (event: StreamEvent) => void;
  }): Promise<TransportResponse>;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

export interface LoopOptions {
  requestId: string;
  /** System prompt plus history; the user message is already in there. */
  messages: ChatMessage[];
  transport: ChatTransport;
  execute: ToolExecutor;
  onEvent?: (event: StreamEvent) => void;
  maxRounds?: number;
  /** Called after each exchange so the caller can persist it as it happens. */
  onAssistantToolCalls?: (input: { content: string; toolCalls: ToolCall[] }) => Promise<void> | void;
  onToolResult?: (input: { call: ToolCall; result: ToolResult }) => Promise<void> | void;
}

export interface LoopResult {
  /** The conversation as sent, including the final assistant turn. */
  messages: ChatMessage[];
  finalContent: string;
  rounds: number;
  cancelled: boolean;
  /** Payloads of write tools the model called; the caller stages them as cards. */
  pendingActions: unknown[];
  error: string | null;
}

export function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Pending actions a tool result describes. */
export function pendingActionsFrom(result: unknown): unknown[] {
  if (typeof result !== "object" || result === null) return [];
  const record = result as Record<string, unknown>;
  if (record.action_type === "create_memory" || "pending_action_id" in record) return [record];
  return [];
}

/**
 * Run one user turn to completion: resolve tool calls against the local
 * database until the model answers in prose or the round cap is hit.
 */
export async function runTurn(options: LoopOptions): Promise<LoopResult> {
  const maxRounds = options.maxRounds ?? MAX_TOOL_ROUNDS;
  const messages: ChatMessage[] = [...options.messages];
  const pendingActions: unknown[] = [];
  let rounds = 0;

  while (rounds < maxRounds) {
    const response = await options.transport({
      requestId: `${options.requestId}:${rounds}`,
      messages,
      tools: TOOL_DEFINITIONS,
      onEvent: options.onEvent ?? (() => {}),
    });

    if (response.cancelled) {
      return { messages, finalContent: "", rounds, cancelled: true, pendingActions, error: null };
    }

    if (response.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: response.content });
      return {
        messages,
        finalContent: response.content,
        rounds,
        cancelled: false,
        pendingActions,
        error: null,
      };
    }

    // One assistant turn carrying every call, then one result per call. Splitting
    // it per call interleaves calls and responses, which Gemini rejects.
    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
        // Gemini 3 needs its thought signature back; other providers send none.
        ...(call.extraContent == null ? {} : { extra_content: call.extraContent }),
      })),
    });
    await options.onAssistantToolCalls?.({ content: response.content, toolCalls: response.toolCalls });

    for (const call of response.toolCalls) {
      const result = await options.execute(call.name, parseToolArgs(call.arguments));
      pendingActions.push(...pendingActionsFrom(result.result));
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        // Tool results carry the user's notes and descriptions: fenced as data (FIN-47).
        content: fenceData(JSON.stringify(result.result)),
        name: call.name,
      });
      await options.onToolResult?.({ call, result });
    }

    rounds += 1;
  }

  // The cap was reached while the model was still asking for data. Rather than
  // tell the user it gave up, ask once more with the tools removed: whatever the
  // tools returned is already in `messages`, so the only useful thing left is the
  // model's best answer from it. A small local model that loops will keep
  // looping; taking its tools away is what ends the loop.
  const closing = await options.transport({
    requestId: `${options.requestId}:final`,
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "Answer now, using only what the tools have already returned. Do not ask for more data, and say plainly if something you need is missing.",
      },
    ],
    tools: [],
    onEvent: options.onEvent ?? (() => {}),
  });

  if (!closing.cancelled && closing.content.trim()) {
    messages.push({ role: "assistant", content: closing.content });
    return {
      messages,
      finalContent: closing.content,
      rounds,
      cancelled: false,
      pendingActions,
      error: null,
    };
  }

  // Only reachable if the closing call failed or returned nothing: the data is
  // gathered but there is no prose to show for it.
  const capped = `I stopped after ${maxRounds} tool rounds without a final answer. Try narrowing the question.`;
  messages.push({ role: "assistant", content: capped });
  return { messages, finalContent: capped, rounds, cancelled: false, pendingActions, error: null };
}
