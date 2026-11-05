/**
 * Reference-rate refresh, shared by the button and the startup path.
 *
 * One implementation on purpose: the Exchange Rates page and the automatic
 * refresh must write the same pairs, record the same dates and respect the same
 * "a rate the user typed wins" rule. Two copies would drift, and the difference
 * would only show up as a rate that quietly changed.
 */

import { invoke } from "@tauri-apps/api/core";
import { listExchangeRates, saveRates } from "../db/repositories/exchangeRates";
import { setSetting } from "../db/repositories/settings";
import { derivedRatePairs, ratesToWrite, sameRate, type EcbRates } from "../domain/exchangeRates";

export interface RateRefreshResult {
  /** Publication date of the rates the ECB returned. */
  asOf: string;
  /** How many pairs were written. Zero means everything was already set. */
  saved: number;
  /**
   * Pairs where the ECB figure differs from the stored one but was kept because
   * `replace` was off — the user's own rate. Reported so the UI can say what
   * happened instead of "nothing to update".
   */
  kept: number;
}

/**
 * Download the ECB file, derive the pairs and write them.
 *
 * `replace` decides whether a rate the user typed may be overwritten. Records
 * both the publication date and the attempt date: the first is shown to the
 * user, the second is what stops a second fetch on the same day.
 */
export async function refreshRatesFromEcb(
  options: { replace: boolean },
  today: string,
): Promise<RateRefreshResult> {
  const ecb = await invoke<EcbRates>("fetch_ecb_rates");
  const derived = derivedRatePairs(ecb.per_eur);
  const existing = await listExchangeRates();
  const write = ratesToWrite(derived, existing, options.replace);

  const saved =
    write.length > 0
      ? await saveRates(
          write.map((pair) => ({ from_currency: pair.from, to_currency: pair.to, rate: pair.rate })),
        )
      : 0;

  // What the fetch saw but did not touch, because a usable rate was already
  // there and the user did not ask for a replacement.
  const written = new Set(write.map((pair) => `${pair.from}>${pair.to}`));
  const kept = derived.filter((pair) => {
    if (written.has(`${pair.from}>${pair.to}`)) return false;
    const row = existing.find(
      (entry) => entry.from_currency === pair.from && entry.to_currency === pair.to,
    );
    return row ? !sameRate(row.rate, pair.rate) : false;
  }).length;

  await setSetting("rates_as_of", ecb.as_of);
  await setSetting("rates_fetched_on", today);
  // What the published figures were, so "nothing to do" can be judged against
  // the rates in the table rather than against the date of the last attempt.
  await setSetting("rates_last_fetch", JSON.stringify(derived));

  return { asOf: ecb.as_of, saved, kept };
}

/**
 * Whether the startup path should fetch.
 *
 * Keyed on the last *attempt*, not on the publication date: on a working day the
 * ECB publishes around 16:00 CET, so a launch at 09:00 receives the previous
 * day's file. Comparing publication dates would then fetch again on every launch
 * until the afternoon.
 */
export function shouldAutoFetchRates(input: {
  enabled: boolean;
  fetchedOn: string;
  today: string;
}): boolean {
  if (!input.enabled) return false;
  return input.fetchedOn !== input.today;
}
