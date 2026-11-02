/**
 * Snapshot screens' pure logic: URL filters, filtering, sorting, pagination
 * window, CSV export, form validation and the bulk entry / bulk edit rules.
 *
 * Ports of `routes/snapshots.py`, `forms/snapshot_forms.py` and
 * `utils/snapshot_helpers.py`. The source filters in SQL; the desktop dataset is
 * small, so the joined rows are filtered in memory. That keeps these functions
 * pure and testable against an independent oracle.
 */

import Decimal from "decimal.js";
import { z } from "zod";
import { displayName } from "./assets";
import { isFutureSnapshotDate, isValidIsoDate } from "./dates";
import { formatNumber, formatSymbolAmount } from "./format";
import { fromMinorUnits, toMinorUnits } from "./money";

/** A snapshot joined to its asset, institution and category. */
export interface SnapshotListRow {
  id: number;
  asset_id: number;
  date: string;
  amount_minor: number;
  created_at: string;
  updated_at: string;
  /** The asset's custom name; null when it has none. */
  asset_name: string | null;
  product_name: string;
  institution_id: number;
  institution_name: string;
  category_name: string;
  currency: string;
}

/** `asset.display_name`, or the source's 'Unknown Asset'. */
export function snapshotAssetName(row: SnapshotListRow): string {
  return displayName({
    name: row.asset_name,
    institution_name: row.institution_name,
    product_name: row.product_name,
    category_name: row.category_name,
  });
}

// --- filters ----------------------------------------------------------------

export type SortBy = "date" | "amount" | "asset";
export type SortOrder = "asc" | "desc";

export interface SnapshotFilters {
  start_date: string;
  end_date: string;
  institution_id: number | null;
  currency: string;
  search: string;
  /** Decimal text, or "" when absent or unparseable. */
  min_amount: string;
  max_amount: string;
  sort_by: SortBy;
  sort_order: SortOrder;
  page: number;
  per_page: number;
}

export const DEFAULT_SNAPSHOT_FILTERS: SnapshotFilters = {
  start_date: "",
  end_date: "",
  institution_id: null,
  currency: "",
  search: "",
  min_amount: "",
  max_amount: "",
  sort_by: "date",
  sort_order: "desc",
  page: 1,
  per_page: 20,
};

export const MAX_PER_PAGE = 100;

/** Flask's `type=int`: anything unparseable becomes "absent". */
function intOrNull(value: string | null): number | null {
  if (value === null || !/^[+-]?\d+$/.test(value.trim())) return null;
  return Number.parseInt(value, 10);
}

/** Flask's `type=float`. Kept as text so the input shows what was typed. */
function floatText(value: string | null): string {
  if (value === null || value.trim() === "") return "";
  return Number.isFinite(Number(value)) ? value.trim() : "";
}

export interface ParsedSnapshotFilters {
  filters: SnapshotFilters;
  /** What `_apply_snapshot_filters` flashes for a malformed date. */
  warnings: string[];
}

/** Read the URL query the way `list_snapshots` reads `request.args`. */
export function parseSnapshotFilters(params: URLSearchParams): ParsedSnapshotFilters {
  const warnings: string[] = [];

  let start = (params.get("start_date") ?? "").trim();
  if (start && !isValidIsoDate(start)) {
    warnings.push("Invalid start date format");
    start = "";
  }
  let end = (params.get("end_date") ?? "").trim();
  if (end && !isValidIsoDate(end)) {
    warnings.push("Invalid end date format");
    end = "";
  }

  const sortBy = params.get("sort_by");
  const sort_by: SortBy = sortBy === "amount" || sortBy === "asset" ? sortBy : "date";
  // `if sort_order == 'desc'` — anything else, including a typo, sorts ascending.
  const sort_order: SortOrder = (params.get("sort_order") ?? "desc") === "desc" ? "desc" : "asc";

  // Flask-SQLAlchemy `paginate`: per_page capped at 100, below 1 falls back to 20,
  // a page below 1 becomes 1.
  const perPageRaw = intOrNull(params.get("per_page")) ?? 20;
  const per_page = perPageRaw < 1 ? 20 : Math.min(perPageRaw, MAX_PER_PAGE);
  const page = Math.max(intOrNull(params.get("page")) ?? 1, 1);

  return {
    filters: {
      start_date: start,
      end_date: end,
      institution_id: intOrNull(params.get("institution_id")),
      currency: (params.get("currency") ?? "").trim(),
      search: params.get("search") ?? "",
      min_amount: floatText(params.get("min_amount")),
      max_amount: floatText(params.get("max_amount")),
      sort_by,
      sort_order,
      page,
      per_page,
    },
    warnings,
  };
}

