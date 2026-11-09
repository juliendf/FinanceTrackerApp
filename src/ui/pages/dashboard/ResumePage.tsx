/**
 * Performance: how the portfolio did over a chosen period.
 *
 * The period lives in `?range=`. Amounts use the `currency` filter, so the base
 * currency symbol placement follows `formatCurrency`.
 *
 * The route is still `/resume`, from when this screen was in French. The path is
 * invisible, and changing it would break saved links for no gain.
 *
 * Laid out like the Dashboard — header banner, stat tiles, cards with header
 * bars — because it is the same kind of page. It used to be a narrow centred
 * column with a bare heading, which read as a different product.
 *
 * The route is still `/resume` for the same reason: invisible, and renaming it
 * would break saved links for nothing.
 */

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import type { ReactNode } from "react";
import { portfolioEvolution, RESUME_RANGES, resumeMetrics } from "../../../domain/dashboard";
import { formatCurrency, formatDate } from "../../../domain/format";
import { useDashboardData } from "../../../lib/useDashboardData";
import { UnconvertedBadge } from "../../components/UnconvertedBadge";
import { EvolutionLineChart } from "../../charts/EvolutionLineChart";
import { PageHeader } from "../../components/FormCard";
import { StatCard } from "../../components/StatCard";

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

/** One label/value row inside a card, matching the tables elsewhere. */
function Row({ label, tip, children, className = "" }: { label: string; tip: string; children: ReactNode; className?: string }) {
  return (
    <tr>
      <th scope="row" className="fw-normal">
        {label}
        <Info text={tip} />
      </th>
      <td className={`text-end ${className}`}>{children}</td>
    </tr>
  );
}

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
    const metrics = resumeMetrics(data.facts, converter, range, data.today);
    // The same series the Dashboard used to draw, now driven by this page's
    // range: one control, one line.
    const evolution = portfolioEvolution(data.facts, converter, range, data.today, metrics.totalValue);
    return { metrics, evolution, warnings: [...converter.warnings] };
  }, [data.facts, data.makeConverter, data.today, range]);

  if (data.isLoading) return <p className="text-muted">Loading…</p>;

  const m = view.metrics;
  const money = (value: { toNumber(): number }) => formatCurrency(value.toNumber(), data.baseCurrency);
  const positive = m.netPerformancePct === null ? undefined : m.netPerformancePct.greaterThanOrEqualTo(0) ? "success" : "danger";

  return (
    <>
      <PageHeader
        title="Performance"
        subtitle={
          m.startDate ? (
            <>
              {formatDate(m.startDate)} — {formatDate(m.endDate)}
              <UnconvertedBadge warnings={view.warnings} />
            </>
          ) : (
            "No snapshots in this period"
          )
        }
        icon="file-text"
        actions={
          <div className="btn-group btn-group-sm" role="group" aria-label="Period">
            {RESUME_RANGES.map((key) => (
              <Link
                key={key}
                to={`/resume?range=${key}`}
                replace
                className={`btn btn-outline-primary${range === key ? " active" : ""}`}
                aria-current={range === key ? "true" : undefined}
              >
                {LABELS[key]}
              </Link>
            ))}
          </div>
        }
      />

      <div className="stat-grid">
        <StatCard
          label="Total portfolio value"
          icon="bi-cash-stack"
          accent="primary"
          money
          value={money(m.totalValue)}
          subtitle="At the end of the period"
        />
        <StatCard
          label="Net performance"
          icon="bi-graph-up-arrow"
          accent={positive}
          value={m.netPerformancePct !== null ? `${signed(m.netPerformancePct)} %` : "N/A"}
          subtitle="On the capital held at the start"
        />
        <StatCard
          label="Absolute performance"
          icon="bi-plus-slash-minus"
          accent={positive}
          money
          value={money(m.netPerformanceAbs)}
          subtitle="End value minus start value"
        />
        <StatCard
          label="Annualised performance"
          icon="bi-calendar-check"
          accent={m.annualizedPerformance === null ? undefined : m.annualizedPerformance.greaterThanOrEqualTo(0) ? "success" : "danger"}
          value={m.annualizedPerformance !== null ? `${signed(m.annualizedPerformance)} %` : "N/A"}
          subtitle="Growth per year over the period"
        />
      </div>

      <div className="card card-accent mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="card-title mb-0">
            <i className="bi bi-graph-up me-2" aria-hidden="true" />
            Portfolio Evolution
          </h5>
          <span className="text-muted small">{LABELS[range] ?? range}</span>
        </div>
        <div className="card-body">
          <EvolutionLineChart
            points={view.evolution.points.map((point) => ({ label: point.date, value: point.value.toNumber() }))}
            currency={data.baseCurrency}
            seriesLabel="Portfolio value"
          />
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">
              <h5 className="card-title mb-0">
                <i className="bi bi-calendar-range me-2" aria-hidden="true" />
                Period
              </h5>
            </div>
            <div className="card-body p-0">
              <table className="table align-middle mb-0">
                <tbody>
                  <Row label="Period length" tip="Number of days between the start and the end of the selected period.">
                    {m.timeInMarket !== null ? `${m.timeInMarket} days` : "—"}
                  </Row>
                  <Row label="Invested capital" tip="Portfolio value at the start of the period, in the base currency.">
                    {money(m.investedCapital)}
                  </Row>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="card-title mb-0">
                <i className="bi bi-pie-chart me-2" aria-hidden="true" />
                Assets
              </h5>
              <button
                className="btn btn-sm btn-outline-secondary"
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                {open ? "Hide breakdown" : "Show breakdown"}
              </button>
            </div>
            <div className="card-body p-0">
              <table className="table align-middle mb-0">
                <tbody>
                  <Row label="Cash" tip={'Assets whose category has the "Cash" system role.'}>
                    {money(m.cashValue)}
                  </Row>
                  <Row label="Emergency fund" tip={'Assets whose category has the "Emergency fund" system role.'}>
                    {money(m.emergencyFundValue)}
                  </Row>
                </tbody>
              </table>

              {open ? (
                <div className="p-3" id="breakdown">
                  {m.breakdown.map((item) => (
                    <div key={item.label} className="d-flex justify-content-between py-1">
                      <span>{item.label}</span>
                      <span className="money">{money(item.value)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
