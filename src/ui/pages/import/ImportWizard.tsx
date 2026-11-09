/**
 * "Import from FinanceTracker" wizard.
 *
 * Steps: pick a file → preview (counts, warnings, blocking errors) → import →
 * map categories to system roles (v2 only) → report.
 *
 * The preview step is deliberately loud about what will *not* be imported: the
 * v2 export has no memories and no goals, and its categories carry no system
 * role. Losing data silently would be worse than refusing.
 */

import { useState } from "react";
import { Modal } from "react-bootstrap";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { parseBackup, type ParsedBackup } from "../../../import/schema";
import { buildImportPlan, type ImportPlan } from "../../../import/plan";
import { executeImport, ImportBlockedError, type ImportResult } from "../../../import/execute";
import { listCategoriesMissingRole, updateCategoryRole } from "../../../db/repositories/categories";
import { SYSTEM_ROLE_CHOICES } from "../../../domain/systemCategory";
import { useToast } from "../../layout/Toasts";

type Step = "pick" | "preview" | "importing" | "roles" | "report";

interface Props {
  show: boolean;
  onClose: () => void;
  onImported?: () => void;
}

const ENTITY_ORDER: Array<[keyof ImportPlan["counts"], string]> = [
  ["institutions", "Institutions"],
  ["categories", "Categories"],
  ["tags", "Tags"],
  ["assets", "Assets"],
  ["snapshots", "Snapshots"],
  ["exchangeRates", "Exchange rates"],
  ["providers", "LLM providers"],
  ["settings", "Settings"],
  ["profile", "Profile"],
  ["memories", "Memories"],
  ["goals", "Goals"],
];

