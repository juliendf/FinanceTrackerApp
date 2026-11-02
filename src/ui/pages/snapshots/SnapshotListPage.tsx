/**
 * Snapshots list.
 *
 * Filters, sort and page live in the URL query.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Dropdown } from "react-bootstrap";
import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listInstitutions } from "../../../db/repositories/institutions";
import { deleteSnapshot, deleteSnapshots, listSnapshotRows } from "../../../db/repositories/snapshots";
import { todayIso } from "../../../domain/dates";
import { formatDate, formatMinorAsCurrency, formatSymbolAmount, relativeDate } from "../../../domain/format";
import { fromMinorUnits } from "../../../domain/money";
import { paginate } from "../../../domain/pagination";
import {
  csvFileName,
  filterSnapshots,
  pageNumbers,
  generateSnapshotsCsv,
  messages,
  nextSort,
  parseSnapshotFilters,
  snapshotAssetName,
  snapshotCurrencyOptions,
  snapshotFiltersToParams,
  sortSnapshots,
  summariseSnapshots,
  type SnapshotFilters,
  type SnapshotListRow,
  type SortBy,
} from "../../../domain/snapshots";
import { PageHeader } from "../../components/FormCard";
import { BulkDeleteModal, SnapshotDeleteModal } from "../../components/SnapshotDeleteModal";
import { StatCard } from "../../components/StatCard";
import { useToast } from "../../layout/Toasts";

const PAGE_SIZES = [10, 20, 50, 100];

function symbolOf(currency: string) {
  return ({ EUR: "€", USD: "$", CHF: "CHF" } as Record<string, string>)[currency] ?? currency;
}

const errText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SnapshotListPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { filters, warnings } = useMemo(() => parseSnapshotFilters(params), [params]);

  const warned = useRef("");
  useEffect(() => {
    const key = warnings.join("|");
    if (key && key !== warned.current) {
      for (const warning of warnings) toast.error(warning);
    }
    warned.current = key;
  }, [warnings, toast]);

  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<SnapshotListRow | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const rowsQuery = useQuery({ queryKey: ["snapshot-rows"], queryFn: listSnapshotRows });
  const institutions = useQuery({ queryKey: ["institutions"], queryFn: listInstitutions });

  const allRows = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const filtered = useMemo(() => filterSnapshots(allRows, filters), [allRows, filters]);
  const sorted = useMemo(() => sortSnapshots(filtered, filters), [filtered, filters]);
  const page = useMemo(() => paginate(sorted, filters.page, filters.per_page), [sorted, filters]);
  const summary = useMemo(() => summariseSnapshots(filtered), [filtered]);

  useEffect(() => setSelected(new Set()), [page.page, params]);

  const hasFilters = Boolean(
    filters.search || filters.start_date || filters.end_date || filters.institution_id !== null || filters.currency,
  );

  const commit = (next: SnapshotFilters, resetPage = true) =>
    setParams(snapshotFiltersToParams({ ...next, page: resetPage ? 1 : next.page }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    commit(draft);
  };

  const refresh = () => {
    for (const key of ["snapshot-rows", "snapshots", "snapshot-points", "assets", "asset-row"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const removeOne = useMutation({
    mutationFn: (row: SnapshotListRow) => deleteSnapshot(row.id),
    onSuccess: (_, row) => {
      refresh();
      setPendingDelete(null);
      toast.success(messages.deleted(snapshotAssetName(row), row.date, row.currency, row.amount_minor));
    },
    onError: (error: unknown) => {
      setPendingDelete(null);
      toast.error(`Error deleting snapshot: ${errText(error)}`);
    },
  });

  const removeMany = useMutation({
    mutationFn: (rows: SnapshotListRow[]) => deleteSnapshots(rows.map((row) => row.id)).then(() => rows),
    onSuccess: (rows) => {
      refresh();
      setSelected(new Set());
      setConfirmBulk(false);
      toast.success(
        rows.length === 1
          ? messages.deleted(snapshotAssetName(rows[0]), rows[0].date, rows[0].currency, rows[0].amount_minor)
          : messages.bulkDeleted(rows.length),
      );
    },
    onError: (error: unknown) => {
      setConfirmBulk(false);
      toast.error(`Error deleting snapshots: ${errText(error)}`);
    },
  });

  const exportCsv = async () => {
    const rows = sortSnapshots(filterSnapshots(allRows, filters), { sort_by: "date", sort_order: "desc" });
    try {
      const path = await invoke<string | null>("save_text_file", {
        defaultName: csvFileName(todayIso()),
        filterName: "CSV",
        extensions: ["csv"],
        contents: generateSnapshotsCsv(rows),
      });
      if (!path) return;
      toast.success(`Exported ${rows.length} snapshot${rows.length === 1 ? "" : "s"} to ${path}`);
    } catch (error) {
      toast.error(`Export failed: ${errText(error)}`);
    }
  };

  const selectedRows = page.items.filter((row) => selected.has(row.id));
  const allSelected = page.items.length > 0 && selectedRows.length === page.items.length;
  const first = page.perPage * (page.page - 1) + 1;
  const last = page.perPage * (page.page - 1) + page.items.length;

  const sortIndicator = (column: SortBy) =>
    filters.sort_by === column ? (
      <span className="sort-indicator">{filters.sort_order === "desc" ? "▼" : "▲"}</span>
    ) : null;

  const sortBy = (column: SortBy) => commit({ ...filters, ...nextSort(filters, column) });

  const auto = (patch: Partial<SnapshotFilters>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    commit(next);
  };

  return (
    <>
      <PageHeader
        title="Snapshots"
        subtitle="Browse, filter and export recorded snapshots"
        icon="camera"
        showDate={false}
        actions={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportCsv()}>
              <i className="bi bi-download" aria-hidden="true" />
              Export CSV
            </button>
            <Link to="/snapshots/bulk" className="btn btn-secondary btn-sm">
              <i className="bi bi-list-ul" aria-hidden="true" />
              Bulk Entry
            </Link>
            <Link to="/snapshots/new" className="btn btn-primary btn-sm">
              <i className="bi bi-plus-lg" aria-hidden="true" />
              Add Snapshot
            </Link>
          </>
        }
      />

      {summary.totalCount > 0 ? (
        <div className="row g-3 mb-4">
          <div className="col-xl-3 col-md-6">
            <StatCard
              label="Total Snapshots"
              accent="primary"
              value={summary.totalCount}
              subtitle={
                summary.dateRange.start && summary.dateRange.end
                  ? `${formatDate(summary.dateRange.start)} – ${formatDate(summary.dateRange.end)}`
                  : undefined
              }
            />
          </div>
        </div>
      ) : null}

      <div className="filter-section">
        <div className="panel-title">Filters</div>
        <form onSubmit={submit} id="filterForm">
          <div className="row g-3">
            <div className="col-md-3">
              <label htmlFor="start_date" className="form-label">Start Date</label>
              <input type="date" className="form-control" id="start_date" value={draft.start_date}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label htmlFor="end_date" className="form-label">End Date</label>
              <input type="date" className="form-control" id="end_date" value={draft.end_date}
                onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label htmlFor="institution_id" className="form-label">Institution</label>
              <select className="form-select" id="institution_id"
                value={draft.institution_id === null ? "" : String(draft.institution_id)}
                onChange={(e) => auto({ institution_id: e.target.value === "" ? null : Number(e.target.value) })}>
                <option value="">All Institutions</option>
                {(institutions.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label htmlFor="currency" className="form-label">Currency</label>
              <select className="form-select" id="currency" value={draft.currency}
                onChange={(e) => auto({ currency: e.target.value })}>
                <option value="">All Currencies</option>
                {snapshotCurrencyOptions(allRows).map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label htmlFor="min_amount" className="form-label">Min Amount</label>
              <input type="number" className="form-control" id="min_amount" step="0.01" placeholder="0.00"
                value={draft.min_amount} onChange={(e) => setDraft({ ...draft, min_amount: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label htmlFor="max_amount" className="form-label">Max Amount</label>
              <input type="number" className="form-control" id="max_amount" step="0.01" placeholder="999999.99"
                value={draft.max_amount} onChange={(e) => setDraft({ ...draft, max_amount: e.target.value })} />
            </div>
            <div className="col-md-4">
              <label htmlFor="search" className="form-label">Search</label>
              <input type="text" className="form-control" id="search" placeholder="Search asset names, institutions..."
                value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} />
            </div>
            <div className="col-md-2">
              <label htmlFor="per_page" className="form-label">Per Page</label>
              <select className="form-select" id="per_page" value={draft.per_page}
                onChange={(e) => auto({ per_page: Number(e.target.value) })}>
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2 mt-3">
            <button type="submit" className="btn btn-primary btn-sm">
              <i className="bi bi-funnel" aria-hidden="true" />
              Apply Filters
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams(new URLSearchParams())}>
              <i className="bi bi-x-lg" aria-hidden="true" />
              Clear All
            </button>
          </div>
        </form>
      </div>

      {selected.size > 0 ? (
        <div className="alert alert-primary alert-permanent d-flex align-items-center justify-content-between" id="bulkActionsBar">
          <span>
            <i className="bi bi-check2-square me-2" aria-hidden="true" />
            <strong>{selected.size}</strong> snapshot(s) selected
          </span>
          <span className="d-flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/snapshots/bulk-edit?${[...selected].map((id) => `ids=${id}`).join("&")}`)}>
              <i className="bi bi-pencil" aria-hidden="true" />
              Bulk Edit
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmBulk(true)}>
              <i className="bi bi-trash" aria-hidden="true" />
              Bulk Delete
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>
              <i className="bi bi-x-lg" aria-hidden="true" />
              Clear
            </button>
          </span>
        </div>
      ) : null}

      <div className="table-container">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    id="selectAll"
                    className="form-check-input"
                    aria-label="Select all snapshots on this page"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedRows.length > 0 && !allSelected;
                    }}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(page.items.map((row) => row.id)) : new Set())
                    }
                  />
                </th>
                <th className="sort-header" onClick={() => sortBy("date")}>Date {sortIndicator("date")}</th>
                <th className="sort-header" onClick={() => sortBy("asset")}>Asset {sortIndicator("asset")}</th>
                <th>Institution</th>
                <th>Category</th>
                <th className="sort-header num" onClick={() => sortBy("amount")}>Amount {sortIndicator("amount")}</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rowsQuery.isLoading ? (
                <tr><td colSpan={7} className="text-muted p-4">Loading…</td></tr>
              ) : page.items.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <i className="bi bi-camera empty-state-icon" aria-hidden="true" />
                      {hasFilters ? (
                        <>
                          <p className="empty-state-title mb-0">No snapshots match these filters</p>
                          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setParams(new URLSearchParams())}>
                            Clear filters
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="empty-state-title mb-0">No snapshots yet</p>
                          <p className="mb-2">Record the value of an asset to start building history.</p>
                          <Link to="/snapshots/new" className="btn btn-primary btn-sm">
                            <i className="bi bi-plus-lg" aria-hidden="true" />
                            Add your first snapshot
                          </Link>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                page.items.map((row) => {
                  const name = snapshotAssetName(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          className="form-check-input snapshot-checkbox"
                          aria-label={`Select snapshot ${row.date} ${name}`}
                          checked={selected.has(row.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(row.id);
                            else next.delete(row.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td>
                        <div>{formatDate(row.date)}</div>
                        <small className="text-muted">{relativeDate(row.date)}</small>
                      </td>
                      <td>
                        <Link to={`/snapshots/${row.id}`} className="cell-title text-decoration-none">{name}</Link>
                        {row.product_name && row.product_name !== name ? (
                          <span className="cell-sub">{row.product_name}</span>
                        ) : null}
                      </td>
                      <td>{row.institution_name}</td>
                      <td><span className="chip">{row.category_name}</span></td>
                      <td className="num">
                        {formatMinorAsCurrency(row.amount_minor, row.currency)}
                        <span className="currency-code ms-1">{row.currency}</span>
                      </td>
                      <td>
                        <div className="row-actions d-none d-md-inline-flex">
                          <Link to={`/snapshots/${row.id}`} className="btn btn-icon btn-icon-accent" title="View snapshot details" aria-label="View snapshot">
                            <i className="bi bi-eye" aria-hidden="true" />
                          </Link>
                          <Link to={`/snapshots/${row.id}/edit`} className="btn btn-icon" title="Edit snapshot" aria-label="Edit snapshot">
                            <i className="bi bi-pencil" aria-hidden="true" />
                          </Link>
                          <button type="button" className="btn btn-icon btn-icon-danger" title="Delete snapshot"
                            aria-label={`Delete snapshot ${row.date} ${name}`} onClick={() => setPendingDelete(row)}>
                            <i className="bi bi-trash" aria-hidden="true" />
                          </button>
                        </div>
                        <Dropdown className="d-md-none text-end" align="end">
                          <Dropdown.Toggle as="button" className="btn btn-icon" aria-label="Actions" bsPrefix="p-0 border-0 bg-transparent">
                            <i className="bi bi-three-dots-vertical" aria-hidden="true" />
                          </Dropdown.Toggle>
                          <Dropdown.Menu>
                            <Dropdown.Item as={Link} to={`/snapshots/${row.id}`}>
                              <i className="bi bi-eye me-2" aria-hidden="true" />View Details
                            </Dropdown.Item>
                            <Dropdown.Item as={Link} to={`/snapshots/${row.id}/edit`}>
                              <i className="bi bi-pencil-square me-2" aria-hidden="true" />Edit Snapshot
                            </Dropdown.Item>
                            <Dropdown.Divider />
                            <Dropdown.Item className="text-danger" onClick={() => setPendingDelete(row)}>
                              <i className="bi bi-trash me-2" aria-hidden="true" />Delete Snapshot
                            </Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {page.pages > 1 ? (
        <>
          <nav aria-label="Snapshot pagination" className="mt-4">
            <ul className="pagination justify-content-center">
              <li className={`page-item${page.hasPrev ? "" : " disabled"}`}>
                {page.hasPrev ? (
                  <button type="button" className="page-link" onClick={() => commit({ ...filters, page: page.page - 1 }, false)}>
                    <i className="bi bi-chevron-left" aria-hidden="true" /> Previous
                  </button>
                ) : (
                  <span className="page-link"><i className="bi bi-chevron-left" aria-hidden="true" /> Previous</span>
                )}
              </li>
              {pageNumbers(page.page, page.pages).map((number, index) =>
                number === null ? (
                  <li className="page-item disabled" key={`gap-${index}`}><span className="page-link">…</span></li>
                ) : number === page.page ? (
                  <li className="page-item active" key={number}><span className="page-link">{number}</span></li>
                ) : (
                  <li className="page-item" key={number}>
                    <button type="button" className="page-link" onClick={() => commit({ ...filters, page: number }, false)}>{number}</button>
                  </li>
                ),
              )}
              <li className={`page-item${page.hasNext ? "" : " disabled"}`}>
                {page.hasNext ? (
                  <button type="button" className="page-link" onClick={() => commit({ ...filters, page: page.page + 1 }, false)}>
                    Next <i className="bi bi-chevron-right" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="page-link">Next <i className="bi bi-chevron-right" aria-hidden="true" /></span>
                )}
              </li>
            </ul>
          </nav>
          <div className="text-center text-muted small mt-2">
            Showing {first}–{last} of {page.total} snapshots
          </div>
        </>
      ) : null}

      <SnapshotDeleteModal
        target={
          pendingDelete
            ? {
                assetName: snapshotAssetName(pendingDelete),
                date: pendingDelete.date,
                amount: formatSymbolAmount(
                  symbolOf(pendingDelete.currency),
                  fromMinorUnits(pendingDelete.amount_minor) ?? 0,
                ),
              }
            : null
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) await removeOne.mutateAsync(pendingDelete);
        }}
      />
      <BulkDeleteModal
        count={confirmBulk ? selectedRows.length : 0}
        onCancel={() => setConfirmBulk(false)}
        onConfirm={async () => {
          await removeMany.mutateAsync(selectedRows);
        }}
      />
    </>
  );
}
