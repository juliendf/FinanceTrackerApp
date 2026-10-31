/**
 * Top toolbar: the draggable strip that carries the window controls on macOS.
 *
 * Navigation lives in the sidebar, so this is deliberately thin: the theme
 * toggle and the account menu, with the rest of the strip acting as the window
 * drag region. The traffic lights sit over it (the window uses an overlay title
 * bar), which is why the left side keeps a fixed inset.
 */

import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Dropdown } from "react-bootstrap";
import { AboutModal } from "../components/AboutModal";
import { ThemeToggle } from "./ThemeToggle";

export function Navbar() {
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <header className="app-toolbar" data-tauri-drag-region>
        <div className="app-toolbar-title" data-tauri-drag-region>
          <img src="/icon.png" alt="" width={18} height={18} />
          <span>FinanceTracker</span>
        </div>
        <div className="app-toolbar-spacer" data-tauri-drag-region />
        <ThemeToggle />
        <Dropdown align="end">
          <Dropdown.Toggle
            as="button"
            className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-2"
            bsPrefix="app-user-toggle"
          >
            <i className="bi bi-person-circle" aria-hidden="true" />
            <span className="d-none d-md-inline">You</span>
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item as={NavLink} to="/profile">
              <i className="bi bi-person-gear me-2" aria-hidden="true" />
              Profile settings
            </Dropdown.Item>
            <Dropdown.Item as={NavLink} to="/settings">
              <i className="bi bi-gear me-2" aria-hidden="true" />
              Settings
            </Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item onClick={() => setAboutOpen(true)}>
              <i className="bi bi-info-circle me-2" aria-hidden="true" />
              About FinanceTracker
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </header>

      <AboutModal show={aboutOpen} onHide={() => setAboutOpen(false)} />
    </>
  );
}