export function ImportWizard({ show, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>("pick");
  const [fileName, setFileName] = useState<string | null>(null);
  const [backup, setBackup] = useState<ParsedBackup | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Array<{ id: number; name: string; role: string }>>([]);

  const toast = useToast();
  const queryClient = useQueryClient();

  const reset = () => {
    setStep("pick");
    setFileName(null);
    setBackup(null);
    setPlan(null);
    setResult(null);
    setError(null);
    setRoles([]);
  };

  const close = () => {
    reset();
    onClose();
  };

  const pickFile = async () => {
    setError(null);
    try {
      // The native dialog is opened by Rust, which reads only what was picked.
      const picked = await invoke<{ name: string; contents: string } | null>(
        "pick_and_read_text_file",
        { filterName: "FinanceTracker backup", extensions: ["json"] },
      );
      if (!picked) return;
      const raw = picked.contents;
      const parsed = parseBackup(raw);
      const nextPlan = buildImportPlan(parsed);

      setFileName(picked.name);
      setBackup(parsed);
      setPlan(nextPlan);
      setStep("preview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const runImport = async () => {
    if (!backup) return;
    setStep("importing");
    setError(null);
    try {
      const imported = await executeImport(backup);
      setResult(imported);

      const missing = await listCategoriesMissingRole();
      if (missing.length > 0) {
        setRoles(missing.map((category) => ({ id: category.id, name: category.name, role: "" })));
        setStep("roles");
      } else {
        setStep("report");
      }

      void queryClient.invalidateQueries();
      toast.success(`Imported ${imported.counts.snapshots} snapshots and ${imported.counts.assets} assets.`);
    } catch (cause) {
      if (cause instanceof ImportBlockedError) {
        setPlan(cause.plan);
        setStep("preview");
      } else {
        setStep("preview");
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveRoles = async () => {
    for (const entry of roles) {
      if (!entry.role) continue;
      await updateCategoryRole(entry.id, entry.role);
    }
    void queryClient.invalidateQueries({ queryKey: ["categories"] });
    onImported?.();
    setStep("report");
  };

  const skipRoles = () => {
    onImported?.();
    setStep("report");
  };

  const blocking = (plan?.errors.length ?? 0) > 0;

  return (
    <Modal show={show} onHide={close} size="lg" centered backdrop="static">
      <Modal.Header closeButton={step !== "importing"}>
        <Modal.Title>
          <i className="bi bi-upload me-2" aria-hidden="true" />
          Import from FinanceTracker
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error ? (
          <div className="alert alert-danger" role="alert">
            <i className="bi bi-x-circle me-2" aria-hidden="true" />
            {error}
          </div>
        ) : null}

        {step === "pick" ? (
          <>
            <p className="text-muted">
              Choose the JSON file produced by FinanceTracker &gt; Settings &gt; Data
              backup. Everything is written in one transaction, and the file is only
              read, never modified.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void pickFile()}>
              <i className="bi bi-folder2-open me-2" aria-hidden="true" />
              Choose a backup file
            </button>
          </>
        ) : null}

        {step === "preview" && plan ? (
          <>
            <p className="mb-3">
              <strong>{fileName}</strong> — backup version {plan.version}
              {plan.exportedAt ? `, exported ${plan.exportedAt.slice(0, 19).replace("T", " ")}` : ""}
            </p>

            {blocking ? (
              <div className="alert alert-danger" role="alert">
                <strong>This file cannot be imported.</strong>
                <ul className="mb-0 mt-2">
                  {plan.errors.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="table-responsive mb-3">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th className="text-end">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {ENTITY_ORDER.filter(([key]) => plan.counts[key] > 0).map(([key, label]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className="text-end">{plan.counts[key]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {plan.warnings.length > 0 ? (
              <div className="alert alert-warning">
                <ul className="mb-0">
                  {plan.warnings.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.notImported.length > 0 ? (
              <div className="alert alert-info">
                <strong>Not included in this backup:</strong>
                <ul className="mb-0">
                  {plan.notImported.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.roundingIssues.length > 0 ? (
              <div className="alert alert-warning">
                <strong>Amounts that are not exact at 2 decimals:</strong>
                <ul className="mb-0">
                  {plan.roundingIssues.slice(0, 10).map((issue) => (
                    <li key={`${issue.entity}-${issue.id}`}>
                      {issue.entity} {issue.id}: {issue.value} → {issue.rounded}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!blocking ? (
              <p className="text-muted small mb-0">
                Importing replaces everything currently in the app. The database holds{" "}
                {plan.counts.assets} assets in this file; any existing local data is deleted first.
              </p>
            ) : null}
          </>
        ) : null}

        {step === "importing" ? (
          <div className="text-center py-4">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Importing…</span>
            </div>
            <p className="text-muted mt-3 mb-0">Writing everything in one transaction…</p>
          </div>
        ) : null}

        {step === "roles" ? (
          <>
            <p className="text-muted">
              This backup has no category system roles — the v2 export does not carry
              them. The Performance view needs them, so map what you can. You can skip and
              reopen this later from Categories.
            </p>
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ width: "45%" }}>System role</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role, index) => (
                    <tr key={role.id}>
                      <td>{role.name}</td>
                      <td>
                        <select
                          className="form-select form-select-sm"
                          value={role.role}
                          onChange={(event) => {
                            const next = [...roles];
                            next[index] = { ...role, role: event.target.value };
                            setRoles(next);
                          }}
                        >
                          <option value="">— not set —</option>
                          {SYSTEM_ROLE_CHOICES.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {step === "report" && result ? (
          <>
            <div className="alert alert-success" role="alert">
              <i className="bi bi-check-circle me-2" aria-hidden="true" />
              <strong>Success!</strong> Import finished in {result.durationMs} ms.
            </div>
            <ul className="mb-0">
              <li>{result.counts.institutions} institutions</li>
              <li>{result.counts.categories} categories</li>
              <li>{result.counts.tags} tags</li>
              <li>{result.counts.assets} assets</li>
              <li>{result.counts.snapshots} snapshots</li>
              <li>{result.counts.exchangeRates} exchange rates</li>
              <li>
                {result.counts.providers} LLM provider
                {result.counts.providers === 1 ? "" : "s"}
                {result.keysToKeychain > 0
                  ? `, ${result.keysToKeychain} API key${result.keysToKeychain === 1 ? "" : "s"} moved to the Keychain`
                  : ""}
              </li>
              <li>{result.counts.settings} settings</li>
              <li>{result.counts.profile} profile</li>
            </ul>
          </>
        ) : null}
      </Modal.Body>

      <Modal.Footer>
        {step === "preview" ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={blocking}
              onClick={() => void runImport()}
            >
              <i className="bi bi-database-fill-down me-2" aria-hidden="true" />
              Import and replace local data
            </button>
          </>
        ) : null}

        {step === "roles" ? (
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={skipRoles}>
              Skip for now
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void saveRoles()}>
              Save roles
            </button>
          </>
        ) : null}

        {step === "report" ? (
          <button type="button" className="btn btn-primary" onClick={close}>
            Done
          </button>
        ) : null}

        {step === "pick" ? (
          <button type="button" className="btn btn-secondary" onClick={close}>
            Cancel
          </button>
        ) : null}
      </Modal.Footer>
    </Modal>
  );
}
