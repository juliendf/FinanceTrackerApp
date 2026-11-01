/**
 * Top toolbar: a drag strip with the app name and the theme toggle.
 *
 * It holds no navigation at all — every destination is in the sidebar, so there
 * is exactly one place to look. About lives at the bottom of the sidebar, next to
 * the version it describes.
 */

import { ThemeToggle } from "./ThemeToggle";

export function Navbar() {
  return (
    <header className="app-toolbar" data-tauri-drag-region>
      <div className="app-toolbar-title" data-tauri-drag-region>
        <img src="/icon.png" alt="" width={18} height={18} />
        <span>FinanceTracker</span>
      </div>
      <div className="app-toolbar-spacer" data-tauri-drag-region />
      <ThemeToggle />
    </header>
  );
}
