import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { router } from "./router";
import { watchSystemTheme } from "./lib/theme";
import { SeedGate } from "./ui/layout/SeedGate";
import { ToastProvider } from "./ui/layout/Toasts";
import { useAutoRefreshRates } from "./lib/useAutoRefreshRates";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Local SQLite: no network, so retries only hide real errors.
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  },
});

/**
 * The once-a-day reference-rate refresh. Rendered inside the providers so it can
 * read settings and write the table; it renders nothing.
 */
function RateRefresh() {
  useAutoRefreshRates();
  return null;
}

export default function App() {
  // Follow the OS theme while the preference is 'auto'.
  useEffect(() => watchSystemTheme(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SeedGate>
          <RouterProvider router={router} />
          <RateRefresh />
        </SeedGate>
      </ToastProvider>
    </QueryClientProvider>
  );
}
