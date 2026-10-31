/**
 * Tags list — port of `templates/tags/list.html` and `routes/tags.py`.
 *
 * Unlike institutions and categories, a tag *can* be deleted while assets use
 * it: `tag_delete` removes the association from every asset first, which the
 * `asset_tags` cascade does here.
 */

import { useState } from "react";
import { Modal } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/FormCard";
import { DataTable, type Column } from "../../components/DataTable";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
import { TagBadge } from "../../components/SearchFilter";
import { TextField } from "../../components/Field";
import { useToast } from "../../layout/Toasts";
import {
  createTag,
  deleteTag,
  listTagsWithCounts,
  tagNameExists,
  updateTag,
  type TagWithCount,
} from "../../../db/repositories/tags";
import { tagSchema } from "../../../domain/referenceData";

const KEY = ["tags"] as const;

interface FormState {
  id: number | null;
  name: string;
  color: string;
}

const EMPTY: FormState = { id: null, name: "", color: "#6c757d" };

export function TagsPage() {
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<TagWithCount | null>(null);

  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: listTagsWithCounts });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: KEY });

  const save = useMutation({
    mutationFn: async (state: FormState) => {
      const parsed = tagSchema.safeParse({ name: state.name, color: state.color });
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
        throw Object.assign(new Error("validation"), { fieldErrors });
      }

      if (await tagNameExists(parsed.data.name, state.id ?? undefined)) {
        throw Object.assign(new Error("validation"), {
          fieldErrors: { name: "Tag name must be unique." },
        });
      }

      const color = parsed.data.color || null;
      if (state.id === null) {
        await createTag(parsed.data.name, color);
      } else {
        await updateTag(state.id, parsed.data.name, color);
      }
      return state;
    },
    onSuccess: (state) => {
      invalidate();
      setForm(null);
      setErrors({});
      toast.success(
        `Tag ${state.id === null ? "created" : "updated"} successfully.`,
      );
    },
    onError: (error: unknown) => {
      const fieldErrors = (error as { fieldErrors?: Record<string, string> }).fieldErrors;
      if (fieldErrors) setErrors(fieldErrors);
      else toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const remove = useMutation({
    mutationFn: (target: TagWithCount) => deleteTag(target.id),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      setPendingDelete(null);
      toast.success("Tag deleted successfully.");
    },
    onError: (error: unknown) => {
      setPendingDelete(null);
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const columns: Array<Column<TagWithCount>> = [
    {
      key: "name",
      label: "Tag",
      sortable: true,
      render: (row) => <TagBadge name={row.name} color={row.color} />,
    },
    { key: "asset_count", label: "Assets", sortable: true },
  ];

  return (
    <>
      <PageHeader
        title="Tags"
        subtitle="Free-form labels attached to assets."
        icon="bookmark"
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
            New tag
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
              tableId="tags-table"
              emptyMessage="No tags yet"
              actions={(row) => (
                <div className="btn-group btn-group-sm" role="group">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    title="Edit"
                    aria-label={`Edit ${row.name}`}
                    onClick={() => {
                      setErrors({});
                      setForm({ id: row.id, name: row.name, color: row.color ?? "#6c757d" });
                    }}
                  >
                    <i className="bi bi-pencil-square" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    title="Delete"
                    aria-label={`Delete ${row.name}`}
                    onClick={() => setPendingDelete(row)}
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
            <Modal.Title>{form?.id === null ? "New Tag" : "Edit Tag"}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {form ? (
              <>
                <TextField
                  id="tag-name"
                  label="Tag Name"
                  value={form.name}
                  error={errors.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
                <div className="mb-3">
                  <label htmlFor="tag-color" className="form-label">
                    Color (hex)
                  </label>
                  <div className="d-flex align-items-center gap-2">
                    <input
                      id="tag-color"
                      type="color"
                      className="form-control form-control-color"
                      value={/^#[0-9A-Fa-f]{6}$/.test(form.color) ? form.color : "#6c757d"}
                      onChange={(event) => setForm({ ...form, color: event.target.value })}
                    />
                    <input
                      className={`form-control${errors.color ? " is-invalid" : ""}`}
                      aria-label="Colour hex code"
                      value={form.color}
                      onChange={(event) => setForm({ ...form, color: event.target.value })}
                    />
                  </div>
                  <div className="form-text">Hex code for tag badge (e.g., #FF0000)</div>
                  {errors.color ? <div className="invalid-feedback d-block">{errors.color}</div> : null}
                </div>
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
              Save
            </button>
          </Modal.Footer>
        </form>
      </Modal>

      <DeleteConfirmModal
        show={pendingDelete !== null}
        title="Delete tag"
        confirmLabel="Delete"
        message={
          <>
            Delete <strong>{pendingDelete?.name}</strong>?
            {pendingDelete && pendingDelete.asset_count > 0 ? (
              <> It is attached to {pendingDelete.asset_count} asset
                {pendingDelete.asset_count === 1 ? "" : "s"}; those links are removed
                and the assets themselves are kept.</>
            ) : null}
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
