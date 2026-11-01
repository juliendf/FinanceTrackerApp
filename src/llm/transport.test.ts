/**
 * The stop button cancels the round that is actually in flight.
 *
 * The loop suffixes the request id per round (`base:0`, `base:1`, …). Cancelling
 * the base id matched nothing in Rust, so stop looked broken.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
  cancelChat: vi.fn(),
}));
vi.mock("./client", () => ({
  chatCompletion: (...args: unknown[]) => client.chatCompletion(...args),
  cancelChat: (...args: unknown[]) => client.cancelChat(...args),
}));

import { rustTransport } from "./transport";

const endpoint = { provider_id: 2 };

const call = (requestId: string) => ({
  requestId,
  messages: [{ role: "user" as const, content: "hi" }],
  tools: [],
  onEvent: () => {},
});

beforeEach(() => {
  vi.clearAllMocks();
  client.chatCompletion.mockResolvedValue({ content: "ok", toolCalls: [], cancelled: false });
  client.cancelChat.mockResolvedValue(undefined);
});

describe("rustTransport", () => {
  it("sends the round id it was given, and cancelling after the round is a no-op", async () => {
    const transport = rustTransport(endpoint);
    await transport(call("chat-1:0"));
    expect(client.chatCompletion).toHaveBeenCalledWith(expect.objectContaining({ requestId: "chat-1:0" }));

    // Nothing is streaming any more, so there is no id to cancel in Rust.
    await transport.cancel();
    expect(client.cancelChat).not.toHaveBeenCalled();
  });

  it("cancels the round in flight, not the previous one", async () => {
    const transport = rustTransport(endpoint);
    await transport(call("chat-2:0"));
    const inflight = transport(call("chat-2:1"));
    await transport.cancel();
    expect(client.cancelChat).toHaveBeenCalledWith("chat-2:1");
    await inflight;
  });

  it("stops before the next round when asked between rounds", async () => {
    const transport = rustTransport(endpoint);
    await transport.cancel();
    const result = await transport(call("chat-3:0"));
    expect(result.cancelled).toBe(true);
    expect(client.chatCompletion).not.toHaveBeenCalled();
  });

  it("reports the round as cancelled if stop lands while it streams", async () => {
    let release!: (value: unknown) => void;
    client.chatCompletion.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const transport = rustTransport(endpoint);
    const inflight = transport(call("chat-4:0"));
    await transport.cancel();
    release({ content: "partial", toolCalls: [], cancelled: false });
    const result = await inflight;
    expect(result.cancelled).toBe(true);
  });

  it("names the provider and passes the model override through", async () => {
    const transport = rustTransport(endpoint, "qwen3.5:4b");
    await transport(call("chat-5:0"));
    expect(client.chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 2, model: "qwen3.5:4b" }),
    );
  });
});