/** Serialise back to a query, omitting defaults. */
export function snapshotFiltersToParams(filters: Partial<SnapshotFilters>): URLSearchParams {
  const params = new URLSearchParams();
  const d = DEFAULT_SNAPSHOT_FILTERS;
  for (const key of ["start_date", "end_date", "currency", "search", "min_amount", "max_amount"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (filters.institution_id !== null && filters.institution_id !== undefined) {
    params.set("institution_id", String(filters.institution_id));
  }
  if (filters.sort_by && filters.sort_by !== d.sort_by) params.set("sort_by", filters.sort_by);
  if (filters.sort_order && filters.sort_order !== d.sort_order) params.set("sort_order", filters.sort_order);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  if (filters.per_page && filters.per_page !== d.per_page) params.set("per_page", String(filters.per_page));
  return params;
}

/** Header click: ascending on a new column, flip asc to desc on the same one. */
export function nextSort(
  current: Pick<SnapshotFilters, "sort_by" | "sort_order">,
  clicked: SortBy,
): { sort_by: SortBy; sort_order: SortOrder } {
  const flip = current.sort_by === clicked && current.sort_order === "asc";
  return { sort_by: clicked, sort_order: flip ? "desc" : "asc" };
}

const amountOf = (row: SnapshotListRow): Decimal =>
  fromMinorUnits(row.amount_minor) ?? new Decimal(0);

/** `_apply_snapshot_filters`. */
export function filterSnapshots(
  rows: readonly SnapshotListRow[],
  filters: Pick<
    SnapshotFilters,
    "start_date" | "end_date" | "institution_id" | "currency" | "search" | "min_amount" | "max_amount"
  >,
): SnapshotListRow[] {
  const needle = filters.search.toLowerCase();
  const min = filters.min_amount === "" ? null : new Decimal(filters.min_amount);
  const max = filters.max_amount === "" ? null : new Decimal(filters.max_amount);

  return rows.filter((row) => {
    if (filters.start_date && row.date < filters.start_date) return false;
    if (filters.end_date && row.date > filters.end_date) return false;
    if (filters.institution_id !== null && row.institution_id !== filters.institution_id) return false;
    if (filters.currency && row.currency !== filters.currency) return false;
    if (min !== null && amountOf(row).lessThan(min)) return false;
    if (max !== null && amountOf(row).greaterThan(max)) return false;
    if (needle) {
      // Asset.name (the *custom* name), institution, product and category.
      const fields = [row.asset_name ?? "", row.institution_name, row.product_name, row.category_name];
      if (!fields.some((field) => field.toLowerCase().includes(needle))) return false;
    }
    return true;
  });
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * `ORDER BY` for the list.
 *
 * Sorting by asset uses the *custom* name column, which is NULL for most assets;
 * PostgreSQL (the source) puts NULLs last ascending and first descending. The
 * source gives no tie-break, so equal keys come back in arbitrary order there;
 * here they fall back to newest date, then id, which is deterministic.
 */
export function sortSnapshots(
  rows: readonly SnapshotListRow[],
  sort: Pick<SnapshotFilters, "sort_by" | "sort_order">,
): SnapshotListRow[] {
  const factor = sort.sort_order === "asc" ? 1 : -1;

  const primary = (a: SnapshotListRow, b: SnapshotListRow): number => {
    switch (sort.sort_by) {
      case "amount":
        return a.amount_minor - b.amount_minor;
      case "asset": {
        if (a.asset_name === b.asset_name) return 0;
        if (a.asset_name === null) return 1; // NULLS LAST when ascending
        if (b.asset_name === null) return -1;
        return compareText(a.asset_name, b.asset_name);
      }
      default:
        return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    }
  };

  return [...rows].sort(
    (a, b) =>
      factor * primary(a, b) ||
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      a.id - b.id,
  );
}

export interface SnapshotSummary {
  totalCount: number;
  dateRange: { start: string | null; end: string | null };
}

/** The only tile the template still renders: count and date range. */
export function summariseSnapshots(rows: readonly Pick<SnapshotListRow, "date">[]): SnapshotSummary {
  if (rows.length === 0) return { totalCount: 0, dateRange: { start: null, end: null } };
  let start = rows[0].date;
  let end = rows[0].date;
  for (const row of rows) {
    if (row.date < start) start = row.date;
    if (row.date > end) end = row.date;
  }
  return { totalCount: rows.length, dateRange: { start, end } };
}

/** Distinct currencies, sorted, as the filter dropdown offers them. */
export function snapshotCurrencyOptions(rows: readonly Pick<SnapshotListRow, "currency">[]): string[] {
  return [...new Set(rows.map((row) => row.currency).filter(Boolean))].sort();
}

/**
 * Flask-SQLAlchemy 3 `Pagination.iter_pages` with its defaults
 * (`left_edge=2, left_current=2, right_current=4, right_edge=2`), `null` marking
 * a gap. The asset list uses a different helper, `assetPageNumbers`.
 */
export function flaskPageNumbers(
  current: number,
  totalPages: number,
  { leftEdge = 2, leftCurrent = 2, rightCurrent = 4, rightEdge = 2 } = {},
): Array<number | null> {
  const end = totalPages + 1;
  if (end === 1) return [];

  const result: Array<number | null> = [];
  const range = (from: number, to: number) => {
    for (let n = from; n < to; n += 1) result.push(n);
  };

  const leftEnd = Math.min(1 + leftEdge, end);
  range(1, leftEnd);
  if (leftEnd === end) return result;

  const midStart = Math.max(leftEnd, current - leftCurrent);
  const midEnd = Math.min(current + rightCurrent + 1, end);
  if (midStart - leftEnd > 0) result.push(null);
  range(midStart, midEnd);
  if (midEnd === end) return result;

  const rightStart = Math.max(midEnd, end - rightEdge);
  if (rightStart - midEnd > 0) result.push(null);
  range(rightStart, end);
  return result;
}

// --- CSV export --------------------------------------------------------------

export const CSV_HEADERS = [
  "Date",
  "Asset Name",
  "Institution",
  "Product",
  "Category",
  "Amount",
  "Currency",
  "Created At",
] as const;

/**
 * One field as Python's `csv.writer` (default "excel" dialect, QUOTE_MINIMAL)
 * writes it: quoted only when it holds a comma, a double quote or a line break,
 * with embedded quotes doubled.
 */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** `strftime('%Y-%m-%d %H:%M:%S')` of a stored ISO timestamp; '' when missing. */
export function csvTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 19).replace("T", " ");
}

/**
 * `SnapshotHelper.generate_csv_export`.
 *
 * Rows end in `\r\n`, which is what `csv.writer` emits whatever the platform,
 * and the export is newest first. The amount is `f"{amount:.2f}"`.
 */
export function generateSnapshotsCsv(rows: readonly SnapshotListRow[]): string {
  const lines = [CSV_HEADERS.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        snapshotAssetName(row),
        row.institution_name,
        row.product_name,
        row.category_name,
        (fromMinorUnits(row.amount_minor) ?? new Decimal(0)).toFixed(2),
        row.currency,
        csvTimestamp(row.created_at),
      ]
        .map(csvField)
        .join(","),
    );
  }
  return lines.map((line) => `${line}\r\n`).join("");
}

