import { describe, expect, it } from "vitest";
import { deriveMemoryKey, slugifyMemoryKey } from "./memoryKey";

describe("slugifyMemoryKey", () => {
  it("builds a short label from the sentence", () => {
    expect(slugifyMemoryKey("User is in a French PACS with their partner.")).toBe(
      "user_is_in_a_french_pacs_with_their_partner",
    );
  });

  it("strips accents and punctuation", () => {
    expect(slugifyMemoryKey("Rémunération : 8 487 CHF / mois")).toBe("remuneration_8_487_chf_mois");
  });

  it("caps the length", () => {
    const key = slugifyMemoryKey("x".repeat(200));
    expect(key.length).toBeLessThanOrEqual(48);
  });

  it("falls back to 'memory' for text with nothing usable", () => {
    expect(slugifyMemoryKey("   ")).toBe("memory");
    expect(slugifyMemoryKey("!!!")).toBe("memory");
  });
});

describe("deriveMemoryKey", () => {
  it("avoids collisions with existing keys", () => {
    expect(deriveMemoryKey("House downpayment", ["house_downpayment"])).toBe("house_downpayment_2");
    expect(deriveMemoryKey("House downpayment", ["house_downpayment", "house_downpayment_2"])).toBe(
      "house_downpayment_3",
    );
  });

  it("returns the plain slug when it is free", () => {
    expect(deriveMemoryKey("House downpayment", [])).toBe("house_downpayment");
  });
});
