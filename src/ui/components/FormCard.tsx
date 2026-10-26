/** Card wrappers and page headers — ports of `form_fields.html` and `page_header.html`. */

import type { ReactNode } from "react";

/** `form_card` */
export function FormCard({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card card-finance">
      <div className="card-header">
        <h5 className="card-title mb-0">
          <i className="bi bi-pencil-square me-2" aria-hidden="true" />
          {title}
        </h5>
        {subtitle ? <small className="text-muted">{subtitle}</small> : null}
      </div>
      <div className="card-body">
        {children}
        {actions}
      </div>
    </div>
  );
}

/** `form_actions` */
export function FormActions({
  submitText = "Save",
  submitIcon,
  submitClass = "btn-primary",
  onCancel,
  cancelLabel = "Cancel",
  isSubmitting = false,
  loadingText = "Processing...",
}: {
  submitText?: string;
  submitIcon?: string;
  submitClass?: string;
  onCancel?: () => void;
  cancelLabel?: string;
  isSubmitting?: boolean;
  loadingText?: string;
}) {
  return (
    <div className="form-actions d-flex justify-content-between align-items-center mt-4 pt-3 border-top">
      <div>
        {onCancel ? (
          <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
            <i className="bi bi-x-circle me-2" aria-hidden="true" />
            {cancelLabel}
          </button>
        ) : null}
      </div>
      <div>
        <button type="submit" className={`btn ${submitClass}`} disabled={isSubmitting}>
          {submitIcon ? <i className={`bi bi-${submitIcon} me-2`} aria-hidden="true" /> : null}
          {isSubmitting ? loadingText : submitText}
        </button>
      </div>
    </div>
  );
}

/** `page_header` */
export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  showDate = true,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: string;
  actions?: ReactNode;
  showDate?: boolean;
}) {
  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });

  return (
    <div className="page-header-banner mb-4">
      <div className="page-header-main">
        {icon ? (
          <span className="page-header-icon">
            <i className={`bi bi-${icon}`} aria-hidden="true" />
          </span>
        ) : null}
        <div>
          <h1 className="page-header-title">{title}</h1>
          {subtitle ? <p className="page-header-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {actions || showDate ? (
        <div className="page-header-actions">
          {showDate ? (
            <span className="page-header-date text-muted small d-none d-md-inline-flex align-items-center gap-1">
              <i className="bi bi-calendar3" aria-hidden="true" />
              {today}
            </span>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
