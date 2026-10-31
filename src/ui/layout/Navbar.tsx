/**
 * Navbar — port of `templates/components/navbar.html`.
 *
 * Differences, both forced by "single user, no login":
 *   * the user dropdown loses Login/Logout and shows Profile + Settings only;
 *   * the mobile floating action buttons are kept, since they are layout, not auth.
 */

import { useState } from "react";
import { NavLink } from "react-router-dom";
import { AboutModal } from "../components/AboutModal";
import { ThemeToggle } from "./ThemeToggle";

const NAV_LINKS = [
  { to: "/", label: "Dashboard", icon: "bi-speedometer2", end: true },
  { to: "/resume", label: "Résumé", icon: "bi-file-text" },
  { to: "/assets", label: "Assets", icon: "bi-wallet2" },
  { to: "/snapshots", label: "Snapshots", icon: "bi-camera" },
  { to: "/chat", label: "Chat", icon: "bi-chat-dots" },
  { to: "/data", label: "Data", icon: "bi-hdd-stack" },
];

export function Navbar() {
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <nav className="navbar navbar-expand-lg navbar-glass">
        <div className="container">
          <NavLink className="navbar-brand d-flex align-items-center" to="/">
            <span className="navbar-brand-mark">
              <i className="bi bi-graph-up-arrow" aria-hidden="true" />
            </span>
            <span>Finance Tracker</span>
          </NavLink>

          <button
            className="navbar-toggler"
            type="button"
            aria-label="Toggle navigation"
            onClick={() => {
              document.getElementById("navbarNav")?.classList.toggle("show");
            }}
          >
            <span className="navbar-toggler-icon" />
          </button>

          <div className="collapse navbar-collapse" id="navbarNav">
            <ul className="navbar-nav me-auto">
              {NAV_LINKS.map((link) => (
                <li className="nav-item" key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                  >
                    <i className={`bi ${link.icon}`} aria-hidden="true" />
                    <span>{link.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>

            <ul className="navbar-nav d-flex flex-row align-items-center gap-2">
              <li className="nav-item d-flex align-items-center">
                <ThemeToggle />
              </li>
              <li className="nav-item dropdown">
                <button
                  className="nav-link dropdown-toggle d-flex align-items-center"
                  type="button"
                  aria-expanded="false"
                  onClick={(event) => {
                    event.currentTarget.parentElement
                      ?.querySelector(".dropdown-menu")
                      ?.classList.toggle("show");
                  }}
                >
                  <i className="bi bi-person-circle" aria-hidden="true" />
                  <span className="d-none d-md-inline">You</span>
                </button>
                <ul className="dropdown-menu dropdown-menu-end">
                  <li>
                    <NavLink className="dropdown-item" to="/profile">
                      <i className="bi bi-person-gear me-2" aria-hidden="true" />
                      Profile Settings
                    </NavLink>
                  </li>
                  <li>
                    <NavLink className="dropdown-item" to="/settings">
                      <i className="bi bi-gear me-2" aria-hidden="true" />
                      Settings
                    </NavLink>
                  </li>
                  <li><hr className="dropdown-divider" /></li>
                  <li>
                    <button type="button" className="dropdown-item" onClick={() => setAboutOpen(true)}>
                      <i className="bi bi-info-circle me-2" aria-hidden="true" />
                      About
                    </button>
                  </li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </nav>

      <AboutModal show={aboutOpen} onHide={() => setAboutOpen(false)} />

      <div
        className="d-lg-none position-fixed bottom-0 end-0 p-3 d-flex flex-column gap-2"
        style={{ zIndex: 1040 }}
      >
        <NavLink to="/snapshots/new" className="btn btn-secondary fab" title="Record snapshot">
          <i className="bi bi-camera" aria-hidden="true" />
        </NavLink>
        <NavLink to="/assets/new" className="btn btn-primary fab" title="Add asset">
          <i className="bi bi-plus-lg" aria-hidden="true" />
        </NavLink>
      </div>
    </>
  );
}
