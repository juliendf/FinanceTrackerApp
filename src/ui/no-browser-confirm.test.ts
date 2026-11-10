/**
 * `window.confirm` / `window.alert` are not usable in this webview.
 *
 * Tauri routes them through the dialog plugin, whose permission this app does
 * not grant (deliberately: the popups render as a raw webview panel). The call
 * rejects, nothing happens, and the console fills with unhandled rejections —
 * which is how deletes silently stopped working. Use `DeleteConfirmModal`.
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = globSync("src/**/*.{ts,tsx}").filter((file) => !file.includes(".test."));

/** Remove comments so prose about confirm() does not trip the check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Matches a bare `confirm(` / `alert(`, or the same on `window.` / `globalThis.`.
 * A preceding `.` (e.g. `form.confirm(`) or identifier char (`confirmPending(`)
 * does not count.
 */
const DIALOG_CALL = /(^|[^\w$.])(?:(?:window|globalThis)\.)?(confirm|alert)\s*\(/;

describe("no browser dialogs", () => {
  it("never calls window.confirm, confirm() or alert()", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (DIALOG_CALL.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the pattern catches every spelling and ignores lookalikes", () => {
    for (const bad of [
      'window.confirm("x")',
      'window.alert("x")',
      'globalThis.alert(1)',
      'if (confirm("x")) {}',
      'alert("x")',
      'await confirm("x")',
    ]) {
      expect(DIALOG_CALL.test(bad), `should match: ${bad}`).toBe(true);
    }
    for (const good of ['form.confirm("x")', 'confirmPending("x")', 'setConfirm(true)', 'onConfirm()']) {
      expect(DIALOG_CALL.test(good), `should not match: ${good}`).toBe(false);
    }
  });
});
