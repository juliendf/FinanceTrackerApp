/**
 * About: the app's name, version and where its data lives.
 *
 * macOS also shows its standard About panel from the app menu (version comes
 * from the bundle's `Info.plist`); this one is reachable from the "You" menu
 * without leaving the app.
 */

import { Link } from "react-router-dom";
import { Modal } from "react-bootstrap";
import { useQuery } from "@tanstack/react-query";
import { getName, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

export function AboutModal({ show, onHide }: { show: boolean; onHide: () => void }) {
  const name = useQuery({ queryKey: ["app-name"], queryFn: getName, enabled: show });
  const version = useQuery({ queryKey: ["app-version"], queryFn: getVersion, enabled: show });
  const tauri = useQuery({ queryKey: ["tauri-version"], queryFn: getTauriVersion, enabled: show });
  const dbPath = useQuery({
    queryKey: ["database-path"],
    queryFn: () => invoke<string>("database_path"),
    enabled: show,
  });

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>About {name.data ?? "FinanceTracker"}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex align-items-center gap-3 mb-3">
          <img src="/icon.png" alt="" width={56} height={56} style={{ borderRadius: 12 }} />
          <div>
            <div className="fw-bold">{name.data ?? "FinanceTracker"}</div>
            <div className="text-muted">
              Version {version.data ?? "…"}
              {tauri.data ? ` · Tauri ${tauri.data}` : null}
            </div>
          </div>
        </div>
        <p className="mb-2">
          A local-first personal finance tracker: assets, snapshots, dashboards and an AI assistant. Your data
          never leaves this Mac unless you turn the assistant on and ask it something.
        </p>
        <p className="text-muted small mb-2">
          Database: <span className="font-monospace">{dbPath.data ?? "…"}</span>
        </p>
        <p className="text-muted small mb-0">
          Source app: the original FinanceTracker Flask project. See the parity checklist and the deviations log
          in <code>docs/</code>.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Link to="/settings/data" className="btn btn-secondary" onClick={onHide}>
          <i className="bi bi-hdd-stack me-2" aria-hidden="true" />
          Data &amp; Backups
        </Link>
        <button type="button" className="btn btn-primary" onClick={onHide}>
          Close
        </button>
      </Modal.Footer>
    </Modal>
  );
}
