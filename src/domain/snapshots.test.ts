import { describe, expect, it } from "vitest";
import {
  amountError,
  csvField,
  filterSnapshots,
  generateSnapshotsCsv,
  latestBefore,
  nextSort,
  parseSnapshotFilters,
  snapshotFiltersToParams,
  snapshotFormSchema,
  sortSnapshots,
  validateBulkEdit,
  validateBulkEntry,
  messages,
  type SnapshotListRow,
} from "./snapshots";

const row = (id: number, over: Partial<SnapshotListRow> = {}): SnapshotListRow => ({
  id,
  asset_id: 1,
  date: "2026-01-01",
  amount_minor: 100_00,
  created_at: "2026-01-01T10:00:00.123456",
  updated_at: "2026-01-01T10:00:00",
  asset_name: null,
  product_name: "Livret A",
  institution_id: 1,
  institution_name: "Boursorama",
  category_name: "Cash",
  currency: "EUR",
  ...over,
});

const NO_FILTER = { start_date: "", end_date: "", institution_id: null, currency: "", search: "", min_amount: "", max_amount: "" };

describe("parseSnapshotFilters", () => {
  it("defaults", () => {
    const { filters, warnings } = parseSnapshotFilters(new URLSearchParams());
    expect(filters).toMatchObject({ sort_by: "date", sort_order: "desc", page: 1, per_page: 20, institution_id: null });
    expect(warnings).toEqual([]);
  });
  it("warns on and drops malformed dates", () => {
    const { filters, warnings } = parseSnapshotFilters(new URLSearchParams("start_date=nope&end_date=2026-02-30"));
    expect(filters.start_date).toBe("");
    expect(filters.end_date).toBe("");
    expect(warnings).toEqual(["Invalid start date format", "Invalid end date format"]);
  });
  it("treats any sort_order but desc as asc, caps per_page, falls back below 1", () => {
    const p = (q: string) => parseSnapshotFilters(new URLSearchParams(q)).filters;
    expect(p("sort_order=DESC").sort_order).toBe("asc");
    expect(p("per_page=500").per_page).toBe(100);
    expect(p("per_page=0").per_page).toBe(20);
    expect(p("page=-3").page).toBe(1);
    expect(p("sort_by=bogus").sort_by).toBe("date");
    expect(p("institution_id=abc").institution_id).toBeNull();
  });
  it("round-trips through the query string omitting defaults", () => {
    const { filters } = parseSnapshotFilters(new URLSearchParams("currency=CHF&sort_by=amount&sort_order=asc&page=3"));
    expect(snapshotFiltersToParams(filters).toString()).toBe("currency=CHF&sort_by=amount&sort_order=asc&page=3");
    expect(snapshotFiltersToParams({}).toString()).toBe("");
  });
  it("falls back to the Items Per Page setting when the URL has no per_page", () => {
    const p = (q: string, perPage?: number) =>
      parseSnapshotFilters(new URLSearchParams(q), { perPage }).filters;
    expect(p("", 50).per_page).toBe(50);
    expect(p("per_page=10", 50).per_page).toBe(10);
    // Below 1 is unreadable, and so falls back to the setting like a missing one.
    expect(p("per_page=0", 50).per_page).toBe(50);
    expect(p("", Number.NaN).per_page).toBe(20);
    expect(p("", 5000).per_page).toBe(100);
  });
  it("does not pin the setting into the URL when serialising", () => {
    const defaults = { perPage: 50 };
    expect(snapshotFiltersToParams({ per_page: 50 }, defaults).toString()).toBe("");
    expect(snapshotFiltersToParams({ per_page: 10 }, defaults).toString()).toBe("per_page=10");
  });
});

describe("nextSort", () => {
  it("asc on a new column, flips asc to desc on the same one", () => {
    expect(nextSort({ sort_by: "date", sort_order: "desc" }, "amount")).toEqual({ sort_by: "amount", sort_order: "asc" });
    expect(nextSort({ sort_by: "amount", sort_order: "asc" }, "amount")).toEqual({ sort_by: "amount", sort_order: "desc" });
    expect(nextSort({ sort_by: "amount", sort_order: "desc" }, "amount")).toEqual({ sort_by: "amount", sort_order: "asc" });
  });
});

