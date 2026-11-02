/**
 * LLM provider configuration rules.
 *
 * Pure, so the repositories stay SQL-only: `provider_save` must receive the
 * endpoint the app will actually call, and deciding what that endpoint is is
 * policy, not storage.
 */

/**
 * Gemini's native base URL answers on `/v1beta/chat/completions`, which is not
 * OpenAI-shaped. Every request in this app speaks the OpenAI schema, so a
 * `gemini` provider is pointed at Gemini's OpenAI-compatible surface
 * (`.../v1beta/openai`).
 */
export function normaliseBaseUrl(providerType: string, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (providerType !== "gemini") return trimmed;
  if (trimmed.endsWith("/openai")) return trimmed;
  if (/\/v1beta$/.test(trimmed)) return `${trimmed}/openai`;
  return trimmed;
}
