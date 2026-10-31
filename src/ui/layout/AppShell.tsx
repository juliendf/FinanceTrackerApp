/**
 * Application shell: sidebar, toolbar, scrolling content. No footer.
 *
 * Full height, with the page scrolling inside `.app-content` rather than the
 * window. That is what keeps the sidebar and toolbar fixed like a desktop app,
 * and it is why `html`, `body` and `#root` are pinned to 100% in custom.css.
 */

import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Sidebar, useSidebarCollapsed } from "./Sidebar";
import { useStoredTheme } from "../../lib/useStoredTheme";
import { ErrorBoundary } from "../components/ErrorBoundary";

export function AppShell({ children }: { children: ReactNode }) {
  useStoredTheme();
  const [collapsed, toggle] = useSidebarCollapsed();

  return (
    <div className="app-shell">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="app-main">
        <Navbar />
        <main className="app-content">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

/**
 * Kept so older imports keep working; the sidebar shell is now the only one.
 * @deprecated use `AppShell`.
 */
export const AppShellWithSidebar = AppShell;
