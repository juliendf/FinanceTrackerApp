/**
 * Categories list.
 *
 * Categories carry a colour and an optional `system_role` (French labels, used
 * by the Résumé view). Deletion is refused while assets reference the category.
 */

import { useState } from "react";
import { Modal } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/FormCard";
import { DataTable, type Column } from "../../components/DataTable";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
import { SelectField, TextField, TextareaField } from "../../components/Field";
import { useToast } from "../../layout/Toasts";
import {
  categoryNameExists,
  createCategory,
  deleteCategory,
  listCategoriesWithCounts,
  updateCategory,
  type CategoryWithCount,
} from "../../../db/repositories/categories";
import {
  categorySchema,
  DEFAULT_CATEGORY_COLOR,
  systemRoleLabel,
} from "../../../domain/referenceData";
import { SYSTEM_ROLE_CHOICES } from "../../../domain/systemCategory";

const KEY = ["categories"] as const;

interface FormState {
  id: number | null;
  name: string;
  description: string;
  color: string;
  system_role: string;
}

const EMPTY: FormState = {
  id: null,
  name: "",
  description: "",
  color: DEFAULT_CATEGORY_COLOR,
  system_role: "",
};

export function CategoriesPage() {
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<CategoryWithCount | null>(null);

  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: listCategoriesWithCounts });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: KEY });

  const save = useMutation({
    mutationFn: async (state: FormState) => {
      const parsed = categorySchema.safeParse({
        name: state.name,
        description: state.description,
        color: state.color,
        system_role: state.system_role,
      });
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
        throw Object.assign(new Error("validation"), { fieldErrors });
      }

      if (await categoryNameExists(parsed.data.name, state.id ?? undefined)) {
        throw Object.assign(new Error("validation"), {
          fieldErrors: { name: "A category with this name already exists." },
        });
      }

      const color = parsed.data.color || DEFAULT_CATEGORY_COLOR;
      const role = parsed.data.system_role || null;
      const description = parsed.data.description || null;

      if (state.id === null) {
        await createCategory(parsed.data.name, color, role, description);
      } else {
        await updateCategory(state.id, parsed.data.name, color, role, description);
      }
      return state;
    },
    onSuccess: (state) => {
      invalidate();
      setForm(null);
      setErrors({});
      toast.success(
        `Category "${state.name.trim()}" ${state.id === null ? "created" : "updated"} successfully!`,
      );
    },
    onError: (error: unknown) => {
      const fieldErrors = (error as { fieldErrors?: Record<string, string> }).fieldErrors;
      if (fieldErrors) setErrors(fieldErrors);
      else toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const remove = useMutation({
    mutationFn: (target: CategoryWithCount) => deleteCategory(target.id),
    onSuccess: () => {
      invalidate();
      setPendingDelete(null);
      toast.success("Category deleted successfully!");
    },
    onError: (error: unknown) => {
      setPendingDelete(null);
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const columns: Array<Column<CategoryWithCount>> = [
    {
      key: "name",
      label: "Name",
      sortable: true,
      render: (row) => (
        <span className="d-inline-flex align-items-center gap-2">
          <span
            className="d-inline-block rounded-circle"
            style={{
              width: 10,
              height: 10,
              backgroundColor: row.color ?? "#6c757d",
            }}
            aria-hidden="true"
          />
          {row.name}
        </span>
      ),
    },
    {
      key: "system_role",
      label: "Rôle système",
      render: (row) => systemRoleLabel(row.system_role) || "—",
    },
    {
      key: "description",
      label: "Description",
      render: (row) => row.description ?? "—",
    },
    { key: "asset_count", label: "Assets", sortable: true },
  ];

  const requestDelete = (row: CategoryWithCount) => {
    if (row.asset_count > 0) {
      toast.error(
        `Cannot delete category "${row.name}" - it has ${row.asset_count} associated assets.`,
      );
      return;
    }
    setPendingDelete(row);
  };

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="Asset categories, their colour and the system role the Résumé uses."
        icon="tags"
        showDate={false}
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setErrors({});
              setForm(EMPTY);
            }}
          >
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            New category
          </button>
        }
      />

      <div className="card card-finance">
        <div className="card-body p-0">
          {query.isLoading ? (
            <p className="text-muted p-4 mb-0">Loading…</p>
          ) : (
            <DataTable
              rows={query.data ?? []}
              columns={columns}
              rowKey={(row) => row.id}
              tableId="categories-table"
              emptyMessage="No categories yet"
              actions={(row) => (
                <div className="btn-group btn-group-sm" role="group">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    title="Edit"
                    aria-label={`Edit ${row.name}`}
                    onClick={() => {
                      setErrors({});
                      setForm({
                        id: row.id,
                        name: row.name,
                        description: row.description ?? "",
                        color: row.color ?? DEFAULT_CATEGORY_COLOR,
                        system_role: row.system_role ?? "",
                      });
                    }}
                  >
                    <i className="bi bi-pencil-square" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    title="Delete"
                    aria-label={`Delete ${row.name}`}
                    onClick={() => requestDelete(row)}
                  >
                    <i className="bi bi-trash" aria-hidden="true" />
                  </button>
                </div>
              )}
            />
          )}
        </div>
      </div>

      <Modal show={form !== null} onHide={() => setForm(null)} centered>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (form) save.mutate(form);
          }}
        >
          <Modal.Header closeButton>
            <Modal.Title>
              {form?.id === null ? "Add New Category" : "Edit Category"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {form ? (
              <>
                <TextField
                  id="category-name"
                  label="Category Name"
                  value={form.name}
                  error={errors.name}
                  help="Name of the asset category"
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
                <div className="mb-3">
                  <label htmlFor="category-color" className="form-label">
                    Color
                  </label>
                  <div className="d-flex align-items-center gap-2">
                    <input
                      id="category-color"
                      type="color"
                      className={`form-control form-control-color${errors.color ? " is-invalid" : ""}`}
                      value={/^#[0-9A-Fa-f]{6}$/.test(form.color) ? form.color : DEFAULT_CATEGORY_COLOR}
                      onChange={(event) => setForm({ ...form, color: event.target.value })}
                    />
                    <input
                      className="form-control"
                      aria-label="Colour hex code"
                      value={form.color}
                      onChange={(event) => setForm({ ...form, color: event.target.value })}
                    />
                  </div>
                  <div className="form-text">
                    Optional colour for visual identification (hex code)
                  </div>
                  {errors.color ? <div className="invalid-feedback d-block">{errors.color}</div> : null}
                </div>
                <SelectField
                  id="category-system-role"
                  label="Rôle système"
                  value={form.system_role}
                  error={errors.system_role}
                  help="Optional role used by the Résumé view to compute standardized metrics"
                  onChange={(event) => setForm({ ...form, system_role: event.target.value })}
                >
                  <option value="">(aucun)</option>
                  {SYSTEM_ROLE_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </SelectField>
                <TextareaField
                  id="category-description"
                  label="Description"
                  rows={3}
                  value={form.description}
                  error={errors.description}
                  placeholder="e.g. Accounts for long-term savings and retirement planning"
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setForm(null)}
              disabled={save.isPending}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {form?.id === null ? "Create" : "Update"}
            </button>
          </Modal.Footer>
        </form>
      </Modal>

      <DeleteConfirmModal
        show={pendingDelete !== null}
        title="Delete category"
        confirmLabel="Delete"
        message={
          <>
            Delete <strong>{pendingDelete?.name}</strong>? It has no assets, so
            nothing else is affected.
          </>
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) remove.mutate(pendingDelete);
        }}
      />
    </>
  );
}
