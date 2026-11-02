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
 * Page numbers to render, with `null` marking a gap.
 * An edge of 1 on each side, one page before the current one and two after.
 */
export function pageNumbers(
  current: number,
  totalPages: number,
  options: {
    leftEdge?: number;
    rightEdge?: number;
    leftCurrent?: number;
    rightCurrent?: number;
  } = {},
): Array<number | null> {
  const {
    leftEdge = 1,
    rightEdge = 1,
    leftCurrent = 1,
    rightCurrent = 2,
  } = options;

  const result: Array<number | null> = [];
  let lastSeen = 0;

  for (let page = 1; page <= totalPages; page += 1) {
    const nearCurrent =
      page >= current - leftCurrent && page <= current + rightCurrent;
    const nearEdge = page <= leftEdge || page > totalPages - rightEdge;

    if (nearCurrent || nearEdge) {
      if (lastSeen && page - lastSeen > 1) result.push(null);
      result.push(page);
      lastSeen = page;
    }
  }

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

/**
 * Page numbers for the asset list: edges of 2, a window from `current - 2` to
 * `current + 2`.
 *
 * Only the numbers are produced, never the gaps, so a pager built from this
 * shows "1 2 5 6 7 8 9 20 21" with nothing marking the jumps. This returns
 * `null` for a gap so the UI can print an ellipsis instead.
 */
export function assetPageNumbers(
  current: number,
  totalPages: number,
  { leftEdge = 2, leftCurrent = 2, rightCurrent = 3, rightEdge = 2 } = {},
): Array<number | null> {
  const result: Array<number | null> = [];
  let last = 0;
  for (let page = 1; page <= totalPages; page += 1) {
    const keep =
      page <= leftEdge ||
      (current - leftCurrent - 1 < page && page < current + rightCurrent) ||
      page > totalPages - rightEdge;
    if (!keep) continue;
    if (last && page - last > 1) result.push(null);
    result.push(page);
    last = page;
  }
  return result;
}
