/**
 * "Export a backup": writes the version 4 envelope, with entity selection.
 *
 * API keys are never included.
 */

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "react-bootstrap";
import { readExportRows } from "../../../db/repositories/export";
import { backupFileName, backupJson, buildBackup, ENTITY_LABELS, SELECTABLE_ENTITIES } from "../../../export/backup";
import { humanSize, oversizeWarning, readLimitBytes, utf8Bytes } from "../../../export/limits";
import { useToast } from "../../layout/Toasts";

export function BackupExportCard() {
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<string>>(new Set(SELECTABLE_ENTITIES));
  const [busy, setBusy] = useState(false);
  /** A backup this build could not read back, waiting for a decision. */
  const [oversize, setOversize] = useState<{ bytes: number; limit: number; contents: string } | null>(null);

  const toggle = (entity: string) => {
    const next = new Set(chosen);
    if (next.has(entity)) next.delete(entity);
    else next.add(entity);
    setChosen(next);
  };

  const write = async (contents: string, bytes: number) => {
    const path = await invoke<string | null>("save_text_file", {
      defaultName: backupFileName(),
      filterName: "FinanceTracker backup",
      extensions: ["json"],
      contents,
    });
    if (path) toast.success(`Backup written (${humanSize(bytes)}) to ${path}`);
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
      const contents = backupJson(envelope);
      const bytes = utf8Bytes(contents);

      // A file over the read limit could never be imported again, so ask first.
      const limit = await readLimitBytes();
      if (oversizeWarning(bytes, limit) !== null) {
        setOversize({ bytes, limit, contents });
        return;
      }
      await write(contents, bytes);
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const exportAnyway = async () => {
    if (!oversize) return;
    const pending = oversize;
    setOversize(null);
    setBusy(true);
    try {
      await write(pending.contents, pending.bytes);
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
          Writes a version 4 JSON backup. Provider API keys are never included: they stay in your macOS
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

      {/* Not a `window.confirm`: the app has its own modals, and this one has to
          explain a number, not ask a yes/no question. */}
      <Modal show={oversize !== null} onHide={() => setOversize(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>This backup could not be imported back</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>{oversize ? oversizeWarning(oversize.bytes, oversize.limit) : null}</p>
          <p className="text-muted mb-0">
            Chat History is usually the largest part, then Snapshots. Untick what you can live
            without and export again — or keep this file as an archive for a later build.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-secondary" onClick={() => setOversize(null)}>
            Go back
          </button>
          <button type="button" className="btn btn-outline-danger" onClick={() => void exportAnyway()}>
            Export anyway
          </button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
