/**
 * First-run screen — shown while the database holds no assets.
 *
 * Two honest choices: start empty, or import a backup. Importing is the
 * recommended path because it lands the user with real data to work with.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/FormCard";
import { ImportWizard } from "../import/ImportWizard";

export function FirstRunPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Welcome to FinanceTracker"
        subtitle="This is the desktop edition. Pick where your data comes from."
        icon="piggy-bank"
        showDate={false}
      />

      <div className="row g-4">
        <div className="col-lg-6">
          <div className="card card-finance h-100">
            <div className="card-body d-flex flex-column">
              <h5 className="card-title">
                <i className="bi bi-upload me-2" aria-hidden="true" />
                Import a backup
              </h5>
              <p className="text-muted flex-grow-1">
                Bring existing data across from a JSON backup. Institutions, categories, tags, assets, snapshots,
                rates, providers, settings and profile are imported. Provider API keys move to the macOS Keychain.
              </p>
              <button
                type="button"
                className="btn btn-primary align-self-start"
                onClick={() => setWizardOpen(true)}
              >
                Import a backup
              </button>
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card card-finance h-100">
            <div className="card-body d-flex flex-column">
              <h5 className="card-title">
                <i className="bi bi-plus-circle me-2" aria-hidden="true" />
                Start empty
              </h5>
              <p className="text-muted flex-grow-1">
                Begin with a clean database. The default settings, the six EUR/USD/CHF
                exchange rates and one key-less LLM provider are already in place, so
                you can create institutions, categories and assets straight away.
              </p>
              <button
                type="button"
                className="btn btn-outline-secondary align-self-start"
                onClick={() => navigate("/assets")}
              >
                Go to assets
              </button>
            </div>
          </div>
        </div>
      </div>

      <ImportWizard
        show={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onImported={() => navigate("/")}
      />
    </>
  );
}
