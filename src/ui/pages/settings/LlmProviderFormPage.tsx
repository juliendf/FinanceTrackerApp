/**
 * New / edit LLM provider: port of `settings/llm_provider_form.html`.
 *
 * The endpoint is the thing people get wrong, so it is shown first and large,
 * with the common URLs spelled out. The API key is write-only: it goes to the
 * Keychain, is never read back into the field, and is never written to SQLite.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  createProvider,
  deleteProvider,
  getProvider,
  getProviderKey,
  setDefaultProvider,
  updateProvider,
  PROVIDER_TYPES,
} from "../../../db/repositories/llmProviders";
import { useToast } from "../../layout/Toasts";
import { SettingsLayout } from "./SettingsLayout";

const DEFAULT_BASE_URL = "http://localhost:11434/v1";

interface Draft {
  name: string;
  provider_type: string;
  base_url: string;
  model: string;
  is_active: boolean;
  is_default: boolean;
}

const EMPTY: Draft = {
  name: "",
  provider_type: "openai",
  base_url: DEFAULT_BASE_URL,
  model: "",
  is_active: true,
  is_default: false,
};

export function LlmProviderFormPage() {
  const { providerId } = useParams();
  const id = providerId ? Number(providerId) : null;
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const existing = useQuery({
    queryKey: ["llm-provider", id],
    queryFn: () => getProvider(id as number),
    enabled: id !== null,
  });

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!existing.data) return;
    setDraft({
      name: existing.data.name,
      provider_type: existing.data.provider_type,
      base_url: existing.data.base_url,
      model: existing.data.model,
      is_active: existing.data.is_active === 1,
      is_default: existing.data.is_default === 1,
    });
  }, [existing.data]);

  const refresh = () => {
    for (const key of ["llm-providers", "llm-provider", "settings"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const keyForCheck = async (): Promise<string | null> => {
    if (apiKey.trim()) return apiKey.trim();
    if (existing.data) return getProviderKey(existing.data);
    return null;
  };

  const testConnection = async () => {
    setBusy("test");
    try {
      const message = await invoke<string>("test_connection", {
        baseUrl: draft.base_url,
        apiKey: await keyForCheck(),
      });
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const fetchModels = async () => {
    setBusy("models");
    try {
      const list = await invoke<string[]>("list_models", {
        baseUrl: draft.base_url,
        apiKey: await keyForCheck(),
      });
      setModels(list);
      if (list.length === 0) toast.warning("That endpoint advertises no models.");
      else if (!draft.model) setDraft({ ...draft, model: list[0] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!draft.name.trim()) found.name = "Provider name is required";
    else if (draft.name.length > 50) found.name = "Name must be at most 50 characters";
    if (!draft.base_url.trim()) found.base_url = "Base URL is required";
    else if (!/^https?:\/\/\S+$/.test(draft.base_url.trim())) found.base_url = "Must be a valid URL";
    if (!draft.model.trim()) found.model = "Model name is required";
    else if (draft.model.length > 100) found.model = "Model name must be at most 100 characters";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input = {
      name: draft.name.trim(),
      base_url: draft.base_url.trim().replace(/\/+$/, ""),
      model: draft.model.trim(),
      provider_type: draft.provider_type,
      is_active: draft.is_active,
    };

    const mutation = async () => {
      if (id === null) {
        const newId = await createProvider(input, apiKey.trim() || undefined);
        if (draft.is_default) await setDefaultProvider(newId);
        toast.success(`LLM provider "${input.name}" created successfully!`);
      } else {
        await updateProvider(id, input, apiKey.trim() || undefined);
        if (draft.is_default) await setDefaultProvider(id);
        toast.success(`LLM provider "${input.name}" updated successfully!`);
      }
      refresh();
      navigate("/settings/llm-providers");
    };

    void mutation().catch((error: unknown) =>
      toast.error(`Error saving provider: ${error instanceof Error ? error.message : String(error)}`),
    );
  };

  const remove = async () => {
    if (id === null) return;
    if (!confirm("Delete this provider? Its API key is removed from the Keychain too.")) return;
    try {
      await deleteProvider(id);
      refresh();
      toast.success("Provider deleted.");
      navigate("/settings/llm-providers");
    } catch (error) {
      toast.error(String(error));
    }
  };

  if (id !== null && existing.isLoading) return <p className="text-muted">Loading…</p>;
  if (id !== null && !existing.data) {
    return (
      <div className="alert alert-warning">
        Provider not found. <Link to="/settings/llm-providers">Back to providers</Link>
      </div>
    );
  }

  return (
    <SettingsLayout
      title={id === null ? "New LLM Provider" : "Edit LLM Provider"}
      subtitle="Chat requests go to this endpoint. The key is stored in the macOS Keychain, never in the database."
      actions={
        <Link to="/settings/llm-providers" className="btn btn-secondary btn-sm">
          <i className="bi bi-arrow-left" aria-hidden="true" />
          Back
        </Link>
      }
    >
      <form onSubmit={save} noValidate>
        <div className="form-section">
          <h5 className="mb-3"><i className="bi bi-hdd-network me-2" aria-hidden="true" />Endpoint</h5>
          <div className="mb-3">
            <label htmlFor="base_url" className="form-label">Base URL</label>
            <input
              id="base_url"
              type="url"
              className={`form-control form-control-lg font-monospace${errors.base_url ? " is-invalid" : ""}`}
              value={draft.base_url}
              onChange={(event) => setDraft({ ...draft, base_url: event.target.value })}
              placeholder={DEFAULT_BASE_URL}
            />
            {errors.base_url ? <div className="invalid-feedback d-block">{errors.base_url}</div> : null}
            <div className="form-text">
              Ollama <code>http://localhost:11434/v1</code> · LM Studio <code>http://localhost:1234/v1</code> · OpenAI{" "}
              <code>https://api.openai.com/v1</code> · Gemini{" "}
              <code>https://generativelanguage.googleapis.com/v1beta/openai</code>
            </div>
          </div>
          <div className="row">
            <div className="col-md-6 mb-3">
              <label htmlFor="provider_type" className="form-label">Provider Type</label>
              <select
                id="provider_type"
                className="form-select"
                value={draft.provider_type}
                onChange={(event) => setDraft({ ...draft, provider_type: event.target.value })}
              >
                {PROVIDER_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
              <div className="form-text">Use OpenAI-compatible for Ollama and LM Studio.</div>
            </div>
            <div className="col-md-6 mb-3">
              <label htmlFor="api_key" className="form-label">API Key</label>
              <input
                id="api_key"
                type="password"
                className="form-control"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={existing.data?.keychain_ref ? "•••••• (stored in Keychain)" : "Not needed for Ollama"}
                autoComplete="off"
              />
              <div className="form-text">
                {existing.data?.keychain_ref
                  ? "Leave empty to keep the stored key."
                  : "Goes to the macOS Keychain, never to the database."}
              </div>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void testConnection()}>
              <i className="bi bi-plug me-2" aria-hidden="true" />
              Test connection
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void fetchModels()}>
              <i className="bi bi-cloud-download me-2" aria-hidden="true" />
              Fetch models
            </button>
          </div>
        </div>

        <div className="form-section">
          <h5 className="mb-3"><i className="bi bi-cpu me-2" aria-hidden="true" />Model</h5>
          <div className="row">
            <div className="col-md-6 mb-3">
              <label htmlFor="name" className="form-label">Name</label>
              <input
                id="name"
                className={`form-control${errors.name ? " is-invalid" : ""}`}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Ollama local"
                maxLength={50}
              />
              {errors.name ? <div className="invalid-feedback d-block">{errors.name}</div> : null}
              <div className="form-text">A friendly name, shown in the chat header.</div>
            </div>
            <div className="col-md-6 mb-3">
              <label htmlFor="model" className="form-label">Model</label>
              <input
                id="model"
                className={`form-control font-monospace${errors.model ? " is-invalid" : ""}`}
                value={draft.model}
                list="model-options"
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                placeholder="qwen2.5:7b"
                maxLength={100}
              />
              <datalist id="model-options">
                {models.map((model) => <option key={model} value={model} />)}
              </datalist>
              {errors.model ? <div className="invalid-feedback d-block">{errors.model}</div> : null}
              <div className="form-text">e.g. <code>qwen2.5:7b</code>, <code>gpt-4o-mini</code>, <code>gemini-2.5-flash</code></div>
            </div>
          </div>
          <div className="form-check mb-2">
            <input
              id="is_default"
              type="checkbox"
              className="form-check-input"
              checked={draft.is_default}
              onChange={(event) => setDraft({ ...draft, is_default: event.target.checked })}
            />
            <label htmlFor="is_default" className="form-check-label">Set as default provider</label>
            <div className="form-text">The default is preselected in the chat.</div>
          </div>
          <div className="form-check">
            <input
              id="is_active"
              type="checkbox"
              className="form-check-input"
              checked={draft.is_active}
              onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
            />
            <label htmlFor="is_active" className="form-check-label">Active</label>
            <div className="form-text">Inactive providers are hidden from the chat dropdown.</div>
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2 mt-4 pt-3 border-top">
          <button type="submit" className="btn btn-primary">
            <i className="bi bi-check-lg me-2" aria-hidden="true" />
            Save Provider
          </button>
          <Link to="/settings/llm-providers" className="btn btn-secondary">Cancel</Link>
          {id !== null ? (
            <button type="button" className="btn btn-outline-danger ms-auto" onClick={() => void remove()}>
              <i className="bi bi-trash me-2" aria-hidden="true" />
              Delete
            </button>
          ) : null}
        </div>
      </form>
    </SettingsLayout>
  );
}
