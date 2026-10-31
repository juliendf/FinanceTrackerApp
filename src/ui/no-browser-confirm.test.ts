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

describe("no browser dialogs", () => {
  it("never calls window.confirm, confirm() or alert()", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (/(^|[^\w.])confirm\s*\(/.test(code) || /(^|[^\w.])alert\s*\(/.test(code)) {
        // Spelled-out alternatives are fine; only bare calls count.
        if (!/DeleteConfirmModal|confirmAction|setConfirm/.test(file)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
