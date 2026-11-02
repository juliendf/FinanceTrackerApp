/**
 * Theme preference handling.
 *
 * Three states cycle light -> dark -> auto. Three DOM attributes must stay in
 * lockstep: `data-theme` (design tokens in custom.css), `data-bs-theme`
 * (Bootstrap component colours) and `color-scheme` (native controls).
 *
 * `index.html` applies the same logic inline before first paint; this module
 * only handles changes afterwards.
 */

export type ThemePreference = "light" | "dark" | "auto";
export type ThemeName = "light" | "dark";

const STORAGE_KEY = "theme";
const ORDER: ThemePreference[] = ["light", "dark", "auto"];

declare global {
  interface Window {
    __themePreference?: ThemePreference;
    __themeResolved?: ThemeName;
  }
}

// jsdom (the component tests) has no matchMedia; treat that as a light system.
const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function systemTheme(): ThemeName {
  return media?.matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ThemeName {
  return preference === "auto" ? systemTheme() : preference;
}

export function readPreference(): ThemePreference {
  return window.__themePreference ?? "auto";
}

export function currentTheme(): ThemeName {
  return (document.documentElement.getAttribute("data-theme") as ThemeName) ?? "light";
}

export function applyTheme(preference: ThemePreference): ThemeName {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;

  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-bs-theme", resolved);
  root.style.colorScheme = resolved;

  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* private mode */
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#0b0e12" : "#ffffff");
  }

  window.__themePreference = preference;
  window.__themeResolved = resolved;

  // Chart helpers listen for this.
  document.dispatchEvent(
    new CustomEvent("themechange", { detail: { preference, theme: resolved } }),
  );

  return resolved;
}

export function nextPreference(preference: ThemePreference): ThemePreference {
  return ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];
}

export function cycleTheme(): ThemePreference {
  const next = nextPreference(readPreference());
  applyTheme(next);
  return next;
}

/** Follow the OS while the preference is 'auto'. Returns an unsubscribe fn. */
export function watchSystemTheme(): () => void {
  const onChange = () => {
    if (readPreference() === "auto") applyTheme("auto");
  };
  if (!media) return () => {};
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: "Light theme — click for dark",
  dark: "Dark theme — click to follow system",
  auto: "Following system theme — click for light",
};

export const THEME_ICONS: Record<ThemePreference, string> = {
  light: "bi-sun",
  dark: "bi-moon-stars",
  auto: "bi-circle-half",
};
