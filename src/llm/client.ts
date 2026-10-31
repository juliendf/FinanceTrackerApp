/**
 * Thin wrapper over the Rust `chat_completion` command.
 *
 * The chat *loop* (tool rounds, pending actions) lives here in TypeScript so it
 * is testable with a mocked transport; Rust does one HTTP round trip per call.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import type { ToolDefinition } from "./tools";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  /** Gemini's functionResponse needs the name; OpenAI ignores it. */
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "toolCall"; id: string; name: string; arguments: string }
  | { type: "done"; content: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export interface CompletionRequest {
  requestId: string;
  baseUrl: string;
  apiKey?: string | null;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  onEvent: (event: StreamEvent) => void;
}

/**
 * One streamed completion. Resolves with the assembled assistant message, so
 * the loop does not have to reassemble deltas itself.
 */
export async function chatCompletion(
  request: CompletionRequest,
): Promise<{ content: string; toolCalls: ToolCall[]; cancelled: boolean }> {
  const channel = new Channel<StreamEvent>();
  const toolCalls: ToolCall[] = [];
  let content = "";
  let cancelled = false;

  channel.onmessage = (event) => {
    switch (event.type) {
      case "delta":
        content += event.content;
        break;
      case "toolCall":
        toolCalls.push({
          id: event.id,
          name: event.name,
          arguments: event.arguments,
        });
        break;
      case "cancelled":
        cancelled = true;
        break;
      default:
        break;
    }
    request.onEvent(event);
  };

  await invoke("chat_completion", {
    requestId: request.requestId,
    baseUrl: request.baseUrl,
    apiKey: request.apiKey ?? null,
    model: request.model,
    messages: request.messages,
    tools: request.tools ?? null,
    onEvent: channel,
  });

  return { content, toolCalls, cancelled };
}

export function cancelChat(requestId: string): Promise<void> {
  return invoke("cancel_chat", { requestId });
}

export function listModels(
  baseUrl: string,
  apiKey?: string | null,
): Promise<string[]> {
  return invoke<string[]>("list_models", { baseUrl, apiKey: apiKey ?? null });
}

export function testConnection(
  baseUrl: string,
  apiKey?: string | null,
): Promise<string> {
  return invoke<string>("test_connection", { baseUrl, apiKey: apiKey ?? null });
}
