/**
 * Quick-add modals — port of `components/quick_add_modal.html`.
 *
 * In the source these are Bootstrap modals posted to `/admin/api/institutions`
 * and `/admin/api/categories`, which return the new row so the calling form can
 * select it without a page reload. Same behaviour here, minus the HTTP hop.
 */

import { useState } from "react";
import { Modal } from "react-bootstrap";
import { createInstitution, institutionNameExists } from "../../db/repositories/institutions";
import { createCategory, categoryNameExists } from "../../db/repositories/categories";
import { QUICK_ADD_CATEGORY_COLOR } from "../../domain/referenceData";
import { useToast } from "../layout/Toasts";

interface BaseProps {
  show: boolean;
  onClose: () => void;
}

export function QuickAddInstitutionModal({
  show,
  onClose,
  onCreated,
}: BaseProps & { onCreated: (created: { id: number; name: string }) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const close = () => {
    setName("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Institution name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The source returns 400 "Institution already exists" rather than 500.
      if (await institutionNameExists(trimmed)) {
        setError("Institution already exists");
        return;
      }
      const id = await createInstitution(trimmed);
      onCreated({ id, name: trimmed });
      toast.success(`Institution "${trimmed}" created.`);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={close} centered>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-bank me-2" aria-hidden="true" />
          Quick Add Institution
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="mb-3">
            <label htmlFor="quickInstitutionName" className="form-label">
              Institution Name
            </label>
            <input
              id="quickInstitutionName"
              className={`form-control${error ? " is-invalid" : ""}`}
              value={name}
              placeholder="Enter institution name"
              onChange={(event) => setName(event.target.value)}
            />
            {error ? <div className="invalid-feedback">{error}</div> : null}
          </div>
        </form>
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          <i className="bi bi-plus-lg me-2" aria-hidden="true" />
          Add Institution
        </button>
      </Modal.Footer>
    </Modal>
  );
}

export function QuickAddCategoryModal({
  show,
  onClose,
  onCreated,
}: BaseProps & { onCreated: (created: { id: number; name: string }) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const close = () => {
    setName("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Category name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (await categoryNameExists(trimmed)) {
        setError("Category already exists");
        return;
      }
      // The source's AJAX endpoint creates with the model default colour.
      const id = await createCategory(trimmed, QUICK_ADD_CATEGORY_COLOR);
      onCreated({ id, name: trimmed });
      toast.success(`Category "${trimmed}" created.`);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={close} centered>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-tags me-2" aria-hidden="true" />
          Quick Add Category
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="mb-3">
            <label htmlFor="quickCategoryName" className="form-label">
              Category Name
            </label>
            <input
              id="quickCategoryName"
              className={`form-control${error ? " is-invalid" : ""}`}
              value={name}
              placeholder="Enter category name"
              onChange={(event) => setName(event.target.value)}
            />
            {error ? <div className="invalid-feedback">{error}</div> : null}
          </div>
        </form>
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          <i className="bi bi-plus-lg me-2" aria-hidden="true" />
          Add Category
        </button>
      </Modal.Footer>
    </Modal>
  );
}
