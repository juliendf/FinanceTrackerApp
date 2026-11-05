/**
 * A conversation as Markdown.
 *
 * Two choices worth stating:
 *
 *   * **tool calls become one line.** The stored `tool_calls` blob is large JSON
 *     and unreadable in a document; what matters to a reader is which lookups
 *     happened, so the function names are listed and the payloads are dropped.
 *   * **`system` and `tool` rows are not messages.** They are plumbing — the
 *     system prompt and raw tool output — and rendering them would turn an
 *     export into a log.
 *
 * Nothing here talks to the filesystem: the caller hands the string to
 * `save_text_file`, which opens the native dialog in Rust.
 */

import type { Message } from "../db/repositories/chat";
import { toolCallNames } from "../llm/history";

const pad2 = (value: number): string => String(value).padStart(2, "0");

const dayOf = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** Split a stored timestamp into its day and its clock time. */
function stamp(iso: string): { day: string; time: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { day: dayOf(date), time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}` };
}

export interface ConversationMarkdownInput {
  title: string;
  /** When the conversation started; omitted when unknown. */
  createdAt: string | null;
  messages: readonly Message[];
  exportedAt?: Date;
}

export function conversationMarkdown({
  title,
  createdAt,
  messages,
  exportedAt = new Date(),
}: ConversationMarkdownInput): string {
  const lines: string[] = [`# ${title}`, ""];

  const started = createdAt ? stamp(createdAt) : null;
  lines.push(
    `Exported from FinanceTracker on ${dayOf(exportedAt)}.` +
      (started ? ` Started ${started.day} at ${started.time}.` : ""),
  );
  lines.push("");

  let currentDay = "";
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;

    const text = (message.content ?? "").trim();
    const looked =
      message.role === "assistant" && message.tool_calls
        ? Object.values(toolCallNames(message.tool_calls))
        : [];
    if (!text && looked.length === 0) continue;

    const when = stamp(message.created_at);
    if (when && when.day !== currentDay) {
      currentDay = when.day;
      lines.push(`## ${when.day}`, "");
    }

    lines.push(`**${message.role === "user" ? "You" : "Advisor"}**${when ? ` · ${when.time}` : ""}`, "");
    if (text) lines.push(text, "");
    if (looked.length > 0) lines.push(`> Looked up: ${looked.join(", ")}`, "");
  }

  // Collapse the runs of blank lines the per-section pushes leave behind.
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** `2026-11-05` from a date, for the file name. */
export const todayStamp = (date: Date = new Date()): string => dayOf(date);

/**
 * `retirement-picture-2026-11-05.md`
 *
 * Accents are folded rather than stripped, so "Prévoyance" becomes
 * "prevoyance" and not "pr-voyance".
 */
export function conversationFileName(title: string, day: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "conversation"}-${day}.md`;
}
