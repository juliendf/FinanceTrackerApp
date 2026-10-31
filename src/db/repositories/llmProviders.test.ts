import { describe, expect, it } from "vitest";
import { normaliseBaseUrl, PROVIDER_TYPES, keychainAccount } from "./llmProviders";

describe("normaliseBaseUrl", () => {
  it("trims trailing slashes for OpenAI-compatible endpoints", () => {
    expect(normaliseBaseUrl("openai", "http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
    expect(normaliseBaseUrl("openai", " https://api.openai.com/v1 ")).toBe("https://api.openai.com/v1");
  });

  it("moves Gemini onto its OpenAI-compatible surface", () => {
    expect(normaliseBaseUrl("gemini", "https://generativelanguage.googleapis.com/v1beta")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai",
    );
    expect(normaliseBaseUrl("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai",
    );
    // Anything else is left alone, so a proxy path still works.
    expect(normaliseBaseUrl("gemini", "https://proxy.example/gemini")).toBe("https://proxy.example/gemini");
  });
});

describe("provider plumbing", () => {
  it("names the Keychain account after the provider id", () => {
    expect(keychainAccount(2)).toBe("provider:2");
  });

  it("offers both provider types", () => {
    expect(PROVIDER_TYPES.map((type) => type.value)).toEqual(["openai", "gemini"]);
  });
});
