/**
 * Settings > Data.
 *
 * Phase 1b needs the import entry point and the reset; the full settings screen
 * (export at v3, JSON settings export/import, API key section removal) is
 * Phase 6.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/FormCard";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
import { ImportWizard } from "../import/ImportWizard";
import { useToast } from "../../layout/Toasts";
import { resetDatabase } from "../../../db/reset";
import { seedFirstRun } from "../../../db/seed";
import { countAssets } from "../../../db/repositories/assets";
import { countSnapshots } from "../../../db/repositories/snapshots";

export function DataPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const toast = useToast();
  const queryClient = useQueryClient();

  const assets = useQuery({ queryKey: ["assets"], queryFn: countAssets });
  const snapshots = useQuery({ queryKey: ["snapshot-count"], queryFn: countSnapshots });

  const reset = useMutation({
    mutationFn: async () => {
      await resetDatabase();
      // Put the first-run defaults back, so the app is usable immediately.
      await seedFirstRun();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      setResetOpen(false);
      setConfirmation("");
      toast.success("Database reset. Defaults restored.");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  return (
    <>
      <PageHeader
        title="Data"
        subtitle="Import, export and reset the local database."
        icon="hdd-stack"
        showDate={false}
      />

      <div className="row g-4 mb-4">
        <div className="col-md-6">
          <div className="stat-card stat-card-sm accent-primary">
            <div className="stat-label">Assets</div>
            <div className="stat-number">{assets.data ?? "—"}</div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="stat-card stat-card-sm">
            <div className="stat-label">Snapshots</div>
            <div className="stat-number">{snapshots.data ?? "—"}</div>
          </div>
        </div>
      </div>

      <div className="card card-finance mb-4">
        <div className="card-body">
          <h5 className="card-title">
            <i className="bi bi-upload me-2" aria-hidden="true" />
            Import from FinanceTracker
          </h5>
          <p className="text-muted">
            Replace the local database with the contents of a JSON backup. The import
            runs in a single transaction: either everything lands or nothing does.
            This also covers a desktop backup once Phase 6 writes version 3.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setWizardOpen(true)}>
            Import a backup
          </button>
        </div>
      </div>

      <div className="card card-finance">
        <div className="card-body">
          <h5 className="card-title text-danger">
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
            Reset
          </h5>
          <p className="text-muted">
            Deletes every asset, snapshot, institution, category, tag, exchange rate,
            provider, memory, goal and setting, then restores the defaults. Provider
            API keys are removed from the Keychain too. This cannot be undone.
          </p>
          <button type="button" className="btn btn-outline-danger" onClick={() => setResetOpen(true)}>
            Reset the database
          </button>
        </div>
      </div>

      <ImportWizard
        show={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onImported={() => void queryClient.invalidateQueries()}
      />

      <DeleteConfirmModal
        show={resetOpen}
        title="Reset the database"
        confirmLabel="Reset everything"
        message={
          <>
            <p>
              This deletes all local data and cannot be undone. Type{" "}
              <strong>RESET</strong> to confirm.
            </p>
            <input
              className="form-control"
              value={confirmation}
              placeholder="RESET"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </>
        }
        onCancel={() => {
          setResetOpen(false);
          setConfirmation("");
        }}
        onConfirm={() => {
          if (confirmation !== "RESET") {
            toast.warning('Type "RESET" exactly, or cancel.');
            return;
          }
          reset.mutate();
        }}
      />
    </>
  );
}
