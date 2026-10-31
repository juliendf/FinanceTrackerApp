/**
 * Application shell — navbar, content region, footer.
 *
 * Structure and classes follow `templates/base.html` and
 * `templates/components/navbar.html` so custom.css lands on the same hooks.
 */

import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Sidebar, useSidebarCollapsed } from "./Sidebar";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { useStoredTheme } from "../../lib/useStoredTheme";

export function AppShell({ children }: { children: ReactNode }) {
  useStoredTheme();

  return (
    <>
      <Navbar />
      <main className="flex-grow-1">
        <div className="container py-4">{children}</div>
      </main>
      <footer className="mt-auto">
        <div className="container d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span>&copy; 2025 Finance Tracker</span>
          <span className="d-flex align-items-center gap-2 text-muted small">
            Desktop edition
          </span>
        </div>
      </footer>
    </>
  );
}

/**
 * Shell with the ported sidebar. The source only reaches its sidebar through
 * `layouts/main.html`, which no live page extends, so this layout is available
 * but not the default.
 */
export function AppShellWithSidebar({
  children,
  breadcrumbs = [],
  counts,
}: {
  children: ReactNode;
  breadcrumbs?: Crumb[];
  counts?: Record<string, number>;
}) {
  const [collapsed, toggle] = useSidebarCollapsed();

  return (
    <>
      <Navbar />
      <div className="main-layout-container d-flex flex-grow-1">
        <div className={`sidebar-wrapper${collapsed ? " collapsed" : ""}`}>
          <Sidebar collapsed={collapsed} onToggle={toggle} counts={counts} />
        </div>
        <div className="main-content-wrapper flex-grow-1">
          <div className="content-header bg-white border-bottom px-4 py-3">
            <Breadcrumbs items={breadcrumbs} />
          </div>
          <div className="content-body p-4">{children}</div>
        </div>
      </div>
      <footer className="mt-auto">
        <div className="container d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span>&copy; 2025 Finance Tracker</span>
        </div>
      </footer>
    </>
  );
}
