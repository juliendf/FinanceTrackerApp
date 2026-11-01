/**
 * The real transport: one streamed round trip through Rust.
 *
 * The loop suffixes the request id per round (`base:0`, `base:1`, …), so a stop
 * has to cancel the id of the round that is actually in flight — cancelling the
 * base id found nothing and the stop button did nothing. A stop requested
 * between rounds is remembered and short-circuits the next one.
 */

import { cancelChat, chatCompletion } from "./client";
import type { ChatTransport, TransportResponse } from "./chatLoop";

export interface ProviderEndpoint {
  base_url: string;
  api_key?: string | null;
  model: string;
}

export interface CancellableTransport extends ChatTransport {
  /** Stops the round in flight, or the next one if none is running. */
  cancel: () => Promise<void>;
}

export function rustTransport(
  endpoint: ProviderEndpoint,
  modelOverride?: string | null,
): CancellableTransport {
  let activeRequestId: string | null = null;
  let stopRequested = false;

  const transport = (async (input): Promise<TransportResponse> => {
    if (stopRequested) return { content: "", toolCalls: [], cancelled: true };

    activeRequestId = input.requestId;
    try {
      const result = await chatCompletion({
        requestId: input.requestId,
        baseUrl: endpoint.base_url,
        apiKey: endpoint.api_key,
        model: modelOverride || endpoint.model,
        messages: input.messages,
        tools: input.tools,
        onEvent: input.onEvent,
      });
      return stopRequested ? { ...result, cancelled: true } : result;
    } finally {
      activeRequestId = null;
    }
  }) as CancellableTransport;

  transport.cancel = async () => {
    stopRequested = true;
    if (activeRequestId) await cancelChat(activeRequestId);
  };

  return transport;
}
