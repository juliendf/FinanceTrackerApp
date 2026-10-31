import { createHashRouter } from "react-router-dom";
import { AppShell } from "./ui/layout/AppShell";
import { PlaceholderPage } from "./ui/components/PlaceholderPage";
import { AssetDetailPage } from "./ui/pages/assets/AssetDetailPage";
import { AssetFormPage } from "./ui/pages/assets/AssetFormPage";
import { AssetListPage } from "./ui/pages/assets/AssetListPage";
import { ChatPage } from "./ui/pages/chat/ChatPage";
import { LlmProviderFormPage } from "./ui/pages/settings/LlmProviderFormPage";
import { LlmProvidersPage } from "./ui/pages/settings/LlmProvidersPage";
import { ProfilePage } from "./ui/pages/profile/ProfilePage";
import { DataPage } from "./ui/pages/settings/DataPage";
import { CategoriesPage } from "./ui/pages/reference/CategoriesPage";
import { InstitutionsPage } from "./ui/pages/reference/InstitutionsPage";
import { TagsPage } from "./ui/pages/reference/TagsPage";
import { BulkEditPage } from "./ui/pages/snapshots/BulkEditPage";
import { BulkEntryPage } from "./ui/pages/snapshots/BulkEntryPage";
import { SnapshotDetailPage } from "./ui/pages/snapshots/SnapshotDetailPage";
import { SnapshotFormPage } from "./ui/pages/snapshots/SnapshotFormPage";
import { SnapshotListPage } from "./ui/pages/snapshots/SnapshotListPage";
import { AssetsDashboardPage } from "./ui/pages/dashboard/AssetsDashboardPage";
import { AssetEvolutionPage, DistributionChartPage } from "./ui/pages/dashboard/ChartsPages";
import { PerformancePage } from "./ui/pages/dashboard/PerformancePage";
import { ExchangeRatesEditPage } from "./ui/pages/settings/ExchangeRatesEditPage";
import { ExchangeRatesPage } from "./ui/pages/settings/ExchangeRatesPage";
import { SettingsExportPage } from "./ui/pages/settings/SettingsExportPage";
import { SettingsImportPage } from "./ui/pages/settings/SettingsImportPage";
import { SettingsPage } from "./ui/pages/settings/SettingsPage";
import { SettingsResetPage } from "./ui/pages/settings/SettingsResetPage";
import { ResumePage } from "./ui/pages/dashboard/ResumePage";
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
        <ResumePage />
      </AppShell>
    ),
  },
  {
    path: "/dashboard/resume",
    element: (
      <AppShell>
        <ResumePage />
      </AppShell>
    ),
  },
  {
    path: "/dashboard/assets",
    element: (
      <AppShell>
        <AssetsDashboardPage />
      </AppShell>
    ),
  },
  {
    path: "/dashboard/performance",
    element: (
      <AppShell>
        <PerformancePage />
      </AppShell>
    ),
  },
  {
    path: "/charts/performance",
    element: (
      <AppShell>
        <PerformancePage />
      </AppShell>
    ),
  },
  {
    path: "/charts/distribution",
    element: (
      <AppShell>
        <DistributionChartPage />
      </AppShell>
    ),
  },
  {
    path: "/charts/asset-evolution",
    element: (
      <AppShell>
        <AssetEvolutionPage />
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
    path: "/assets/new",
    element: (
      <AppShell>
        <AssetFormPage />
      </AppShell>
    ),
  },
  {
    path: "/assets/:assetId",
    element: (
      <AppShell>
        <AssetDetailPage />
      </AppShell>
    ),
  },
  {
    path: "/assets/:assetId/edit",
    element: (
      <AppShell>
        <AssetFormPage />
      </AppShell>
    ),
  },
  {
    path: "/snapshots",
    element: (
      <AppShell>
        <SnapshotListPage />
      </AppShell>
    ),
  },
  {
    path: "/snapshots/new",
    element: (
      <AppShell>
        <SnapshotFormPage />
      </AppShell>
    ),
  },
  {
    path: "/snapshots/bulk",
    element: (
      <AppShell>
        <BulkEntryPage />
      </AppShell>
    ),
  },
  {
    path: "/snapshots/bulk-edit",
    element: (
      <AppShell>
        <BulkEditPage />
      </AppShell>
    ),
  },
  {
    path: "/snapshots/:snapshotId",
    element: (
      <AppShell>
        <SnapshotDetailPage />
      </AppShell>
    ),
  },
  {
    path: "/snapshots/:snapshotId/edit",
    element: (
      <AppShell>
        <SnapshotFormPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/data",
    element: (
      <AppShell>
        <DataPage />
      </AppShell>
    ),
  },
  {
    path: "/chat",
    element: (
      <AppShell>
        <ChatPage />
      </AppShell>
    ),
  },
  {
    path: "/chat/:conversationId",
    element: (
      <AppShell>
        <ChatPage />
      </AppShell>
    ),
  },
  {
    path: "/settings",
    element: (
      <AppShell>
        <SettingsPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/llm-providers",
    element: (
      <AppShell>
        <LlmProvidersPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/llm-providers/new",
    element: (
      <AppShell>
        <LlmProviderFormPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/llm-providers/:providerId/edit",
    element: (
      <AppShell>
        <LlmProviderFormPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/reset",
    element: (
      <AppShell>
        <SettingsResetPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/export",
    element: (
      <AppShell>
        <SettingsExportPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/import",
    element: (
      <AppShell>
        <SettingsImportPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/exchange-rates",
    element: (
      <AppShell>
        <ExchangeRatesPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/exchange-rates/edit",
    element: (
      <AppShell>
        <ExchangeRatesEditPage />
      </AppShell>
    ),
  },
  {
    path: "/settings/exchange-rates/history",
    element: (
      <AppShell>
        <ExchangeRatesPage />
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
    path: "/profile",
    element: (
      <AppShell>
        <ProfilePage />
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
]);
