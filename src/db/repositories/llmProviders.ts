/**
 * LLM providers. The API key is never stored here — only a `keychain_ref`
 * such as `provider:1`; the secret lives in the macOS Keychain.
 */

import { getDb } from "../client";

export interface LLMProvider {
  id: number;
  name: string;
  base_url: string;
  keychain_ref: string | null;
  model: string;
  provider_type: string;
  is_default: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export async function listProviders(): Promise<LLMProvider[]> {
  const db = await getDb();
  return db.select<LLMProvider[]>(
    `SELECT * FROM llm_providers ORDER BY is_default DESC, name COLLATE NOCASE ASC`,
  );
}

export async function getDefaultProvider(): Promise<LLMProvider | null> {
  const db = await getDb();
  const rows = await db.select<LLMProvider[]>(
    `SELECT * FROM llm_providers WHERE is_default = 1 LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function countProviders(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM llm_providers`,
  );
  return rows[0]?.n ?? 0;
}

export async function createProvider(input: {
  name: string;
  base_url: string;
  model: string;
  provider_type?: string;
  keychain_ref?: string | null;
  is_default?: boolean;
  is_active?: boolean;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO llm_providers
       (name, base_url, model, provider_type, keychain_ref, is_default, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.base_url.trim().replace(/\/+$/, ""),
      input.model.trim(),
      input.provider_type ?? "openai",
      input.keychain_ref ?? null,
      input.is_default ? 1 : 0,
      input.is_active === false ? 0 : 1,
    ],
  );
  return Number(result.lastInsertId);
}
