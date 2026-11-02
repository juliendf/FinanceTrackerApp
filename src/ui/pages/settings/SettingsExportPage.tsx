/**
 * Export settings.
 *
 * The JSON is shown on the page and a button saves it through a native dialog.
 */

import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getAllSettings } from "../../../db/repositories/settings";
import { exportSettingsJson } from "../../../domain/settings";
import { useToast } from "../../layout/Toasts";
import { SettingsLayout } from "./SettingsLayout";

export function SettingsExportPage() {
  const toast = useToast();
  const settings = useQuery({ queryKey: ["settings"], queryFn: getAllSettings });
  const json = settings.data ? exportSettingsJson(settings.data) : "";

  const download = async () => {
    try {
      const path = await invoke<string | null>("save_text_file", {
        defaultName: "finance_tracker_settings.json",
        filterName: "JSON",
        extensions: ["json"],
        contents: json,
      });
      if (path) toast.success(`Settings saved to ${path}`);
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <SettingsLayout title="Export Settings" subtitle="Download your current settings configuration" actions={null}>
      <div className="card card-finance">
        <div className="card-body">
          <h4 className="mb-3">Export Your Settings</h4>
          <div className="alert alert-info">
            <h6 className="alert-heading"><i className="bi bi-info-circle me-2" aria-hidden="true" />About Settings Export</h6>
            <p className="mb-2">The file contains every preference stored in the app:</p>
            <ul className="mb-0">
              <li>Currency: base currency and converted-amount display</li>
              <li>Application: items per page and date format</li>
              <li>Display: theme and animations</li>
            </ul>
          </div>
          <label htmlFor="settingsJson" className="form-label">Settings JSON</label>
          <textarea id="settingsJson" className="form-control font-monospace mb-3" rows={14} readOnly value={json} />
          <button type="button" className="btn btn-primary" onClick={() => void download()} disabled={!json}>
            <i className="bi bi-download me-2" aria-hidden="true" />
            Save as JSON
          </button>
        </div>
      </div>
    </SettingsLayout>
  );
}
