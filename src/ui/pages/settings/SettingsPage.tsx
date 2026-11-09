/**
 * General settings.
 *
 * The API key section is deliberately absent: there is no REST API in this
 * build. Everything else is here: the six fields, save, reset to defaults,
 * settings JSON export/import, and the update check — which belongs to the app
 * as a whole rather than to Data & Backup, where it used to sit.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllSettings, setSettings } from "../../../db/repositories/settings";
import { applyTheme } from "../../../lib/theme";
import {
  CURRENCY_CHOICES,
  DATE_FORMAT_CHOICES,
  DEFAULT_SETTINGS,
  ITEMS_PER_PAGE_CHOICES,
  THEME_CHOICES,
  type SettingValue,
} from "../../../domain/settings";
import { useToast } from "../../layout/Toasts";
import { SettingsLayout } from "./SettingsLayout";
import { UpdateCard } from "./UpdateCard";

type Draft = {
  base_currency: string;
  show_converted_amounts: boolean;
  items_per_page: string;
  date_format: string;
  theme: string;
  enable_animations: boolean;
};

const toDraft = (settings: Record<string, SettingValue>): Draft => ({
  base_currency: String(settings.base_currency ?? DEFAULT_SETTINGS.base_currency),
  show_converted_amounts: settings.show_converted_amounts !== false,
  items_per_page: String(settings.items_per_page ?? DEFAULT_SETTINGS.items_per_page),
  date_format: String(settings.date_format ?? DEFAULT_SETTINGS.date_format),
  theme: String(settings.theme ?? DEFAULT_SETTINGS.theme),
  enable_animations: settings.enable_animations !== false,
});

export function SettingsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: getAllSettings });
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(toDraft(settings.data));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (values: Draft) => setSettings({ ...values }),
    onSuccess: (_, values) => {
      applyTheme(values.theme as "light" | "dark" | "auto");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved successfully!");
    },
    onError: (error: unknown) =>
      toast.error(`Error saving settings: ${error instanceof Error ? error.message : String(error)}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft) save.mutate(draft);
  };

  if (!draft) return <p className="text-muted">Loading…</p>;

  const field = <K extends keyof Draft>(key: K) => ({
    value: draft[key] as Draft[K],
    onChange: (value: Draft[K]) => setDraft({ ...draft, [key]: value }),
  });

  return (
    <SettingsLayout
      title="Application Settings"
      actions={
        <>
          <Link to="/settings/export" className="btn btn-secondary btn-sm">
            <i className="bi bi-download" aria-hidden="true" />
            Export
          </Link>
          <Link to="/settings/import" className="btn btn-secondary btn-sm">
            <i className="bi bi-upload" aria-hidden="true" />
            Import
          </Link>
        </>
      }
    >
      <form onSubmit={submit} id="settingsForm">
        <div className="form-section">
          <h5 className="mb-3">
            <i className="bi bi-currency-exchange me-2" aria-hidden="true" />
            Currency Settings
          </h5>
          <div className="row mb-3">
            <div className="col-md-6">
              <label htmlFor="base_currency" className="form-label">Base Currency</label>
              <select
                id="base_currency"
                className="form-select"
                value={(field("base_currency")).value}
                onChange={(e) => field("base_currency").onChange(e.target.value)}
              >
                {CURRENCY_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
              <div className="form-text">Default currency for conversions and totals</div>
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-md-12">
              <div className="form-check">
                <input
                  id="show_converted_amounts"
                  type="checkbox"
                  className="form-check-input"
                  checked={draft.show_converted_amounts}
                  onChange={(e) => setDraft({ ...draft, show_converted_amounts: e.target.checked })}
                />
                <label htmlFor="show_converted_amounts" className="form-check-label">Show Converted Amounts</label>
              </div>
              <div className="form-text">Display amounts in base currency alongside original currency</div>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h5 className="mb-3"><i className="bi bi-gear me-2" aria-hidden="true" />Application Settings</h5>
          <div className="row mb-3">
            <div className="col-md-6">
              <label htmlFor="items_per_page" className="form-label">Items Per Page</label>
              <select
                id="items_per_page"
                className="form-select"
                value={draft.items_per_page}
                onChange={(e) => setDraft({ ...draft, items_per_page: e.target.value })}
              >
                {ITEMS_PER_PAGE_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
              <div className="form-text">Number of items to display in lists and tables</div>
            </div>
            <div className="col-md-6">
              <label htmlFor="date_format" className="form-label">Date Format</label>
              <select
                id="date_format"
                className="form-select"
                value={draft.date_format}
                onChange={(e) => setDraft({ ...draft, date_format: e.target.value })}
              >
                {DATE_FORMAT_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
              <div className="form-text">How dates are displayed throughout the application</div>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h5 className="mb-3"><i className="bi bi-palette me-2" aria-hidden="true" />Display Settings</h5>
          <div className="row mb-3">
            <div className="col-md-6">
              <label htmlFor="theme" className="form-label">Theme</label>
              <select
                id="theme"
                className="form-select"
                value={draft.theme}
                onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
              >
                {THEME_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
              <div className="form-text">Application color theme</div>
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-md-6">
              <div className="form-check">
                <input
                  id="enable_animations"
                  type="checkbox"
                  className="form-check-input"
                  checked={draft.enable_animations}
                  onChange={(e) => setDraft({ ...draft, enable_animations: e.target.checked })}
                />
                <label htmlFor="enable_animations" className="form-check-label">Enable Animations</label>
              </div>
              <div className="form-text">Enable smooth transitions and animations</div>
            </div>
          </div>
        </div>

        {/* Not a field: its buttons are type="button", so it is never submitted
            with the form. It sits last, above the save bar, like the rest. */}
        <UpdateCard />

        <div className="d-flex flex-wrap gap-2 mt-4 pt-3 border-top">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            <i className="bi bi-check-lg me-2" aria-hidden="true" />
            Save Settings
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => navigate("/settings/reset")}>
            <i className="bi bi-arrow-counterclockwise me-2" aria-hidden="true" />
            Reset to Defaults
          </button>
          <Link to="/settings/llm-providers" className="btn btn-outline-secondary">
            <i className="bi bi-cpu me-2" aria-hidden="true" />
            LLM Providers
          </Link>
          <Link to="/settings/export" className="btn btn-outline-info">
            <i className="bi bi-download me-2" aria-hidden="true" />
            Export Settings
          </Link>
        </div>
      </form>
    </SettingsLayout>
  );
}
