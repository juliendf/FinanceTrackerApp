import { describe, expect, it } from "vitest";
import type { Conversation } from "../../../db/repositories/chat";
import { filterSessions, groupSessions, sessionMeta } from "./sessionList";

const now = new Date("2026-11-01T15:00:00");

const conv = (id: number, title: string, updated_at: string): Conversation => ({
  id,
  provider_id: null,
  model_override: null,
  title,
  created_at: updated_at,
  updated_at,
});

describe("sessionMeta", () => {
  it("shows the hour for today", () => {
    expect(sessionMeta("2026-11-01T09:12:00", now).label).toBe("9h");
    expect(sessionMeta("2026-11-01T22:40:00", now).label).toBe("22h");
  });

  it("shows a weekday within the week", () => {
    // 2026-10-28 is a Wednesday.
    expect(sessionMeta("2026-10-28T10:00:00", now).label).toBe("Wed");
  });

  it("shows a date once it is older than a week", () => {
    expect(sessionMeta("2026-10-16T10:00:00", now).label).toBe("16 Oct");
  });

  it("survives a malformed timestamp", () => {
    expect(sessionMeta("nonsense", now).label).toBe("");
  });
});

describe("groupSessions", () => {
  const rows = [
    conv(1, "New session", "2026-11-01T13:00:00"),
    conv(2, "Hello", "2026-10-28T10:00:00"),
    conv(3, "Older one", "2026-10-16T10:00:00"),
    conv(4, "Also older", "2026-10-14T10:00:00"),
  ];

  it("splits this week from earlier and keeps the input order", () => {
    const groups = groupSessions(rows, now);
    expect(groups.map((group) => group.title)).toEqual(["This week", "Earlier"]);
    expect(groups[0].items.map((item) => item.title)).toEqual(["New session", "Hello"]);
    expect(groups[1].items.map((item) => item.title)).toEqual(["Older one", "Also older"]);
  });

  it("attaches the label to every row", () => {
    const groups = groupSessions(rows, now);
    expect(groups[0].items[0].meta.label).toBe("13h");
    expect(groups[1].items[0].meta.label).toBe("16 Oct");
  });

  it("drops an empty group", () => {
    const groups = groupSessions([conv(1, "Only recent", "2026-11-01T13:00:00")], now);
    expect(groups.map((group) => group.title)).toEqual(["This week"]);
  });

  it("is empty-safe", () => {
    expect(groupSessions([], now)).toEqual([]);
  });
});

describe("filterSessions", () => {
  const rows = [conv(1, "Email Draft Refinement", ""), conv(2, "Portfolio review", "")];

  it("matches case-insensitively and trims the needle", () => {
    expect(filterSessions(rows, "  EMAIL ").map((row) => row.id)).toEqual([1]);
  });

  it("keeps everything for an empty query", () => {
    expect(filterSessions(rows, "   ")).toHaveLength(2);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterSessions(rows, "zzz")).toEqual([]);
  });
});
