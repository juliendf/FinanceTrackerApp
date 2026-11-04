/**
 * A text filter that commits to the URL after a pause.
 *
 * Filtering is live, so the URL is the target state: a change made outside the
 * box — Clear All, the back button, a removed chip — is adopted straight away.
 * A change made by typing waits for a pause first, because re-querying on every
 * keystroke re-renders the whole table for a prefix nobody asked to see.
 *
 * The order matters. Adoption runs before the debounce and skips values we
 * committed ourselves, otherwise the commit would immediately overwrite whatever
 * was typed while the timer was running and eat the keystrokes.
 *
 * `commit` is held in a ref so the caller can close over the current filters
 * without restarting the timer on every unrelated state change.
 */

import { useEffect, useRef, useState } from "react";

export const FILTER_DEBOUNCE_MS = 300;

export function useDebouncedFilter(
  value: string,
  commit: (next: string) => void,
  delay: number = FILTER_DEBOUNCE_MS,
): [string, (next: string) => void] {
  const [text, setText] = useState(value);
  const lastCommitted = useRef(value);
  const commitRef = useRef(commit);

  useEffect(() => {
    commitRef.current = commit;
  });

  useEffect(() => {
    if (value === lastCommitted.current) return;
    lastCommitted.current = value;
    setText(value);
  }, [value]);

  useEffect(() => {
    if (text === lastCommitted.current) return;
    const timer = setTimeout(() => {
      lastCommitted.current = text;
      commitRef.current(text);
    }, delay);
    return () => clearTimeout(timer);
  }, [text, delay]);

  return [text, setText];
}
