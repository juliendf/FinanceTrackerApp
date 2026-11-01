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

import { deleteProvider, normaliseBaseUrl, PROVIDER_TYPES, keychainAccount } from "./llmProviders";

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

describe("deleteProvider", () => {
  const provider = {
    id: 3,
    name: "Ollama",
    base_url: "http://localhost:11434/v1",
    model: "qwen3",
    provider_type: "openai",
    keychain_ref: "provider:3",
    is_default: 0,
    is_active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    runTransaction.mockResolvedValue(0);
    invoke.mockResolvedValue(undefined);
    select.mockResolvedValue([provider]);
  });

  it("deletes the rows before the Keychain item, so a failed delete is retryable", async () => {
    await deleteProvider(3);

    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect((runTransaction.mock.calls[0] as unknown[][])[0]).toEqual([
      "DELETE FROM provider_models WHERE provider_id = 3",
      "DELETE FROM llm_providers WHERE id = 3",
    ]);
    expect(invoke).toHaveBeenCalledWith("secret_delete", { account: "provider:3" });
    // Order: rows first, key second.
    expect(runTransaction.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0]);
  });

  it("keeps the key when the delete fails", async () => {
    runTransaction.mockRejectedValue(new Error("database is locked"));

    await expect(deleteProvider(3)).rejects.toThrow(/locked/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