describe("filterSnapshots", () => {
  const rows = [
    row(1, { date: "2026-01-01", amount_minor: 50_00 }),
    row(2, { date: "2026-02-01", amount_minor: 150_00, currency: "CHF", institution_id: 2, institution_name: "UBS", asset_name: "Salary" }),
    row(3, { date: "2026-03-01", amount_minor: 250_00 }),
  ];
  it("date bounds are inclusive", () => {
    expect(filterSnapshots(rows, { ...NO_FILTER, start_date: "2026-02-01", end_date: "2026-03-01" }).map((r) => r.id)).toEqual([2, 3]);
  });
  it("amount bounds are inclusive", () => {
    expect(filterSnapshots(rows, { ...NO_FILTER, min_amount: "50", max_amount: "150" }).map((r) => r.id)).toEqual([1, 2]);
  });
  it("institution is an id, currency exact", () => {
    expect(filterSnapshots(rows, { ...NO_FILTER, institution_id: 2 }).map((r) => r.id)).toEqual([2]);
    expect(filterSnapshots(rows, { ...NO_FILTER, currency: "CHF" }).map((r) => r.id)).toEqual([2]);
  });
  it("search is case-insensitive over custom name, institution, product, category", () => {
    expect(filterSnapshots(rows, { ...NO_FILTER, search: "salary" }).map((r) => r.id)).toEqual([2]);
    expect(filterSnapshots(rows, { ...NO_FILTER, search: "UBS" }).map((r) => r.id)).toEqual([2]);
    expect(filterSnapshots(rows, { ...NO_FILTER, search: "livret" }).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(filterSnapshots(rows, { ...NO_FILTER, search: "cash" })).toHaveLength(3);
  });
});

describe("sortSnapshots", () => {
  const rows = [
    row(1, { date: "2026-01-01", amount_minor: 300, asset_name: "B" }),
    row(2, { date: "2026-02-01", amount_minor: 100, asset_name: null }),
    row(3, { date: "2026-02-01", amount_minor: 200, asset_name: "A" }),
  ];
  const ids = (s: Parameters<typeof sortSnapshots>[1]) => sortSnapshots(rows, s).map((r) => r.id);
  it("by date, ties by id ascending", () => {
    expect(ids({ sort_by: "date", sort_order: "desc" })).toEqual([2, 3, 1]);
    expect(ids({ sort_by: "date", sort_order: "asc" })).toEqual([1, 2, 3]);
  });
  it("by amount", () => {
    expect(ids({ sort_by: "amount", sort_order: "asc" })).toEqual([2, 3, 1]);
  });
  it("by asset puts NULL names last ascending and first descending", () => {
    expect(ids({ sort_by: "asset", sort_order: "asc" })).toEqual([3, 1, 2]);
    expect(ids({ sort_by: "asset", sort_order: "desc" })).toEqual([2, 1, 3]);
  });
});

describe("CSV", () => {
  it("quotes only when needed and doubles quotes", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
  });
  it("writes CRLF rows, 2dp amounts and second-resolution timestamps", () => {
    const csv = generateSnapshotsCsv([row(1, { amount_minor: 123456, product_name: "A, B" })]);
    expect(csv).toBe(
      "Date,Asset Name,Institution,Product,Category,Amount,Currency,Created At\r\n" +
        '2026-01-01,"Boursorama - A, B (Cash)",Boursorama,"A, B",Cash,1234.56,EUR,2026-01-01 10:00:00\r\n',
    );
  });
});

