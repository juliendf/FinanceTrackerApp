/**
 * Quick-add modals.
 *
 * Each one is a Bootstrap modal that creates the row and returns it, so the
 * calling form can select it without a reload.
 */

import { useState } from "react";
import { Modal } from "react-bootstrap";
import { createInstitution, institutionNameExists } from "../../db/repositories/institutions";
import { createCategory, categoryNameExists } from "../../db/repositories/categories";
import { QUICK_ADD_CATEGORY_COLOR } from "../../domain/referenceData";
import { SYSTEM_ROLE_CHOICES, SYSTEM_ROLES } from "../../domain/systemCategory";
import { createTag, tagNameExists } from "../../db/repositories/tags";
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
      // A duplicate name is a validation error, not a server failure.
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
  // Required, like the full form: every asset's category needs a role. `other`
  // is the honest default for a name typed in a hurry, and it can be changed
  // later in Categories.
  const [role, setRole] = useState<string>(SYSTEM_ROLES.OTHER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const close = () => {
    setName("");
    setRole(SYSTEM_ROLES.OTHER);
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
      // Categories are created with the default colour.
      const id = await createCategory(trimmed, QUICK_ADD_CATEGORY_COLOR, role);
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
          <div>
            <label htmlFor="quickCategoryRole" className="form-label">
              System role
            </label>
            <select
              id="quickCategoryRole"
              className="form-select"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {SYSTEM_ROLE_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
            <div className="form-text">
              Stocks or bonds are the only roles whose assets can list holdings.
            </div>
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

export function QuickAddTagModal({
  show,
  onClose,
  onCreated,
}: BaseProps & { onCreated: (created: { id: number; name: string }) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6c757d");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const close = () => {
    setName("");
    setColor("#6c757d");
    setError(null);
    onClose();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Tag name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (await tagNameExists(trimmed)) {
        setError("Tag name must be unique.");
        return;
      }
      const id = await createTag(trimmed, color);
      onCreated({ id, name: trimmed });
      toast.success(`Tag "${trimmed}" created.`);
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
        <Modal.Title>Add New Tag</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="mb-3">
            <label htmlFor="quickTagName" className="form-label">
              Tag Name
            </label>
            <input
              id="quickTagName"
              className={`form-control${error ? " is-invalid" : ""}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {error ? <div className="invalid-feedback">{error}</div> : null}
          </div>
          <div className="mb-3">
            <label htmlFor="quickTagColor" className="form-label">
              Color (optional)
            </label>
            <input
              id="quickTagColor"
              type="color"
              className="form-control form-control-color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </div>
        </form>
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          Add Tag
        </button>
      </Modal.Footer>
    </Modal>
  );
}
