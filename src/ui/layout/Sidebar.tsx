/**
 * Sidebar — port of `templates/components/sidebar.html`, with the collapse state
 * persisted in localStorage.
 *
 * Note: in the source app this component is only included by
 * `layouts/main.html`, which no live page extends; its links are `#` anchors.
 * It is built here for parity and used only by the optional
 * `WithSidebar` layout. See docs/DEVIATIONS.md.
 */

import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

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
      { to: "/", label: "Dashboard", icon: "bi-speedometer2" },
      { to: "/resume", label: "Résumé", icon: "bi-file-text" },
      { to: "/assets", label: "Assets", icon: "bi-briefcase" },
      { to: "/charts/performance", label: "Performance", icon: "bi-graph-up" },
      { to: "/charts/distribution", label: "Allocations", icon: "bi-pie-chart" },
    ],
  },
  {
    title: "Management",
    links: [
      { to: "/institutions", label: "Institutions", icon: "bi-building" },
      { to: "/categories", label: "Categories", icon: "bi-tags" },
      { to: "/tags", label: "Tags", icon: "bi-bookmark" },
      { to: "/snapshots", label: "Snapshots", icon: "bi-camera" },
    ],
  },
  {
    title: "Tools",
    links: [
      { to: "/data", label: "Data", icon: "bi-hdd-stack" },
      { to: "/settings", label: "Settings", icon: "bi-gear" },
    ],
  },
] as const;

export function Sidebar({
  collapsed,
  onToggle,
  counts = {},
}: {
  collapsed: boolean;
  onToggle: () => void;
  counts?: Record<string, number>;
}) {
  return (
    <div
      className={`sidebar bg-white shadow-sm border-end${collapsed ? " collapsed" : ""}`}
      id="sidebar"
    >
      <div className="sidebar-header p-3 border-bottom">
        <h6 className="mb-0">Navigation</h6>
      </div>

      <div className="sidebar-content">
        {SECTIONS.map((section) => (
          <div className="nav-section" key={section.title}>
            <div className="nav-section-header p-3 bg-light border-bottom">
              <small className="text-muted text-uppercase fw-bold">{section.title}</small>
            </div>
            <nav className="nav flex-column">
              {section.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === "/"}
                  className={({ isActive }) =>
                    `nav-link d-flex align-items-center py-2 px-3${isActive ? " active" : ""}`
                  }
                >
                  <i className={`bi ${link.icon} me-2`} aria-hidden="true" />
                  {link.label}
                  {counts[link.to] !== undefined ? (
                    <span className="badge bg-secondary ms-auto">{counts[link.to]}</span>
                  ) : null}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
      </div>

      <div className="sidebar-footer p-3 border-top mt-auto">
        <div className="d-flex align-items-center">
          <div className="flex-grow-1">
            <small className="text-muted">Version 0.1.0</small>
          </div>
          <button
            className="btn btn-sm btn-outline-secondary"
            id="sidebar-toggle-btn"
            title="Toggle Sidebar"
            onClick={onToggle}
          >
            <i className={`bi bi-chevron-${collapsed ? "right" : "left"}`} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
