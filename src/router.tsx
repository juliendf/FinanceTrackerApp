import { createHashRouter, Navigate } from "react-router-dom";
import { AppShell } from "./ui/layout/AppShell";
import { AssetListPage } from "./ui/pages/assets/AssetListPage";
import { ChatSpikePage } from "./ui/pages/chat/ChatSpikePage";

/**
 * Hash router, mirroring the web app's URL structure. Hash routing keeps the
 * bundle scheme-agnostic inside the Tauri webview.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: (
      <AppShell>
        <Navigate to="/assets" replace />
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
    path: "/ai",
    element: (
      <AppShell>
        <ChatSpikePage />
      </AppShell>
    ),
  },
  {
    path: "*",
    element: (
      <AppShell>
        <p className="text-muted">Page not found.</p>
      </AppShell>
    ),
  },
]);
