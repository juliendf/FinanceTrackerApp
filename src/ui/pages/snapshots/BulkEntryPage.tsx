/**
 * Bulk snapshot entry.
 *
 * One date, one amount per asset; blank rows are skipped. The batch is written
 * in one transaction, so one bad row writes nothing.
 */

import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAssets } from "../../../db/repositories/assets";
import { listCategories } from "../../../db/repositories/categories";
import { listInstitutions } from "../../../db/repositories/institutions";
import {
  assetIdsWithSnapshotOn,
  createSnapshotsBulk,
  listAllSnapshotPoints,
} from "../../../db/repositories/snapshots";
import { displayName, sortAssets } from "../../../domain/assets";
import { todayIso } from "../../../domain/dates";
import { formatMinorAsCurrency } from "../../../domain/format";
import { fromMinorUnits } from "../../../domain/money";
import { latestBefore, messages, validateBulkEntry, type BulkError } from "../../../domain/snapshots";
import { PageHeader } from "../../components/FormCard";
import { useToast } from "../../layout/Toasts";

export function BulkEntryPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const categoryFilter = params.get("category_filter") ?? "";
  const institutionFilter = params.get("institution_filter") ?? "";
  const currencyFilter = params.get("currency_filter") ?? "";

  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: listAssets });
  const categories = useQuery({ queryKey: ["categories"], queryFn: listCategories });
  const institutions = useQuery({ queryKey: ["institutions"], queryFn: listInstitutions });
  const points = useQuery({ queryKey: ["snapshot-points"], queryFn: listAllSnapshotPoints });

  const [date, setDate] = useState(todayIso());
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [applyValue, setApplyValue] = useState("");
  const [errors, setErrors] = useState<BulkError[]>([]);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const rows = (assetsQuery.data ?? []).filter(
      (a) =>
        (!categoryFilter || String(a.category_id) === categoryFilter) &&
        (!institutionFilter || String(a.institution_id) === institutionFilter) &&
        (!currencyFilter || a.currency === currencyFilter),
    );
    return sortAssets(rows);
  }, [assetsQuery.data, categoryFilter, institutionFilter, currencyFilter]);

  const currencies = useMemo(
    () => [...new Set((assetsQuery.data ?? []).map((a) => a.currency))].sort(),
    [assetsQuery.data],
  );

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const filled = visible.filter((a) => (amounts[a.id] ?? "").trim() !== "").length;
  const errorFor = (id: number) => errors.find((e) => e.assetId === id)?.message;
  const formErrors = errors.filter((e) => e.assetId === null);

  const applySame = () => {
    const next = { ...amounts };
    for (const a of visible) next[a.id] = applyValue;
    setAmounts(next);
  };

  const copyPrevious = () => {
    const previous = latestBefore(points.data ?? [], visible.map((a) => a.id), date);
    const next = { ...amounts };
    for (const a of visible) {
      const found = previous.get(a.id);
      if (found) next[a.id] = (fromMinorUnits(found.amount_minor) ?? 0).toFixed(2);
    }
    setAmounts(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const existing = await assetIdsWithSnapshotOn(date);
      const result = validateBulkEntry({
        date,
        entries: visible.map((a) => ({ assetId: a.id, label: displayName(a), amount: amounts[a.id] ?? "" })),
        existingAssetIds: existing,
      });
      setErrors(result.errors);
      if (result.errors.length > 0) return;
      const count = await createSnapshotsBulk(date, result.rows);
      for (const key of ["snapshot-rows", "snapshots", "snapshot-points", "assets", "asset-row", "latest-snapshot"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(messages.bulkCreated(count));
      navigate("/snapshots");
    } catch (error) {
      toast.error(`Error creating snapshots: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const last = useMemo(() => {
    const map = new Map<number, { date: string; amount_minor: number }>();
    for (const p of points.data ?? []) {
      const cur = map.get(p.asset_id);
      if (!cur || p.date > cur.date) map.set(p.asset_id, p);
    }
    return map;
  }, [points.data]);

  return (
    <>
      <PageHeader
        title="Bulk Snapshot Entry"
        subtitle="Record a value for many assets at one date"
        icon="list-ul"
        showDate={false}
        actions={
          <Link to="/snapshots" className="btn btn-secondary btn-sm">
            <i className="bi bi-arrow-left" aria-hidden="true" />
            Back to Snapshots
          </Link>
        }
      />

      <form onSubmit={(e) => void submit(e)} noValidate id="bulkSnapshotForm">
        <div className="filter-section">
          <div className="row g-3">
            <div className="col-md-3">
              <label htmlFor="snapshotDate" className="form-label">Date</label>
              <input id="snapshotDate" type="date" className="form-control" value={date} max={todayIso()}
                onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="col-md-9">
              <label className="form-label">Filter Assets</label>
              <div className="row g-2">
                <div className="col-md-4">
                  <select id="categoryFilter" className="form-select" aria-label="Category" value={categoryFilter}
                    onChange={(e) => setFilter("category_filter", e.target.value)}>
                    <option value="">All Categories</option>
                    {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <select id="institutionFilter" className="form-select" aria-label="Institution" value={institutionFilter}
                    onChange={(e) => setFilter("institution_filter", e.target.value)}>
                    <option value="">All Institutions</option>
                    {(institutions.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <select id="currencyFilter" className="form-select" aria-label="Currency" value={currencyFilter}
                    onChange={(e) => setFilter("currency_filter", e.target.value)}>
                    <option value="">All Currencies</option>
                    {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2 align-items-center mt-3">
            <input type="number" step="0.01" className="form-control form-control-sm" style={{ maxWidth: 140 }}
              aria-label="Amount to apply" placeholder="0.00" value={applyValue}
              onChange={(e) => setApplyValue(e.target.value)} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={applySame} disabled={applyValue.trim() === ""}>
              Apply same amount
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copyPrevious}>
              Copy previous
            </button>
            <span className="text-muted small ms-auto">{filled} of {visible.length} assets filled</span>
          </div>
        </div>

        {formErrors.length > 0 || errors.length > 0 ? (
          <div className="alert alert-danger alert-permanent" role="alert">
            <ul className="mb-0">
              {errors.map((e, i) => <li key={i}>{e.message}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="table-container">
          <div className="table-responsive asset-table">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Institution</th><th>Product</th><th>Category</th><th>Currency</th>
                  <th style={{ width: 140 }}>Amount</th><th style={{ width: 120 }}>Last Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state">
                        <i className="bi bi-wallet2 empty-state-icon" aria-hidden="true" />
                        <p className="empty-state-title mb-0">No assets found</p>
                        <p className="mb-2">Create an asset before recording snapshots for it.</p>
                        <Link to="/assets/new" className="btn btn-primary btn-sm">
                          <i className="bi bi-plus-lg" aria-hidden="true" />Create your first asset
                        </Link>
                      </div>
                    </td>
                  </tr>
                ) : (
                  visible.map((a) => {
                    const prev = last.get(a.id);
                    const rowError = errorFor(a.id);
                    return (
                      <tr key={a.id} className="asset-row">
                        <td>{a.institution_name}</td>
                        <td>{a.product_name}</td>
                        <td><span className="chip">{a.category_name}</span></td>
                        <td><span className="currency-code">{a.currency}</span></td>
                        <td>
                          <input type="number" step="0.01" placeholder="0.00"
                            aria-label={`Amount for ${displayName(a)}`}
                            className={`form-control form-control-sm amount-input${rowError ? " is-invalid" : ""}`}
                            value={amounts[a.id] ?? ""}
                            onChange={(e) => setAmounts({ ...amounts, [a.id]: e.target.value })} />
                          {rowError ? <div className="invalid-feedback d-block">{rowError}</div> : null}
                        </td>
                        <td>
                          {prev ? (
                            <>
                              <span className="money">{formatMinorAsCurrency(prev.amount_minor, a.currency)}</span>
                              <span className="cell-sub">{prev.date}</span>
                            </>
                          ) : (
                            <span className="text-muted">No snapshots</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2 mt-3">
          <button type="submit" className="btn btn-primary" id="submitBtn" disabled={busy || filled === 0}>
            <i className="bi bi-plus-lg" aria-hidden="true" />
            Create Snapshots
          </button>
          <Link to="/snapshots" className="btn btn-secondary">Cancel</Link>
        </div>
      </form>
    </>
  );
}
