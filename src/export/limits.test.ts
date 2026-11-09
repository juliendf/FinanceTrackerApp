import { describe, expect, it } from "vitest";
import { humanSize, oversizeWarning, READ_LIMIT_FALLBACK_BYTES, utf8Bytes } from "./limits";

describe("backup size guard", () => {
  it("measures the file in UTF-8 bytes, not JavaScript characters", () => {
    expect(utf8Bytes("abc")).toBe(3);
    // "é" is one UTF-16 unit but two bytes; a backup full of French text would
    // otherwise be under-reported.
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("€")).toBe(3);
  });

  it("says nothing for a backup that fits", () => {
    expect(oversizeWarning(242_082, READ_LIMIT_FALLBACK_BYTES)).toBeNull();
    // Exactly at the limit is still readable: the check is `>`.
    expect(oversizeWarning(READ_LIMIT_FALLBACK_BYTES, READ_LIMIT_FALLBACK_BYTES)).toBeNull();
  });

  it("names both sizes when the file is over the limit", () => {
    const warning = oversizeWarning(62 * 1024 * 1024, READ_LIMIT_FALLBACK_BYTES);
    expect(warning).toContain("62.0 MB");
    expect(warning).toContain("50.0 MB");
    expect(warning).toContain("could not be imported back");
  });

  it("reads as kilobytes below a megabyte", () => {
    expect(humanSize(242_082)).toBe("236 KB");
    expect(humanSize(1024)).toBe("1 KB");
    expect(humanSize(0)).toBe("1 KB");
    expect(humanSize(1_048_576)).toBe("1.0 MB");
  });
});