describe("single-snapshot form", () => {
  const ok = { asset_id: "1", date: "2026-01-01", amount: "10" };
  const messagesOf = (v: object) => {
    const r = snapshotFormSchema.safeParse(v);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };
  it("accepts a valid entry", () => expect(messagesOf(ok)).toEqual([]));
  it("requires asset and date", () => {
    expect(messagesOf({ ...ok, asset_id: "" })).toContain("Please select an asset");
    expect(messagesOf({ ...ok, date: "" })).toContain("Please select a date");
  });
  it("rejects dates beyond tomorrow", () => {
    expect(messagesOf({ ...ok, date: "2999-01-01" })).toContain("Snapshot date cannot be in the future.");
  });
  it("amount rules", () => {
    expect(amountError("")).toBe("Please enter an amount");
    expect(amountError("0")).toBe("Amount must be greater than 0");
    expect(amountError("0.001")).toBe("Amount must be greater than 0");
    expect(amountError("-5")).toBe("Amount must be greater than 0");
    expect(amountError("1000000001")).toBe("Amount seems unusually large. Please verify.");
    expect(amountError("1000000000")).toBeNull();
    expect(amountError("abc")).toBe("Please enter a valid amount.");
  });
  it("duplicate message", () => {
    expect(messages.duplicate("2026-01-01")).toBe(
      "A snapshot for this asset already exists on 2026-01-01. Please choose a different date or edit the existing snapshot.",
    );
  });
});

describe("messages", () => {
  it("formats symbols as a prefix", () => {
    expect(messages.created("X", "2026-01-01", "CHF", 123456)).toBe(
      "Snapshot created successfully for X on 2026-01-01: CHF 1,234.56",
    );
    expect(messages.updated("X", "EUR", { date: "2026-01-01", amountMinor: 100 }, { date: "2026-01-02", amountMinor: 250 })).toBe(
      "Snapshot updated successfully for X. Date: 2026-01-01 → 2026-01-02, Amount: € 1.00 → 2.50",
    );
  });
});

describe("validateBulkEntry", () => {
  const entries = [
    { assetId: 1, label: "A", amount: "10.005" },
    { assetId: 2, label: "B", amount: "" },
    { assetId: 3, label: "C", amount: "5" },
  ];
  const base = { date: "2026-01-01", entries, existingAssetIds: new Set<number>(), today: "2026-06-01" };
  it("skips blanks and converts half-even to minor units", () => {
    const r = validateBulkEntry(base);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ assetId: 1, amountMinor: 1000 }, { assetId: 3, amountMinor: 500 }]);
  });
  it("one bad row blocks the batch and returns no rows", () => {
    const r = validateBulkEntry({ ...base, entries: [...entries, { assetId: 4, label: "D", amount: "0" }] });
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ assetId: 4, message: "D: Amount must be greater than 0" }]);
  });
  it("flags duplicates per row", () => {
    const r = validateBulkEntry({ ...base, existingAssetIds: new Set([3]) });
    expect(r.errors).toEqual([{ assetId: 3, message: "A snapshot for C already exists on 2026-01-01" }]);
    expect(r.rows).toEqual([]);
  });
  it("requires something to enter and a sane date", () => {
    expect(validateBulkEntry({ ...base, entries: [] }).errors[0].message).toBe(
      "Please select at least one asset and enter valid amounts.",
    );
    expect(validateBulkEntry({ ...base, date: "2999-01-01" }).errors[0].message).toBe("Snapshot date cannot be in the future.");
  });
});

describe("validateBulkEdit", () => {
  it("only filled rows change", () => {
    const r = validateBulkEdit([
      { snapshotId: 1, label: "A", amount: "" },
      { snapshotId: 2, label: "B", amount: "12.5" },
    ]);
    expect(r.updates).toEqual([{ snapshotId: 2, amountMinor: 1250 }]);
  });
  it("any invalid row blocks everything", () => {
    const r = validateBulkEdit([
      { snapshotId: 1, label: "A", amount: "3" },
      { snapshotId: 2, label: "B", amount: "-1" },
    ]);
    expect(r.updates).toEqual([]);
    expect(r.errors[0].message).toBe("Invalid amount for B: Amount must be greater than 0");
  });
});

describe("latestBefore", () => {
  const snaps = [
    { asset_id: 1, date: "2026-01-01", amount_minor: 1 },
    { asset_id: 1, date: "2026-02-01", amount_minor: 2 },
    { asset_id: 1, date: "2026-03-01", amount_minor: 3 },
    { asset_id: 2, date: "2026-05-01", amount_minor: 9 },
  ];
  it("is strictly before the reference date", () => {
    const m = latestBefore(snaps, [1, 2], "2026-03-01");
    expect(m.get(1)).toEqual({ date: "2026-02-01", amount_minor: 2 });
    expect(m.has(2)).toBe(false);
  });
});
