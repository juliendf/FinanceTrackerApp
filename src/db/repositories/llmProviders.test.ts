import { beforeEach, describe, expect, it, vi } from "vitest";

const runTransaction = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());

vi.mock("../transaction", async () => {
  const actual = await vi.importActual<typeof import("../transaction")>("../transaction");
  return { ...actual, runTransaction: (...a: unknown[]) => runTransaction(...a) };
});
vi.mock("../client", () => ({ getDb: async () => ({ select }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { deleteProvider, normaliseBaseUrl, PROVIDER_TYPES } from "./llmProviders";

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
  it("offers both provider types", () => {
    expect(PROVIDER_TYPES.map((type) => type.value)).toEqual(["openai", "gemini"]);
  });
});

describe("provider writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue(undefined);
    select.mockResolvedValue([]);
  });

  it("deletes through Rust, which also removes the Keychain item", async () => {
    await deleteProvider(3);

    // One command: the row, its model list and its key go together, and the
    // generic SQL path is not involved (it may not touch these tables).
    expect(invoke).toHaveBeenCalledWith("provider_delete", { id: 3 });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("surfaces a failure instead of swallowing it", async () => {
    invoke.mockRejectedValue(new Error("database is locked"));

    await expect(deleteProvider(3)).rejects.toThrow(/locked/);
  });
});
