/**
 * Application shell: navbar, main region, footer.
 *
 * Phase 0 keeps this deliberately thin — the full shell (sidebar with saved
 * collapse state, breadcrumbs, toast system) is Phase 1. The structure and
 * classes follow `templates/base.html` so custom.css lands on the same hooks.
 */

import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { to: "/assets", label: "Assets", icon: "bi-wallet2" },
  { to: "/ai", label: "AI chat", icon: "bi-chat-dots" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <nav className="navbar navbar-expand-lg">
        <div className="container-fluid px-4">
          <NavLink className="navbar-brand d-flex align-items-center gap-2" to="/assets">
            <i className="bi bi-piggy-bank" aria-hidden="true" />
            <span>FinanceTracker</span>
          </NavLink>

          <div className="d-flex align-items-center gap-2">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `btn btn-sm ${isActive ? "btn-primary" : "btn-outline-secondary"}`
                }
              >
                <i className={`bi ${item.icon} me-1`} aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <main className="flex-grow-1">
        <div className="container-fluid px-4 py-4">{children}</div>
      </main>

      <footer className="mt-auto">
        <div className="container d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span>&copy; 2025 FinanceTracker</span>
          <span className="text-muted">Desktop edition</span>
        </div>
      </footer>
    </>
  );
}
