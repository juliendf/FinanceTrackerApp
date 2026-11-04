import { describe, expect, it } from "vitest";
import {
  nextSortState,
  pageNumbers,
  paginate,
  paginationLabel,
  sortRows,
} from "./pagination";

const items = Array.from({ length: 45 }, (_, index) => index + 1);

describe("paginate", () => {
  it("slices the requested page", () => {
    const page = paginate(items, 2, 20);
    expect(page.items).toHaveLength(20);
    expect(page.items[0]).toBe(21);
    expect(page.items[19]).toBe(40);
    expect(page.pages).toBe(3);
    expect(page.hasPrev).toBe(true);
    expect(page.hasNext).toBe(true);
  });

  it("puts the remainder on the last page", () => {
    const page = paginate(items, 3, 20);
    expect(page.items).toHaveLength(5);
    expect(page.hasNext).toBe(false);
  });

  it("clamps out-of-range pages instead of returning nothing", () => {
    expect(paginate(items, 99, 20).page).toBe(3);
    expect(paginate(items, 0, 20).page).toBe(1);
    expect(paginate(items, -5, 20).page).toBe(1);
  });

  it("handles an empty collection", () => {
    const page = paginate([], 1, 20);
    expect(page.items).toEqual([]);
    expect(page.pages).toBe(1);
    expect(page.hasPrev).toBe(false);
    expect(page.hasNext).toBe(false);
  });

  it("guards against a zero or negative page size", () => {
    expect(paginate(items, 1, 0).perPage).toBe(20);
    expect(paginate(items, 1, -3).perPage).toBe(20);
  });
});

describe("pageNumbers", () => {
  it("lists every page when there are few", () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(2, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(1, 0)).toEqual([]);
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps the slot count constant once the pages overflow", () => {
    // The pager is centred, so a varying width slides it sideways on every
    // click. Every page of a 20-page list must yield the same number of slots.
    for (let page = 1; page <= 20; page += 1) {
      expect(pageNumbers(page, 20), `page ${page}`).toHaveLength(9);
    }
    for (let page = 1; page <= 10; page += 1) {
      expect(pageNumbers(page, 10), `page ${page}`).toHaveLength(9);
    }
  });

  it("collapses the gap with nulls", () => {
    expect(pageNumbers(1, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, null, 10]);
    expect(pageNumbers(10, 10)).toEqual([1, null, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("keeps a window around the current page", () => {
    expect(pageNumbers(5, 10)).toEqual([1, null, 3, 4, 5, 6, 7, null, 10]);
    expect(pageNumbers(10, 20)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
    expect(pageNumbers(20, 20)).toEqual([1, null, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("stays inside the range on a rogue current page", () => {
    expect(pageNumbers(0, 20)).toEqual(pageNumbers(1, 20));
    expect(pageNumbers(99, 20)).toEqual(pageNumbers(20, 20));
  });
});

describe("nextSortState", () => {
  it("cycles none -> asc -> desc -> none", () => {
    const start = { key: null, direction: "asc" as const };
    const asc = nextSortState(start, "amount");
    expect(asc).toEqual({ key: "amount", direction: "asc" });

    const desc = nextSortState(asc, "amount");
    expect(desc).toEqual({ key: "amount", direction: "desc" });

    const cleared = nextSortState(desc, "amount");
    expect(cleared).toEqual({ key: null, direction: "asc" });
  });

  it("restarts at asc when switching column", () => {
    expect(nextSortState({ key: "a", direction: "desc" }, "b")).toEqual({
      key: "b",
      direction: "asc",
    });
  });
});

describe("sortRows", () => {
  const rows = [
    { name: "charlie", amount: 30 },
    { name: "Alpha", amount: 10 },
    { name: "bravo", amount: 20 },
  ];

  it("sorts strings case-insensitively", () => {
    expect(sortRows(rows, { key: "name", direction: "asc" }).map((r) => r.name)).toEqual([
      "Alpha",
      "bravo",
      "charlie",
    ]);
  });

  it("sorts numbers", () => {
    expect(sortRows(rows, { key: "amount", direction: "desc" }).map((r) => r.amount)).toEqual([
      30, 20, 10,
    ]);
  });

  it("returns input order when no key is set", () => {
    expect(sortRows(rows, { key: null, direction: "asc" })).toEqual(rows);
  });

  it("does not mutate the input", () => {
    const copy = [...rows];
    sortRows(rows, { key: "amount", direction: "asc" });
    expect(rows).toEqual(copy);
  });

  it("sorts nulls first", () => {
    const withNull = [{ v: 2 }, { v: null }, { v: 1 }];
    expect(sortRows(withNull, { key: "v", direction: "asc" }).map((r) => r.v)).toEqual([
      null,
      1,
      2,
    ]);
  });
});

describe("paginationLabel", () => {
  it("reports the visible window", () => {
    expect(paginationLabel(paginate(items, 1, 20))).toBe("Showing 1 to 20 of 45 entries");
    expect(paginationLabel(paginate(items, 3, 20))).toBe("Showing 41 to 45 of 45 entries");
  });

  it("says so when there is nothing", () => {
    expect(paginationLabel(paginate([], 1, 20))).toBe("No entries");
  });
});
