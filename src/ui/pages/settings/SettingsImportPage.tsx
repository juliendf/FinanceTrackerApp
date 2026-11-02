/**
 * Import settings.
 *
 * Paste JSON or pick a file; keys this build does not know are ignored. Values
 * are written in one transaction.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setSettings } from "../../../db/repositories/settings";
import { parseSettingsImport } from "../../../domain/settings";
import { applyTheme } from "../../../lib/theme";
import { useToast } from "../../layout/Toasts";
import { SettingsLayout } from "./SettingsLayout";

export function SettingsImportPage() {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const apply = useMutation({
    mutationFn: (values: Record<string, string | number | boolean>) => setSettings(values),
    onSuccess: async (_, values) => {
      if (typeof values.theme === "string") applyTheme(values.theme as "light" | "dark" | "auto");
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings imported successfully!");
      navigate("/settings");
    },
    onError: (cause: unknown) =>
      setError(`Error importing settings: ${cause instanceof Error ? cause.message : String(cause)}`),
  });

  const pickFile = async () => {
    setError(null);
    try {
      const picked = await invoke<{ name: string; contents: string } | null>("pick_and_read_text_file", {
        filterName: "JSON",
        extensions: ["json"],
      });
      if (picked) setRaw(picked.contents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submit = () => {
    setError(null);
    const parsed = parseSettingsImport(raw);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    if (Object.keys(parsed.values).length === 0) {
      setError("That file has no settings this app knows about.");
      return;
    }
    setIgnored(parsed.ignored);
    apply.mutate(parsed.values);
  };

  return (
    <SettingsLayout title="Import Settings" subtitle="Restore settings from a previous export" actions={null}>
      <div className="card card-finance">
        <div className="card-body">
          <h4 className="mb-3">Import Settings Configuration</h4>
          <div className="alert alert-warning">
            <h6 className="alert-heading"><i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />Important</h6>
            <p className="mb-2">Importing settings will:</p>
            <ul className="mb-0">
              <li>Replace your current settings with those from the imported file</li>
              <li>Override any custom preferences you have configured</li>
              <li>This action cannot be undone automatically</li>
            </ul>
          </div>
          <div className="alert alert-info">
            Consider <Link to="/settings/export">exporting your current settings</Link> as a backup before importing.
          </div>

          <label htmlFor="settingsFile" className="form-label">Settings JSON</label>
          <textarea
            id="settingsFile"
            className="form-control font-monospace mb-2"
            rows={10}
            placeholder="Paste settings JSON here..."
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <div className="form-text mb-3">Paste exported settings JSON data, or open a file.</div>
          {error ? <div className="alert alert-danger">{error}</div> : null}
          {ignored.length > 0 ? (
            <div className="alert alert-warning">
              Ignored unknown settings: {ignored.join(", ")}
            </div>
          ) : null}

          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={submit} disabled={raw.trim() === "" || apply.isPending}>
              <i className="bi bi-upload me-2" aria-hidden="true" />
              Import Settings
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void pickFile()}>
              <i className="bi bi-folder2-open me-2" aria-hidden="true" />
              Open a file…
            </button>
            <Link to="/settings" className="btn btn-outline-secondary">Cancel</Link>
          </div>
        </div>
      </div>
    </SettingsLayout>
  );
}
