/** Delete confirmations for one or several snapshots. */

import { useState, type ReactNode } from "react";
import { Modal } from "react-bootstrap";

function Shell({
  show,
  onCancel,
  onConfirm,
  confirmLabel,
  children,
}: {
  show: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
          Confirm Delete
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>{children}</Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          <i className="bi bi-trash me-2" aria-hidden="true" />
          {confirmLabel}
        </button>
      </Modal.Footer>
    </Modal>
  );
}

/** One snapshot — port of the modal on `snapshots/detail.html`. */
export function SnapshotDeleteModal({
  target,
  onCancel,
  onConfirm,
}: {
  target: { assetName: string; date: string; amount: string } | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Shell show={target !== null} onCancel={onCancel} onConfirm={onConfirm} confirmLabel="Delete Snapshot">
      <p>Are you sure you want to delete this snapshot?</p>
      <div className="alert alert-warning">
        <strong>Asset:</strong> {target?.assetName}
        <br />
        <strong>Date:</strong> {target?.date}
        <br />
        <strong>Amount:</strong> {target?.amount}
      </div>
      <p className="text-danger mb-0">
        <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
        <strong>This action cannot be undone.</strong>
      </p>
    </Shell>
  );
}

/** Several snapshots — the list's bulk delete, which the source asks with `confirm()`. */
export function BulkDeleteModal({
  count,
  onCancel,
  onConfirm,
}: {
  /** 0 keeps the dialog closed. */
  count: number;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Shell show={count > 0} onCancel={onCancel} onConfirm={onConfirm} confirmLabel={`Delete ${count} snapshot${count === 1 ? "" : "s"}`}>
      <p className="mb-0">
        Are you sure you want to delete {count} snapshot{count !== 1 ? "s" : ""}? This action
        cannot be undone.
      </p>
    </Shell>
  );
}
