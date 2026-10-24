/**
 * Assets list.
 *
 * Reproduces `templates/assets/list.html` minus the filter block (Phase 3) and
 * minus the Tags column (no tags table until Phase 2). KPI tiles, the table and
 * the freshness badges match the source.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Table } from "react-bootstrap";
import { listAssets, deleteAsset } from "../../../db/repositories/assets";
import { listCategories } from "../../../db/repositories/categories";
import { listInstitutions } from "../../../db/repositories/institutions";
import { listAllSnapshotPoints } from "../../../db/repositories/snapshots";
import { formatMinorAsCurrency } from "../../../domain/format";
import { formatDate, relativeDate } from "../../../domain/format";
import {
  buildPortfolioSeries,
  freshness,
  summariseAssets,
  type FreshnessStatus,
} from "../../../domain/portfolio";
import { loadSampleData, resetData } from "../../../dev/sampleData";
import { PortfolioLineChart } from "../../charts/PortfolioLineChart";
import { StatCard } from "../../components/StatCard";
import { AssetFormModal } from "./AssetFormModal";

const STATUS_META: Record<FreshnessStatus, { label: string; variant: string }> = {
  current: { label: "Current", variant: "success" },
  outdated: { label: "Outdated", variant: "warning" },
  stale: { label: "Stale", variant: "danger" },
  "no-data": { label: "No data", variant: "secondary" },
};

/** Port of `Asset.display_name` from `app/models/core.py`. */
function displayName(row: {
  name: string | null;
  institution_name: string;
  product_name: string;
  category_name: string;
}): string {
  if (row.name) return row.name;
  return `${row.institution_name} - ${row.product_name} (${row.category_name})`;
}

export function AssetListPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: listAssets });
  const institutionsQuery = useQuery({
    queryKey: ["institutions"],
    queryFn: listInstitutions,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  });
  const pointsQuery = useQuery({
    queryKey: ["snapshot-points"],
    queryFn: listAllSnapshotPoints,
  });

  const rows = assetsQuery.data ?? [];
  const summary = useMemo(
    () =>
      summariseAssets(
        rows.map((row) => ({
          currency: row.currency,
          latest_amount_minor: row.latest_amount_minor,
          latest_date: row.latest_date,
        })),
      ),
    [rows],
  );
  const series = useMemo(
    () => buildPortfolioSeries(pointsQuery.data ?? []),
    [pointsQuery.data],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["assets"] });
    void queryClient.invalidateQueries({ queryKey: ["snapshot-points"] });
    void queryClient.invalidateQueries({ queryKey: ["institutions"] });
    void queryClient.invalidateQueries({ queryKey: ["categories"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAsset(id),
    onSuccess: invalidate,
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      await resetData();
      await loadSampleData();
    },
    onSuccess: invalidate,
  });

  const loading =
    assetsQuery.isLoading ||
    institutionsQuery.isLoading ||
    categoriesQuery.isLoading;

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="h3 mb-1">Assets</h1>
          <p className="text-muted mb-0">
            {summary.totalAssets} tracked asset{summary.totalAssets === 1 ? "" : "s"}
            {series.mixedCurrencies
              ? " · totals sum raw amounts, no FX conversion yet"
              : ""}
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowForm(true)}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />
          New asset
        </Button>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-xl-3 col-md-6">
          <StatCard
            label="Total assets"
            value={summary.totalAssets}
            icon="bi-wallet2"
            accent="primary"
            subtitle={
              summary.dateRange.start && summary.dateRange.end
                ? `${formatDate(summary.dateRange.start)} – ${formatDate(summary.dateRange.end)}`
                : "No snapshots yet"
            }          />
        </div>
        {summary.byCurrency.map((bucket) => (
          <div className="col-xl-3 col-md-6" key={bucket.currency}>
            <StatCard
              label={bucket.currency}
              value={formatMinorAsCurrency(bucket.totalMinor, bucket.currency)}
              subtitle={`${bucket.assetCount} asset${bucket.assetCount === 1 ? "" : "s"}`}
            />
          </div>
        ))}
      </div>

      <Card className="mb-4">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h2 className="h5 mb-0">Portfolio value</h2>
            <span className="text-muted small">
              {series.points.length} data point{series.points.length === 1 ? "" : "s"}
            </span>
          </div>
          <PortfolioLineChart
            series={series}
            currency={summary.byCurrency[0]?.currency ?? "EUR"}
          />
        </Card.Body>
      </Card>

      <Card>
        <Card.Body className="p-0">
          {loading ? (
            <p className="text-muted p-4 mb-0">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="p-5 text-center">
              <p className="text-muted">No assets yet.</p>
              <div className="d-flex gap-2 justify-content-center">
                <Button variant="primary" onClick={() => setShowForm(true)}>
                  Create the first asset
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={() => seedMutation.mutate()}
                  disabled={seedMutation.isPending}
                >
                  {seedMutation.isPending ? "Loading…" : "Load sample data"}
                </Button>
              </div>
              {seedMutation.isError ? (
                <p className="text-danger mt-3 mb-0 small">
                  {String(seedMutation.error)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="table-responsive">
              <Table hover className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Institution</th>
                    <th>Category</th>
                    <th className="num text-end">Latest value</th>
                    <th>Updated</th>
                    <th>Status</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const status = freshness(row.latest_date);
                    const meta = STATUS_META[status];
                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="fw-semibold">{displayName(row)}</div>
                          <div className="text-muted small">{row.currency}</div>
                        </td>
                        <td>{row.institution_name}</td>
                        <td>
                          {row.category_color ? (
                            <span
                              className="d-inline-block rounded-circle me-2"
                              style={{
                                width: 10,
                                height: 10,
                                backgroundColor: row.category_color,
                              }}
                              aria-hidden="true"
                            />
                          ) : null}
                          {row.category_name}
                        </td>
                        <td className="num text-end">
                          {formatMinorAsCurrency(
                            row.latest_amount_minor,
                            row.currency,
                          )}
                        </td>
                        <td>
                          {formatDate(row.latest_date)}
                          <div className="text-muted small">
                            {relativeDate(row.latest_date)}
                          </div>
                        </td>
                        <td>
                          <Badge bg={meta.variant}>{meta.label}</Badge>
                        </td>
                        <td className="text-end">
                          <Button
                            variant="outline-danger"
                            size="sm"
                            title="Delete asset"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete "${displayName(row)}" and all of its snapshots?`,
                                )
                              ) {
                                deleteMutation.mutate(row.id);
                              }
                            }}
                          >
                            <i className="bi bi-trash" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>

      {assetsQuery.isError ? (
        <p className="text-danger mt-3 small">{String(assetsQuery.error)}</p>
      ) : null}

      <AssetFormModal
        show={showForm}
        institutions={institutionsQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        onHide={() => setShowForm(false)}
        onCreated={invalidate}
      />
    </>
  );
}
