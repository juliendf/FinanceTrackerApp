/**
 * Links never navigate the app window.
 *
 * A reply from the model can contain a link. If it navigated, one click would
 * replace the app with a web page that has no way back — so every absolute
 * http(s) link is handed to the system browser instead, and a `file:` or
 * `javascript:` href is ignored entirely. The Rust `open_external` command
 * re-checks the scheme.
 *
 * Modifier-clicks are handled the same way: in a browser Cmd-click means "open in
 * a new tab", but this window has no tabs, so leaving it alone would either do
 * nothing or navigate the app. The browser is still one click away, in a real tab.
 *
 * There is also a Rust backstop (`navigation_guard` in `src-tauri/src/lib.rs`)
 * that refuses any document navigation away from the app, in case a click is not
 * seen here.
 */

import { invoke } from "@tauri-apps/api/core";

/** Ask Rust to open a web URL in the default browser. */
export function openExternal(href: string): Promise<void> {
  return invoke("open_external", { url: href });
}

const WEB_URL = /^https?:\/\//i;

/**
 * Intercept clicks on links to other origins for the whole document.
 * Returns a function that removes the listener.
 */
export function installExternalLinkGuard(doc: Document = document): () => void {
  const handler = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute("href") ?? "";
    // In-app routes are hash links (#/assets) and must keep working.
    if (!WEB_URL.test(href)) return;

    event.preventDefault();
    void openExternal(href).catch(() => undefined);
  };

  doc.addEventListener("click", handler, true);
  return () => doc.removeEventListener("click", handler, true);
}
