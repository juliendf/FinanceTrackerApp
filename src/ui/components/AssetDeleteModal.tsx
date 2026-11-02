/** Delete confirmation for an asset. */

import { useState } from "react";
import { Modal } from "react-bootstrap";

export function AssetDeleteModal({
  name,
  snapshotCount,
  onCancel,
  onConfirm,
}: {
  /** Display name of the asset to delete; null keeps the modal closed. */
  name: string | null;
  snapshotCount?: number;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Modal show={name !== null} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
          Confirm Asset Deletion
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="alert alert-danger">
          <strong>
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
            Warning:
          </strong>{" "}
          This action is permanent and cannot be undone!
        </div>
        <p className="mb-3">Are you sure you want to delete the asset:</p>
        <div className="text-center p-3 bg-light rounded">
          <strong className="fs-5">{name}</strong>
        </div>
        <ul className="list-unstyled mt-3 mb-0">
          <li>
            <i className="bi bi-x-lg text-danger me-2" aria-hidden="true" />
            All asset information will be permanently removed
          </li>
          <li>
            <i className="bi bi-x-lg text-danger me-2" aria-hidden="true" />
            All associated snapshots and historical data will be deleted
            {snapshotCount !== undefined ? ` (${snapshotCount})` : ""}
          </li>
          <li>
            <i className="bi bi-x-lg text-danger me-2" aria-hidden="true" />
            This action cannot be reversed
          </li>
        </ul>
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          <i className="bi bi-x-lg me-2" aria-hidden="true" />
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
          Yes, Delete Permanently
        </button>
      </Modal.Footer>
    </Modal>
  );
}
