/**
 * Bulk edit exchange rates.
 *
 * One rate per pair, saved in one transaction. The required pairs (CHF<->USD)
 * are created if missing. Validation rejects a blank rate and anything below
 * 0.000001.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureRequiredPairs, listExchangeRates, saveRates } from "../../../db/repositories/exchangeRates";
import { rateText, validateRates, type RateError } from "../../../domain/exchangeRates";
import { useToast } from "../../layout/Toasts";
import { SettingsLayout } from "./SettingsLayout";

export function ExchangeRatesEditPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const ensure = useQuery({ queryKey: ["exchange-rates-ensured"], queryFn: ensureRequiredPairs });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: listExchangeRates, enabled: ensure.isSuccess });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<RateError[]>([]);

  useEffect(() => {
    if (!rates.data) return;
    // The stored text, not a 6-dp rounding of it: saving without editing must
    // not quietly lose precision the importer kept.
    setDraft(Object.fromEntries(rates.data.map((rate) => [`${rate.from_currency}>${rate.to_currency}`, rate.rate])));
  }, [rates.data]);

  const save = useMutation({
    mutationFn: saveRates,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["exchange-rates"] });
      toast.success("Exchange rates updated successfully!");
      navigate("/settings/exchange-rates");
    },
    onError: (error: unknown) =>
      toast.error(`Error updating exchange rates: ${error instanceof Error ? error.message : String(error)}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const rows = (rates.data ?? []).map((rate) => ({
      from: rate.from_currency,
      to: rate.to_currency,
      rate: draft[`${rate.from_currency}>${rate.to_currency}`] ?? "",
    }));
    const problems = validateRates(rows);
    setErrors(problems);
    if (problems.length > 0) return;
    save.mutate(rows.map((row) => ({ from_currency: row.from, to_currency: row.to, rate: rateText(row.rate) })));
  };

  const errorFor = (pair: string) => errors.find((e) => e.pair === pair)?.message;

  return (
    <SettingsLayout title="Edit Exchange Rates" subtitle="Update the conversion rate for each currency pair" actions={null}>
      <form onSubmit={submit} noValidate>
        {errors.length > 0 ? (
          <div className="alert alert-danger" role="alert">
            {errors.length} rate{errors.length === 1 ? "" : "s"} need attention.
          </div>
        ) : null}
        <div className="table-container">
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr><th>From</th><th>To</th><th className="num">Rate</th></tr>
              </thead>
              <tbody>
                {(rates.data ?? []).map((rate) => {
                  const pair = `${rate.from_currency}>${rate.to_currency}`;
                  const errorKey = `${rate.from_currency}->${rate.to_currency}`;
                  const problem = errorFor(errorKey);
                  return (
                    <tr key={pair}>
                      <td><span className="cell-title">{rate.from_currency}</span></td>
                      <td>{rate.to_currency}</td>
                      <td>
                        <input
                          type="number"
                          step="0.000001"
                          min="0.000001"
                          aria-label={`Rate ${rate.from_currency} to ${rate.to_currency}`}
                          className={`form-control form-control-sm amount-input ms-auto${problem ? " is-invalid" : ""}`}
                          value={draft[pair] ?? ""}
                          onChange={(e) => setDraft({ ...draft, [pair]: e.target.value })}
                        />
                        {problem ? <div className="invalid-feedback d-block">{problem}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2 mt-3">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            <i className="bi bi-check-lg me-2" aria-hidden="true" />
            Save All Rates
          </button>
          <Link to="/settings/exchange-rates" className="btn btn-secondary">Cancel</Link>
        </div>
      </form>
    </SettingsLayout>
  );
}
