/**
 * Root route: first-run screen while the database is empty, dashboard after.
 *
 * The first launch has a decision to make — start empty or import a backup — so
 * it gets its own screen.
 */

import { useQuery } from "@tanstack/react-query";
import { isEmptyDatabase } from "../../../db/seed";
import { FirstRunPage } from "./FirstRunPage";
import { DashboardPage } from "../dashboard/DashboardPage";

export function StartRoute() {
  const empty = useQuery({ queryKey: ["database-empty"], queryFn: isEmptyDatabase });

  if (empty.isLoading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading…</span>
        </div>
      </div>
    );
  }

  if (empty.data) return <FirstRunPage />;

  return <DashboardPage />;
}
