/** Delete confirmation — port of `delete_confirmation_modal` in `components/table.html`. */

import { useState, type ReactNode } from "react";
import { Modal } from "react-bootstrap";

export function DeleteConfirmModal({
  show,
  title = "Confirm deletion",
  message,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: {
  show: boolean;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{message}</Modal.Body>
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
          {busy ? "Deleting…" : confirmLabel}
        </button>
      </Modal.Footer>
    </Modal>
  );
}
