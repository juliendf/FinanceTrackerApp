/**
 * Conversation list shaping: recency groups and the right-hand timestamp.
 *
 * Pure so the grouping and the label rules can be tested without rendering.
 * The labels follow the pattern every chat app uses: an hour today, a weekday
 * within the week, a date after that.
 */

import type { Conversation } from "../../../db/repositories/chat";

export interface SessionMeta {
  /** "22h", "Wed", "16 Oct" — short enough for a narrow column. */
  label: string;
  /** ISO sort key, so the list never depends on display formatting. */
  iso: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse the stored `YYYY-MM-DDTHH:MM:SS(.sss)Z` timestamp. */
function parse(timestamp: string): Date | null {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * When the conversation last changed, as a short label.
 *
 * Today → `22h`; within seven days → `Wed`; older → `16 Oct`.
 */
export function sessionMeta(updatedAt: string, now: Date = new Date()): SessionMeta {
  const date = parse(updatedAt);
  if (!date) return { label: "", iso: updatedAt };

  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return { label: `${date.getHours()}h`, iso: updatedAt };
  if (days < 7) return { label: WEEKDAYS[date.getDay()], iso: updatedAt };
  return { label: `${date.getDate()} ${MONTHS[date.getMonth()]}`, iso: updatedAt };
}

export interface SessionGroup<T> {
  /** "This week" or "Earlier". */
  title: string;
  items: Array<T & { meta: SessionMeta }>;
}

/**
 * Split conversations into "This week" and "Earlier", newest first, with the
 * timestamp computed once per row.
 */
export function groupSessions(
  conversations: readonly Conversation[],
  now: Date = new Date(),
): Array<SessionGroup<Conversation>> {
  const week: SessionGroup<Conversation>["items"] = [];
  const earlier: SessionGroup<Conversation>["items"] = [];

  for (const conversation of conversations) {
    const item = { ...conversation, meta: sessionMeta(conversation.updated_at, now) };
    const date = parse(conversation.updated_at);
    const days = date ? Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000) : 99;
    (days < 7 ? week : earlier).push(item);
  }

  const groups: Array<SessionGroup<Conversation>> = [];
  if (week.length > 0) groups.push({ title: "This week", items: week });
  if (earlier.length > 0) groups.push({ title: "Earlier", items: earlier });
  return groups;
}

/** Case-insensitive title filter; an empty needle keeps everything. */
export function filterSessions<T extends { title: string }>(conversations: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...conversations];
  return conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle));
}
