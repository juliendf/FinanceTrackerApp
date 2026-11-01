import { describe, expect, it } from "vitest";
import { ageFromBirthDate } from "./age";

describe("ageFromBirthDate", () => {
  it("counts completed years", () => {
    expect(ageFromBirthDate("1990-03-15", "2026-11-01")).toBe(36);
    expect(ageFromBirthDate("1990-12-15", "2026-11-01")).toBe(35);
  });

  it("turns over on the birthday itself", () => {
    expect(ageFromBirthDate("1990-11-01", "2026-11-01")).toBe(36);
    expect(ageFromBirthDate("1990-11-02", "2026-11-01")).toBe(35);
  });

  it("returns null for missing, malformed or future dates", () => {
    expect(ageFromBirthDate(null, "2026-11-01")).toBeNull();
    expect(ageFromBirthDate("", "2026-11-01")).toBeNull();
    expect(ageFromBirthDate("15/03/1990", "2026-11-01")).toBeNull();
    expect(ageFromBirthDate("2030-01-01", "2026-11-01")).toBeNull();
    expect(ageFromBirthDate("1890-01-01", "2026-11-01")).toBeNull();
  });
});