/** `snapshots_export_{date.today()}.csv` */
export function csvFileName(today: string): string {
  return `snapshots_export_${today}.csv`;
}

// --- messages ----------------------------------------------------------------

/** `Asset.formatted_currency` for the flash messages. */
function symbolOf(currency: string): string {
  return ({ EUR: "€", USD: "$", CHF: "CHF" } as Record<string, string>)[currency] ?? currency;
}

export const messages = {
  duplicate: (date: string) =>
    `A snapshot for this asset already exists on ${date}. Please choose a different date or edit the existing snapshot.`,
  created: (assetName: string, date: string, currency: string, amountMinor: number) =>
    `Snapshot created successfully for ${assetName} on ${date}: ${formatSymbolAmount(symbolOf(currency), fromMinorUnits(amountMinor) ?? new Decimal(0))}`,
  updated: (
    assetName: string,
    currency: string,
    before: { date: string; amountMinor: number },
    after: { date: string; amountMinor: number },
  ) => {
    const sym = symbolOf(currency);
    const was = fromMinorUnits(before.amountMinor) ?? new Decimal(0);
    const now = fromMinorUnits(after.amountMinor) ?? new Decimal(0);
    return (
      `Snapshot updated successfully for ${assetName}. ` +
      `Date: ${before.date} → ${after.date}, ` +
      `Amount: ${formatSymbolAmount(sym, was)} → ${formatNumber(now)}`
    );
  },
  deleted: (assetName: string, date: string, currency: string, amountMinor: number) =>
    `Snapshot deleted successfully: ${assetName} on ${date} (${formatSymbolAmount(symbolOf(currency), fromMinorUnits(amountMinor) ?? new Decimal(0))})`,
  bulkDeleted: (count: number) => `Successfully deleted ${count} snapshots.`,
  bulkCreated: (count: number) => `Successfully created ${count} snapshots.`,
  bulkUpdated: (count: number) => `Successfully updated ${count} snapshots.`,
} as const;

