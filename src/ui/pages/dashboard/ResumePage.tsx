/**
 * Résumé: port of `templates/dashboard/resume.html`. French UI, as in the source.
 *
 * The period lives in `?range=`. Amounts use the `currency` filter, so the base
 * currency symbol placement follows `formatCurrency`.
 */

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import type { ReactNode } from "react";
import { RESUME_RANGES, resumeMetrics } from "../../../domain/dashboard";
import { formatCurrency, formatDate } from "../../../domain/format";
import { useDashboardData } from "../../../lib/useDashboardData";
import { UnconvertedBadge } from "../../components/UnconvertedBadge";

const LABELS: Record<string, string> = {
  ALL: "Depuis toujours",
  YTD: "YTD",
  "1Y": "1 an",
  "6M": "6 mois",
  "3M": "3 mois",
  "1M": "1 mois",
};

function Info({ text }: { text: string }) {
  return (
    <OverlayTrigger placement="top" overlay={<Tooltip>{text}</Tooltip>}>
      <i className="bi bi-info-circle text-muted ms-1" aria-label={text} role="img" tabIndex={0} />
    </OverlayTrigger>
  );
}

function Row({ label, tip, children, last = false, className = "" }: { label: string; tip: string; children: ReactNode; last?: boolean; className?: string }) {
  return (
    <div className={`d-flex justify-content-between py-2${last ? "" : " border-bottom"}`}>
      <span>
        {label}
        <Info text={tip} />
      </span>
      <span className={className}>{children}</span>
    </div>
  );
}

const sign = (value: { greaterThanOrEqualTo(n: number): boolean }) => (value.greaterThanOrEqualTo(0) ? "text-success" : "text-danger");

/** Python's `'%+.2f' | format(x)`. */
const signed = (value: { toFixed(n: number): string; isNegative(): boolean }) =>
  `${value.isNegative() ? "" : "+"}${value.toFixed(2)}`;

export function ResumePage() {
  const [params] = useSearchParams();
  const range = (params.get("range") ?? "ALL").toUpperCase();
  const data = useDashboardData();
  const [open, setOpen] = useState(false);

  const view = useMemo(() => {
    const converter = data.makeConverter();
    return { metrics: resumeMetrics(data.facts, converter, range, data.today), warnings: [...converter.warnings] };
  }, [data.facts, data.makeConverter, data.today, range]);

  if (data.isLoading) return <p className="text-muted">Chargement…</p>;

  const m = view.metrics;
  const money = (value: { toNumber(): number }) => formatCurrency(value.toNumber(), data.baseCurrency);

  return (
    <div className="container py-4">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <h2 className="text-center mb-4">Résumé</h2>

          <div className="text-center mb-4">
            <div className="btn-group" role="group" aria-label="Période">
              {RESUME_RANGES.map((key) => (
                <Link
                  key={key}
                  to={`/resume?range=${key}`}
                  replace
                  className={`btn btn-outline-secondary${range === key ? " active" : ""}`}
                  aria-current={range === key ? "true" : undefined}
                >
                  {LABELS[key]}
                </Link>
              ))}
            </div>
            {m.startDate ? (
              <div className="text-muted small mt-2">
                {formatDate(m.startDate)} — {formatDate(m.endDate)}
                <UnconvertedBadge warnings={view.warnings} />
              </div>
            ) : null}
          </div>

          <div className="card mb-3">
            <div className="card-body">
              <Row label="Durée de la période" tip="Nombre de jours entre le début et la fin de la période sélectionnée.">
                {m.timeInMarket !== null ? `${m.timeInMarket} jours` : "—"}
              </Row>
              <Row label="Valeur totale du portefeuille" tip="Valeur du portefeuille à la fin de la période, en devise de base.">
                {money(m.totalValue)}
              </Row>
              <Row label="Capital investi" tip="Valeur du portefeuille au début de la période, en devise de base.">
                {money(m.investedCapital)}
              </Row>
              <Row label="Performance absolue" tip="Valeur à la fin de la période moins la valeur au début de la période." className={sign(m.netPerformanceAbs)}>
                {money(m.netPerformanceAbs)}
              </Row>
              <Row
                label="Performance nette"
                tip="Performance absolue divisée par le capital investi au début de la période."
                className={m.netPerformancePct === null ? "text-muted" : sign(m.netPerformancePct)}
              >
                {m.netPerformancePct !== null ? `${signed(m.netPerformancePct)} %` : "N/A"}
              </Row>
              <Row
                last
                label="Performance annualisée"
                tip="Taux de croissance annualisé sur la période sélectionnée."
                className={m.annualizedPerformance === null ? "text-muted" : sign(m.annualizedPerformance)}
              >
                {m.annualizedPerformance !== null ? `${signed(m.annualizedPerformance)} %` : "N/A"}
              </Row>
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-body">
              <h5 className="card-title">Actifs</h5>
              <Row label="Actifs totaux" tip="Valeur totale du portefeuille à la fin de la période.">
                {money(m.totalValue)}
              </Row>
              <Row label="Cash" tip={'Somme des actifs dont la catégorie a le rôle système "Liquidités".'}>
                {money(m.cashValue)}
              </Row>
              <Row label="Fonds d'urgence" tip={'Somme des actifs dont la catégorie a le rôle système "Fonds d\'urgence".'}>
                {money(m.emergencyFundValue)}
              </Row>
              <div className="mt-3">
                <button
                  className="btn btn-sm btn-outline-secondary"
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                >
                  Voir la répartition
                </button>
                {open ? (
                  <div className="mt-2" id="breakdown">
                    {m.breakdown.map((item) => (
                      <div key={item.label} className="d-flex justify-content-between py-1">
                        <span>{item.label}</span>
                        <span>{money(item.value)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <Row
                last
                label="Fortune / Actifs nets"
                tip="Valeur totale du portefeuille à la fin de la période. Les dettes ne sont pas encore prises en charge."
              >
                {money(m.netWorth)}
              </Row>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
