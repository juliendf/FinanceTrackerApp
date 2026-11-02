// @vitest-environment jsdom
/**
 * Links in an assistant reply must never navigate the app window.
 *
 * Without this, one click on a link the model produced replaced the whole app
 * with an external page that had no way back — and the URL leaked whatever the
 * link had put in its query string.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { installExternalLinkGuard } from "./externalLinks";

let remove: (() => void) | null = null;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  document.body.innerHTML = "";
  remove = installExternalLinkGuard();
});

afterEach(() => {
  remove?.();
  remove = null;
});

/** Click an anchor and report whether the page navigation was prevented. */
function click(anchor: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  document.body.append(anchor);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  anchor.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("external link guard", () => {
  it("sends an https link to the browser instead of navigating", () => {
    const prevented = click(
      Object.assign(document.createElement("a"), { href: "https://example.com/x?d=secret" }),
    );

    expect(prevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.com/x?d=secret" });
  });

  it("handles http links too", () => {
    const prevented = click(Object.assign(document.createElement("a"), { href: "http://localhost:8080/" }));

    expect(prevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "http://localhost:8080/" });
  });

  it("leaves in-app hash routes alone", () => {
    const prevented = click(Object.assign(document.createElement("a"), { href: "#/assets" }));

    expect(prevented).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("ignores relative links the markdown renderer creates", () => {
    const prevented = click(Object.assign(document.createElement("a"), { href: "/docs/IMPORT_FORMAT.md" }));

    expect(prevented).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses a non-web scheme rather than handing it to the opener", () => {
    const prevented = click(Object.assign(document.createElement("a"), { href: "file:///etc/passwd" }));

    expect(prevented).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still calls Rust when the command fails, without breaking the click", () => {
    invoke.mockRejectedValue(new Error("no browser"));
    const prevented = click(Object.assign(document.createElement("a"), { href: "https://example.com/" }));

    expect(prevented).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("opens a modifier-click in the browser too, because this window has no tabs", () => {
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey"] as const) {
      invoke.mockClear();
      const prevented = click(Object.assign(document.createElement("a"), { href: "https://example.com/" }), {
        [modifier]: true,
      });

      expect(prevented, modifier).toBe(true);
      expect(invoke, modifier).toHaveBeenCalledWith("open_external", { url: "https://example.com/" });
    }
  });

  it("finds the anchor when the click lands on a child element", () => {
    const anchor = Object.assign(document.createElement("a"), { href: "https://example.com/" });
    const strong = document.createElement("strong");
    strong.textContent = "click here";
    anchor.append(strong);
    document.body.append(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    strong.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.com/" });
  });

  it("keeps working after a listener is removed and reinstalled", () => {
    remove?.();
    remove = installExternalLinkGuard();

    click(Object.assign(document.createElement("a"), { href: "https://example.com/once" }));

    // One listener, so the URL is opened once — not twice.
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
