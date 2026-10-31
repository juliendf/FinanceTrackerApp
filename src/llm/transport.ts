/** The real transport: one streamed round trip through Rust. */

import { cancelChat, chatCompletion, type StreamEvent } from "./client";
import type { ChatTransport } from "./chatLoop";

export interface ProviderEndpoint {
  base_url: string;
  api_key?: string | null;
  model: string;
}

/**
 * Bind the model and endpoint to the loop's transport shape. `requestId` is
 * suffixed per round by the loop, so `cancel` can stop the round in flight.
 */
export function rustTransport(
  endpoint: ProviderEndpoint,
  modelOverride?: string | null,
): ChatTransport & { cancel: (requestId: string) => Promise<void> } {
  const transport = (async (input) =>
    chatCompletion({
      requestId: input.requestId,
      baseUrl: endpoint.base_url,
      apiKey: endpoint.api_key,
      model: modelOverride || endpoint.model,
      messages: input.messages,
      tools: input.tools,
      onEvent: input.onEvent,
    })) as ChatTransport & { cancel: (requestId: string) => Promise<void> };

  transport.cancel = (requestId: string) => cancelChat(requestId);
  return transport;
}

export type { StreamEvent };
