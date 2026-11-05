/**
 * Refresh the reference rates once a day, at startup.
 *
 * Opt-in: with `rates_source_enabled` off this does nothing at all. On, it makes
 * one request per calendar day to the ECB's public file — the only request this
 * app makes without a click, and `SECURITY.md` says so.
 *
 * Silence is deliberate. A toast on every launch is noise, and a failure is
 * ordinary (a laptop opened offline); the attempt is recorded either way so it
 * does not retry until tomorrow. What the user needs to know lives on the
 * Exchange Rates page: the publication date, and whether it is old.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { todayIso } from "../domain/dates";
import { setSetting } from "../db/repositories/settings";
import { refreshRatesFromEcb, shouldAutoFetchRates } from "./rateRefresh";
import { useSettings } from "./useSettings";

export function useAutoRefreshRates(): void {
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);

  const enabled = settings.rates_source_enabled === true;
  const fetchedOn = String(settings.rates_fetched_on ?? "");

  useEffect(() => {
    const today = todayIso();
    if (!shouldAutoFetchRates({ enabled, fetchedOn, today })) return;
    // Recording the attempt invalidates the settings query, which re-runs this
    // effect while the request is still open.
    if (inFlight.current) return;
    inFlight.current = true;

    void (async () => {
      try {
        await refreshRatesFromEcb({ replace: false }, today);
      } catch {
        // Offline, an endpoint that moved, a laptop on a train. The day still
        // counts as attempted, or every launch would retry.
        await setSetting("rates_fetched_on", today).catch(() => {});
      } finally {
        inFlight.current = false;
        void queryClient.invalidateQueries({ queryKey: ["exchange-rates"] });
        void queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
    })();
  }, [enabled, fetchedOn, queryClient]);
}
