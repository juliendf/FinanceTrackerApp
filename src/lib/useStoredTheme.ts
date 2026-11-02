/**
 * Apply the `theme` setting stored in the database once it has loaded.
 *
 * The inline script in `index.html` has to paint before any database call, so it
 * uses localStorage; the stored setting then wins as soon as it is known.
 * Without a stored row, nothing changes, so a toggle made before settings exist
 * is not undone.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSetting, hasSetting } from "../db/repositories/settings";
import { applyTheme, readPreference, type ThemePreference } from "./theme";

export function useStoredTheme(): void {
  const stored = useQuery({
    queryKey: ["stored-theme"],
    queryFn: async () => ((await hasSetting("theme")) ? ((await getSetting("theme")) as string) : null),
  });

  useEffect(() => {
    const value = stored.data;
    if (!value || !["light", "dark", "auto"].includes(value)) return;
    if (readPreference() !== value) applyTheme(value as ThemePreference);
  }, [stored.data]);
}
