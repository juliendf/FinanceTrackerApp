/** Sidebar collapse persisted in localStorage, plus the theme toggle button. */

import { useEffect, useState } from "react";
import {
  cycleTheme,
  readPreference,
  THEME_ICONS,
  THEME_LABELS,
  watchSystemTheme,
  type ThemePreference,
} from "../../lib/theme";

export function useThemePreference(): [ThemePreference, () => void] {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => watchSystemTheme(), []);

  const cycle = () => setPreference(cycleTheme());

  return [preference, cycle];
}

export function ThemeToggle() {
  const [preference, cycle] = useThemePreference();

  return (
    <button
      type="button"
      className="theme-toggle btn btn-icon"
      title={THEME_LABELS[preference]}
      aria-label={THEME_LABELS[preference]}
      data-theme-preference={preference}
      onClick={cycle}
    >
      <i className={`bi ${THEME_ICONS[preference]}`} aria-hidden="true" />
    </button>
  );
}
