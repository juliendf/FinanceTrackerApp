/**
 * LLM providers. The API key never touches SQLite: `keychain_ref` points at a
 * macOS Keychain item (`provider:<id>`), written through the `secret_*` commands.
 */

import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../client";
import { runTransaction } from "../transaction";
import { sqlInt, sqlText } from "../literals";

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

/**
 * Gemini's native base URL answers on `/v1beta/chat/completions`, which is not
 * OpenAI-shaped. Every request in this app speaks the OpenAI schema, so a
 * `gemini` provider is pointed at Gemini's OpenAI-compatible surface
 * (`.../v1beta/openai`) — the alternative the brief asks for instead of porting
 * litellm's Gemini special case.
 */
export function normaliseBaseUrl(providerType: string, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (providerType !== "gemini") return trimmed;
  if (trimmed.endsWith("/openai")) return trimmed;
  if (/\/v1beta$/.test(trimmed)) return `${trimmed}/openai`;
  return trimmed;
}

export function keychainAccount(id: number): string {
  return `provider:${id}`;
}

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

/** Statements that replace a provider's model rows; used inside its transaction. */
function modelStatements(
  providerId: number,
  models: ReadonlyArray<{ model: string; enabled: boolean }>,
): string[] {
  const statements = [`DELETE FROM provider_models WHERE provider_id = ${sqlInt(providerId)}`];
  for (const choice of models) {
    statements.push(
      `INSERT INTO provider_models (provider_id, model, enabled) VALUES (${sqlInt(providerId)}, ${sqlText(choice.model)}, ${sqlInt(choice.enabled ? 1 : 0)})`,
    );
  }
  return statements;
}

/**
 * Create a provider. The key is stored first, under the id the insert will get;
 * if the insert fails the Keychain item is removed again.
 */
export async function createProvider(input: ProviderInput, apiKey?: string): Promise<number> {
  const db = await getDb();
  const next = await db.select<{ id: number }[]>(
    `SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'llm_providers'), 0) + 1 AS id`,
  );
  const id = next[0]?.id ?? 1;
  const account = apiKey && apiKey.trim() ? keychainAccount(id) : null;
  if (account && apiKey) await invoke("secret_set", { account, secret: apiKey });

  try {
    await runTransaction([
      `INSERT INTO llm_providers (id, name, base_url, model, provider_type, keychain_ref, is_default, is_active)
       VALUES (${sqlInt(id)}, ${sqlText(input.name)}, ${sqlText(normaliseBaseUrl(input.provider_type, input.base_url))},
               ${sqlText(input.model)}, ${sqlText(input.provider_type)}, ${sqlText(account)}, 0,
               ${sqlInt(input.is_active ? 1 : 0)})`,
      ...(input.models ? modelStatements(id, input.models) : []),
    ]);
    // First provider becomes the default, as a fresh install needs one.
    const all = await listProviders();
    if (all.length === 1) await setDefaultProvider(id);
    return id;
  } catch (error) {
    if (account) await invoke("secret_delete", { account }).catch(() => undefined);
    throw error;
  }
}

export async function updateProvider(id: number, input: ProviderInput, apiKey?: string): Promise<void> {
  const existing = await getProvider(id);
  const account = keychainAccount(id);
  if (apiKey !== undefined && apiKey.trim() !== "") {
    await invoke("secret_set", { account, secret: apiKey });
  }
  const keychainRef = existing?.keychain_ref ?? (apiKey && apiKey.trim() ? account : null);
  await runTransaction([
    `UPDATE llm_providers
        SET name = ${sqlText(input.name)}, base_url = ${sqlText(normaliseBaseUrl(input.provider_type, input.base_url))},
            model = ${sqlText(input.model)}, provider_type = ${sqlText(input.provider_type)},
            keychain_ref = ${sqlText(keychainRef)}, is_active = ${sqlInt(input.is_active ? 1 : 0)},
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ${sqlInt(id)}`,
    ...(input.models ? modelStatements(id, input.models) : []),
  ]);
}

/** Delete a provider and its Keychain item. The default flag moves to the first survivor. */
export async function deleteProvider(id: number): Promise<void> {
  const provider = await getProvider(id);
  if (provider?.keychain_ref) {
    await invoke("secret_delete", { account: provider.keychain_ref }).catch(() => undefined);
  }
  await runTransaction([
    `DELETE FROM provider_models WHERE provider_id = ${sqlInt(id)}`,
    `DELETE FROM llm_providers WHERE id = ${sqlInt(id)}`,
  ]);
  if (provider?.is_default === 1) {
    const remaining = await listProviders();
    if (remaining.length > 0) await setDefaultProvider(remaining[0].id);
  }
}

/** Exactly one default: the unique partial index refuses two, so clear first. */
export async function setDefaultProvider(id: number): Promise<void> {
  await runTransaction([
    `UPDATE llm_providers SET is_default = 0 WHERE is_default = 1`,
    `UPDATE llm_providers SET is_default = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ${sqlInt(id)}`,
  ]);
}

export async function getProviderKey(provider: LlmProvider): Promise<string | null> {
  if (!provider.keychain_ref) return null;
  return invoke<string | null>("secret_get", { account: provider.keychain_ref });
}

export async function countProviders(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM llm_providers`);
  return rows[0]?.n ?? 0;
}
