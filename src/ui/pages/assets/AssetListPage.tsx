/**
 * Assets list — port of `templates/assets/list.html` and `list_assets()`
 * in `routes/assets.py`.
 *
 * Filter, page and page-size state live in the URL query (`?search=&currency=…`),
 * as in the web app, so a filtered view survives a reload and a back-button.
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Dropdown } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAssets, deleteAsset } from "../../../db/repositories/assets";
import { listCategories } from "../../../db/repositories/categories";
import { listExchangeRates } from "../../../db/repositories/exchangeRates";
import { listInstitutions } from "../../../db/repositories/institutions";
import { listAllSnapshotPoints } from "../../../db/repositories/snapshots";
import { listTags } from "../../../db/repositories/tags";
import {
  activeFilterChips,
  assetFiltersToParams,
  currencyOptions,
  displayName,
  filterAssets,
  parseAssetFilters,
  summariseAssetList,
  type AssetRow,
} from "../../../domain/assets";
import { RateTable } from "../../../domain/currency";
import { formatDate, formatMinorAsCurrency, relativeDate } from "../../../domain/format";
import { assetPageNumbers, paginate } from "../../../domain/pagination";
import { freshness, snapshotDateRange, type FreshnessStatus } from "../../../domain/portfolio";
import { useSettings } from "../../../lib/useSettings";
import { AssetDeleteModal } from "../../components/AssetDeleteModal";
import { PageHeader } from "../../components/FormCard";
import { StatCard } from "../../components/StatCard";
import { TagBadge } from "../../components/SearchFilter";
import { useToast } from "../../layout/Toasts";

const STATUS: Record<FreshnessStatus, { label: string; variant: string }> = {
  current: { label: "Current", variant: "success" },
  outdated: { label: "Outdated", variant: "warning" },
  stale: { label: "Stale", variant: "danger" },
  "no-data": { label: "No data", variant: "secondary" },
};

const PAGE_SIZES = [10, 20, 50, 100];

export function AssetListPage() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseAssetFilters(params), [params]);

  // The form edits a draft; "Search" commits it to the URL, like the GET form.
  const [draft, setDraft] = useState(filters);
  useEffect(() => setDraft(filters), [filters]);

  const [pendingDelete, setPendingDelete] = useState<AssetRow | null>(null);

  const toast = useToast();
  const queryClient = useQueryClient();
  const { baseCurrency } = useSettings();

  const assetsQuery = useQuery({ queryKey: ["assets"], queryFn: listAssets });
  const institutions = useQuery({ queryKey: ["institutions"], queryFn: listInstitutions });
  const categories = useQuery({ queryKey: ["categories"], queryFn: listCategories });
  const tags = useQuery({ queryKey: ["tags"], queryFn: listTags });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: listExchangeRates });
  const points = useQuery({ queryKey: ["snapshot-points"], queryFn: listAllSnapshotPoints });

  const allAssets = useMemo(() => assetsQuery.data ?? [], [assetsQuery.data]);
  const filtered = useMemo(() => filterAssets(allAssets, filters), [allAssets, filters]);
  const page = useMemo(() => paginate(filtered, filters.page, filters.perPage), [filtered, filters]);

  const rateTable = useMemo(() => new RateTable(rates.data ?? []), [rates.data]);
  const summary = useMemo(
    () => summariseAssetList(filtered, rateTable, baseCurrency),
    [filtered, rateTable, baseCurrency],
  );

  // The tile claims a snapshot range; compute the real one over the filtered assets.
  const dateRange = useMemo(() => {
    const ids = new Set(filtered.map((row) => row.id));
    return snapshotDateRange((points.data ?? []).filter((point) => ids.has(point.asset_id)));
  }, [filtered, points.data]);

  const chips = activeFilterChips(filters);
  const hasFilters = chips.length > 0;

  const go = (next: Partial<typeof filters>) => setParams(assetFiltersToParams({ ...filters, ...next }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // A new search always starts on page 1.
    setParams(assetFiltersToParams({ ...draft, page: 1 }));
  };

  const remove = useMutation({
    mutationFn: (row: AssetRow) => deleteAsset(row.id),
    onSuccess: (_, row) => {
      for (const key of ["assets", "snapshot-points", "snapshots"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      setPendingDelete(null);
      toast.success(`Asset "${displayName(row)}" deleted successfully!`);
    },
    onError: (error: unknown) => {
      setPendingDelete(null);
      toast.error(`Error deleting asset: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const loading = assetsQuery.isLoading;
  const first = page.total === 0 ? 0 : (page.page - 1) * page.perPage + 1;
  const last = Math.min(page.page * page.perPage, page.total);

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="Manage your financial assets and portfolios"
        icon="wallet2"
        showDate={false}
        actions={
          <Link to="/assets/new" className="btn btn-primary">
            <i className="bi bi-plus-lg" aria-hidden="true" />
            Add New Asset
          </Link>
        }
      />

      {summary.totalAssets > 0 ? (
        <div className="row g-3 mb-4">
          {summary.combined && summary.byCurrency.length > 0 ? (
            <div className="col-xl-3 col-md-6">
              <StatCard
                label="Total Value"
                icon="bi-cash-stack"
                accent="success"
                money
                value={formatMinorAsCurrency(summary.combined.totalMinor, summary.combined.currency)}
                subtitle={`All currencies, converted to ${summary.combined.currency}`}
              />
            </div>
          ) : null}
          <div className="col-xl-3 col-md-6">
            <StatCard
              label="Total Assets"
              icon="bi-wallet2"
              accent="primary"
              value={summary.totalAssets}
              subtitle={
                dateRange.start && dateRange.end
                  ? `${formatDate(dateRange.start)} – ${formatDate(dateRange.end)}`
                  : undefined
              }
            />
          </div>
          {summary.byCurrency.map((bucket) => (
            <div className="col-xl-3 col-md-6" key={bucket.currency}>
              <StatCard
                label={bucket.currency}
                money
                value={formatMinorAsCurrency(bucket.totalMinor, bucket.currency)}
                subtitle={`${bucket.assets} assets · ${bucket.snapshots} snapshots`}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="row mb-4">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <form onSubmit={submit} id="filter-form">
                <div className="row g-3">
                  <div className="col-md-3">
                    <label htmlFor="search" className="form-label">Search</label>
                    <input
                      type="text"
                      className="form-control"
                      id="search"
                      value={draft.search}
                      placeholder="Search assets, institutions, products..."
                      onChange={(event) => setDraft({ ...draft, search: event.target.value })}
                    />
                  </div>

                  <FilterSelect
                    id="currency"
                    label="Currency"
                    all="All Currencies"
                    value={draft.currency}
                    options={currencyOptions(allAssets)}
                    onChange={(value) => setDraft({ ...draft, currency: value })}
                  />
                  <FilterSelect
                    id="category"
                    label="Category"
                    all="All Categories"
                    value={draft.category}
                    options={(categories.data ?? []).map((row) => row.name)}
                    onChange={(value) => setDraft({ ...draft, category: value })}
                  />
                  <FilterSelect
                    id="institution"
                    label="Institution"
                    all="All Institutions"
                    value={draft.institution}
                    options={(institutions.data ?? []).map((row) => row.name)}
                    onChange={(value) => setDraft({ ...draft, institution: value })}
                  />
                  <FilterSelect
                    id="tag"
                    label="Tag"
                    all="All Tags"
                    value={draft.tag}
                    options={(tags.data ?? []).map((row) => row.name)}
                    onChange={(value) => setDraft({ ...draft, tag: value })}
                  />
                </div>

                <div className="d-flex flex-wrap gap-2 mt-3">
                  <button type="submit" className="btn btn-primary btn-sm">
                    <i className="bi bi-search" aria-hidden="true" />
                    Search
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setParams(new URLSearchParams())}
                  >
                    <i className="bi bi-x-lg" aria-hidden="true" />
                    Clear Filters
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {hasFilters ? (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <span className="section-label">Filters</span>
          {chips.map((chip) => (
            <span className="chip" key={chip.param}>{chip.label}</span>
          ))}
          <button
            type="button"
            className="btn btn-link btn-sm p-0"
            onClick={() => setParams(new URLSearchParams())}
          >
            Clear all
          </button>
        </div>
      ) : null}

      <div className="table-toolbar">
        <span className="table-count">
          {page.total ? (
            <>
              Showing <strong>{first}–{last}</strong> of <strong>{page.total}</strong> assets
            </>
          ) : (
            "No assets"
          )}
        </span>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Rows per page"
          value={filters.perPage}
          onChange={(event) => go({ perPage: Number(event.target.value), page: 1 })}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size} per page</option>
          ))}
        </select>
      </div>

      <div className="row">
        <div className="col-12">
          {loading ? (
            <p className="text-muted">Loading…</p>
          ) : page.items.length > 0 ? (
            <>
              <div className="table-container">
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Institution</th>
                        <th>Category</th>
                        <th>Tags</th>
                        <th className="num">Latest Value</th>
                        <th>Updated</th>
                        <th>Status</th>
                        <th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((asset) => (
                        <AssetTableRow key={asset.id} asset={asset} onDelete={setPendingDelete} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {page.pages > 1 ? (
                <nav aria-label="Asset pagination" className="mt-4">
                  <ul className="pagination justify-content-center">
                    <li className={`page-item${page.hasPrev ? "" : " disabled"}`}>
                      {page.hasPrev ? (
                        <button type="button" className="page-link" onClick={() => go({ page: page.page - 1 })}>
                          <i className="bi bi-chevron-left" aria-hidden="true" /> Previous
                        </button>
                      ) : (
                        <span className="page-link">
                          <i className="bi bi-chevron-left" aria-hidden="true" /> Previous
                        </span>
                      )}
                    </li>

                    {assetPageNumbers(page.page, page.pages).map((number, index) =>
                      number === null ? (
                        <li className="page-item disabled" key={`gap-${index}`}>
                          <span className="page-link">…</span>
                        </li>
                      ) : number === page.page ? (
                        <li className="page-item active" key={number}>
                          <span className="page-link">{number}</span>
                        </li>
                      ) : (
                        <li className="page-item" key={number}>
                          <button type="button" className="page-link" onClick={() => go({ page: number })}>
                            {number}
                          </button>
                        </li>
                      ),
                    )}

                    <li className={`page-item${page.hasNext ? "" : " disabled"}`}>
                      {page.hasNext ? (
                        <button type="button" className="page-link" onClick={() => go({ page: page.page + 1 })}>
                          Next <i className="bi bi-chevron-right" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="page-link">
                          Next <i className="bi bi-chevron-right" aria-hidden="true" />
                        </span>
                      )}
                    </li>
                  </ul>
                </nav>
              ) : null}
            </>
          ) : (
            <div className="card">
              <div className="empty-state">
                <i className="bi bi-wallet2 empty-state-icon" aria-hidden="true" />
                {hasFilters ? (
                  <>
                    <p className="empty-state-title mb-0">No assets match these filters</p>
                    <p className="mb-2">Try broadening your search criteria.</p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setParams(new URLSearchParams())}
                    >
                      Clear Filters
                    </button>
                  </>
                ) : (
                  <>
                    <p className="empty-state-title mb-0">No assets yet</p>
                    <p className="mb-2">Start tracking your finances by adding your first asset.</p>
                    <Link to="/assets/new" className="btn btn-primary btn-sm">
                      <i className="bi bi-plus-lg" aria-hidden="true" />
                      Add Your First Asset
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {assetsQuery.isError ? (
        <p className="text-danger mt-3 small">{String(assetsQuery.error)}</p>
      ) : null}

      <AssetDeleteModal
        name={pendingDelete ? displayName(pendingDelete) : null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) await remove.mutateAsync(pendingDelete);
        }}
      />
    </>
  );
}

function FilterSelect({
  id,
  label,
  all,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  all: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="col-md-2">
      <label htmlFor={id} className="form-label">{label}</label>
      <select
        className="form-select"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{all}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </div>
  );
}

function AssetTableRow({ asset, onDelete }: { asset: AssetRow; onDelete: (row: AssetRow) => void }) {
  const name = displayName(asset);
  const status = STATUS[freshness(asset.latest_date)];

  return (
    <tr className="asset-row">
      <td>
        <Link to={`/assets/${asset.id}`} className="cell-title text-decoration-none">{name}</Link>
        {asset.product_name && asset.product_name !== name ? (
          <span className="cell-sub">{asset.product_name}</span>
        ) : null}
      </td>
      <td>{asset.institution_name}</td>
      <td><span className="chip">{asset.category_name}</span></td>
      <td>
        {asset.tags.length > 0 ? (
          asset.tags.map((tag) => <TagBadge key={tag.id} name={tag.name} color={tag.color} />)
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="num">
        {asset.latest_amount_minor !== null ? (
          <>
            {formatMinorAsCurrency(asset.latest_amount_minor, asset.currency)}
            <span className="currency-code ms-1">{asset.currency}</span>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="text-muted">{asset.latest_date ? relativeDate(asset.latest_date) : "Never"}</td>
      <td><span className={`badge bg-${status.variant}`}>{status.label}</span></td>
      <td>
        <div className="row-actions d-none d-md-inline-flex">
          <Link to={`/assets/${asset.id}`} className="btn btn-icon btn-icon-accent" title="View details" aria-label={`View ${name}`}>
            <i className="bi bi-eye" aria-hidden="true" />
          </Link>
          <Link to={`/assets/${asset.id}/edit`} className="btn btn-icon" title="Edit asset" aria-label={`Edit ${name}`}>
            <i className="bi bi-pencil" aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="btn btn-icon btn-icon-danger delete-asset-btn"
            title="Delete asset"
            aria-label={`Delete ${name}`}
            onClick={() => onDelete(asset)}
          >
            <i className="bi bi-trash" aria-hidden="true" />
          </button>
        </div>
        <Dropdown className="d-md-none text-end" align="end">
          <Dropdown.Toggle as="button" className="btn btn-icon" aria-label="Actions" bsPrefix="p-0 border-0 bg-transparent">
            <i className="bi bi-three-dots-vertical" aria-hidden="true" />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item as={Link} to={`/assets/${asset.id}`}>
              <i className="bi bi-eye me-2" aria-hidden="true" />View Details
            </Dropdown.Item>
            <Dropdown.Item as={Link} to={`/assets/${asset.id}/edit`}>
              <i className="bi bi-pencil me-2" aria-hidden="true" />Edit Asset
            </Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item className="text-danger" onClick={() => onDelete(asset)}>
              <i className="bi bi-trash me-2" aria-hidden="true" />Delete Asset
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </td>
    </tr>
  );
}
