import { createHashRouter, Navigate } from "react-router-dom";
import { AppShell } from "./ui/layout/AppShell";
import { PlaceholderPage } from "./ui/components/PlaceholderPage";
import { AssetListPage } from "./ui/pages/assets/AssetListPage";
import { ChatSpikePage } from "./ui/pages/chat/ChatSpikePage";
import { DataPage } from "./ui/pages/settings/DataPage";
import { CategoriesPage } from "./ui/pages/reference/CategoriesPage";
import { InstitutionsPage } from "./ui/pages/reference/InstitutionsPage";
import { TagsPage } from "./ui/pages/reference/TagsPage";
import { StartRoute } from "./ui/pages/start/StartRoute";

/**
 * Hash router, mirroring the web app's URL structure.
 *
 * Routes whose screens are not ported yet render `PlaceholderPage` so the
 * navbar never dead-ends. Each one has a row in docs/PARITY_CHECKLIST.md with
 * the phase that replaces it.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: (
      <AppShell>
        <StartRoute />
      </AppShell>
    ),
  },
  {
    path: "/resume",
    element: (
      <AppShell>
        <PlaceholderPage
          title="Résumé"
          phase="Phase 5"
          icon="file-text"
          description="French-language performance summary: invested capital, absolute and annualised performance, breakdown by system role."
        />
      </AppShell>
    ),
  },
  {
    path: "/assets",
    element: (
      <AppShell>
        <AssetListPage />
      </AppShell>
    ),
  },
  {
    path: "/snapshots",
    element: (
      <AppShell>
        <PlaceholderPage
          title="Snapshots"
          phase="Phase 4"
          icon="camera"
          description="Filters, sorting, bulk delete, CSV export, single entry and the bulk entry grid."
        />
      </AppShell>
    ),
  },
  {
    path: "/chat",
    element: (
      <AppShell>
        <ChatSpikePage />
      </AppShell>
    ),
  },
  {
    path: "/data",
    element: (
      <AppShell>
        <DataPage />
      </AppShell>
    ),
  },
  {
    path: "/settings",
    element: (
      <AppShell>
        <PlaceholderPage
          title="Settings"
          phase="Phase 6"
          icon="gear"
          description="General settings, exchange rates, backup export/import, reset to defaults."
        />
      </AppShell>
    ),
  },
  {
    path: "/profile",
    element: (
      <AppShell>
        <PlaceholderPage
          title="Profile"
          phase="Phase 7"
          icon="person-gear"
          description="Financial profile, AI style preferences, memories and goals."
        />
      </AppShell>
    ),
  },
  {
    path: "/institutions",
    element: (
      <AppShell>
        <InstitutionsPage />
      </AppShell>
    ),
  },
  {
    path: "/categories",
    element: (
      <AppShell>
        <CategoriesPage />
      </AppShell>
    ),
  },
  {
    path: "/tags",
    element: (
      <AppShell>
        <TagsPage />
      </AppShell>
    ),
  },
  {
    path: "/charts/performance",
    element: (
      <AppShell>
        <PlaceholderPage
          title="Performance"
          phase="Phase 5"
          icon="graph-up"
          description="A stub in the source app. Ported as a stub, per the brief."
        />
      </AppShell>
    ),
  },
  {
    path: "/charts/distribution",
    element: (
      <AppShell>
        <PlaceholderPage
          title="Allocations"
          phase="Phase 5"
          icon="pie-chart"
          description="Distribution by institution, category, currency and product."
        />
      </AppShell>
    ),
  },
  {
    path: "*",
    element: (
      <AppShell>
        <PlaceholderPage
          title="Page not found"
          phase="—"
          icon="question-circle"
          description="That route does not exist."
        />
      </AppShell>
    ),
  },
  {
    path: "/assets/new",
    element: <Navigate to="/assets" replace />,
  },
]);
