/**
 * Home dashboard: what the portfolio is worth now.
 *
 * KPI tiles and a breakdown pie. The value-over-time line lives on the Performance
 * screen, which owns the period selector — keeping it here meant two controls
 * for the same series on two screens.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { distribution, summarise, type DistributionGroup } from "../../../domain/dashboard";
import { formatCurrency } from "../../../domain/format";
import { useDashboardData } from "../../../lib/useDashboardData";
import { DistributionPie } from "../../charts/DistributionPie";
import { CountUp } from "../../components/CountUp";
import { PageHeader } from "../../components/FormCard";
import { UnconvertedBadge } from "../../components/UnconvertedBadge";

const GROUPS: Array<[DistributionGroup, string]> = [
  ["category", "Category"],
  ["currency", "Currency"],
  ["institution", "Institution"],
  ["product", "Product"],
];

export function DashboardPage() {
  const data = useDashboardData();
  const [group, setGroup] = useState<DistributionGroup>("category");

  const view = useMemo(() => {
    const converter = data.makeConverter();
    const summary = summarise(data.facts, data.assetCurrencies, converter, data.today);
    const slices = distribution(data.facts, group, converter);
    return { summary, slices, warnings: [...converter.warnings] };
  }, [data.facts, data.assetCurrencies, data.today, data.makeConverter, group]);

  if (data.isLoading) return <p className="text-muted">Loading…</p>;
  if (data.error) return <div className="alert alert-danger">Could not load the dashboard: {String(data.error)}</div>;

  const { summary, slices, warnings } = view;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Here's your financial overview."
        icon="speedometer2"
      />

      <div className="stat-grid">
        <div>
          <div className="stat-card accent-primary">
            <div className="stat-label">Total Assets</div>
            <div className="stat-icon"><i className="bi bi-wallet2" aria-hidden="true" /></div>
            <div className="stat-number" id="total-assets"><CountUp value={summary.totalAssets} /></div>
            <div className="stat-subtitle">Across all institutions</div>
          </div>
        </div>
        <div>
          <div className="stat-card accent-success">
            <div className="stat-label">Portfolio Value</div>
            <div className="stat-icon"><i className="bi bi-cash-stack" aria-hidden="true" /></div>
            <div className="stat-number stat-number-money" id="portfolio-value">
              {formatCurrency(summary.portfolioValue, data.baseCurrency)}
            </div>
            <div className="stat-subtitle">
              Current total in {data.baseCurrency}
              <UnconvertedBadge warnings={warnings} />
            </div>
          </div>
        </div>
        <div>
          <div className="stat-card accent-info">
            <div className="stat-label">Currencies</div>
            <div className="stat-icon"><i className="bi bi-globe2" aria-hidden="true" /></div>
            <div className="stat-number" id="currency-count"><CountUp value={summary.currencyCount} /></div>
            <div className="stat-subtitle">{summary.currencies.join(", ") || "None yet"}</div>
          </div>
        </div>
        <div>
          <div className={`stat-card ${summary.daysSinceUpdate > 30 ? "accent-warning" : "accent-primary"}`}>
            <div className="stat-label">Days Since Update</div>
            <div className="stat-icon"><i className="bi bi-clock-history" aria-hidden="true" /></div>
            <div className="stat-number" id="last-update"><CountUp value={summary.daysSinceUpdate} /></div>
            <div className="stat-subtitle">Last snapshot entry</div>
          </div>
        </div>
      </div>

      <div className="row mb-4 quick-actions">
        <div className="col-12">
          <div className="d-flex flex-wrap gap-2">
            <Link to="/assets/new" className="btn btn-primary">
              <i className="bi bi-plus-lg" aria-hidden="true" />
              Add New Asset
            </Link>
            <Link to="/snapshots/new" className="btn btn-secondary">
              <i className="bi bi-camera" aria-hidden="true" />
              Record Snapshot
            </Link>
            <Link to="/snapshots/bulk" className="btn btn-secondary">
              <i className="bi bi-list-ul" aria-hidden="true" />
              Bulk Entry
            </Link>
            <Link to="/settings" className="btn btn-secondary ms-sm-auto">
              <i className="bi bi-gear" aria-hidden="true" />
              Settings
            </Link>
          </div>
        </div>
      </div>

      <div className="card card-accent">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="card-title mb-0">
            <i className="bi bi-pie-chart me-2" aria-hidden="true" />
            Portfolio Breakdown
          </h5>
          <div className="segmented" role="group" aria-label="Group breakdown by">
            {GROUPS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`btn${group === key ? " active" : ""}`}
                aria-pressed={group === key}
                onClick={() => setGroup(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          <DistributionPie slices={slices} currency={group === "currency" ? "native" : data.baseCurrency} />
        </div>
      </div>
    </>
  );
}
