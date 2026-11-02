/**
 * Institutions list.
 *
 *   * names are unique, and a duplicate is reported on the field;
 *   * deletion is refused while assets reference the institution (the count is
 *     checked first and an error shown).
 */

import { useState } from "react";
import { Modal } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/FormCard";
import { DataTable, type Column } from "../../components/DataTable";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
import { TextField, TextareaField } from "../../components/Field";
import { useToast } from "../../layout/Toasts";
import {
  createInstitution,
  deleteInstitution,
  institutionNameExists,
  listInstitutionsWithCounts,
  updateInstitution,
  type InstitutionWithCount,
} from "../../../db/repositories/institutions";
import { institutionSchema } from "../../../domain/referenceData";

const KEY = ["institutions"] as const;

interface FormState {
  id: number | null;
  name: string;
  description: string;
}

const EMPTY: FormState = { id: null, name: "", description: "" };

export function InstitutionsPage() {
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<InstitutionWithCount | null>(null);

  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: listInstitutionsWithCounts });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: KEY });

  const save = useMutation({
    mutationFn: async (state: FormState) => {
      const parsed = institutionSchema.safeParse({
        name: state.name,
        description: state.description,
      });
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
        throw Object.assign(new Error("validation"), { fieldErrors });
      }

      const duplicate = await institutionNameExists(
        parsed.data.name,
        state.id ?? undefined,
      );
      if (duplicate) {
        throw Object.assign(new Error("validation"), {
          fieldErrors: { name: "An institution with this name already exists." },
        });
      }

      const description = parsed.data.description || null;
      if (state.id === null) {
        await createInstitution(parsed.data.name, description);
      } else {
        await updateInstitution(state.id, parsed.data.name, description);
      }
      return state;
    },
    onSuccess: (state) => {
      invalidate();
      setForm(null);
      setErrors({});
      toast.success(
        `Institution "${state.name.trim()}" ${state.id === null ? "created" : "updated"} successfully!`,
      );
    },
    onError: (error: unknown) => {
      const fieldErrors = (error as { fieldErrors?: Record<string, string> }).fieldErrors;
      if (fieldErrors) setErrors(fieldErrors);
      else toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const remove = useMutation({
    mutationFn: (target: InstitutionWithCount) => deleteInstitution(target.id),
    onSuccess: () => {
      invalidate();
      setPendingDelete(null);
      toast.success("Institution deleted successfully!");
    },
    onError: (error: unknown) => {
      setPendingDelete(null);
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const columns: Array<Column<InstitutionWithCount>> = [
    { key: "name", label: "Name", sortable: true },
    {
      key: "description",
      label: "Description",
      render: (row) => row.description ?? "—",
    },
    { key: "asset_count", label: "Assets", sortable: true },
  ];

  const openNew = () => {
    setErrors({});
    setForm(EMPTY);
  };

  const openEdit = (row: InstitutionWithCount) => {
    setErrors({});
    setForm({ id: row.id, name: row.name, description: row.description ?? "" });
  };

  const requestDelete = (row: InstitutionWithCount) => {
    if (row.asset_count > 0) {
      // `delete_institution` refuses and explains, rather than cascading.
      toast.error(
        `Cannot delete institution "${row.name}" - it has ${row.asset_count} associated asset${row.asset_count === 1 ? "" : "s"}. Please delete or reassign these assets first.`,
      );
      return;
    }
    setPendingDelete(row);
  };

  return (
    <>
      <PageHeader
        title="Institutions"
        subtitle="Banks and brokers your assets belong to."
        icon="building"
        showDate={false}
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={openNew}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            New institution
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
              tableId="institutions-table"
              emptyMessage="No institutions yet"
              actions={(row) => (
                <div className="btn-group btn-group-sm" role="group">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    title="Edit"
                    aria-label={`Edit ${row.name}`}
                    onClick={() => openEdit(row)}
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
              {form?.id === null ? "Add New Institution" : "Edit Institution"}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {form ? (
              <>
                <TextField
                    id="institution-name"
                    label="Institution Name"
                    value={form.name}
                    error={errors.name}
                    help="Name of the financial institution (bank, investment firm, etc.)"
                    placeholder="e.g. UBS"
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
                <TextareaField
                    id="institution-description"
                    label="Description"
                    rows={3}
                    value={form.description}
                    error={errors.description}
                    help="Optional description or notes about this institution"
                    placeholder="e.g. Main bank for checking and savings accounts"
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
        title="Delete institution"
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
