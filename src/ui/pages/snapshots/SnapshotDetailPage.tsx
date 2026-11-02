/** Snapshot detail: port of `snapshots/detail.html` and the `detail` route. */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fromMinorUnits } from "../../../domain/money";
import { listAssets } from "../../../db/repositories/assets";
import { deleteSnapshot, getSnapshotRow, listRelatedSnapshots } from "../../../db/repositories/snapshots";
import { daysSince, formatDate, formatSymbolAmount } from "../../../domain/format";
import { messages, snapshotAssetName } from "../../../domain/snapshots";
import { PageHeader } from "../../components/FormCard";
import { TagBadge } from "../../components/SearchFilter";
import { SnapshotDeleteModal } from "../../components/SnapshotDeleteModal";
import { useToast } from "../../layout/Toasts";

const SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", CHF: "CHF" };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const major = (minor: number) => fromMinorUnits(minor) ?? 0;
/** `%Y-%m-%d %H:%M` of a stored timestamp. */
const stamp = (value: string | null) => (value ? value.slice(0, 16).replace("T", " ") : "Unknown");

export function SnapshotDetailPage() {
  const id = Number(useParams().snapshotId);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);

  const snapshot = useQuery({ queryKey: ["snapshot-row", id], queryFn: () => getSnapshotRow(id) });
  const related = useQuery({
    queryKey: ["snapshots", "related", snapshot.data?.asset_id, id],
    queryFn: () => listRelatedSnapshots(snapshot.data!.asset_id, id),
    enabled: !!snapshot.data,
  });
  const assets = useQuery({ queryKey: ["assets"], queryFn: listAssets });

  const remove = useMutation({
    mutationFn: () => deleteSnapshot(id),
    onSuccess: () => {
      const row = snapshot.data!;
      for (const key of ["snapshot-rows", "snapshot-row", "snapshots", "snapshot-points", "assets", "asset-row"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(messages.deleted(snapshotAssetName(row), row.date, row.currency, row.amount_minor));
      navigate("/snapshots");
    },
    onError: (error: unknown) => {
      setConfirm(false);
      toast.error(`Error deleting snapshot: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  if (snapshot.isLoading) return <p className="text-muted">Loading…</p>;
  const row = snapshot.data;
  if (!row) {
    return (
      <div className="alert alert-warning">
        Snapshot not found. <Link to="/snapshots">Back to snapshots</Link>
      </div>
    );
  }

  const name = snapshotAssetName(row);
  const symbol = SYMBOLS[row.currency] ?? row.currency;
  const amount = formatSymbolAmount(symbol, major(row.amount_minor));
  const weekday = WEEKDAYS[new Date(`${row.date}T00:00:00Z`).getUTCDay()];
  const asset = (assets.data ?? []).find((a) => a.id === row.asset_id);
  const others = related.data ?? [];

  return (
    <>
      <nav aria-label="breadcrumb" className="mb-4">
        <ol className="breadcrumb">
          <li className="breadcrumb-item"><Link to="/">Dashboard</Link></li>
          <li className="breadcrumb-item"><Link to="/snapshots">Snapshots</Link></li>
          <li className="breadcrumb-item active" aria-current="page">Snapshot Details</li>
        </ol>
      </nav>

      <PageHeader
        title={name}
        subtitle={`Snapshot from ${formatDate(row.date, "%B %d, %Y")}`}
        showDate={false}
        actions={
          <div className="text-md-end">
            <div className="amount-display">{amount}</div>
            <small className="opacity-75">Current Value</small>
          </div>
        }
      />

      <div className="row">
        <div className="col-lg-8">
          <div className="info-card">
            <h5 className="mb-3"><i className="bi bi-info-circle me-2" aria-hidden="true" />Snapshot Information</h5>
            <div className="row">
              <Field label="Asset" value={name} />
              <Field label="Date" value={`${weekday}, ${formatDate(row.date, "%B %d, %Y")}`} />
              <Field label="Amount" value={amount} />
              <Field label="Currency" value={row.currency} />
              <Field label="Created" value={stamp(row.created_at)} />
              {row.updated_at && row.updated_at !== row.created_at ? (
                <Field label="Last Updated" value={stamp(row.updated_at)} />
              ) : null}
            </div>
          </div>

          <div className="info-card">
            <h5 className="mb-3"><i className="bi bi-wallet2 me-2" aria-hidden="true" />Asset Details</h5>
            <div className="row">
              <Field label="Institution" value={row.institution_name} />
              <Field label="Product" value={row.product_name} />
              <Field label="Category" value={row.category_name} />
              {asset && asset.tags.length > 0 ? (
                <div className="col-sm-6 mb-3">
                  <label className="form-label text-muted small">Tags</label>
                  <div>
                    {asset.tags.map((tag) => (
                      <TagBadge key={tag.id} name={tag.name} color={tag.color} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-3">
              <Link to={`/assets/${row.asset_id}`} className="btn btn-secondary btn-sm">
                <i className="bi bi-box-arrow-up-right" aria-hidden="true" />
                View Asset Details
              </Link>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="info-card">
            <h6 className="mb-3"><i className="bi bi-tools me-2" aria-hidden="true" />Actions</h6>
            <div className="d-grid gap-2">
              <Link to={`/snapshots/${row.id}/edit`} className="btn btn-primary">
                <i className="bi bi-pencil" aria-hidden="true" />Edit Snapshot
              </Link>
              <Link to={`/snapshots/new?asset_id=${row.asset_id}`} className="btn btn-secondary">
                <i className="bi bi-plus-lg" aria-hidden="true" />Add Another
              </Link>
              <div className="divider my-1" />
              <button type="button" className="btn btn-outline-danger" onClick={() => setConfirm(true)}>
                <i className="bi bi-trash" aria-hidden="true" />Delete Snapshot
              </button>
            </div>
          </div>

          {others.length > 0 ? (
            <div className="info-card">
              <h6 className="mb-3"><i className="bi bi-clock-history me-2" aria-hidden="true" />Other Snapshots for this Asset</h6>
              <div className="timeline">
                {others.map((item) => (
                  <div className="timeline-item" key={item.id}>
                    <div className="d-flex justify-content-between align-items-start">
                      <div>
                        <div className="fw-bold">{item.date}</div>
                        <div className="text-muted small">{formatSymbolAmount(symbol, major(item.amount_minor))}</div>
                      </div>
                      <Link to={`/snapshots/${item.id}`} className="btn btn-icon btn-icon-accent" title="View snapshot" aria-label="View snapshot">
                        <i className="bi bi-arrow-right" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <Link to={`/snapshots?search=${encodeURIComponent(row.product_name)}`} className="btn btn-outline-secondary btn-sm">
                  <i className="bi bi-list-ul me-2" aria-hidden="true" />View All Snapshots
                </Link>
              </div>
            </div>
          ) : null}

          <div className="info-card">
            <h6 className="mb-3"><i className="bi bi-graph-up me-2" aria-hidden="true" />Quick Stats</h6>
            <div className="mb-2">
              <small className="text-muted">Days since creation:</small>
              <div className="fw-bold">{daysSince(row.date)} days</div>
            </div>
            {others.length > 0 ? (
              <div className="mb-2">
                <small className="text-muted">Total snapshots for this asset:</small>
                <div className="fw-bold">{others.length + 1}</div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <SnapshotDeleteModal
        target={confirm ? { assetName: name, date: row.date, amount } : null}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await remove.mutateAsync();
        }}
      />
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-sm-6 mb-3">
      <label className="form-label text-muted small">{label}</label>
      <div className="fw-bold">{value}</div>
    </div>
  );
}
