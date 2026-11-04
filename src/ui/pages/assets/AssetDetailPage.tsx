/**
 * Asset detail.
 *
 * Three display details the page depends on:
 *   * Cost/Charges is a percentage, formatted as such, not as currency;
 *   * Interest Rate is a stored percentage value, so it must not be scaled by
 *     100 — a stored 1.25 shows as "1.25%";
 *   * the snapshot "% Change" column passes a fraction to the percentage
 *     filter, which multiplies by 100 once, so +5 % shows as "+5.0%".
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteAsset, getAssetRow } from "../../../db/repositories/assets";
import { deleteSnapshot, listSnapshotsForAsset } from "../../../db/repositories/snapshots";
import { buildHistory, displayName, formattedCurrency } from "../../../domain/assets";
import {
  formatDate,
  formatMinorAsCurrency,
  formatPercentage,
  formatPercentValue,
  relativeDate,
} from "../../../domain/format";
import { formatSymbolAmount } from "../../../domain/format";
import { fromMinorUnits } from "../../../domain/money";
import { messages } from "../../../domain/snapshots";
import { SnapshotDeleteModal } from "../../components/SnapshotDeleteModal";
import { AssetDeleteModal } from "../../components/AssetDeleteModal";
import { PageHeader } from "../../components/FormCard";
import { TagBadge } from "../../components/SearchFilter";
import { AssetEvolutionChart } from "../../charts/AssetEvolutionChart";
import { useToast } from "../../layout/Toasts";

export function AssetDetailPage() {
  const { assetId } = useParams();
  const id = Number(assetId);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [snapshotToDelete, setSnapshotToDelete] = useState<{ id: number; date: string; amount_minor: number } | null>(null);

  const assetQuery = useQuery({ queryKey: ["asset-row", id], queryFn: () => getAssetRow(id) });
  const snapshotsQuery = useQuery({ queryKey: ["snapshots", id], queryFn: () => listSnapshotsForAsset(id) });

  const remove = useMutation({
    mutationFn: () => deleteAsset(id),
    onSuccess: () => {
      for (const key of ["assets", "snapshot-points", "snapshots", "asset-row"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(`Asset "${name}" deleted successfully!`);
      navigate("/assets");
    },
    onError: (error: unknown) => {
      setConfirmDelete(false);
      toast.error(`Error deleting asset: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const removeSnapshot = useMutation({
    mutationFn: (snapshotId: number) => deleteSnapshot(snapshotId),
    onSuccess: () => {
      for (const key of ["assets", "snapshot-points", "snapshots", "asset-row", "snapshot-rows"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const asset = assetQuery.data;
  const name = asset ? displayName(asset) : "";

  if (assetQuery.isLoading || snapshotsQuery.isLoading) return <p className="text-muted">Loading…</p>;

  if (!asset) {
    return (
      <div className="alert alert-warning">
        <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
        The requested asset was not found. <Link to="/assets">Back to Assets</Link>
      </div>
    );
  }

  const history = buildHistory(snapshotsQuery.data ?? []);
  const latest = history[0] ?? null;
  const oldest = history.length >= 2 ? history[history.length - 1] : null;
  // Reference fields that are only occasionally useful, on one muted line.
  const footnote = [
    asset.code_nin ? `Code/NIN ${asset.code_nin}` : null,
    asset.cost_charges && Number(asset.cost_charges) !== 0
      ? `Cost/Charges ${formatPercentValue(asset.cost_charges)}`
      : null,
    asset.interest_rate && Number(asset.interest_rate) !== 0
      ? `Interest ${formatPercentValue(asset.interest_rate)}`
      : null,
    `Created ${formatDate(asset.created_at.slice(0, 10))}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        title={name}
        subtitle="Asset Details and History"
        showDate={false}
        actions={
          <>
            <Link to={`/snapshots/new?asset_id=${asset.id}`} className="btn btn-primary btn-sm">
              <i className="bi bi-camera" aria-hidden="true" />
              Add Snapshot
            </Link>
            <Link to={`/assets/${asset.id}/edit`} className="btn btn-secondary btn-sm">
              <i className="bi bi-pencil" aria-hidden="true" />
              Edit
            </Link>
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setConfirmDelete(true)}>
              <i className="bi bi-trash" aria-hidden="true" />
              Delete
            </button>
          </>
        }
      />

      {/* One summary strip instead of three cards of wildly different heights:
          the value, when it was last recorded and how much history backs it. */}
      <div className="card asset-summary mb-4">
        <div className="card-body">
          <div className="asset-summary-main">
            <div>
              <div className="asset-info-label">Current Value</div>
              {latest ? (
                <>
                  <div className="amount-display">
                    {formatMinorAsCurrency(latest.amount_minor, asset.currency)}
                  </div>
                  <div className="text-muted small">
                    Last updated {relativeDate(latest.date)} · {formatDate(latest.date)}
                  </div>
                </>
              ) : (
                <>
                  <div className="amount-display text-muted">—</div>
                  <div className="text-muted small">No value recorded yet</div>
                </>
              )}
            </div>

            <div className="asset-summary-facts">
              <div>
                <div className="asset-summary-value">{history.length}</div>
                <div className="asset-info-label">Snapshots</div>
              </div>
              {oldest ? (
                <div>
                  <div className="asset-summary-value">
                    {formatMinorAsCurrency(oldest.amount_minor, asset.currency)}
                  </div>
                  <div className="asset-info-label">First recorded</div>
                </div>
              ) : null}
              {oldest ? (
                <div>
                  <div className="asset-summary-value">{formatDate(oldest.date)}</div>
                  <div className="asset-info-label">Since</div>
                </div>
              ) : null}
            </div>
          </div>

          {/* The few facts worth glancing at, inline. Everything else is
              reference data and lives on the footnote line or in Edit. */}
          <div className="asset-summary-strip">
            <span>
              <span className="asset-info-label">Institution </span>
              {asset.institution_name}
            </span>
            <span>
              <span className="asset-info-label">Category </span>
              <span className="badge bg-primary">{asset.category_name}</span>
            </span>
            <span>
              <span className="asset-info-label">Currency </span>
              {asset.currency} <span className="text-muted">({formattedCurrency(asset.currency)})</span>
            </span>
            {asset.product_name !== name ? (
              <span>
                <span className="asset-info-label">Product </span>
                {asset.product_name}
              </span>
            ) : null}
            {asset.tags.length > 0 ? (
              <span className="d-inline-flex align-items-center gap-1 flex-wrap">
                <span className="asset-info-label">Tags </span>
                {asset.tags.map((tag) => (
                  <TagBadge key={tag.id} name={tag.name} color={tag.color} />
                ))}
              </span>
            ) : null}
          </div>

          {asset.description ? (
            <p className="asset-summary-note mb-0">{asset.description}</p>
          ) : null}

          {asset.notes ? (
            <p className="asset-summary-note mb-0" style={{ whiteSpace: "pre-wrap" }}>
              {asset.notes}
            </p>
          ) : null}

          <div className="asset-summary-footnote">
            {footnote}
            {!asset.notes ? (
              <>
                {" · "}
                <Link to={`/assets/${asset.id}/edit`}>Add notes</Link>
              </>
            ) : (
              <>
                {" · "}
                <Link to={`/assets/${asset.id}/edit`}>Edit</Link>
              </>
            )}
          </div>

          {!latest ? (
            <Link to={`/snapshots/new?asset_id=${asset.id}`} className="btn btn-primary btn-sm mt-3">
              <i className="bi bi-plus-lg me-2" aria-hidden="true" />
              Add Snapshot
            </Link>
          ) : null}
        </div>
      </div>

      {history.length > 0 ? (
        <div className="card mb-4">
          <div className="card-header">
            <h5 className="card-title mb-0">
              <i className="bi bi-graph-up me-2" aria-hidden="true" />
              Value Evolution
            </h5>
          </div>
          <div className="card-body">
            <AssetEvolutionChart
              currency={asset.currency}
              points={history.map((row) => ({ date: row.date, amountMinor: row.amount_minor }))}
            />
          </div>
        </div>
      ) : null}

      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="card-title mb-0">
            <i className="bi bi-clock-history me-2" aria-hidden="true" />
            Snapshot History
          </h5>
          <Link to={`/snapshots/new?asset_id=${asset.id}`} className="btn btn-sm btn-primary">
            <i className="bi bi-plus-lg me-2" aria-hidden="true" />
            Add Snapshot
          </Link>
        </div>
        <div className="card-body">
          {history.length > 0 ? (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th className="text-end">Amount</th>
                    <th className="text-end">Change</th>
                    <th className="text-end">% Change</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr className="snapshot-row" key={row.id}>
                      <td>
                        <strong>{formatDate(row.date, "%B %d, %Y")}</strong>
                        <br />
                        <small className="text-muted">{relativeDate(row.date)}</small>
                      </td>
                      <td className="text-end">
                        <strong>{formatMinorAsCurrency(row.amount_minor, asset.currency)}</strong>
                      </td>
                      <td className="text-end">
                        {row.changeMinor === null || row.changeMinor === 0 ? (
                          <span className="text-muted">-</span>
                        ) : row.changeMinor > 0 ? (
                          <span className="text-success">+{formatMinorAsCurrency(row.changeMinor, asset.currency)}</span>
                        ) : (
                          <span className="text-danger">{formatMinorAsCurrency(row.changeMinor, asset.currency)}</span>
                        )}
                      </td>
                      <td className="text-end">
                        {row.changeFraction === null || row.changeFraction.isZero() ? (
                          <span className="text-muted">-</span>
                        ) : row.changeFraction.greaterThan(0) ? (
                          <span className="text-success">+{formatPercentage(row.changeFraction, 1)}</span>
                        ) : (
                          <span className="text-danger">{formatPercentage(row.changeFraction, 1)}</span>
                        )}
                      </td>
                      <td className="text-end">
                        <div className="btn-group btn-group-sm" role="group">
                          <Link to={`/snapshots/${row.id}/edit`} className="btn btn-outline-secondary">
                            <i className="bi bi-pencil-square me-1" aria-hidden="true" />
                            Edit
                          </Link>
                          <button
                            type="button"
                            className="btn btn-outline-danger"
                            aria-label={`Delete snapshot ${row.date}`}
                            onClick={() => setSnapshotToDelete({ id: row.id, date: row.date, amount_minor: row.amount_minor })}
                          >
                            <i className="bi bi-trash" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-4">
              <i className="bi bi-graph-up icon-3x text-muted mb-3" aria-hidden="true" />
              <h5>No snapshots recorded</h5>
              <p className="text-muted">Start tracking this asset's value by adding your first snapshot.</p>
              <Link to={`/snapshots/new?asset_id=${asset.id}`} className="btn btn-primary">
                <i className="bi bi-plus-lg me-2" aria-hidden="true" />
                Add First Snapshot
              </Link>
            </div>
          )}
        </div>
      </div>

      <SnapshotDeleteModal
        target={
          snapshotToDelete && asset
            ? {
                assetName: name,
                date: snapshotToDelete.date,
                amount: formatSymbolAmount(
                  ({ EUR: "€", USD: "$", CHF: "CHF" } as Record<string, string>)[asset.currency] ?? asset.currency,
                  fromMinorUnits(snapshotToDelete.amount_minor) ?? 0,
                ),
              }
            : null
        }
        onCancel={() => setSnapshotToDelete(null)}
        onConfirm={async () => {
          if (!snapshotToDelete || !asset) return;
          const target = snapshotToDelete;
          await removeSnapshot.mutateAsync(target.id);
          setSnapshotToDelete(null);
          toast.success(messages.deleted(name, target.date, asset.currency, target.amount_minor));
        }}
      />
      <AssetDeleteModal
        name={confirmDelete ? name : null}
        snapshotCount={history.length}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await remove.mutateAsync();
        }}
      />
    </>
  );
}
