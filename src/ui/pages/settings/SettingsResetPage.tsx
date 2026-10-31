/**
 * Reset settings to defaults: port of `settings/reset.html` and `reset_confirm`.
 *
 * The source requires a checkbox, then deletes the settings rows so the defaults
 * apply again. Data is untouched.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resetSettings } from "../../../db/repositories/settings";
import { useToast } from "../../layout/Toasts";
import { SettingsLayout } from "./SettingsLayout";

export function SettingsResetPage() {
  const [confirmed, setConfirmed] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const reset = useMutation({
    mutationFn: resetSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("All settings have been reset to defaults.");
      navigate("/settings");
    },
    onError: (error: unknown) =>
      toast.error(`Error resetting settings: ${error instanceof Error ? error.message : String(error)}`),
  });

  return (
    <SettingsLayout title="Reset Settings" subtitle="Restore all settings to their default values" actions={null}>
      <div className="card card-finance">
        <div className="card-body">
          <div className="text-center mb-3">
            <i className="bi bi-exclamation-triangle text-warning" style={{ fontSize: "3rem" }} aria-hidden="true" />
          </div>
          <h4 className="text-center mb-4">Are you sure you want to reset all settings?</h4>
          <div className="alert alert-warning">
            <h6 className="alert-heading">
              <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
              Warning
            </h6>
            <p className="mb-2">This action will:</p>
            <ul className="mb-0">
              <li>Reset all application settings to their default values</li>
              <li>Remove any custom preferences you have configured</li>
              <li>This action cannot be undone</li>
            </ul>
          </div>
          <div className="alert alert-info">
            <i className="bi bi-info-circle me-2" aria-hidden="true" />
            Your assets, snapshots and exchange rates are not touched. Consider{" "}
            <Link to="/settings/export">exporting your current settings</Link> first.
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (confirmed) reset.mutate();
            }}
          >
            <div className="form-check mb-3">
              <input
                id="confirm_reset"
                type="checkbox"
                className="form-check-input"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <label htmlFor="confirm_reset" className="form-check-label">
                I understand this will reset all settings to defaults
              </label>
            </div>
            <div className="d-flex gap-2">
              <button type="submit" className="btn btn-danger" disabled={!confirmed || reset.isPending}>
                <i className="bi bi-arrow-counterclockwise me-2" aria-hidden="true" />
                Reset All Settings
              </button>
              <Link to="/settings" className="btn btn-outline-secondary">Cancel</Link>
            </div>
          </form>
        </div>
      </div>
    </SettingsLayout>
  );
}
