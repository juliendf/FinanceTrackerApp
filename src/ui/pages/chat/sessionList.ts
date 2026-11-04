/**
 * Conversation list shaping: recency groups and the right-hand timestamp.
 *
 * Pure so the grouping and the label rules can be tested without rendering.
 * The labels follow the pattern every chat app uses: an hour today, a weekday
 * within the week, a date after that.
 */

import type { Conversation } from "../../../db/repositories/chat";

export interface SessionMeta {
  /** "22:40", "Wed", "16 Oct" — short enough for a narrow column. */
  label: string;
  /** The exact moment, shown as the row's tooltip. */
  title: string;
  /** ISO sort key, so the list never depends on display formatting. */
  iso: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const pad2 = (value: number): string => String(value).padStart(2, "0");

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
 * Under a minute → `now`; under an hour → `5m`; under a day → `3h`; the previous
 * day → `Yesterday`; within a week → `Wed`; older → `16 Oct`.
 *
 * Elapsed time is measured before calendar days, so a message 40 minutes ago
 * across midnight reads `40m` rather than `Yesterday`. Above a day the calendar
 * takes over, which is what makes `Yesterday` mean yesterday rather than "24 to
 * 48 hours ago".
 *
 * Every label is a duration or an unambiguous word; none of them is a clock
 * time, because `23h` in this column read as "23 hours ago" and was in fact
 * 23:00. The exact moment lives in `title`.
 */
export function sessionMeta(updatedAt: string, now: Date = new Date()): SessionMeta {
  const date = parse(updatedAt);
  if (!date) return { label: "", title: updatedAt, iso: updatedAt };

  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const title =
    `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ` +
    `${date.getFullYear()}, ${time}`;

  const elapsed = now.getTime() - date.getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);

  // A timestamp in the future is clock skew, not a countdown.
  if (elapsed < MINUTE) return { label: "now", title, iso: updatedAt };
  if (elapsed < HOUR) return { label: `${Math.floor(elapsed / MINUTE)}m`, title, iso: updatedAt };
  if (elapsed < DAY) return { label: `${Math.floor(elapsed / HOUR)}h`, title, iso: updatedAt };
  if (days === 1) return { label: "Yesterday", title, iso: updatedAt };
  if (days < 7) return { label: WEEKDAYS[date.getDay()], title, iso: updatedAt };
  return { label: `${date.getDate()} ${MONTHS[date.getMonth()]}`, title, iso: updatedAt };
}

export interface SessionGroup<T> {
  /** "Pinned", "This week" or "Earlier". */
  title: string;
  items: Array<T & { meta: SessionMeta }>;
}

/**
 * Split conversations into "Pinned", "This week" and "Earlier", newest first,
 * with the timestamp computed once per row.
 *
 * A pinned conversation appears in Pinned only, never in its date group as well:
 * the same row twice in one list reads as a bug, and the pin is the stronger
 * signal of where the user expects to find it.
 */
export function groupSessions(
  conversations: readonly Conversation[],
  now: Date = new Date(),
): Array<SessionGroup<Conversation>> {
  const pinned: SessionGroup<Conversation>["items"] = [];
  const week: SessionGroup<Conversation>["items"] = [];
  const earlier: SessionGroup<Conversation>["items"] = [];

  for (const conversation of conversations) {
    const item = { ...conversation, meta: sessionMeta(conversation.updated_at, now) };
    if (conversation.pinned_at) {
      pinned.push(item);
      continue;
    }
    const date = parse(conversation.updated_at);
    const days = date ? Math.round((startOfDay(now) - startOfDay(date)) / DAY) : 99;
    (days < 7 ? week : earlier).push(item);
  }

  const groups: Array<SessionGroup<Conversation>> = [];
  if (pinned.length > 0) groups.push({ title: "Pinned", items: pinned });
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
