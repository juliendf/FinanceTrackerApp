/**
 * The history window sent to the model — port of `_build_history_messages`.
 *
 * Two things matter, and both are load-bearing:
 *
 *   * the newest `limit` messages are taken, not the oldest, so the user's
 *     latest message is always included;
 *   * the window is repaired before it goes out. A cut that lands between an
 *     assistant `tool_calls` row and its results leaves an unpaired
 *     call/response, which Gemini rejects with a 400 for every later message in
 *     the conversation. Such assistant rows are dropped, along with their
 *     orphaned results.
 */

import type { ChatMessage } from "./client";
import type { Message } from "../db/repositories/chat";
import { TOOL_DEFINITIONS } from "./tools";

/** Function names the model may call. Anything else in a stored row is corrupt. */
const KNOWN_TOOLS = new Set(TOOL_DEFINITIONS.map((tool) => tool.function.name));

/** `tool_call_id -> function name` from a stored `tool_calls` blob. */
export function toolCallNames(raw: string | null): Record<string, string> {
  if (!raw) return {};
  let calls: unknown;
  try {
    calls = JSON.parse(raw || "[]");
  } catch {
    return {};
  }
  if (!Array.isArray(calls)) return {};
  const names: Record<string, string> = {};
  for (const call of calls) {
    if (typeof call !== "object" || call === null) continue;
    const record = call as Record<string, unknown>;
    const id = record.id;
    const name = (record.function as Record<string, unknown> | undefined)?.name;
    if (typeof id === "string" && typeof name === "string") names[id] = name;
  }
  return names;
}

/**
 * Turn stored rows into a valid message list, repairing a cut window.
 * `rows` must be oldest first (the repository returns them that way).
 */
export function buildHistoryMessages(rows: readonly Message[]): ChatMessage[] {
  let start = 0;
  while (start < rows.length) {
    const row = rows[start];
    if (row.role === "tool" || (row.role === "assistant" && row.tool_calls)) start += 1;
    else break;
  }
  const window = rows.slice(start);

  const resolved = new Set(
    window.filter((row) => row.role === "tool" && row.tool_call_id).map((row) => row.tool_call_id as string),
  );

  const namesById: Record<string, string> = {};
  const kept: Message[] = [];
  for (const row of window) {
    if (row.role === "assistant") {
      const names = row.tool_calls ? toolCallNames(row.tool_calls) : {};
      if (row.tool_calls) {
        const ids = Object.keys(names);
        // A name we no longer know means the row is corrupt — older builds
        // merged two streamed calls into one name ("list_assetsget_allocation"),
        // and the provider rejects the whole turn with 400 INVALID_ARGUMENT.
        const unknown = Object.values(names).some((name) => !KNOWN_TOOLS.has(name));
        if (ids.length === 0 || unknown || !ids.every((id) => resolved.has(id))) continue;
        Object.assign(namesById, names);
      } else if (!(row.content ?? "").trim()) {
        continue;
      }
    }
    kept.push(row);
  }

  const messages: ChatMessage[] = [];
  for (const row of kept) {
    if (row.role === "tool") {
      if (!row.tool_call_id || !(row.tool_call_id in namesById)) continue;
      messages.push({
        role: "tool",
        content: row.content ?? "",
        tool_call_id: row.tool_call_id,
        name: namesById[row.tool_call_id],
      });
      continue;
    }
    const entry: ChatMessage = { role: row.role, content: row.content ?? "" };
    if (row.role === "assistant" && row.tool_calls) entry.tool_calls = JSON.parse(row.tool_calls);
    messages.push(entry);
  }
  return messages;
}
