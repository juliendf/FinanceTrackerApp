import { describe, expect, it } from "vitest";
import { detectProviderType, enabledModels, isGeminiEndpoint, mergeModelChoices } from "./providerModels";

describe("endpoint flavour", () => {
  it("recognises Gemini's host", () => {
    expect(isGeminiEndpoint("https://generativelanguage.googleapis.com/v1beta")).toBe(true);
    expect(detectProviderType("https://generativelanguage.googleapis.com/v1beta")).toBe("gemini");
  });

  it("treats everything else as OpenAI-compatible", () => {
    expect(detectProviderType("http://localhost:11434/v1")).toBe("openai");
    expect(detectProviderType("https://api.openai.com/v1")).toBe("openai");
    expect(detectProviderType("not a url")).toBe("openai");
  });
});

describe("mergeModelChoices", () => {
  it("enables newly fetched models and keeps saved choices", () => {
    const merged = mergeModelChoices(
      ["qwen3.5:4b", "qwen2.5-coder:14b", "ministral-3:8b"],
      [
        { model: "qwen3.5:4b", enabled: false },
        { model: "gemma3:4b", enabled: true },
      ],
    );
    expect(merged).toEqual([
      { model: "qwen3.5:4b", enabled: false },
      { model: "qwen2.5-coder:14b", enabled: true },
      { model: "ministral-3:8b", enabled: true },
    ]);
  });

  it("keeps the provider's default model even if the endpoint stops listing it", () => {
    const merged = mergeModelChoices(["a", "b"], [], "legacy-model");
    expect(merged[0]).toEqual({ model: "legacy-model", enabled: true });
    expect(merged.map((choice) => choice.model)).toEqual(["legacy-model", "a", "b"]);
  });

  it("does not resurrect models that disappeared and are not the default", () => {
    const merged = mergeModelChoices(["a"], [{ model: "gone", enabled: true }], "a");
    expect(merged).toEqual([{ model: "a", enabled: true }]);
  });

  it("deduplicates and skips blanks", () => {
    expect(mergeModelChoices(["a", "a", ""], [])).toEqual([{ model: "a", enabled: true }]);
  });

  it("survives an empty fetch", () => {
    expect(mergeModelChoices([], [], null)).toEqual([]);
    expect(mergeModelChoices([], [{ model: "x", enabled: false }], "x")).toEqual([{ model: "x", enabled: false }]);
  });
});

describe("enabledModels", () => {
  it("keeps only the enabled ones, in order", () => {
    expect(
      enabledModels([
        { model: "a", enabled: true },
        { model: "b", enabled: false },
        { model: "c", enabled: true },
      ]),
    ).toEqual(["a", "c"]);
  });
});
