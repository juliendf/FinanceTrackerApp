/**
 * Exchange rates.
 *
 * The list creates the CHF<->USD pairs at rate 0 when missing, so they always
 * appear; the history view is the same table ordered by last update.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureRequiredPairs, listExchangeRates } from "../../../db/repositories/exchangeRates";
import { formatRate, ratesMatchLastFetch } from "../../../domain/exchangeRates";
import { refreshRatesFromEcb } from "../../../lib/rateRefresh";
import { todayIso } from "../../../domain/dates";
import { useSettings, useUpdateSetting } from "../../../lib/useSettings";
import { useToast } from "../../layout/Toasts";
import { formatDate } from "../../../domain/format";
import { SettingsLayout } from "./SettingsLayout";

export function ExchangeRatesPage() {
  const history = useLocation().pathname.endsWith("/history");
  const queryClient = useQueryClient();
  const toast = useToast();
  const { settings } = useSettings();
  const updateSetting = useUpdateSetting();
  const [replace, setReplace] = useState(false);
  const [fetching, setFetching] = useState(false);

  const sourceEnabled = settings.rates_source_enabled === true;
  const asOf = String(settings.rates_as_of ?? "");
  const fetchedOn = String(settings.rates_fetched_on ?? "");
  const checkedToday = fetchedOn === todayIso();
  /**
   * Download the ECB file and write what it implies.
   *
   * Shared with the startup refresh so the two cannot disagree about which
   * pairs are written or what "a rate the user set" means.
   */
  const fetchRates = async () => {
    setFetching(true);
    try {
      const { asOf: published, saved, kept } = await refreshRatesFromEcb({ replace }, todayIso());
      await queryClient.invalidateQueries({ queryKey: ["exchange-rates"] });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success(
        saved > 0
          ? `Updated ${saved} rate${saved === 1 ? "" : "s"} from the ECB, as of ${published}.`
          : kept > 0
            ? `Kept ${kept} rate${kept === 1 ? "" : "s"} you set. Tick "Also replace rates I set myself" to take the ECB figures from ${published}.`
            : `Already up to date with the ECB figures from ${published}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setFetching(false);
    }
  };

  const ensure = useQuery({ queryKey: ["exchange-rates-ensured"], queryFn: ensureRequiredPairs });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: listExchangeRates, enabled: ensure.isSuccess });

  /**
   * "Nothing to do" is judged against the rates in the table, not against the
   * date of the last attempt. Disabling on the date alone locked the button for
   * the rest of the day — including after editing a rate by hand and wanting the
   * published figure back.
   */
  const upToDate =
    checkedToday && asOf !== "" && ratesMatchLastFetch(rates.data ?? [], String(settings.rates_last_fetch ?? ""));


  useEffect(() => {
    if (ensure.isSuccess) void queryClient.invalidateQueries({ queryKey: ["exchange-rates"] });
  }, [ensure.isSuccess, queryClient]);

  const rows = [...(rates.data ?? [])].sort((a, b) =>
    history
      ? b.updated_at.localeCompare(a.updated_at)
      : `${a.from_currency}${a.to_currency}`.localeCompare(`${b.from_currency}${b.to_currency}`),
  );

  return (
    <SettingsLayout
      title="Exchange Rates"
      subtitle="Conversion rates used for multi-currency totals"
      actions={
        <>
          <Link to="/settings/exchange-rates/edit" className="btn btn-primary btn-sm">
            <i className="bi bi-pencil-square" aria-hidden="true" />
            Edit Rates
          </Link>
          <Link
            to={history ? "/settings/exchange-rates" : "/settings/exchange-rates/history"}
            className="btn btn-secondary btn-sm"
          >
            <i className="bi bi-clock-history" aria-hidden="true" />
            {history ? "Current rates" : "History"}
          </Link>
        </>
      }
    >
      <div className="card card-finance mb-4">
        <div className="card-body">
          <h5 className="card-title">
            <i className="bi bi-bank me-2" aria-hidden="true" />
            Reference rates
          </h5>
          <div className="form-check mb-2">
            <input
              className="form-check-input"
              type="checkbox"
              id="rates_source_enabled"
              checked={sourceEnabled}
              onChange={(event) =>
                void updateSetting.mutateAsync({ key: "rates_source_enabled", value: event.target.checked })
              }
            />
            <label className="form-check-label" htmlFor="rates_source_enabled">
              Keep rates current from the European Central Bank
            </label>
            <div className="form-text">
              Once a day, when the app starts. This is the only request the app makes without you clicking anything.
            </div>
          </div>
          <p className="text-muted small mb-3">
            The ECB publishes <strong>reference rates once per working day</strong>, around 16:00 CET, as units of each
            currency per euro. They are not tradeable rates — there is no spread and no intraday movement — and on
            weekends and holidays the last working day is shown. Cross rates such as USD→CHF are calculated from the two
            euro rates. The request downloads one public file from <code>ecb.europa.eu</code>; nothing about your data is
            sent.
          </p>

          {sourceEnabled ? (
            <>
              <div className="form-check mb-3">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="replace_rates"
                  checked={replace}
                  onChange={(event) => setReplace(event.target.checked)}
                />
                <label className="form-check-label" htmlFor="replace_rates">
                  Also replace rates I set myself
                </label>
                <div className="form-text">
                  Off, a fetch only fills pairs that have no usable rate. On, every pair is overwritten with the ECB
                  figure.
                </div>
              </div>
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void fetchRates()}
                  disabled={fetching || upToDate}
                  title={
                    upToDate
                      ? "Already checked today. The ECB publishes reference rates once per working day, around 16:00 CET."
                      : undefined
                  }
                >
                  <i className="bi bi-cloud-download me-2" aria-hidden="true" />
                  {fetching ? "Fetching…" : upToDate ? "Checked today" : "Fetch from the ECB"}
                </button>
                <span className="text-muted small">
                  {asOf ? `Rates as of ${asOf}` : "Never fetched"}
                  {checkedToday ? " · checked today" : fetchedOn ? ` · last checked ${fetchedOn}` : ""}
                </span>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {rates.isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card card-finance">
          <div className="empty-state">
            <i className="bi bi-currency-exchange empty-state-icon" aria-hidden="true" />
            <p className="empty-state-title mb-0">No exchange rates configured</p>
            <p className="mb-2">Add rates so amounts in other currencies can be converted.</p>
            <Link to="/settings/exchange-rates/edit" className="btn btn-primary btn-sm">
              <i className="bi bi-pencil-square" aria-hidden="true" />
              Set Rates
            </Link>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Rate</th>
                  {history ? <th>Last Updated</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((rate) => (
                  <tr key={rate.id}>
                    <td><span className="cell-title">{rate.from_currency}</span></td>
                    <td>{rate.to_currency}</td>
                    <td className="num">
                      {formatRate(rate.rate)}
                      {Number(rate.rate) <= 0 ? <span className="badge bg-warning text-dark ms-2">unset</span> : null}
                    </td>
                    {history ? <td className="text-muted">{formatDate(rate.updated_at, "%Y-%m-%d %H:%M")}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SettingsLayout>
  );
}
