/**
 * Sortable data table — port of `render_table` in `templates/components/table.html`.
 *
 * Column types (`currency`, `date`, `percentage`, `badge`, `link`) are mirrored
 * so a screen can be ported by copying its column list.
 */

import type { ReactNode } from "react";
import { formatCurrency, formatDate } from "../../domain/format";
import { nextSortState, sortRows, type SortState } from "../../domain/pagination";

export type ColumnType = "text" | "currency" | "date" | "percentage" | "badge" | "link";

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  type?: ColumnType;
  /** Row key holding the currency code, for `type: "currency"`. */
  currencyKey?: string;
  /** Bootstrap badge colour, for `type: "badge"`. */
  badgeColor?: string;
  /** Custom cell renderer, overrides `type`. */
  render?: (row: T) => ReactNode;
  className?: string;
}

interface Props<T extends object> {
  rows: readonly T[];
  columns: ReadonlyArray<Column<T>>;
  rowKey: (row: T) => string | number;
  sort?: SortState;
  onSortChange?: (state: SortState) => void;
  emptyMessage?: string;
  actions?: (row: T) => ReactNode;
  tableId?: string;
}

function renderCell<T extends object>(column: Column<T>, row: T): ReactNode {
  if (column.render) return column.render(row);

  const raw = (row as Record<string, unknown>)[column.key];
  if (raw === null || raw === undefined || raw === "") return "-";

  switch (column.type) {
    case "currency": {
      const code = column.currencyKey
        ? String((row as Record<string, unknown>)[column.currencyKey] ?? "EUR")
        : "EUR";
      return (
        <span className="currency-amount" data-currency={code}>
          {formatCurrency(raw as string | number, code)}
        </span>
      );
    }
    case "date":
      return formatDate(String(raw));
    case "percentage":
      return <span className="percentage">{Number(raw).toFixed(2)}%</span>;
    case "badge":
      return <span className={`badge bg-${column.badgeColor ?? "primary"}`}>{String(raw)}</span>;
    default:
      return String(raw);
  }
}

export function DataTable<T extends object>({
  rows,
  columns,
  rowKey,
  sort,
  onSortChange,
  emptyMessage = "No data available",
  actions,
  tableId = "data-table",
}: Props<T>) {
  const sorted = sort ? sortRows(rows, sort) : [...rows];
  const columnCount = columns.length + (actions ? 1 : 0);

  return (
    <div className="table-container">
      <div className="table-responsive">
        <table className="table table-striped table-hover" id={tableId}>
          <thead className="table-dark">
            <tr>
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                const canSort = Boolean(column.sortable && onSortChange);
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={[canSort ? "sortable" : "", column.className ?? ""]
                      .filter(Boolean)
                      .join(" ")}
                    data-column={column.key}
                    data-sort={isSorted ? sort?.direction : "none"}
                    role={canSort ? "button" : undefined}
                    tabIndex={canSort ? 0 : undefined}
                    onClick={canSort ? () => onSortChange!(nextSortState(sort!, column.key)) : undefined}
                    onKeyDown={
                      canSort
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSortChange!(nextSortState(sort!, column.key));
                            }
                          }
                        : undefined
                    }
                  >
                    {column.label}
                    {canSort ? (
                      <i className="bi bi-arrow-down-up sort-icon" aria-hidden="true" />
                    ) : null}
                  </th>
                );
              })}
              {actions ? <th scope="col" className="text-center">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="text-center text-muted py-4">
                  <i className="bi bi-inbox icon-2x mb-3 d-block" aria-hidden="true" />
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td key={column.key} className={column.className}>
                      {renderCell(column, row)}
                    </td>
                  ))}
                  {actions ? <td className="text-center">{actions(row)}</td> : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
