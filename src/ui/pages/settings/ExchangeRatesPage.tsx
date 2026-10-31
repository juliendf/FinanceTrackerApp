/**
 * Exchange rates: port of `settings/exchange_rates.html` and the list/history
 * routes.
 *
 * The list route creates the CHF<->USD pairs at rate 0 when missing, so they
 * always appear; the history view is the same table ordered by last update.
 */

import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureRequiredPairs, listExchangeRates } from "../../../db/repositories/exchangeRates";
import { formatDate } from "../../../domain/format";
import { formatRate } from "../../../domain/exchangeRates";
import { SettingsLayout } from "./SettingsLayout";

export function ExchangeRatesPage() {
  const history = useLocation().pathname.endsWith("/history");
  const queryClient = useQueryClient();

  const ensure = useQuery({ queryKey: ["exchange-rates-ensured"], queryFn: ensureRequiredPairs });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: listExchangeRates, enabled: ensure.isSuccess });

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
