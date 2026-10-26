/** Breadcrumbs — port of `components/breadcrumb.html`. */

import { Link } from "react-router-dom";

export interface Crumb {
  title: string;
  url?: string;
  icon?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="breadcrumb" className="mb-3">
      <ol className="breadcrumb">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1;
          return (
            <li
              className={`breadcrumb-item${isLast ? " active" : ""}`}
              aria-current={isLast ? "page" : undefined}
              key={`${crumb.title}-${index}`}
            >
              {isLast || !crumb.url ? (
                <>
                  {crumb.icon ? <i className={`${crumb.icon} me-1`} aria-hidden="true" /> : null}
                  {crumb.title}
                </>
              ) : (
                <Link to={crumb.url} className="text-decoration-none">
                  {crumb.icon ? <i className={`${crumb.icon} me-1`} aria-hidden="true" /> : null}
                  {crumb.title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
