/**
 * Reference-data validation tests.
 *
 * The colour asymmetry is deliberate: categories require six hex digits, tags
 * accept three or six.
 */

import { describe, expect, it } from "vitest";
import {
  categorySchema,
  HEX_3_OR_6,
  HEX_6,
  institutionSchema,
  systemRoleLabel,
  tagSchema,
  uniqueErrorFor,
} from "./referenceData";

describe("institutionSchema", () => {
  it("accepts a name and an optional description", () => {
    expect(institutionSchema.safeParse({ name: "UBS", description: "" }).success).toBe(true);
    expect(institutionSchema.safeParse({ name: "UBS", description: "Main bank" }).success).toBe(true);
  });

  it("trims the name", () => {
    const result = institutionSchema.parse({ name: "  UBS  ", description: "" });
    expect(result.name).toBe("UBS");
  });

  it("requires a name", () => {
    const result = institutionSchema.safeParse({ name: "   ", description: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Institution name is required");
    }
  });

  it("caps the name at 100 characters and the description at 500", () => {
    expect(institutionSchema.safeParse({ name: "a".repeat(101), description: "" }).success).toBe(false);
    expect(institutionSchema.safeParse({ name: "a", description: "b".repeat(501) }).success).toBe(false);
    expect(institutionSchema.safeParse({ name: "a".repeat(100), description: "" }).success).toBe(true);
    expect(institutionSchema.safeParse({ name: "a", description: "b".repeat(500) }).success).toBe(true);
  });
});

describe("categorySchema", () => {
  const base = { name: "Savings", description: "", color: "#007bff", system_role: "" };

  it("accepts a valid category", () => {
    expect(categorySchema.safeParse(base).success).toBe(true);
  });

  it("caps the name at 50 characters", () => {
    expect(categorySchema.safeParse({ ...base, name: "a".repeat(51) }).success).toBe(false);
    expect(categorySchema.safeParse({ ...base, name: "a".repeat(50) }).success).toBe(true);
  });

  it("accepts only six-digit hex colours", () => {
    expect(HEX_6.test("#007bff")).toBe(true);
    expect(HEX_6.test("#fff")).toBe(false);
    expect(HEX_6.test("007bff")).toBe(false);
    expect(categorySchema.safeParse({ ...base, color: "#fff" }).success).toBe(false);
    expect(categorySchema.safeParse({ ...base, color: "" }).success).toBe(true);
  });

  it("accepts the system roles from constants.py and nothing else", () => {
    for (const role of ["cash", "emergency_fund", "bonds", "stocks", "real_estate", "retirement", "alternative", "other"]) {
      expect(categorySchema.safeParse({ ...base, system_role: role }).success).toBe(true);
    }
    expect(categorySchema.safeParse({ ...base, system_role: "savings" }).success).toBe(false);
  });
});

describe("tagSchema", () => {
  it("accepts three- or six-digit hex colours, as TagForm does", () => {
    expect(HEX_3_OR_6.test("#fff")).toBe(true);
    expect(HEX_3_OR_6.test("#ffffff")).toBe(true);
    expect(HEX_3_OR_6.test("#ff")).toBe(false);
    expect(tagSchema.safeParse({ name: "Illiquide", color: "#f00" }).success).toBe(true);
    expect(tagSchema.safeParse({ name: "Illiquide", color: "#ff" }).success).toBe(false);
  });

  it("requires a name of at most 50 characters", () => {
    expect(tagSchema.safeParse({ name: "", color: "#fff" }).success).toBe(false);
    expect(tagSchema.safeParse({ name: "a".repeat(51), color: "#fff" }).success).toBe(false);
  });
});

describe("uniqueErrorFor", () => {
  it("recognises the three UNIQUE failures SQLite reports", () => {
    expect(
      uniqueErrorFor(
        new Error("error returned from database: (code: 2067) UNIQUE constraint failed: institutions.name"),
        "name",
      ),
    ).toBe("An institution with this name already exists.");

    expect(
      uniqueErrorFor(
        new Error("UNIQUE constraint failed: categories.name"),
        "name",
      ),
    ).toBe("A category with this name already exists.");

    expect(
      uniqueErrorFor(new Error("UNIQUE constraint failed: tags.name"), "name"),
    ).toBe("Tag name must be unique.");
  });

  it("returns null for unrelated failures", () => {
    expect(uniqueErrorFor(new Error("FOREIGN KEY constraint failed"), "name")).toBeNull();
    expect(uniqueErrorFor(new Error("database is locked"), "name")).toBeNull();
    expect(uniqueErrorFor("something else", "name")).toBeNull();
  });
});

describe("systemRoleLabel", () => {
  it("maps roles to the French labels used by the Résumé", () => {
    expect(systemRoleLabel("cash")).toBe("Liquidités");
    expect(systemRoleLabel("emergency_fund")).toBe("Fonds d'urgence");
    expect(systemRoleLabel("stocks")).toBe("Actions / ETF");
  });

  it("returns an empty string when no role is set", () => {
    expect(systemRoleLabel(null)).toBe("");
    expect(systemRoleLabel("")).toBe("");
  });

  it("falls back to the raw value for an unknown role", () => {
    expect(systemRoleLabel("legacy_role")).toBe("legacy_role");
  });
});