// --- single-snapshot form ----------------------------------------------------

/** `validate_amount`'s upper bound. */
export const MAX_AMOUNT = new Decimal(1_000_000_000);
const MIN_AMOUNT = new Decimal("0.01");

/** Shared amount rules; returns the message for the first failure, or null. */
export function amountError(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "Please enter an amount";
  let value: Decimal;
  try {
    value = new Decimal(text);
  } catch {
    return "Please enter a valid amount.";
  }
  if (!value.isFinite()) return "Please enter a valid amount.";
  if (value.lessThan(MIN_AMOUNT)) return "Amount must be greater than 0";
  if (value.greaterThan(MAX_AMOUNT)) return "Amount seems unusually large. Please verify.";
  return null;
}

export const snapshotFormSchema = z
  .object({
    asset_id: z.string().min(1, "Please select an asset"),
    date: z.string().trim().min(1, "Please select a date"),
    amount: z.string(),
  })
  .superRefine((value, context) => {
    if (value.date && !isValidIsoDate(value.date)) {
      context.addIssue({ code: "custom", path: ["date"], message: "Please enter a valid date." });
    } else if (value.date && isFutureSnapshotDate(value.date)) {
      context.addIssue({ code: "custom", path: ["date"], message: "Snapshot date cannot be in the future." });
    }
    const problem = amountError(value.amount);
    if (problem) context.addIssue({ code: "custom", path: ["amount"], message: problem });
  });

export type SnapshotFormValues = z.infer<typeof snapshotFormSchema>;

/** Amount in minor units, half-even — the same conversion every write uses. */
export function amountToMinor(raw: string): number {
  return toMinorUnits(raw.trim());
}

// --- bulk entry ---------------------------------------------------------------

export interface BulkEntryRow {
  assetId: number;
  /** Shown in the per-asset error message (the asset's display name). */
  label: string;
  /** Raw input; empty means "skip this asset". */
  amount: string;
}

export interface BulkError {
  /** null for an error about the form rather than a row. */
  assetId: number | null;
  message: string;
}

export interface BulkEntryResult {
  errors: BulkError[];
  /** Populated only when there are no errors, so a caller cannot half-write. */
  rows: Array<{ assetId: number; amountMinor: number }>;
}

