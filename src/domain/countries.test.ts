import { describe, expect, it } from "vitest";
import { COUNTRIES, countryLabel, countryName } from "./countries";

describe("countries", () => {
  it("covers the ISO list, sorted by name", () => {
    expect(COUNTRIES.length).toBeGreaterThan(200);
    expect(COUNTRIES[0].code).toHaveLength(2);
    const names = COUNTRIES.map((country) => country.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it("names the codes the app needs", () => {
    expect(countryName("CH")).toBe("Switzerland");
    expect(countryName("FR")).toBe("France");
    expect(countryName("US")).toBe("United States");
  });

  it("keeps an unknown code rather than hiding it", () => {
    expect(countryName("ZZ")).toBe("ZZ");
    expect(countryName(null)).toBeNull();
    expect(countryLabel(null)).toBeNull();
  });

  it("labels a code with both name and code, which is what the prompt gets", () => {
    expect(countryLabel("CH")).toBe("Switzerland (CH)");
    // A code with no name is passed through unchanged.
    expect(countryLabel("ZZ")).toBe("ZZ");
  });
});
