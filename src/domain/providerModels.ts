/**
 * Provider model lists.
 *
 * A provider advertises its models (`GET {base_url}/models`); the form keeps the
 * ones the user wants available to chat. Two things live here because they are
 * pure and worth testing: deciding whether an endpoint is Gemini's compatibility
 * layer, and merging a freshly fetched list with the choices already saved.
 */

export type ProviderType = "openai" | "gemini";

/**
 * Gemini's native API is not OpenAI-shaped, so the app talks to Gemini's
 * compatibility surface instead. That is the only reason the old form offered a
 * "Gemini" option; it is now derived from the URL rather than asked for.
 */
export function isGeminiEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return host === "generativelanguage.googleapis.com" || host.endsWith(".googleapis.com");
  } catch {
    return false;
  }
}

export function detectProviderType(baseUrl: string): ProviderType {
  return isGeminiEndpoint(baseUrl) ? "gemini" : "openai";
}

export interface ModelChoice {
  model: string;
  enabled: boolean;
}

/**
 * Merge a fetched list into the saved choices.
 *
 * Saved choices win, so a model the user turned off stays off after a reload.
 * Models that are new in the fetched list arrive enabled, and models the
 * endpoint no longer advertises are dropped — with the caveat that the
 * provider's own default model is always kept so chat cannot end up with no
 * choices at all.
 */
export function mergeModelChoices(
  fetched: readonly string[],
  saved: readonly ModelChoice[],
  defaultModel?: string | null,
): ModelChoice[] {
  const savedByModel = new Map(saved.map((choice) => [choice.model, choice.enabled]));
  const merged: ModelChoice[] = [];
  const seen = new Set<string>();

  for (const model of fetched) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    merged.push({ model, enabled: savedByModel.get(model) ?? true });
  }

  // A saved default that the endpoint did not list must survive: it is what the
  // provider row points chat at.
  const fallback = defaultModel?.trim();
  if (fallback && !seen.has(fallback)) {
    merged.unshift({ model: fallback, enabled: savedByModel.get(fallback) ?? true });
    seen.add(fallback);
  }

  // Models saved but no longer advertised are kept only if they are the default.
  for (const choice of saved) {
    if (seen.has(choice.model)) continue;
    if (choice.model === fallback) continue;
    seen.add(choice.model);
  }

  return merged;
}

/** The models chat may offer, in list order. */
export function enabledModels(choices: readonly ModelChoice[]): string[] {
  return choices.filter((choice) => choice.enabled).map((choice) => choice.model);
}
