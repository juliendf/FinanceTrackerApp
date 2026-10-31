/**
 * "Check for updates" — the updater plugin's only UI.
 *
 * The updater is configured in `tauri.conf.json` against GitHub Releases. This
 * card checks and reports; it deliberately does not install on its own, because
 * the build is not yet signed with a Developer ID and an unattended restart
 * would be a surprise.
 */

import { useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useQuery } from "@tanstack/react-query";
import { check } from "@tauri-apps/plugin-updater";
import { useToast } from "../../layout/Toasts";

export function UpdateCard() {
  const toast = useToast();
  const version = useQuery({ queryKey: ["app-version"], queryFn: getVersion });
  const [busy, setBusy] = useState(false);

  const checkNow = async () => {
    setBusy(true);
    try {
      const update = await check();
      if (!update) {
        toast.success(`You're on the latest version (${version.data ?? "?"}).`);
      } else {
        toast.info(`Version ${update.version} is available. Download it from the releases page.`);
      }
    } catch (error) {
      // A missing latest.json is the normal state until the first release exists.
      toast.warning(
        `No update feed reachable yet (${error instanceof Error ? error.message : String(error)}). ` +
          "Publishing releases is documented in docs/RELEASE.md.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-finance mb-4">
      <div className="card-body">
        <h5 className="card-title">
          <i className="bi bi-arrow-repeat me-2" aria-hidden="true" />
          Updates
        </h5>
        <p className="text-muted mb-3">
          This build is FinanceTracker <strong>{version.data ?? "…"}</strong>. Updates come from this project's
          GitHub Releases; nothing is downloaded without you asking.
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => void checkNow()} disabled={busy}>
          <i className="bi bi-search me-2" aria-hidden="true" />
          Check for updates
        </button>
      </div>
    </div>
  );
}
