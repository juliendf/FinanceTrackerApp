import { describe, expect, it, vi } from "vitest";
import { parseToolArgs, pendingActionsFrom, runTurn, type ChatTransport } from "./chatLoop";
import type { ToolResult } from "./tools";

/** A transport that replays a fixed script of responses. */
function scripted(
  responses: Array<{
    content?: string;
    calls?: Array<{ id: string; name: string; arguments: string; extraContent?: unknown }>;
    cancelled?: boolean;
  }>,
): ChatTransport {
  let index = 0;
  return async () => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      content: response.content ?? "",
      toolCalls: (response.calls ?? []).map((call) => ({ ...call })),
      cancelled: response.cancelled ?? false,
    };
  };
}

const ok = (result: unknown): ToolResult => ({ result, summary: "ok" });

describe("runTurn", () => {
  it("returns the answer when the model asks for no tools", async () => {
    const execute = vi.fn();
    const result = await runTurn({
      requestId: "t",
      messages: [{ role: "user", content: "hi" }],
      transport: scripted([{ content: "hello" }]),
      execute,
    });
    expect(result.finalContent).toBe("hello");
    expect(result.rounds).toBe(0);
    expect(result.messages[result.messages.length - 1]).toEqual({ role: "assistant", content: "hello" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs one tool round and feeds the result back with its name", async () => {
    const execute = vi.fn(async () => ok({ total_value_base: 10 }));
    const transport = scripted([
      { calls: [{ id: "c1", name: "get_portfolio_summary", arguments: "{}" }] },
      { content: "Your portfolio is 10." },
    ]);
    const result = await runTurn({
      requestId: "t",
      messages: [{ role: "user", content: "how much?" }],
      transport,
      execute,
    });
    expect(execute).toHaveBeenCalledWith("get_portfolio_summary", {});
    expect(result.finalContent).toBe("Your portfolio is 10.");
    const tool = result.messages.find((message) => message.role === "tool");
    expect(tool).toMatchObject({ tool_call_id: "c1", name: "get_portfolio_summary" });
    expect(JSON.parse(tool!.content)).toEqual({ total_value_base: 10 });
    const assistantCall = result.messages.find((message) => message.role === "assistant" && message.tool_calls);
    expect(assistantCall?.tool_calls?.[0].function.name).toBe("get_portfolio_summary");
  });

  it("echoes the provider's extra content back on the assistant call", async () => {
    const signature = { google: { thought_signature: "sig-123" } };
    const result = await runTurn({
      requestId: "t",
      messages: [{ role: "user", content: "x" }],
      transport: scripted([
        { calls: [{ id: "c1", name: "list_assets", arguments: "{}", extraContent: signature }] },
        { content: "done" },
      ]),
      execute: async () => ok([]),
    });
    const assistant = result.messages.find((message) => message.role === "assistant" && message.tool_calls);
    expect(assistant?.tool_calls?.[0].extra_content).toEqual(signature);
  });

  it("treats a null extraContent as absent", async () => {
    // The Rust side used to serialize `None` as `extraContent: null`; forwarding
    // that made Gemini answer 400 "Value is not a struct: null".
    const result = await runTurn({
      requestId: "t",
      messages: [{ role: "user", content: "x" }],
      transport: scripted([
        { calls: [{ id: "c1", name: "list_assets", arguments: "{}", extraContent: null }] },
        { content: "done" },
      ]),
      execute: async () => ok([]),
    });
    const assistant = result.messages.find((message) => message.role === "assistant" && message.tool_calls);
    expect(assistant?.tool_calls?.[0]).not.toHaveProperty("extra_content");
  });

  it("omits extra_content for providers that send none", async () => {
    const result = await runTurn({
      requestId: "t",
      messages: [{ role: "user", content: "x" }],
      transport: scripted([{ calls: [{ id: "c1", name: "list_assets", arguments: "{}" }] }, { content: "done" }]),
      execute: async () => ok([]),
    });
    const assistant = result.messages.find((message) => message.role === "assistant" && message.tool_calls);
    expect(assistant?.tool_calls?.[0]).not.toHaveProperty("extra_content");
  });

  it("stops at the round cap and says so", async () => {
    const transport = scripted([{ calls: [{ id: "c", name: "list_assets", arguments: "{}" }] }]);
    const result = await runTurn({
      requestId: "t",
      messages: [{ role: "user", content: "loop" }],
      transport,
      execute: async () => ok([]),
      maxRounds: 3,
    });
    expect(result.rounds).toBe(3);
    expect(result.finalContent).toContain("3 tool rounds");
  });

  it("returns cancelled without an answer when the stream was stopped", async () => {
    const result = await runTurn({
      requestId: "t",
      messages: [{ role: "user", content: "x" }],
      transport: scripted([{ cancelled: true }]),
      execute: async () => ok({}),
    });
    expect(result.cancelled).toBe(true);
    expect(result.finalContent).toBe("");
  });

  it("collects pending actions from tool results", async () => {
    const transport = scripted([
      {
        calls: [
          { id: "a", name: "propose_snapshot", arguments: '{"asset_id":1,"amount":5}' },
          { id: "b", name: "remember_fact", arguments: "{}" },
        ],
      },
      { content: "done" },
    ]);
    const execute = vi.fn(async (name: string) =>
      ok({ pending_action_id: 7, action_type: name === "remember_fact" ? "create_memory" : "create_snapshot" }),
    );
    const result = await runTurn({
      requestId: "t",
      messages: [{ role: "user", content: "x" }],
      transport,
      execute,
    });
    expect(result.pendingActions).toHaveLength(2);
  });

  it("passes each step to the persistence hooks as it happens", async () => {
    const onAssistantToolCalls = vi.fn();
    const onToolResult = vi.fn();
    await runTurn({
      requestId: "t",
      messages: [{ role: "user", content: "x" }],
      transport: scripted([{ calls: [{ id: "c", name: "list_assets", arguments: "{}" }] }, { content: "ok" }]),
      execute: async () => ok([]),
      onAssistantToolCalls,
      onToolResult,
    });
    expect(onAssistantToolCalls).toHaveBeenCalledTimes(1);
    expect(onToolResult).toHaveBeenCalledTimes(1);
  });
});

describe("helpers", () => {
  it("parses arguments defensively", () => {
    expect(parseToolArgs("")).toEqual({});
    expect(parseToolArgs("{bad")).toEqual({});
    expect(parseToolArgs("[1]")).toEqual({});
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
  });

  it("recognises pending-action results only", () => {
    expect(pendingActionsFrom({ pending_action_id: 1 })).toHaveLength(1);
    expect(pendingActionsFrom({ action_type: "create_memory" })).toHaveLength(1);
    expect(pendingActionsFrom([{ error: "x" }])).toEqual([]);
    expect(pendingActionsFrom({ error: "x" })).toEqual([]);
  });
});
