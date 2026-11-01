/**
 * Settings > Data.
 *
 * Import (including the desktop app's own v3 backups), export at v3, and the
 * typed-confirmation reset. Settings JSON export/import lives under /settings.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsLayout } from "./SettingsLayout";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
import { ImportWizard } from "../import/ImportWizard";
import { BackupExportCard } from "./BackupExportCard";
import { UpdateCard } from "./UpdateCard";
import { useToast } from "../../layout/Toasts";
import { resetDatabase } from "../../../db/reset";
import { seedFirstRun } from "../../../db/seed";
import { loadSampleData, resetData } from "../../../dev/sampleData";
import { countAssets } from "../../../db/repositories/assets";
import { countSnapshots } from "../../../db/repositories/snapshots";

export function DataPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const toast = useToast();
  const queryClient = useQueryClient();

  // Deliberately not ["assets"]: that key holds AssetRow[] everywhere else, and
  // React Query would hand this count tile a list of objects.
  const assets = useQuery({ queryKey: ["asset-count"], queryFn: countAssets });
  const snapshots = useQuery({ queryKey: ["snapshot-count"], queryFn: countSnapshots });

  const sample = useMutation({
    mutationFn: async () => {
      await resetData();
      await loadSampleData();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast.success("Sample data loaded.");
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
  });

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
    <SettingsLayout
      title="Data & Backup"
      subtitle="Import, export and reset the local database"
      actions={null}
    >
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

      <BackupExportCard />

      <UpdateCard />

      <div className="card card-finance mb-4">
        <div className="card-body">
          <h5 className="card-title">
            <i className="bi bi-upload me-2" aria-hidden="true" />
            Import from FinanceTracker
          </h5>
          <p className="text-muted">
            Replace the local database with the contents of a JSON backup. The import
            runs in a single transaction: either everything lands or nothing does.
            Backups written by this app (version 3) are read the same way.
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

      {import.meta.env.DEV ? (
        <div className="card card-finance mb-4">
          <div className="card-body">
            <h5 className="card-title">
              <i className="bi bi-bug me-2" aria-hidden="true" />
              Sample data <span className="badge bg-secondary ms-1">development builds only</span>
            </h5>
            <p className="text-muted">
              Replaces institutions, categories, assets and snapshots with a small deterministic
              dataset, for screenshots. Not available in release builds.
            </p>
            <button type="button" className="btn btn-outline-secondary" onClick={() => sample.mutate()}>
              Load sample data
            </button>
          </div>
        </div>
      ) : null}

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
    </SettingsLayout>
  );
}
