/**
 * Root route: first-run screen while the database is empty, dashboard after.
 *
 * The source had no concept of "empty" — a new user registered and landed on an
 * empty dashboard. Here the first launch has a decision to make, so it gets its
 * own screen.
 */

import { useQuery } from "@tanstack/react-query";
import { isEmptyDatabase } from "../../../db/seed";
import { FirstRunPage } from "./FirstRunPage";
import { PlaceholderPage } from "../../components/PlaceholderPage";

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

  return (
    <PlaceholderPage
      title="Dashboard"
      phase="Phase 5"
      icon="speedometer2"
      description="KPI tiles with count-up, portfolio pie, evolution line with a range selector."
    />
  );
}
