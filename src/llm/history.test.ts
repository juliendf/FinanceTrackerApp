import { describe, expect, it } from "vitest";
import type { Message } from "../db/repositories/chat";
import { buildHistoryMessages, toolCallNames } from "./history";

const row = (id: number, over: Partial<Message>): Message => ({
  id,
  conversation_id: 1,
  role: "user",
  content: "",
  tool_calls: null,
  tool_call_id: null,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
  ...over,
});

const call = JSON.stringify([{ id: "c1", type: "function", function: { name: "list_assets", arguments: "{}" } }]);

describe("toolCallNames", () => {
  it("maps ids to names, ignoring junk", () => {
    expect(toolCallNames(call)).toEqual({ c1: "list_assets" });
    expect(toolCallNames(null)).toEqual({});
    expect(toolCallNames("{bad")).toEqual({});
    expect(toolCallNames('[{"id":"x"}]')).toEqual({});
  });
});

describe("buildHistoryMessages", () => {
  it("keeps a complete exchange intact", () => {
    const messages = buildHistoryMessages([
      row(1, { role: "user", content: "how much?" }),
      row(2, { role: "assistant", content: "", tool_calls: call }),
      row(3, { role: "tool", content: '{"ok":1}', tool_call_id: "c1" }),
      row(4, { role: "assistant", content: "10" }),
    ]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(messages[2]).toMatchObject({ tool_call_id: "c1", name: "list_assets" });
  });

  it("drops a leading tool result and its call when the window cuts mid-exchange", () => {
    const messages = buildHistoryMessages([
      row(3, { role: "tool", content: "{}", tool_call_id: "c1" }),
      row(4, { role: "assistant", content: "10" }),
    ]);
    expect(messages).toEqual([{ role: "assistant", content: "10" }]);
  });

  it("drops an assistant call whose results were cut off", () => {
    const twoCalls = JSON.stringify([
      { id: "c1", type: "function", function: { name: "a", arguments: "{}" } },
      { id: "c2", type: "function", function: { name: "b", arguments: "{}" } },
    ]);
    const messages = buildHistoryMessages([
      row(1, { role: "user", content: "x" }),
      row(2, { role: "assistant", content: "", tool_calls: twoCalls }),
      row(3, { role: "tool", content: "{}", tool_call_id: "c1" }),
      row(4, { role: "tool", content: "{}", tool_call_id: "c2" }),
      row(5, { role: "assistant", content: "done" }),
    ]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool", "assistant"]);
  });

  it("drops an orphaned result and an empty assistant turn", () => {
    const messages = buildHistoryMessages([
      row(1, { role: "user", content: "x" }),
      row(2, { role: "assistant", content: "   " }),
      row(3, { role: "tool", content: "{}", tool_call_id: "ghost" }),
      row(4, { role: "assistant", content: "fine" }),
    ]);
    expect(messages).toEqual([
      { role: "user", content: "x" },
      { role: "assistant", content: "fine" },
    ]);
  });

  it("is empty-safe", () => {
    expect(buildHistoryMessages([])).toEqual([]);
  });
});
