/**
 * A boolean UI preference that survives a restart.
 *
 * Kept in localStorage rather than the settings table: it describes how this
 * window is arranged, not how the app behaves, and it should not travel in a
 * backup or show up on another install. Same storage the theme preference uses,
 * and for the same reason — it has to be readable before the database opens.
 */

import { useCallback, useState } from "react";

export function useStoredBoolean(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : stored === "true";
    } catch {
      // Private mode, a locked store: fall back rather than crash the screen.
      return fallback;
    }
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Not persisting is acceptable; the toggle still works for this session.
      }
    },
    [key],
  );

  return [value, update];
}
