/**
 * "Check for updates" and the install flow.
 *
 * The updater is configured in `tauri.conf.json` against GitHub Releases. A
 * check only reports; installing takes an explicit click, then the app
 * downloads in place, shows progress, and restarts once the download and its
 * signature are verified. Nothing restarts behind the user's back.
 */

import { useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useQuery } from "@tanstack/react-query";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useToast } from "../../layout/Toasts";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "installing"; downloaded: number; total: number | null }
  | { kind: "error"; message: string };

const megabytes = (bytes: number) => (bytes / 1_048_576).toFixed(1);

export function UpdateCard() {
  const toast = useToast();
  const version = useQuery({ queryKey: ["app-version"], queryFn: getVersion });
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const checkNow = async () => {
    setPhase({ kind: "checking" });
    try {
      const update = await check();
      if (!update) {
        toast.success(`You're on the latest version (${version.data ?? "?"}).`);
        setPhase({ kind: "idle" });
      } else {
        setPhase({ kind: "available", update });
      }
    } catch (error) {
      // A missing latest.json is the normal state until a release is published.
      setPhase({
        kind: "error",
        message: `No update feed reachable (${error instanceof Error ? error.message : String(error)}).`,
      });
    }
  };

  const install = async (update: Update) => {
    let downloaded = 0;
    let total: number | null = null;
    setPhase({ kind: "installing", downloaded: 0, total: null });
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            setPhase({ kind: "installing", downloaded: 0, total });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setPhase({ kind: "installing", downloaded, total });
            break;
          default:
            break;
        }
      });
      // install() has replaced the bundle and verified its signature.
      await relaunch();
    } catch (error) {
      setPhase({
        kind: "error",
        message: `The update could not be installed (${error instanceof Error ? error.message : String(error)}).`,
      });
    }
  };

  const busy = phase.kind === "checking" || phase.kind === "installing";
  const percent =
    phase.kind === "installing" && phase.total ? Math.min(100, Math.round((phase.downloaded / phase.total) * 100)) : null;

  return (
    <div className="card card-finance mb-4">
      <div className="card-body">
        <h5 className="card-title">
          <i className="bi bi-arrow-repeat me-2" aria-hidden="true" />
          Updates
        </h5>
        <p className="text-muted mb-3">
          This build is FinanceTracker <strong>{version.data ?? "…"}</strong>. Updates come from this project's
          GitHub Releases and are verified against the app's own signing key before anything is replaced.
        </p>

        {phase.kind === "available" && (
          <div className="alert alert-info py-2">
            <div className="d-flex flex-wrap align-items-center gap-3">
              <span>
                Version <strong>{phase.update.version}</strong> is available.
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void install(phase.update)}>
                <i className="bi bi-download me-2" aria-hidden="true" />
                Install and restart
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPhase({ kind: "idle" })}>
                Later
              </button>
            </div>
          </div>
        )}

        {phase.kind === "installing" && (
          <div className="alert alert-secondary py-2 mb-3">
            <div className="d-flex justify-content-between small mb-1">
              <span>Downloading the update…</span>
              <span>
                {megabytes(phase.downloaded)} MB{phase.total ? ` / ${megabytes(phase.total)} MB` : ""}
              </span>
            </div>
            <div className="progress" role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-bar" style={{ width: percent === null ? "100%" : `${percent}%` }} />
            </div>
            <div className="form-text">The app restarts once the download is verified.</div>
          </div>
        )}

        {phase.kind === "error" && <div className="alert alert-warning py-2">{phase.message}</div>}

        <button type="button" className="btn btn-secondary" onClick={() => void checkNow()} disabled={busy}>
          <i className="bi bi-search me-2" aria-hidden="true" />
          {phase.kind === "checking" ? "Checking…" : "Check for updates"}
        </button>
      </div>
    </div>
  );
}
