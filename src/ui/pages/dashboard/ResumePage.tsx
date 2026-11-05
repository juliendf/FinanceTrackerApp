/**
 * Summary: portfolio performance over a chosen period.
 *
 * The period lives in `?range=`. Amounts use the `currency` filter, so the base
 * currency symbol placement follows `formatCurrency`.
 *
 * The route is still `/resume`, from when this screen was in French. The path is
 * invisible, and changing it would break saved links for no gain.
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
  ALL: "All time",
  YTD: "YTD",
  "1Y": "1 year",
  "6M": "6 months",
  "3M": "3 months",
  "1M": "1 month",
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

/** Always signed, two decimals: "+12.00" or "-3.50". */
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

  if (data.isLoading) return <p className="text-muted">Loading…</p>;

  const m = view.metrics;
  const money = (value: { toNumber(): number }) => formatCurrency(value.toNumber(), data.baseCurrency);

  return (
    <div className="container py-4">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <h2 className="text-center mb-4">Summary</h2>

          <div className="text-center mb-4">
            <div className="btn-group" role="group" aria-label="Period">
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
              <Row label="Period length" tip="Number of days between the start and the end of the selected period.">
                {m.timeInMarket !== null ? `${m.timeInMarket} days` : "—"}
              </Row>
              <Row label="Total portfolio value" tip="Portfolio value at the end of the period, in the base currency.">
                {money(m.totalValue)}
              </Row>
              <Row label="Invested capital" tip="Portfolio value at the start of the period, in the base currency.">
                {money(m.investedCapital)}
              </Row>
              <Row label="Absolute performance" tip="Value at the end of the period minus the value at the start." className={sign(m.netPerformanceAbs)}>
                {money(m.netPerformanceAbs)}
              </Row>
              <Row
                label="Net performance"
                tip="Absolute performance divided by the invested capital at the start of the period."
                className={m.netPerformancePct === null ? "text-muted" : sign(m.netPerformancePct)}
              >
                {m.netPerformancePct !== null ? `${signed(m.netPerformancePct)} %` : "N/A"}
              </Row>
              <Row
                last
                label="Annualised performance"
                tip="Annualised growth rate over the selected period."
                className={m.annualizedPerformance === null ? "text-muted" : sign(m.annualizedPerformance)}
              >
                {m.annualizedPerformance !== null ? `${signed(m.annualizedPerformance)} %` : "N/A"}
              </Row>
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-body">
              <h5 className="card-title">Assets</h5>
              <Row label="Total assets" tip="Total portfolio value at the end of the period.">
                {money(m.totalValue)}
              </Row>
              <Row label="Cash" tip={'Assets whose category has the "Cash" system role.'}>
                {money(m.cashValue)}
              </Row>
              <Row label="Emergency fund" tip={'Assets whose category has the "Emergency fund" system role.'}>
                {money(m.emergencyFundValue)}
              </Row>
              <div className="mt-3">
                <button
                  className="btn btn-sm btn-outline-secondary"
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                >
                  Show breakdown
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
                label="Net worth"
                tip="Total portfolio value at the end of the period. Debts are not accounted for yet."
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
