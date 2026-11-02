/**
 * "Export a backup": writes the version 3 envelope, with entity selection.
 *
 * API keys are never included.
 */

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readExportRows } from "../../../db/repositories/export";
import { backupFileName, backupJson, buildBackup, ENTITY_LABELS, SELECTABLE_ENTITIES } from "../../../export/backup";
import { useToast } from "../../layout/Toasts";

export function BackupExportCard() {
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<string>>(new Set(SELECTABLE_ENTITIES));
  const [busy, setBusy] = useState(false);

  const toggle = (entity: string) => {
    const next = new Set(chosen);
    if (next.has(entity)) next.delete(entity);
    else next.add(entity);
    setChosen(next);
  };

  const exportBackup = async () => {
    if (chosen.size === 0) {
      toast.error("Pick at least one thing to export.");
      return;
    }
    setBusy(true);
    try {
      const rows = await readExportRows();
      const envelope = buildBackup(rows, new Date().toISOString(), [...chosen]);
      const path = await invoke<string | null>("save_text_file", {
        defaultName: backupFileName(),
        filterName: "FinanceTracker backup",
        extensions: ["json"],
        contents: backupJson(envelope),
      });
      if (path) toast.success(`Backup written to ${path}`);
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-finance mb-4">
      <div className="card-body">
        <h5 className="card-title">
          <i className="bi bi-download me-2" aria-hidden="true" />
          Export a backup
        </h5>
        <p className="text-muted">
          Writes a version 3 JSON backup. Provider API keys are never included: they stay in your macOS
          Keychain. The file is plain text — keep it somewhere private.
        </p>
        <div className="row g-2 mb-3">
          {SELECTABLE_ENTITIES.map((entity) => (
            <div className="col-md-4" key={entity}>
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`export-${entity}`}
                  checked={chosen.has(entity)}
                  onChange={() => toggle(entity)}
                />
                <label className="form-check-label" htmlFor={`export-${entity}`}>
                  {ENTITY_LABELS[entity]}
                </label>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void exportBackup()} disabled={busy}>
          <i className="bi bi-download me-2" aria-hidden="true" />
          Export backup
        </button>
      </div>
    </div>
  );
}
