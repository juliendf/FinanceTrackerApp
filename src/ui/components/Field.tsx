/**
 * Form field components — ports of the Jinja macros in
 * `templates/components/form_fields.html`.
 *
 * The markup is deliberately hand-written rather than delegated to react-bootstrap
 * so the classes match the macros exactly: `input-group`, `input-group-text`,
 * `is-invalid`, `form-text`, `invalid-feedback`. custom.css targets those.
 */

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="invalid-feedback">{error}</div>;
}

function FieldShell({
  label,
  htmlFor,
  help,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help ? <div className="form-text">{help}</div> : null}
      <FieldError error={error} />
    </div>
  );
}

const invalid = (error?: string) => (error ? " is-invalid" : "");

interface BaseProps {
  id: string;
  label: ReactNode;
  error?: string;
  help?: ReactNode;
}

/** `text_field` */
export function TextField({
  id,
  label,
  error,
  help,
  addonIcon,
  ...input
}: BaseProps & { addonIcon?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} htmlFor={id} help={help} error={error}>
      <div className="input-group">
        {addonIcon ? (
          <span className="input-group-text">
            <i className={`bi bi-${addonIcon}`} aria-hidden="true" />
          </span>
        ) : null}
        <input
          id={id}
          className={`form-control${invalid(error)}`}
          placeholder={input.placeholder ?? String(label)}
          {...input}
        />
      </div>
    </FieldShell>
  );
}

/** `email_field` */
export function EmailField({
  id,
  label,
  error,
  help,
  ...input
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} htmlFor={id} help={help} error={error}>
      <div className="input-group">
        <span className="input-group-text">
          <i className="bi bi-envelope" aria-hidden="true" />
        </span>
        <input
          id={id}
          type="email"
          className={`form-control${invalid(error)}`}
          placeholder={input.placeholder ?? "Enter email address"}
          {...input}
        />
      </div>
    </FieldShell>
  );
}

/** `number_field` */
export function NumberField({
  id,
  label,
  error,
  help,
  addonText,
  step,
  min,
  max,
  ...input
}: BaseProps & { addonText?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} htmlFor={id} help={help} error={error}>
      <div className="input-group">
        <input
          id={id}
          type="number"
          className={`form-control${invalid(error)}`}
          placeholder={input.placeholder ?? String(label)}
          step={step}
          min={min}
          max={max}
          {...input}
        />
        {addonText ? <span className="input-group-text">{addonText}</span> : null}
      </div>
    </FieldShell>
  );
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  CHF: "CHF",
};

/** `currency_field` */
export function CurrencyField({
  id,
  label,
  error,
  help,
  currency = "EUR",
  ...input
}: BaseProps & { currency?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  return (
    <FieldShell label={label} htmlFor={id} help={help} error={error}>
      <div className="input-group">
        <span className={`input-group-text currency-${currency.toLowerCase()}`}>
          {symbol}
        </span>
        <input
          id={id}
          type="number"
          className={`form-control${invalid(error)}`}
          placeholder="0.00"
          step="0.01"
          min="0"
          {...input}
        />
      </div>
    </FieldShell>
  );
}

/** `select_field` */
export function SelectField({
  id,
  label,
  error,
  help,
  children,
  ...select
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell label={label} htmlFor={id} help={help} error={error}>
      <select id={id} className={`form-select${invalid(error)}`} {...select}>
        {children}
      </select>
    </FieldShell>
  );
}

/** `textarea_field` */
export function TextareaField({
  id,
  label,
  error,
  help,
  rows = 3,
  ...textarea
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} htmlFor={id} help={help} error={error}>
      <textarea
        id={id}
        rows={rows}
        className={`form-control${invalid(error)}`}
        placeholder={textarea.placeholder ?? String(label)}
        {...textarea}
      />
    </FieldShell>
  );
}

/** `date_field` */
export function DateField({
  id,
  label,
  error,
  help,
  ...input
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} htmlFor={id} help={help} error={error}>
      <div className="input-group">
        <span className="input-group-text">
          <i className="bi bi-calendar3" aria-hidden="true" />
        </span>
        <input
          id={id}
          type="date"
          className={`form-control${invalid(error)}`}
          placeholder={input.placeholder ?? "YYYY-MM-DD"}
          {...input}
        />
      </div>
    </FieldShell>
  );
}

/** `checkbox_field` */
export function CheckboxField({
  id,
  label,
  error,
  help,
  ...input
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-3 form-check">
      <input
        id={id}
        type="checkbox"
        className={`form-check-input${invalid(error)}`}
        {...input}
      />
      <label className="form-check-label" htmlFor={id}>
        {label}
      </label>
      {help ? <div className="form-text">{help}</div> : null}
      <FieldError error={error} />
    </div>
  );
}
