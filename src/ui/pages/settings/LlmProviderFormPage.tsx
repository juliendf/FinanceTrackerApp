/**
 * New / edit LLM provider.
 *
 * The endpoint is the thing people get wrong, so it comes first and large, with
 * the common URLs spelled out. The API key is write-only: it goes to the
 * Keychain, never to SQLite, and is never read back into the field.
 *
 * Models are a list, not a text field: "Load models" asks the endpoint what it
 * serves, and each one can be switched on or off. Only the enabled ones appear
 * in the chat's model picker. The provider type is derived from the URL — Gemini
 * differs only in needing its OpenAI-compatible path, which is not a decision
 * worth asking a user to make.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  createProvider,
  deleteProvider,
  getProvider,
  getProviderKey,
  listProviderModels,
  setDefaultProvider,
  updateProvider,
} from "../../../db/repositories/llmProviders";
import { detectProviderType, enabledModels, mergeModelChoices, type ModelChoice } from "../../../domain/providerModels";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
import { useToast } from "../../layout/Toasts";
import { SettingsLayout } from "./SettingsLayout";

const DEFAULT_BASE_URL = "http://localhost:11434/v1";

interface Draft {
  name: string;
  base_url: string;
  model: string;
  is_active: boolean;
  is_default: boolean;
}

const EMPTY: Draft = {
  name: "",
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
  const savedModels = useQuery({
    queryKey: ["llm-provider-models", id],
    queryFn: () => listProviderModels(id as number),
    enabled: id !== null,
  });

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [apiKey, setApiKey] = useState("");
  const [choices, setChoices] = useState<ModelChoice[]>([]);
  /** True once the endpoint has been asked at least once on this visit. */
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const autoLoaded = useRef(false);

  useEffect(() => {
    if (!existing.data) return;
    setDraft({
      name: existing.data.name,
      base_url: existing.data.base_url,
      model: existing.data.model,
      is_active: existing.data.is_active === 1,
      is_default: existing.data.is_default === 1,
    });
  }, [existing.data]);

  // Show what is saved before (or without) asking the endpoint again.
  useEffect(() => {
    if (!savedModels.data || loaded) return;
    if (savedModels.data.length === 0) return;
    setChoices(
      savedModels.data.map((row) => ({ model: row.model, enabled: row.enabled === 1 })),
    );
  }, [savedModels.data, loaded]);

  const gemini = useMemo(() => detectProviderType(draft.base_url) === "gemini", [draft.base_url]);
  const providerType = gemini ? "gemini" : "openai";
  const enabled = enabledModels(choices);

  const refresh = () => {
    for (const key of ["llm-providers", "llm-provider", "llm-provider-models", "settings"]) {
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

  /** Ask the endpoint for its models and merge them with what is saved. */
  const loadModels = async ({ silent = false }: { silent?: boolean } = {}) => {
    setBusy("models");
    try {
      const fetched = await invoke<string[]>("list_models", {
        baseUrl: draft.base_url,
        apiKey: await keyForCheck(),
      });
      const saved = (savedModels.data ?? []).map((row) => ({ model: row.model, enabled: row.enabled === 1 }));
      const merged = mergeModelChoices(fetched, choices.length > 0 ? choices : saved, draft.model);
      setChoices(merged);
      setLoaded(true);
      if (!draft.model && merged.some((choice) => choice.enabled)) {
        setDraft((current) => ({ ...current, model: merged.find((choice) => choice.enabled)!.model }));
      }
      if (!silent) {
        if (fetched.length === 0) toast.warning("That endpoint advertises no models.");
        else toast.success(`Loaded ${fetched.length} model${fetched.length === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      if (silent) return; // opening the form should not shout when offline
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  // On an existing provider, ask once so the list is there without a click.
  useEffect(() => {
    if (id === null || !existing.data || autoLoaded.current) return;
    autoLoaded.current = true;
    void loadModels({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, existing.data]);

  const setAll = (value: boolean) => setChoices(choices.map((choice) => ({ ...choice, enabled: value })));

  const save = (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!draft.name.trim()) found.name = "Provider name is required";
    else if (draft.name.length > 50) found.name = "Name must be at most 50 characters";
    if (!draft.base_url.trim()) found.base_url = "Base URL is required";
    else if (!/^https?:\/\/\S+$/.test(draft.base_url.trim())) found.base_url = "Must be a valid URL";
    if (!draft.model.trim()) found.model = "Choose a default model";
    if (choices.length > 0 && enabled.length === 0) found.model = "Enable at least one model";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input = {
      name: draft.name.trim(),
      base_url: draft.base_url.trim(),
      model: draft.model.trim(),
      provider_type: providerType,
      is_active: draft.is_active,
      // With nothing loaded, keep whatever rows already exist.
      models: loaded || choices.length > 0 ? choices : undefined,
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
    setConfirmDelete(false);
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
        <>
          <button type="submit" form="provider-form" className="btn btn-primary btn-sm">
            <i className="bi bi-check-lg me-2" aria-hidden="true" />
            Save
          </button>
          <Link to="/settings/llm-providers" className="btn btn-secondary btn-sm">
            <i className="bi bi-arrow-left" aria-hidden="true" />
            Back
          </Link>
        </>
      }
    >
      <form onSubmit={save} noValidate className="provider-form" id="provider-form">
        <div className="form-section">
          <h5 className="mb-3"><i className="bi bi-hdd-network me-2" aria-hidden="true" />Endpoint</h5>
          <div className="row">
            <div className="col-lg-8 mb-3">
              <label htmlFor="base_url" className="form-label">Base URL</label>
              <input
                id="base_url"
                type="url"
                className={`form-control font-monospace${errors.base_url ? " is-invalid" : ""}`}
                value={draft.base_url}
                onChange={(event) => setDraft({ ...draft, base_url: event.target.value })}
                placeholder={DEFAULT_BASE_URL}
              />
              {errors.base_url ? <div className="invalid-feedback d-block">{errors.base_url}</div> : null}
              <div className="form-text">
                Ollama <code>http://localhost:11434/v1</code> · LM Studio <code>http://localhost:1234/v1</code> · OpenAI{" "}
                <code>https://api.openai.com/v1</code> · Gemini{" "}
                <code>https://generativelanguage.googleapis.com/v1beta/openai</code>
                {gemini ? <span className="d-block mt-1">Gemini detected: requests use its OpenAI-compatible path.</span> : null}
              </div>
            </div>
            <div className="col-lg-4 mb-3">
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
              <div className="form-text">Shown in the chat header.</div>
            </div>
          </div>

          <div className="row">
            <div className="col-lg-8 mb-3">
              <label htmlFor="api_key" className="form-label">API Key</label>
              <input
                id="api_key"
                type="password"
                className="form-control font-monospace"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={existing.data?.keychain_ref ? "•••••• (stored in Keychain)" : "Not needed for Ollama or LM Studio"}
                autoComplete="off"
              />
              <div className="form-text">
                {existing.data?.keychain_ref
                  ? "Leave empty to keep the stored key."
                  : "Goes to the macOS Keychain, never to the database."}
              </div>
            </div>
            <div className="col-lg-4 mb-3 d-flex align-items-end">
              <button
                type="button"
                className="btn btn-secondary w-100"
                disabled={busy !== null}
                onClick={() => void testConnection()}
              >
                <i className="bi bi-plug me-2" aria-hidden="true" />
                Test connection
              </button>
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="d-flex flex-wrap justify-content-between align-items-center mb-2 gap-2">
            <h5 className="mb-0"><i className="bi bi-cpu me-2" aria-hidden="true" />Models</h5>
            <div className="d-flex gap-2">
              {choices.length > 0 ? (
                <>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setAll(true)}>
                    Enable all
                  </button>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setAll(false)}>
                    Disable all
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null}
                onClick={() => void loadModels()}
              >
                <i className="bi bi-arrow-repeat me-2" aria-hidden="true" />
                {choices.length > 0 ? "Reload list" : "Load models"}
              </button>
            </div>
          </div>
          <p className="form-text mt-0">
            “Load models” asks <code>{draft.base_url.replace(/\/+$/, "")}/models</code> what it serves. Only the
            models you enable appear in the chat's model picker; the default below is what it starts on.
          </p>

          {choices.length === 0 ? (
            <div className="mb-3">
              <label htmlFor="model" className="form-label">Model</label>
              <input
                id="model"
                className={`form-control font-monospace${errors.model ? " is-invalid" : ""}`}
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                placeholder="qwen3.5:4b"
                maxLength={100}
              />
              {errors.model ? <div className="invalid-feedback d-block">{errors.model}</div> : null}
              <div className="form-text">
                Type the id, or load the list to choose from. Some endpoints (notably proxies) do not advertise models.
              </div>
            </div>
          ) : (
            <>
              <div className="provider-model-list" role="group" aria-label="Available models">
                {choices.map((choice) => (
                  <label className="provider-model-row" key={choice.model}>
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={choice.enabled}
                      onChange={(event) =>
                        setChoices(
                          choices.map((item) =>
                            item.model === choice.model ? { ...item, enabled: event.target.checked } : item,
                          ),
                        )
                      }
                    />
                    <span className="provider-model-id font-monospace">{choice.model}</span>
                  </label>
                ))}
              </div>
              <p className="form-text">
                {enabled.length} of {choices.length} enabled.
              </p>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="model" className="form-label">Default model</label>
                  <select
                    id="model"
                    className={`form-select font-monospace${errors.model ? " is-invalid" : ""}`}
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  >
                    {enabled.includes(draft.model) ? null : <option value={draft.model}>{draft.model || "—"}</option>}
                    {enabled.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                  {errors.model ? <div className="invalid-feedback d-block">{errors.model}</div> : null}
                </div>
              </div>
            </>
          )}

          <div className="form-check mb-2">
            <input
              id="is_default"
              type="checkbox"
              className="form-check-input"
              checked={draft.is_default}
              onChange={(event) => setDraft({ ...draft, is_default: event.target.checked })}
            />
            <label htmlFor="is_default" className="form-check-label">Set as default provider</label>
            <div className="form-text">New conversations start on the default provider.</div>
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
            <div className="form-text">Inactive providers are hidden from the chat.</div>
          </div>
        </div>

        <div className="provider-form-actions">
          <div className="d-flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary">
              <i className="bi bi-check-lg me-2" aria-hidden="true" />
              Save Provider
            </button>
            <Link to="/settings/llm-providers" className="btn btn-secondary">Cancel</Link>
          </div>
          {id !== null ? (
            <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmDelete(true)}>
              <i className="bi bi-trash me-2" aria-hidden="true" />
              Delete
            </button>
          ) : null}
        </div>
      </form>

      <DeleteConfirmModal
        show={confirmDelete}
        title="Delete provider"
        message="Delete this provider? Its API key is removed from the Keychain too."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </SettingsLayout>
  );
}
