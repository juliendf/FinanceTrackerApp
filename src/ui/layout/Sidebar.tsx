/**
 * Sidebar: the app's primary navigation.
 *
 * The source only reached its sidebar through `layouts/main.html`, which no live
 * page extends (see docs/DEVIATIONS.md). A desktop app belongs in a sidebar
 * rather than a top nav — a top bar forces every page into one narrow column and
 * leaves the window mostly empty on a wide screen — so it is the default shell
 * here. The collapse state is remembered across launches.
 */

import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import { useQuery } from "@tanstack/react-query";

const STORAGE_KEY = "sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Collapse state, remembered across launches. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      /* private mode */
    }
  }, [collapsed]);

  return [collapsed, () => setCollapsed((value) => !value)];
}

const SECTIONS = [
  {
    title: "Portfolio",
    links: [
      { to: "/", label: "Dashboard", icon: "bi-speedometer2", end: true },
      { to: "/resume", label: "Résumé", icon: "bi-file-text" },
      { to: "/assets", label: "Assets", icon: "bi-wallet2" },
      { to: "/snapshots", label: "Snapshots", icon: "bi-camera" },
    ],
  },
  {
    title: "Assistant",
    links: [{ to: "/chat", label: "Chat", icon: "bi-chat-dots" }],
  },
  {
    title: "Manage",
    links: [
      { to: "/institutions", label: "Institutions", icon: "bi-building" },
      { to: "/categories", label: "Categories", icon: "bi-tags" },
      { to: "/tags", label: "Tags", icon: "bi-bookmark" },
    ],
  },
  {
    title: "App",
    links: [
      { to: "/data", label: "Data", icon: "bi-hdd-stack" },
      { to: "/settings", label: "Settings", icon: "bi-gear" },
    ],
  },
] as const;

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const version = useQuery({ queryKey: ["app-version"], queryFn: getVersion });

  return (
    <aside className={`app-sidebar${collapsed ? " collapsed" : ""}`} aria-label="Main navigation">
      {/* The window uses an overlay title bar: the traffic lights sit here. */}
      <div className="app-sidebar-top" data-tauri-drag-region />

      <nav className="app-sidebar-nav">
        {SECTIONS.map((section) => (
          <div className="app-sidebar-section" key={section.title}>
            <div className="app-sidebar-label label">{section.title}</div>
            {section.links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={"end" in link ? link.end : false}
                className={({ isActive }) => `app-sidebar-link${isActive ? " active" : ""}`}
                title={link.label}
              >
                <i className={`bi ${link.icon}`} aria-hidden="true" />
                <span className="label">{link.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="app-sidebar-footer">
        <span className="label text-muted small">Version {version.data ?? "…"}</span>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={onToggle}
          title={collapsed ? "Show sidebar" : "Hide sidebar"}
          aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
        >
          <i className={`bi bi-chevron-${collapsed ? "right" : "left"}`} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
