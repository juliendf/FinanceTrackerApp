/**
 * LLM providers list: port of `settings/llm_providers.html` and its routes.
 *
 * Also hosts the global `llm_timeout` setting (`LLMConfigForm` in the source).
 * Test and fetch-models go through Rust, so the key never has to leave the
 * Keychain for a check.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  deleteProvider,
  getProviderKey,
  listProviders,
  setDefaultProvider,
} from "../../../db/repositories/llmProviders";
import { setSetting } from "../../../db/repositories/settings";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
import { useToast } from "../../layout/Toasts";
import { SettingsLayout } from "./SettingsLayout";

export function LlmProvidersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["llm-providers"], queryFn: listProviders });
  const [testing, setTesting] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const [timeoutValue, setTimeoutValue] = useState<string>("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["llm-providers"] });
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
  };

  const makeDefault = useMutation({
    mutationFn: (id: number) => setDefaultProvider(id),
    onSuccess: () => {
      refresh();
      toast.success("Default provider updated.");
    },
    onError: (error: unknown) => toast.error(String(error)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteProvider(id),
    onSuccess: () => {
      refresh();
      toast.success("Provider deleted.");
    },
    onError: (error: unknown) => toast.error(String(error)),
  });

  const test = async (id: number) => {
    const provider = (providers.data ?? []).find((row) => row.id === id);
    if (!provider) return;
    setTesting(id);
    try {
      const key = await getProviderKey(provider);
      const message = await invoke<string>("test_connection", { baseUrl: provider.base_url, apiKey: key });
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(null);
    }
  };

  const saveTimeout = useMutation({
    mutationFn: (value: string) => setSetting("llm_timeout", value),
    onSuccess: () => {
      refresh();
      toast.success("Timeout saved.");
    },
    onError: (error: unknown) => toast.error(String(error)),
  });

  return (
    <SettingsLayout
      title="LLM Providers"
      subtitle="Where chat sends its requests. Keys stay in your macOS Keychain."
      actions={
        <Link to="/settings/llm-providers/new" className="btn btn-primary btn-sm">
          <i className="bi bi-plus-lg" aria-hidden="true" />
          New Provider
        </Link>
      }
    >
      {providers.isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : (providers.data ?? []).length === 0 ? (
        <div className="card card-finance mb-4">
          <div className="empty-state">
            <i className="bi bi-cpu empty-state-icon" aria-hidden="true" />
            <p className="empty-state-title mb-0">No provider configured</p>
            <p className="mb-2">Add one to use the chat and memory features.</p>
            <Link to="/settings/llm-providers/new" className="btn btn-primary btn-sm">
              <i className="bi bi-plus-lg" aria-hidden="true" />
              Add a provider
            </Link>
          </div>
        </div>
      ) : (
        <div className="table-container mb-4">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Endpoint</th>
                  <th>Model</th>
                  <th>Key</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(providers.data ?? []).map((provider) => (
                  <tr key={provider.id}>
                    <td>
                      <span className="cell-title">{provider.name}</span>
                      {provider.is_default === 1 ? <span className="badge bg-primary ms-2">default</span> : null}
                    </td>
                    <td><span className="font-monospace small">{provider.base_url}</span></td>
                    <td>{provider.model}</td>
                    <td>
                      {provider.keychain_ref ? (
                        <span className="badge bg-success">Keychain</span>
                      ) : (
                        <span className="text-muted">none</span>
                      )}
                    </td>
                    <td>
                      {provider.is_active === 1 ? (
                        <span className="badge bg-success">active</span>
                      ) : (
                        <span className="badge bg-secondary">inactive</span>
                      )}
                    </td>
                    <td className="text-end">
                      <div className="row-actions d-inline-flex">
                        <button
                          type="button"
                          className="btn btn-icon"
                          title="Test connection"
                          aria-label={`Test ${provider.name}`}
                          disabled={testing === provider.id}
                          onClick={() => void test(provider.id)}
                        >
                          <i className="bi bi-plug" aria-hidden="true" />
                        </button>
                        {provider.is_default === 1 ? null : (
                          <button
                            type="button"
                            className="btn btn-icon"
                            title="Make default"
                            aria-label={`Make ${provider.name} the default`}
                            onClick={() => makeDefault.mutate(provider.id)}
                          >
                            <i className="bi bi-star" aria-hidden="true" />
                          </button>
                        )}
                        <Link to={`/settings/llm-providers/${provider.id}/edit`} className="btn btn-icon" title="Edit" aria-label={`Edit ${provider.name}`}>
                          <i className="bi bi-pencil" aria-hidden="true" />
                        </Link>
                        <button
                          type="button"
                          className="btn btn-icon btn-icon-danger"
                          title="Delete"
                          aria-label={`Delete ${provider.name}`}
                          onClick={() => setPendingDelete({ id: provider.id, name: provider.name })}
                        >
                          <i className="bi bi-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        show={pendingDelete !== null}
        title="Delete provider"
        message={
          pendingDelete
            ? `Delete "${pendingDelete.name}"? Its API key is removed from the Keychain too.`
            : ""
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
      />

      <div className="card card-finance">
        <div className="card-body">
          <h5 className="card-title">AI request timeout</h5>
          <p className="text-muted">
            Max seconds to wait for the model on each reply and memory extraction. Raise it for slow
            local models; lower it to fail fast. 5–600, default 120.
          </p>
          <div className="d-flex gap-2 align-items-end" style={{ maxWidth: 320 }}>
            <div className="flex-grow-1">
              <label htmlFor="llm_timeout" className="form-label">Timeout (seconds)</label>
              <input
                id="llm_timeout"
                type="number"
                min={5}
                max={600}
                className="form-control"
                value={timeoutValue}
                placeholder="120"
                onChange={(event) => setTimeoutValue(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={timeoutValue.trim() === ""}
              onClick={() => saveTimeout.mutate(timeoutValue)}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </SettingsLayout>
  );
}
