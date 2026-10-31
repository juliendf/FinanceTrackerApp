/** Bulk snapshot edit: port of `snapshots/bulk_edit.html` and `bulk_edit_snapshots`. */

import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { listSnapshotRows, updateSnapshotAmountsBulk } from "../../../db/repositories/snapshots";
import { formatMinorAsCurrency } from "../../../domain/format";
import { messages, snapshotAssetName, validateBulkEdit, type BulkError } from "../../../domain/snapshots";
import { PageHeader } from "../../components/FormCard";
import { useToast } from "../../layout/Toasts";

export function BulkEditPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const ids = useMemo(
    () => params.getAll("ids").map(Number).filter((n) => Number.isInteger(n) && n > 0),
    [params],
  );
  const rowsQuery = useQuery({ queryKey: ["snapshot-rows"], queryFn: listSnapshotRows });
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<BulkError[]>([]);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const wanted = new Set(ids);
    return (rowsQuery.data ?? []).filter((r) => wanted.has(r.id));
  }, [rowsQuery.data, ids]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validateBulkEdit(
      rows.map((r) => ({ snapshotId: r.id, label: snapshotAssetName(r), amount: amounts[r.id] ?? "" })),
    );
    setErrors(result.errors);
    if (result.errors.length > 0) return;
    if (result.updates.length === 0) {
      setErrors([{ assetId: null, message: "No changes entered." }]);
      return;
    }
    setBusy(true);
    try {
      const count = await updateSnapshotAmountsBulk(result.updates);
      for (const key of ["snapshot-rows", "snapshot-row", "snapshots", "snapshot-points", "assets", "asset-row"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(messages.bulkUpdated(count));
      navigate("/snapshots");
    } catch (error) {
      toast.error(`Error updating snapshots: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  if (rowsQuery.isLoading) return <p className="text-muted">Loading…</p>;
  if (rows.length === 0) {
    return (
      <div className="alert alert-warning">
        No snapshots selected. <Link to="/snapshots">Back to snapshots</Link>
      </div>
    );
  }

  return (
    <>
      <nav aria-label="breadcrumb" className="mb-4">
        <ol className="breadcrumb">
          <li className="breadcrumb-item"><Link to="/">Dashboard</Link></li>
          <li className="breadcrumb-item"><Link to="/snapshots">Snapshots</Link></li>
          <li className="breadcrumb-item active" aria-current="page">Bulk Edit</li>
        </ol>
      </nav>
      <PageHeader
        title="Bulk Edit Snapshots"
        subtitle={`Edit ${rows.length} snapshot${rows.length === 1 ? "" : "s"} at once`}
        icon="list-check"
        showDate={false}
        actions={
          <Link to="/snapshots" className="btn btn-secondary btn-sm">
            <i className="bi bi-arrow-left" aria-hidden="true" />Back to Snapshots
          </Link>
        }
      />

      <form onSubmit={(e) => void submit(e)} noValidate>
        {errors.length > 0 ? (
          <div className="alert alert-danger alert-permanent" role="alert">
            <ul className="mb-0">{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
          </div>
        ) : null}
        <div className="table-container">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr><th>Date</th><th>Asset</th><th>Institution</th><th className="num">Current Amount</th><th style={{ width: 160 }}>New Amount</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{snapshotAssetName(r)}</td>
                    <td>{r.institution_name}</td>
                    <td className="num">{formatMinorAsCurrency(r.amount_minor, r.currency)}</td>
                    <td>
                      <input type="number" step="0.01" className="form-control form-control-sm"
                        aria-label={`New amount for ${snapshotAssetName(r)} ${r.date}`}
                        placeholder={new Decimal(r.amount_minor).dividedBy(100).toFixed(2)}
                        value={amounts[r.id] ?? ""}
                        onChange={(e) => setAmounts({ ...amounts, [r.id]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2 mt-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <i className="bi bi-check-lg" aria-hidden="true" />Update Snapshots
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => { setAmounts({}); setErrors([]); }}>
            Clear Changes
          </button>
          <Link to="/snapshots" className="btn btn-outline-secondary">Cancel</Link>
        </div>
      </form>
    </>
  );
}