/**
 * `BulkSnapshotForm` + `validate_selected_assets_from_request`.
 *
 * Every row is validated before anything is written, and one bad row blocks the
 * whole batch, which is what the source's pre-check does for duplicates and what
 * the brief asks for ("nothing is written"). Differences from the source are
 * recorded in docs/DEVIATIONS.md: a zero or negative amount is flagged on its
 * row instead of being silently dropped.
 */
export function validateBulkEntry(input: {
  date: string;
  entries: readonly BulkEntryRow[];
  /** Asset ids that already have a snapshot on `date`. */
  existingAssetIds: ReadonlySet<number>;
  today?: string;
}): BulkEntryResult {
  const errors: BulkError[] = [];

  if (!input.date) {
    errors.push({ assetId: null, message: "Please select a date" });
  } else if (!isValidIsoDate(input.date)) {
    errors.push({ assetId: null, message: "Please enter a valid date." });
  } else if (isFutureSnapshotDate(input.date, input.today)) {
    errors.push({ assetId: null, message: "Snapshot date cannot be in the future." });
  }

  const filled = input.entries.filter((entry) => entry.amount.trim() !== "");
  if (filled.length === 0) {
    errors.push({ assetId: null, message: "Please select at least one asset and enter valid amounts." });
    return { errors, rows: [] };
  }

  const rows: BulkEntryResult["rows"] = [];
  for (const entry of filled) {
    const problem = amountError(entry.amount);
    if (problem) {
      errors.push({ assetId: entry.assetId, message: `${entry.label}: ${problem}` });
      continue;
    }
    if (input.existingAssetIds.has(entry.assetId)) {
      errors.push({
        assetId: entry.assetId,
        message: `A snapshot for ${entry.label} already exists on ${input.date}`,
      });
      continue;
    }
    rows.push({ assetId: entry.assetId, amountMinor: amountToMinor(entry.amount) });
  }

  return errors.length > 0 ? { errors, rows: [] } : { errors, rows };
}

// --- bulk edit -----------------------------------------------------------------

export interface BulkEditRow {
  snapshotId: number;
  label: string;
  /** Raw input; empty keeps the current value. */
  amount: string;
}

export interface BulkEditResult {
  errors: BulkError[];
  updates: Array<{ snapshotId: number; amountMinor: number }>;
}

/**
 * `bulk_edit_snapshots` (POST): only filled fields change, each must be above 0.
 *
 * The source commits the valid rows and flashes the rest; here any invalid row
 * blocks the batch so the result is all-or-nothing, like bulk entry.
 */
export function validateBulkEdit(rows: readonly BulkEditRow[]): BulkEditResult {
  const errors: BulkError[] = [];
  const updates: BulkEditResult["updates"] = [];

  for (const row of rows) {
    if (row.amount.trim() === "") continue;
    const problem = amountError(row.amount);
    if (problem) {
      errors.push({ assetId: null, message: `Invalid amount for ${row.label}: ${problem}` });
      continue;
    }
    updates.push({ snapshotId: row.snapshotId, amountMinor: amountToMinor(row.amount) });
  }

  return errors.length > 0 ? { errors, updates: [] } : { errors, updates };
}

// --- previous values ---------------------------------------------------------------

/**
 * `/bulk/copy-previous`: for each asset, its latest snapshot *strictly before*
 * `referenceDate`.
 */
export function latestBefore(
  snapshots: ReadonlyArray<{ asset_id: number; date: string; amount_minor: number }>,
  assetIds: readonly number[],
  referenceDate: string,
): Map<number, { date: string; amount_minor: number }> {
  const wanted = new Set(assetIds);
  const out = new Map<number, { date: string; amount_minor: number }>();
  for (const snapshot of snapshots) {
    if (!wanted.has(snapshot.asset_id) || snapshot.date >= referenceDate) continue;
    const current = out.get(snapshot.asset_id);
    if (!current || snapshot.date > current.date) {
      out.set(snapshot.asset_id, { date: snapshot.date, amount_minor: snapshot.amount_minor });
    }
  }
  return out;
}
