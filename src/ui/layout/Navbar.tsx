/**
 * Top toolbar: a drag strip with the app name, the theme toggle and a shortcut to
 * your profile.
 *
 * Navigation is the sidebar's job, so there is no second menu here. About lives
 * at the bottom of the sidebar, next to the version it describes.
 */

import { NavLink } from "react-router-dom";
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
      <NavLink to="/profile" className="app-user-toggle" title="Your profile">
        <i className="bi bi-person-circle" aria-hidden="true" />
        <span className="d-none d-md-inline">You</span>
      </NavLink>
    </header>
  );
}
