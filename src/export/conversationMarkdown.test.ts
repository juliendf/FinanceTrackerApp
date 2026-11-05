import { describe, expect, it } from "vitest";
import type { Message } from "../db/repositories/chat";
import { conversationFileName, conversationMarkdown } from "./conversationMarkdown";

const msg = (id: number, role: Message["role"], content: string, over: Partial<Message> = {}): Message => ({
  id,
  conversation_id: 5,
  role,
  content,
  tool_calls: null,
  tool_call_id: role === "tool" ? "c1" : null,
  created_at: "2026-11-01T14:22:00",
  updated_at: "2026-11-01T14:22:00",
  ...over,
});

describe("conversationMarkdown", () => {
  it("writes a heading, a provenance line and one section per message", () => {
    const markdown = conversationMarkdown({
      title: "Retirement picture",
      createdAt: "2026-11-01T14:22:00",
      exportedAt: new Date("2026-11-05T09:00:00"),
      messages: [msg(1, "user", "How am I doing?"), msg(2, "assistant", "Well, mostly.")],
    });

    expect(markdown).toContain("# Retirement picture");
    expect(markdown).toContain("Exported from FinanceTracker on 2026-11-05");
    expect(markdown).toContain("Started 2026-11-01 at 14:22");
    expect(markdown).toContain("**You** · 14:22");
    expect(markdown).toContain("How am I doing?");
    expect(markdown).toContain("**Advisor** · 14:22");
    expect(markdown).toContain("Well, mostly.");
  });

  it("starts a new day heading when the date changes", () => {
    const markdown = conversationMarkdown({
      title: "Two days",
      createdAt: null,
      messages: [
        msg(1, "user", "first", { created_at: "2026-11-01T22:00:00" }),
        msg(2, "user", "second", { created_at: "2026-11-02T08:30:00" }),
      ],
    });
    expect(markdown.match(/^## 2026-11-01$/gm)).toHaveLength(1);
    expect(markdown.match(/^## 2026-11-02$/gm)).toHaveLength(1);
    expect(markdown.indexOf("## 2026-11-01")).toBeLessThan(markdown.indexOf("## 2026-11-02"));
  });

  it("names what was looked up instead of dumping the tool payload", () => {
    const markdown = conversationMarkdown({
      title: "Lookup",
      createdAt: null,
      messages: [
        msg(1, "user", "what is my Coinbase worth?"),
        msg(2, "assistant", "Let me check.", {
          tool_calls: JSON.stringify([
            { id: "c1", function: { name: "list_assets", arguments: "{}" } },
            { id: "c2", function: { name: "get_asset_history", arguments: '{"asset_id":3}' } },
          ]),
        }),
        msg(3, "tool", '{"latest_amount_display":"CHF 1,533.00"}'),
        msg(4, "assistant", "It is worth CHF 1,533.00."),
      ],
    });

    expect(markdown).toContain("> Looked up: list_assets, get_asset_history");
    // The raw JSON and the tool result must not reach the document.
    expect(markdown).not.toContain("asset_id");
    expect(markdown).not.toContain("latest_amount_display");
    // And the tool row is not rendered as a message of its own.
    expect(markdown.match(/\*\*Advisor\*\*/g)).toHaveLength(2);
  });

  it("keeps a conversation with only plumbing to its header", () => {
    const markdown = conversationMarkdown({
      title: "Empty",
      createdAt: null,
      messages: [msg(1, "system", "you are a finance assistant"), msg(2, "tool", "{}")],
    });
    expect(markdown).toContain("# Empty");
    expect(markdown).not.toContain("you are a finance assistant");
    expect(markdown).not.toContain("**You**");
  });

  it("does not leave runs of blank lines", () => {
    const markdown = conversationMarkdown({
      title: "Tidy",
      createdAt: null,
      messages: [msg(1, "user", "a"), msg(2, "assistant", "b")],
    });
    expect(markdown).not.toMatch(/\n{3,}/);
    expect(markdown.endsWith("\n")).toBe(true);
  });
});

describe("conversationFileName", () => {
  it("folds accents rather than stripping the letters", () => {
    expect(conversationFileName("Prévoyance & retraite", "2026-11-05")).toBe("prevoyance-retraite-2026-11-05.md");
  });

  it("falls back when the title has nothing usable", () => {
    expect(conversationFileName("   ", "2026-11-05")).toBe("conversation-2026-11-05.md");
  });

  it("keeps the name short", () => {
    expect(conversationFileName("a".repeat(200), "2026-11-05").length).toBeLessThanOrEqual(60 + 4 + 10 + 3);
  });
});
