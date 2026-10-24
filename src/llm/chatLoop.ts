/**
 * The chat tool loop.
 *
 * A reduced port of `app/services/chat_service.py` for Phase 0: it runs the
 * tool rounds and nothing else. Phase 7 adds the parts that need more tables —
 * system prompt from profile + AI style + memories, the PendingAction
 * confirm/reject flow for write tools, and the 60-message history window.
 *
 * The transport is injected so tests can drive it without Rust or a network.
 */

import type { ChatMessage, StreamEvent, ToolCall } from "./client";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

/** Source limit: `chat_service.py` allows five tool rounds per user turn. */
export const MAX_TOOL_ROUNDS = 5;

export interface ChatTransport {
  (input: {
    requestId: string;
    messages: ChatMessage[];
    tools: typeof TOOL_DEFINITIONS;
    onEvent: (event: StreamEvent) => void;
  }): Promise<{ content: string; toolCalls: ToolCall[]; cancelled: boolean }>;
}

export interface LoopResult {
  messages: ChatMessage[];
  finalContent: string;
  rounds: number;
  cancelled: boolean;
}

export interface LoopOptions {
  requestId: string;
  history: ChatMessage[];
  transport: ChatTransport;
  onEvent: (event: StreamEvent) => void;
  maxRounds?: number;
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Run one user turn to completion, resolving tool calls against the local
 * database until the model answers in prose or the round cap is hit.
 */
export async function runTurn(options: LoopOptions): Promise<LoopResult> {
  const maxRounds = options.maxRounds ?? MAX_TOOL_ROUNDS;
  const messages: ChatMessage[] = [...options.history];
  let rounds = 0;

  while (rounds <= maxRounds) {
    const response = await options.transport({
      requestId: `${options.requestId}:${rounds}`,
      messages,
      tools: TOOL_DEFINITIONS,
      onEvent: options.onEvent,
    });

    if (response.cancelled) {
      return { messages, finalContent: "", rounds, cancelled: true };
    }

    if (response.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: response.content });
      return {
        messages,
        finalContent: response.content,
        rounds,
        cancelled: false,
      };
    }

    // Echo the assistant's tool-call turn back, then answer each call.
    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const call of response.toolCalls) {
      const { result, summary } = await executeTool(
        call.name,
        parseArgs(call.arguments),
      );
      // The `toolCall` event already reached the UI through the transport's
      // onEvent, so the transcript shows the call before its result.
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({ summary, ...(result as object) }),
      });
    }

    rounds += 1;
  }

  const capped =
    `I stopped after ${maxRounds} tool rounds without a final answer. ` +
    `Try narrowing the question.`;
  messages.push({ role: "assistant", content: capped });
  return { messages, finalContent: capped, rounds, cancelled: false };
}
