/**
 * Search + filter bar.
 *
 * The caller owns the filter state (react-router search params on real
 * screens), so this component is presentational: it renders the controls and
 * reports changes.
 */

import type { ReactNode } from "react";

export interface FilterOption {
  value: string;
  text: string;
}

export interface FilterSpec {
  name: string;
  label: string;
  type: "select" | "number" | "text";
  options?: FilterOption[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface ActiveFilter {
  /** Query parameter name, used by the clear handler. */
  param: string;
  label: string;
}

interface Props {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterSpec[];
  filterValues?: Record<string, string>;
  onFilterChange?: (name: string, value: string) => void;
  showDateRange?: boolean;
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (value: string) => void;
  onDateToChange?: (value: string) => void;
  onSubmit?: () => void;
  onClearAll?: () => void;
  activeFilters?: ActiveFilter[];
  onRemoveFilter?: (param: string) => void;
}

export function SearchFilter({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  filters = [],
  filterValues = {},
  onFilterChange,
  showDateRange = false,
  dateFrom = "",
  dateTo = "",
  onDateFromChange,
  onDateToChange,
  onSubmit,
  onClearAll,
  activeFilters = [],
  onRemoveFilter,
}: Props) {
  return (
    <div className="search-filter-container mb-4">
      <form
        id="search-filter-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <div className="row g-3 align-items-end">
          <div className="col-md-4">
            <label htmlFor="search" className="form-label">
              Search
            </label>
            <div className="input-group">
              <span className="input-group-text">
                <i className="bi bi-search" aria-hidden="true" />
              </span>
              <input
                type="text"
                className="form-control"
                id="search"
                name="search"
                placeholder={searchPlaceholder}
                value={searchValue}
                autoComplete="off"
                onChange={(event) => onSearchChange(event.target.value)}
              />
              {searchValue ? (
                <button
                  className="btn btn-outline-secondary"
                  type="button"
                  onClick={() => onSearchChange("")}
                >
                  <i className="bi bi-x-lg" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>

          {showDateRange ? (
            <>
              <div className="col-md-3">
                <label htmlFor="date_from" className="form-label">
                  From Date
                </label>
                <input
                  type="date"
                  className="form-control"
                  id="date_from"
                  name="date_from"
                  value={dateFrom}
                  onChange={(event) => onDateFromChange?.(event.target.value)}
                />
              </div>
              <div className="col-md-3">
                <label htmlFor="date_to" className="form-label">
                  To Date
                </label>
                <input
                  type="date"
                  className="form-control"
                  id="date_to"
                  name="date_to"
                  value={dateTo}
                  onChange={(event) => onDateToChange?.(event.target.value)}
                />
              </div>
            </>
          ) : null}

          {filters.map((filter) => (
            <div className="col-md-2" key={filter.name}>
              <label htmlFor={filter.name} className="form-label">
                {filter.label}
              </label>
              {filter.type === "select" ? (
                <select
                  className="form-select"
                  id={filter.name}
                  name={filter.name}
                  value={filterValues[filter.name] ?? ""}
                  onChange={(event) => onFilterChange?.(filter.name, event.target.value)}
                >
                  <option value="">All {filter.label}</option>
                  {(filter.options ?? []).map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.text}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={filter.type === "number" ? "number" : "text"}
                  className="form-control"
                  id={filter.name}
                  name={filter.name}
                  placeholder={filter.placeholder ?? ""}
                  value={filterValues[filter.name] ?? ""}
                  min={filter.min}
                  max={filter.max}
                  step={filter.step}
                  onChange={(event) => onFilterChange?.(filter.name, event.target.value)}
                />
              )}
            </div>
          ))}

          <div className="col-md-auto">
            <div className="btn-group" role="group">
              <button type="submit" className="btn btn-primary">
                <i className="bi bi-search me-1" aria-hidden="true" />
                Filter
              </button>
              <button type="button" className="btn btn-outline-secondary" onClick={onClearAll}>
                <i className="bi bi-x-lg me-1" aria-hidden="true" />
                Clear
              </button>
            </div>
          </div>
        </div>
      </form>

      {activeFilters.length > 0 ? (
        <div className="active-filters mt-3">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <small className="text-muted">Active filters:</small>
            {activeFilters.map((filter) => (
              <span className="badge bg-secondary d-inline-flex align-items-center gap-2" key={filter.param}>
                {filter.label}
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  style={{ fontSize: "0.5rem" }}
                  aria-label={`Remove ${filter.label}`}
                  onClick={() => onRemoveFilter?.(filter.param)}
                />
              </span>
            ))}
            <button type="button" className="btn btn-link btn-sm p-0" onClick={onClearAll}>
              Clear all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** `export_buttons` */
export function ExportButtons({
  onExport,
  formats = ["csv"],
  disabled = false,
}: {
  onExport: (format: string) => void;
  formats?: string[];
  disabled?: boolean;
}) {
  return (
    <div className="export-buttons d-flex gap-2">
      {formats.map((format) => (
        <button
          key={format}
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={disabled}
          onClick={() => onExport(format)}
        >
          <i className="bi bi-download me-1" aria-hidden="true" />
          {format.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** `tag_badge` */
export function TagBadge({ name, color }: { name: string; color?: string | null }) {
  return (
    <span
      className="badge"
      // Truncated in a fixed-width table cell, so keep the full name reachable.
      title={name}
      style={{ backgroundColor: color || "#6c757d", color: "#fff" }}
    >
      {name}
    </span>
  );
}

/** Small info tooltip, dependency-free. */
export function InfoTooltip({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <span className="info-tooltip d-inline-flex align-items-center gap-1" title={text}>
      {children}
      <i className="bi bi-info-circle text-muted" aria-label={text} role="img" />
    </span>
  );
}

/** Chart wrapper with a fixed height and loading / error states. */
export function ChartContainer({
  children,
  height = 400,
  loading = false,
  error = null,
}: {
  children: ReactNode;
  height?: number;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <div className="chart-container position-relative" style={{ height }}>
      {children}
      {loading ? (
        <div className="chart-loading position-absolute top-50 start-50 translate-middle">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="chart-error text-danger position-absolute top-50 start-50 translate-middle">
          <p>Error loading chart.</p>
        </div>
      ) : null}
    </div>
  );
}
