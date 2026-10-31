/**
 * Shared shell for the settings screens: port of `settings/_layout.html`.
 *
 * One page header, a left nav listing every settings area, and the page's own
 * content. The nav marks the current page.
 */

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { PageHeader } from "../../components/FormCard";

const NAV = [
  { to: "/settings", label: "General", icon: "bi-gear" },
  { to: "/settings/exchange-rates", label: "Exchange Rates", icon: "bi-currency-exchange" },
  { to: "/settings/llm-providers", label: "LLM Providers", icon: "bi-cpu" },
  { to: "/settings/data", label: "Data & Backup", icon: "bi-hdd-stack" },
];

export function SettingsLayout({
  title,
  subtitle = "Configure your Finance Tracker preferences",
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { pathname } = useLocation();

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} icon="gear" showDate={false} actions={actions} />
      <div className="row g-4">
        <div className="col-lg-3">
          <div className="settings-nav">
            <div className="panel-title px-2">Settings</div>
            <ul className="nav nav-pills flex-column">
              {NAV.map((item) => {
                const active = item.to === "/settings" ? pathname === "/settings" : pathname.startsWith(item.to);
                return (
                  <li className="nav-item" key={item.to}>
                    <Link className={`nav-link${active ? " active" : ""}`} to={item.to} aria-current={active ? "page" : undefined}>
                      <i className={`bi ${item.icon} me-2`} aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <div className="col-lg-9">{children}</div>
      </div>
    </>
  );
}
