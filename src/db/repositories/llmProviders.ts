/**
 * LLM providers. The API key never touches SQLite: `keychain_ref` points at a
 * macOS Keychain item (`provider:<id>`).
 *
 * **Writes go through Rust.** The provider row decides where a stored key is
 * sent, so the generic SQL path refuses to touch `llm_providers` and
 * `provider_models` (see `write_authorizer` in `src-tauri/src/commands/db.rs`).
 * `provider_save` / `provider_delete` / `provider_set_default` also do the
 * Keychain work, binding a key to the origin it was entered for.
 */

import { invoke } from "@tauri-apps/api/core";
import { normaliseBaseUrl } from "../../domain/providers";
import { getDb } from "../client";

export interface LlmProvider {
  id: number;
  name: string;
  base_url: string;
  model: string;
  provider_type: string;
  keychain_ref: string | null;
  is_default: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export const PROVIDER_TYPES = [
  { value: "openai", label: "OpenAI-compatible (Ollama, LM Studio, OpenRouter, Gemini's /v1beta/openai…)" },
  { value: "gemini", label: "Google Gemini (native endpoint)" },
] as const;

export async function listProviders(): Promise<LlmProvider[]> {
  const db = await getDb();
  return db.select<LlmProvider[]>(
    `SELECT id, name, base_url, model, provider_type, keychain_ref, is_default, is_active, created_at, updated_at
       FROM llm_providers ORDER BY is_default DESC, name COLLATE NOCASE`,
  );
}

export async function listActiveProviders(): Promise<LlmProvider[]> {
  return (await listProviders()).filter((provider) => provider.is_active === 1);
}

export async function getProvider(id: number): Promise<LlmProvider | null> {
  const db = await getDb();
  const rows = await db.select<LlmProvider[]>(
    `SELECT id, name, base_url, model, provider_type, keychain_ref, is_default, is_active, created_at, updated_at
       FROM llm_providers WHERE id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getDefaultProvider(): Promise<LlmProvider | null> {
  const db = await getDb();
  const rows = await db.select<LlmProvider[]>(
    `SELECT id, name, base_url, model, provider_type, keychain_ref, is_default, is_active, created_at, updated_at
       FROM llm_providers WHERE is_default = 1 AND is_active = 1 LIMIT 1`,
  );
  return rows[0] ?? null;
}

export interface ProviderInput {
  name: string;
  base_url: string;
  model: string;
  provider_type: string;
  is_active: boolean;
  /** The models this provider offers, and which of them chat may use. */
  models?: ReadonlyArray<{ model: string; enabled: boolean }>;
}

export interface ProviderModel {
  provider_id: number;
  model: string;
  enabled: number;
}

/** Every model row for a provider, enabled or not. */
export async function listProviderModels(providerId: number): Promise<ProviderModel[]> {
  const db = await getDb();
  return db.select<ProviderModel[]>(
    `SELECT provider_id, model, enabled FROM provider_models WHERE provider_id = ? ORDER BY model`,
    [providerId],
  );
}

/** The models chat may offer for this provider. */
export async function listEnabledModels(providerId: number): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ model: string }[]>(
    `SELECT model FROM provider_models WHERE provider_id = ? AND enabled = 1 ORDER BY model`,
    [providerId],
  );
  return rows.map((row) => row.model);
}

/** Create a provider. The key, if given, is bound to this endpoint's origin. */
export async function createProvider(input: ProviderInput, apiKey?: string): Promise<number> {
  return invoke<number>("provider_save", {
    input: { ...input, base_url: normaliseBaseUrl(input.provider_type, input.base_url), id: null, api_key: apiKey ?? null },
  });
}

/**
 * Update a provider.
 *
 * Changing the base URL of a provider with a stored key drops that key: it was
 * bound to the old origin, and sending it to a new host is exactly what the
 * binding exists to prevent. The form says so, and asks for the key again.
 */
export async function updateProvider(id: number, input: ProviderInput, apiKey?: string): Promise<void> {
  await invoke("provider_save", {
    input: { ...input, base_url: normaliseBaseUrl(input.provider_type, input.base_url), id, api_key: apiKey ?? null },
  });
}

/** Delete a provider, its model rows and its Keychain item. */
export async function deleteProvider(id: number): Promise<void> {
  await invoke("provider_delete", { id });
}

/** Exactly one default: the unique partial index refuses two, so Rust clears first. */
export async function setDefaultProvider(id: number): Promise<void> {
  await invoke("provider_set_default", { id });
}

export async function countProviders(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM llm_providers`);
  return rows[0]?.n ?? 0;
}
