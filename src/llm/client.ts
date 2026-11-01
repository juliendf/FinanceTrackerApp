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
    /**
     * Provider extras that must be echoed back verbatim. Gemini 3 returns a
     * `thought_signature` here and answers 400 INVALID_ARGUMENT if the next
     * request omits it.
     */
    extra_content?: unknown;
  }>;
  tool_call_id?: string;
  /** Gemini's functionResponse needs the name; OpenAI ignores it. */
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Gemini's thought signature, when the provider sends one. */
  extraContent?: unknown;
}

export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "toolCall"; id: string; name: string; arguments: string; extraContent?: unknown }
  | { type: "done"; content: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export interface CompletionRequest {
  requestId: string;
  /** The provider row whose endpoint and key Rust should use. */
  providerId: number;
  /** Overrides the provider's default model for this request. */
  model?: string | null;
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
          // `null` means "no extras"; forwarding it makes Gemini 400.
          ...(event.extraContent == null ? {} : { extraContent: event.extraContent }),
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
    providerId: request.providerId,
    model: request.model ?? null,
    messages: request.messages,
    tools: request.tools ?? null,
    onEvent: channel,
  });

  return { content, toolCalls, cancelled };
}

export function cancelChat(requestId: string): Promise<void> {
  return invoke("cancel_chat", { requestId });
}

/**
 * Models and reachability for a **saved** provider: Rust reads its URL from
 * SQLite and its key from the Keychain. No credential crosses the IPC boundary.
 */
export function providerModels(providerId: number): Promise<string[]> {
  return invoke<string[]>("provider_models", { providerId });
}

export function providerConnection(providerId: number): Promise<string> {
  return invoke<string>("provider_connection", { providerId });
}

/**
 * The same, for an endpoint the user is still editing. The key is the one just
 * typed into the form, so nothing stored is exposed.
 */
export function probeModels(baseUrl: string, apiKey?: string | null): Promise<string[]> {
  return invoke<string[]>("probe_models", { baseUrl, apiKey: apiKey ?? null });
}

export function probeConnection(baseUrl: string, apiKey?: string | null): Promise<string> {
  return invoke<string>("probe_connection", { baseUrl, apiKey: apiKey ?? null });
}
