/**
 * Remembering the model picked per provider, so switching provider restores the
 * last model used with it rather than the provider's default.
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "chat.modelByProvider";

export function readModelChoices(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveModelChoice(providerId: number, model: string): void {
  const choices = readModelChoices();
  if (model) choices[String(providerId)] = model;
  else delete choices[String(providerId)];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choices));
  } catch {
    /* private mode */
  }
}

/** The remembered model for a provider, or "" for "provider default". */
export function useRememberedModel(providerId: number | null): [string, (model: string) => void] {
  const [model, setModel] = useState<string>("");

  useEffect(() => {
    setModel(providerId === null ? "" : (readModelChoices()[String(providerId)] ?? ""));
  }, [providerId]);

  return [
    model,
    (next: string) => {
      setModel(next);
      if (providerId !== null) saveModelChoice(providerId, next);
    },
  ];
}
