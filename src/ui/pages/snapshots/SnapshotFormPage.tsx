/**
 * New / edit snapshot: port of `snapshots/new.html`, `edit.html` and the
 * `new_snapshot` / `create_snapshot` / `edit_snapshot` / `update_snapshot`
 * routes.
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { listAssets } from "../../../db/repositories/assets";
import {
  createSnapshot,
  deleteSnapshot,
  getSnapshotRow,
  latestSnapshotForAsset,
  snapshotExists,
  updateSnapshot,
} from "../../../db/repositories/snapshots";
import { displayName } from "../../../domain/assets";
import { todayIso } from "../../../domain/dates";
import { formatDate, formatSymbolAmount } from "../../../domain/format";
import {
  amountToMinor,
  messages,
  snapshotAssetName,
  snapshotFormSchema,
} from "../../../domain/snapshots";
import { PageHeader } from "../../components/FormCard";
import { SnapshotDeleteModal } from "../../components/SnapshotDeleteModal";
import { useToast } from "../../layout/Toasts";

const SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", CHF: "CHF" };
const symbolOf = (code: string) => SYMBOLS[code] ?? code;
const major = (minor: number) => new Decimal(minor).dividedBy(100);

type Errors = Partial<Record<"asset_id" | "date" | "amount", string>>;
type Mode = "list" | "another" | "asset";

export function SnapshotFormPage() {
  const { snapshotId } = useParams();
  const editingId = snapshotId ? Number(snapshotId) : null;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: listAssets });
  const existing = useQuery({
    queryKey: ["snapshot-row", editingId],
    queryFn: () => getSnapshotRow(editingId as number),
    enabled: editingId !== null,
  });

  const [assetId, setAssetId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed once reference data (and, when editing, the snapshot) has loaded, so the
  // select has its options before it is given a value.
  useEffect(() => {
    if (seeded || !assetsQuery.data) return;
    if (editingId !== null) {
      if (!existing.data) return;
      setAssetId(String(existing.data.asset_id));
      setDate(existing.data.date);
      setAmount(major(existing.data.amount_minor).toFixed(2));
    } else {
      const wanted = search.get("asset_id");
      if (wanted && assetsQuery.data.some((a) => String(a.id) === wanted)) setAssetId(wanted);
    }
    setSeeded(true);
  }, [seeded, assetsQuery.data, existing.data, editingId, search]);

  const assets = useMemo(
    () =>
      [...(assetsQuery.data ?? [])].sort(
        (a, b) =>
          a.institution_id - b.institution_id ||
          a.product_name.localeCompare(b.product_name) ||
          a.category_id - b.category_id,
      ),
    [assetsQuery.data],
  );
  const asset = assets.find((a) => String(a.id) === assetId) ?? null;
  const currency = asset?.currency ?? "";

  const previous = useQuery({
    queryKey: ["latest-snapshot", asset?.id],
    queryFn: () => latestSnapshotForAsset(asset!.id),
    enabled: editingId === null && asset !== null,
  });

  const refresh = () => {
    for (const key of ["snapshot-rows", "snapshot-row", "snapshots", "snapshot-points", "assets", "asset-row", "latest-snapshot"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const save = async (event: FormEvent, mode: Mode = "list") => {
    event.preventDefault();
    const parsed = snapshotFormSchema.safeParse({ asset_id: assetId, date, amount });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    const targetAsset = editingId !== null && existing.data ? existing.data.asset_id : Number(assetId);
    setBusy(true);
    try {
      if (await snapshotExists(targetAsset, date, editingId ?? undefined)) {
        setErrors({ date: messages.duplicate(date) });
        return;
      }
      const minor = amountToMinor(amount);
      if (editingId !== null && existing.data) {
        const before = existing.data;
        await updateSnapshot(editingId, date, minor);
        refresh();
        toast.success(
          messages.updated(
            snapshotAssetName(before),
            before.currency,
            { date: before.date, amountMinor: before.amount_minor },
            { date, amountMinor: minor },
          ),
        );
        navigate(`/snapshots/${editingId}`);
        return;
      }
      await createSnapshot(targetAsset, date, minor);
      refresh();
      toast.success(
        messages.created(asset ? displayName(asset) : "Unknown Asset", date, currency, minor),
      );
      if (mode === "another") {
        setAmount("");
        setDate(todayIso());
      } else if (mode === "asset") navigate(`/assets/${targetAsset}`);
      else navigate("/snapshots");
    } catch (error) {
      toast.error(`Error saving snapshot: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!assetsQuery.data || (editingId !== null && existing.isLoading)) {
    return <div className="text-muted p-4">Loading…</div>;
  }
  if (editingId !== null && !existing.data) {
    return (
      <div className="alert alert-warning">
        Snapshot not found. <Link to="/snapshots">Back to snapshots</Link>
      </div>
    );
  }

  const row = existing.data ?? null;
  const editing = editingId !== null && row !== null;
  const changed = editing && (date !== row.date || amount.trim() !== major(row.amount_minor).toFixed(2));
  const delta = (() => {
    if (!editing || amount.trim() === "") return null;
    try {
      const diff = new Decimal(amount).minus(major(row.amount_minor));
      return diff.isZero() ? null : diff;
    } catch {
      return null;
    }
  })();

  return (
    <>
      <nav aria-label="breadcrumb" className="mb-4">
        <ol className="breadcrumb">
          <li className="breadcrumb-item"><Link to="/">Dashboard</Link></li>
          <li className="breadcrumb-item"><Link to="/snapshots">Snapshots</Link></li>
          <li className="breadcrumb-item active" aria-current="page">{editing ? "Edit" : "Create New"}</li>
        </ol>
      </nav>
      <PageHeader
        title={editing ? "Edit Snapshot" : "Create New Snapshot"}
        subtitle={editing ? `${snapshotAssetName(row)} on ${formatDate(row.date)}` : "Record the current value of an asset at a specific date"}
        icon="camera"
        showDate={false}
        actions={
          editing ? (
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
              <i className="bi bi-trash" aria-hidden="true" />
              Delete
            </button>
          ) : undefined
        }
      />

      <form onSubmit={(e) => void save(e)} noValidate id="snapshotForm">
        <div className="row">
          <div className="col-lg-8">
            <div className="form-section">
              <div className="mb-3">
                <label htmlFor="asset_id" className="form-label">Asset</label>
                <select
                  id="asset_id"
                  className={`form-select${errors.asset_id ? " is-invalid" : ""}`}
                  value={assetId}
                  disabled={editing}
                  onChange={(e) => setAssetId(e.target.value)}
                >
                  <option value="">Select an asset…</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {`${displayName(a)} - ${a.institution_name} - ${a.product_name} (${a.category_name}) [${a.currency}]`}
                    </option>
                  ))}
                </select>
                {errors.asset_id ? <div className="invalid-feedback d-block">{errors.asset_id}</div> : null}
              </div>

              {!editing && previous.data ? (
                <div className="alert alert-info alert-permanent" id="previousSnapshot">
                  <i className="bi bi-info-circle me-2" aria-hidden="true" />
                  Previous snapshot: <strong>{formatSymbolAmount(symbolOf(currency), major(previous.data.amount_minor))}</strong>{" "}
                  on {formatDate(previous.data.date)}
                </div>
              ) : null}

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="snapshotDate" className="form-label">Date</label>
                  <input
                    id="snapshotDate"
                    type="date"
                    className={`form-control${errors.date ? " is-invalid" : ""}`}
                    value={date}
                    max={todayIso()}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  {errors.date ? <div className="invalid-feedback d-block">{errors.date}</div> : null}
                </div>
                <div className="col-md-6 mb-3">
                  <label htmlFor="snapshotAmount" className="form-label">Amount</label>
                  <div className="input-group">
                    {currency ? <span className="input-group-text">{symbolOf(currency)}</span> : null}
                    <input
                      id="snapshotAmount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      className={`form-control${errors.amount ? " is-invalid" : ""}`}
                      value={amount}
                      placeholder="0.00"
                      onChange={(e) => setAmount(e.target.value)}
                      onBlur={() => {
                        if (amount.trim() !== "" && Number.isFinite(Number(amount))) {
                          setAmount(new Decimal(amount).toFixed(2));
                        }
                      }}
                    />
                  </div>
                  {errors.amount ? <div className="invalid-feedback d-block">{errors.amount}</div> : null}
                </div>
              </div>

              {editing && changed ? (
                <div className="alert alert-warning alert-permanent" id="changePreview">
                  <strong>Pending changes</strong>
                  <ul className="mb-0">
                    {date !== row.date ? <li>Date: {row.date} → {date}</li> : null}
                    {delta ? (
                      <li>
                        Amount: {formatSymbolAmount(symbolOf(row.currency), major(row.amount_minor))} →{" "}
                        {formatSymbolAmount(symbolOf(row.currency), new Decimal(amount))} ({delta.isPositive() ? "+" : ""}
                        {delta.toFixed(2)})
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          <div className="col-lg-4">
            <div className="form-section sticky-top" style={{ top: "1rem" }}>
              <div className="d-grid gap-2">
                {editing ? (
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    <i className="bi bi-check-lg me-2" aria-hidden="true" />
                    Save Changes
                  </button>
                ) : (
                  <>
                    <button type="submit" className="btn btn-primary" disabled={busy}>
                      <i className="bi bi-check-lg me-2" aria-hidden="true" />
                      Create Snapshot
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={(e) => void save(e, "another")}>
                      Save &amp; Create Another
                    </button>
                    {asset ? (
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={(e) => void save(e, "asset")}>
                        Save &amp; Back to Asset
                      </button>
                    ) : null}
                  </>
                )}
                <Link to={editing ? `/snapshots/${editingId}` : "/snapshots"} className="btn btn-outline-secondary">
                  Cancel
                </Link>
              </div>
            </div>
          </div>
        </div>
      </form>

      <SnapshotDeleteModal
        target={
          confirmDelete && row
            ? {
                assetName: snapshotAssetName(row),
                date: row.date,
                amount: formatSymbolAmount(symbolOf(row.currency), major(row.amount_minor)),
              }
            : null
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!row) return;
          await deleteSnapshot(row.id);
          refresh();
          setConfirmDelete(false);
          toast.success(messages.deleted(snapshotAssetName(row), row.date, row.currency, row.amount_minor));
          navigate("/snapshots");
        }}
      />
    </>
  );
}
