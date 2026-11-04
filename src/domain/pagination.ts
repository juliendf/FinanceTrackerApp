/**
 * Pagination and sorting helpers — pure, no Tauri imports.
 *
 * page/per_page are 1-based, the pager shows edges and a window around the
 * current page with nulls for gaps.
 */

export interface Page<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  pages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * Per-page fallback for a list screen.
 *
 * The URL query is the source of truth for what a view currently shows; this is
 * what to use when the query says nothing, which is the Items Per Page setting.
 */
export interface ListDefaults {
  perPage?: number;
}

/**
 * Clamp a per-page value into the range a list query accepts.
 *
 * The fallback comes from a setting, which is stored as TEXT and coerced with
 * `Number()` on read: a corrupted row yields NaN, and NaN would propagate into
 * `paginate` and blank the list. Returning the fallback keeps that impossible.
 */
export function clampPerPage(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

export function paginate<T>(items: readonly T[], page: number, perPage: number): Page<T> {
  const requested = Math.floor(perPage);
  // A rogue page size (0, negative, NaN) falls back to the default rather than
  // producing one row per page.
  const safePerPage = Number.isFinite(requested) && requested > 0 ? requested : 20;
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / safePerPage));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (safePage - 1) * safePerPage;

  return {
    items: items.slice(start, start + safePerPage),
    page: safePage,
    perPage: safePerPage,
    total,
    pages,
    hasPrev: safePage > 1,
    hasNext: safePage < pages,
  };
}

/**
 * The pager always renders this many slots, so its width never changes.
 *
 * A centred pager whose item count varies slides sideways on every click: the
 * asset list showed 6 slots on page 1 and 10 in the middle, which moved the
 * whole row by about two buttons. Fixing the count makes the strip still.
 */
export const PAGER_SLOTS = 9;

/**
 * Page numbers to render, with `null` marking a gap.
 *
 * Returns every page when there are `PAGER_SLOTS` or fewer, and exactly
 * `PAGER_SLOTS` entries otherwise, whatever the current page. Keeping the count
 * constant is what stops the pager moving under the cursor.
 */
export function pageNumbers(current: number, totalPages: number): Array<number | null> {
  const total = Math.floor(totalPages);
  if (!Number.isFinite(total) || total < 1) return [];
  if (total <= PAGER_SLOTS) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const page = Math.min(Math.max(Math.floor(current) || 1, 1), total);

  // A gap costs a slot, and a gap only exists when the window does not touch its
  // edge. Start with the smallest window two gaps leave room for, read off which
  // edges are open, then widen to fill what is left.
  let size = PAGER_SLOTS - 4;
  const clampWindow = (): { start: number; end: number } => {
    let start = page - Math.floor((size - 1) / 2);
    let end = start + size - 1;
    if (start < 2) {
      start = 2;
      end = start + size - 1;
    }
    if (end > total - 1) {
      end = total - 1;
      start = end - size + 1;
    }
    return { start, end };
  };

  let { start, end } = clampWindow();
  size = PAGER_SLOTS - 2 - (start > 2 ? 1 : 0) - (end < total - 1 ? 1 : 0);
  ({ start, end } = clampWindow());

  const result: Array<number | null> = [1];
  if (start > 2) result.push(null);
  for (let n = start; n <= end; n += 1) result.push(n);
  if (end < total - 1) result.push(null);
  result.push(total);
  return result;
}

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string | null;
  direction: SortDirection;
}

/** Cycle a column: none -> asc -> desc -> none, as the sortable headers do. */
export function nextSortState(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return { key: null, direction: "asc" };
}

/** Compare two values without throwing on nulls, numbers, or mixed types. */
function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  const left = String(a);
  const right = String(b);
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

/** Stable sort by one key. `key === null` returns the input order. */
export function sortRows<T extends object>(
  rows: readonly T[],
  state: SortState,
): T[] {
  if (!state.key) return [...rows];
  const key = state.key;
  const factor = state.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) =>
    factor * compare(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

/** First/last visible row numbers for the "Showing X to Y of Z" label. */
export function paginationLabel(page: Page<unknown>): string {
  if (page.total === 0) return "No entries";
  const first = page.perPage * (page.page - 1) + 1;
  const last =
    page.page < page.pages ? page.perPage * page.page : page.total;
  return `Showing ${first} to ${last} of ${page.total} entries`;
}
