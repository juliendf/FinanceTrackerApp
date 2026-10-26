/** Pagination and page-size controls — ports of `components/pagination.html`. */

import { paginationLabel, pageNumbers, type Page } from "../../domain/pagination";

export function Pagination({
  page,
  onPageChange,
  showInfo = true,
  showJump = true,
}: {
  page: Page<unknown>;
  onPageChange: (page: number) => void;
  showInfo?: boolean;
  showJump?: boolean;
}) {
  if (page.pages <= 1) return null;
  const numbers = pageNumbers(page.page, page.pages);

  return (
    <nav
      aria-label="Page navigation"
      className="d-flex justify-content-between align-items-center flex-wrap"
    >
      {showInfo ? (
        <div className="pagination-info">
          <small className="text-muted">{paginationLabel(page)}</small>
        </div>
      ) : null}

      <div className="d-flex align-items-center gap-3">
        {showJump && page.pages > 5 ? (
          <div className="page-jump">
            <div className="input-group input-group-sm">
              <span className="input-group-text">Page</span>
              <input
                type="number"
                className="form-control"
                min={1}
                max={page.pages}
                defaultValue={page.page}
                style={{ width: 70 }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const value = Number((event.target as HTMLInputElement).value);
                  if (value >= 1 && value <= page.pages) onPageChange(value);
                }}
              />
            </div>
          </div>
        ) : null}

        <ul className="pagination pagination-sm mb-0">
          <li className={`page-item${page.hasPrev ? "" : " disabled"}`}>
            {page.hasPrev ? (
              <button
                type="button"
                className="page-link"
                aria-label="Previous"
                onClick={() => onPageChange(page.page - 1)}
              >
                <span aria-hidden="true">&laquo;</span>
                <span className="visually-hidden">Previous</span>
              </button>
            ) : (
              <span className="page-link" aria-label="Previous">
                <span aria-hidden="true">&laquo;</span>
                <span className="visually-hidden">Previous</span>
              </span>
            )}
          </li>

          {numbers.map((number, index) =>
            number === null ? (
              <li className="page-item disabled" key={`gap-${index}`}>
                <span className="page-link">…</span>
              </li>
            ) : number === page.page ? (
              <li className="page-item active" aria-current="page" key={number}>
                <span className="page-link">{number}</span>
              </li>
            ) : (
              <li className="page-item" key={number}>
                <button type="button" className="page-link" onClick={() => onPageChange(number)}>
                  {number}
                </button>
              </li>
            ),
          )}

          <li className={`page-item${page.hasNext ? "" : " disabled"}`}>
            {page.hasNext ? (
              <button
                type="button"
                className="page-link"
                aria-label="Next"
                onClick={() => onPageChange(page.page + 1)}
              >
                <span aria-hidden="true">&raquo;</span>
                <span className="visually-hidden">Next</span>
              </button>
            ) : (
              <span className="page-link" aria-label="Next">
                <span aria-hidden="true">&raquo;</span>
                <span className="visually-hidden">Next</span>
              </span>
            )}
          </li>
        </ul>
      </div>
    </nav>
  );
}

/** `page_size_selector` */
export function PageSizeSelector({
  currentSize,
  onChange,
  sizes = [10, 20, 50, 100],
}: {
  currentSize: number;
  onChange: (size: number) => void;
  sizes?: number[];
}) {
  return (
    <div className="page-size-selector">
      <div className="d-flex align-items-center">
        <label htmlFor="pageSize" className="form-label me-2 mb-0">
          Show:
        </label>
        <select
          className="form-select form-select-sm"
          id="pageSize"
          value={currentSize}
          style={{ width: "auto" }}
          onChange={(event) => onChange(Number(event.target.value))}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span className="ms-2 text-muted">entries</span>
      </div>
    </div>
  );
}
