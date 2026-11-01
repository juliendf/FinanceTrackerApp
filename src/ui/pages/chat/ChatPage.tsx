/**
 * Chat: port of `templates/chat/index.html` and `static/js/chat.js`, with
 * streaming instead of polling.
 *
 * Conversations live in the URL (`/chat/:conversationId`). The transcript is the
 * `messages` table; the streaming bubbles live in local state until the turn
 * finishes and is persisted.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  createConversation,
  deleteConversation,
  deleteMessageFrom,
  getConversation,
  listConversations,
  listMessages,
  renameConversation,
  setConversationModel,
  setConversationProvider,
} from "../../../db/repositories/chat";
import {
  getDefaultProvider,
  getProviderKey,
  listActiveProviders,
  type LlmProvider,
} from "../../../db/repositories/llmProviders";
import { getAllSettings } from "../../../db/repositories/settings";
import { QUICK_PROMPTS } from "../../../llm/prompts";
import {
  confirmAction,
  extractMemories,
  loadPendingActions,
  providerApiKey,
  rejectAction,
  sendMessage,
  type PendingActionView,
} from "../../../llm/service";
import { rustTransport } from "../../../llm/transport";
import { toolStatusLabel } from "../../../llm/tools";
import { filterSessions, groupSessions } from "./sessionList";
import { useRememberedModel } from "../../../llm/modelChoice";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
import { PageHeader } from "../../components/FormCard";
import { useToast } from "../../layout/Toasts";

interface PendingBubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const id = conversationId ? Number(conversationId) : null;

  const settings = useQuery({ queryKey: ["settings"], queryFn: getAllSettings });
  const aiEnabled = settings.data?.ai_enabled === true;
  /** Off: hold the reply back and show a spinner until the turn finishes. */
  const streamAnswers = settings.data?.chat_streaming !== false;
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: listConversations });
  const providers = useQuery({ queryKey: ["llm-providers-active"], queryFn: listActiveProviders });
  const conversation = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => getConversation(id as number),
    enabled: id !== null,
  });
  const messages = useQuery({
    queryKey: ["messages", id],
    queryFn: () => listMessages(id as number),
    enabled: id !== null,
  });
  const actions = useQuery({
    queryKey: ["pending-actions", id],
    queryFn: () => loadPendingActions(id as number),
    enabled: id !== null,
  });

  const [input, setInput] = useState("");
  const [bubbles, setBubbles] = useState<PendingBubble[]>([]);
  const [streaming, setStreaming] = useState(false);
  /**
   * What the spinner says. `tool` phases show in both modes — the model is
   * thinking between rounds either way, and a bare "Generating…" for ten
   * seconds tells the user nothing.
   */
  const [activity, setActivity] = useState<
    { phase: "thinking" | "tool" | "writing"; label?: string } | null
  >(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "conversation"; id: number; title: string } | { kind: "message"; id: number } | null
  >(null);
  const [model, setModel] = useRememberedModel(conversation.data?.provider_id ?? null);
  const requestIdRef = useRef<string>("");
  const abortRef = useRef<(() => Promise<void>) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const visibleGroups = useMemo(
    () => groupSessions(filterSessions(conversations.data ?? [], sessionQuery)),
    [conversations.data, sessionQuery],
  );

  const providerList = providers.data ?? [];
  const activeProvider: LlmProvider | null = useMemo(
    () => providerList.find((row) => row.id === conversation.data?.provider_id) ?? null,
    [providerList, conversation.data?.provider_id],
  );

  useEffect(() => {
    setBubbles([]);
  }, [id]);

  useEffect(() => {
    // jsdom has no scrollTo; the optional call keeps the tests quiet.
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [messages.data, bubbles]);

  const refreshList = () => {
    for (const key of ["conversations", "messages", "conversation", "pending-actions"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const newChat = useMutation({
    mutationFn: async () => {
      const fallback = await getDefaultProvider();
      return createConversation(fallback?.id ?? null);
    },
    onSuccess: (newId) => {
      refreshList();
      navigate(`/chat/${newId}`);
    },
    onError: (error: unknown) => toast.error(String(error)),
  });

  const startRename = (convId: number, title: string) => {
    setRenaming(convId);
    setRenameValue(title);
  };

  const commitRename = async () => {
    if (renaming === null) return;
    const title = renameValue.trim();
    setRenaming(null);
    if (!title) return;
    await renameConversation(renaming, title.slice(0, 100));
    refreshList();
  };

  const removeConversation = async (convId: number) => {
    setPendingDelete(null);
    await deleteConversation(convId);
    refreshList();
    if (id === convId) navigate("/chat");
  };

  const changeProvider = async (providerId: number | null) => {
    if (id === null) return;
    await setConversationProvider(id, providerId);
    await setConversationModel(id, null);
    setModel("");
    setModels([]);
    refreshList();
  };

  const fetchModels = async () => {
    if (!activeProvider) return;
    try {
      const key = await getProviderKey(activeProvider);
      const list = await invokeModels(activeProvider.base_url, key);
      setModels(list);
      if (list.length === 0) toast.warning("That provider advertises no models.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || streaming) return;
    if (id === null) {
      toast.error("Start a new chat first.");
      return;
    }
    // The conversation query may not have resolved yet on a fresh page load, so
    // fall back to the default provider instead of refusing to send.
    const selected = activeProvider ?? (await getDefaultProvider());
    if (!selected) {
      toast.error("Choose a provider first.");
      return;
    }

    setInput("");
    setStreaming(true);
    setActivity({ phase: "thinking" });
    // Only the user's own line shows until the model produces text. No
    // "Thinking…" placeholder and no tool-call chatter: those are plumbing, and
    // they used to flash in and out of the transcript on every turn.
    setBubbles([{ id: `user-${Date.now()}`, role: "user", content }]);

    const requestId = `chat-${Date.now()}`;
    requestIdRef.current = requestId;

    try {
      const key = await providerApiKey(selected);
      const transport = rustTransport({ base_url: selected.base_url, api_key: key, model: selected.model }, model || null);
      abortRef.current = transport.cancel;

      const result = await sendMessage({
        conversationId: id,
        text: content,
        transport,
        provider: selected,
        modelOverride: model || null,
        requestId,
        onEvent: (event) => {
          // A tool round starts a fresh answer: the text before the call was
          // preamble, and appending the final answer to it produced a jumble.
          if (event.type === "toolCall") {
            setBubbles((current) => current.filter((bubble) => bubble.role === "user"));
            setActivity({ phase: "tool", label: toolStatusLabel(event.name) });
            return;
          }
          if (event.type !== "delta") return;
          setActivity(streamAnswers ? null : { phase: "writing" });
          if (!streamAnswers) return;
          setBubbles((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, content: last.content + event.content };
            } else {
              next.push({ id: `assistant-${Date.now()}`, role: "assistant", content: event.content });
            }
            return next;
          });
        },
      });

      if (result.cancelled) toast.info("Stopped.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStreaming(false);
      setActivity(null);
      abortRef.current = null;
    }

    // Refetch the transcript first, then drop the local bubbles, so the text
    // never disappears between "streamed" and "loaded".
    await queryClient.invalidateQueries({ queryKey: ["messages", id] });
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    await queryClient.invalidateQueries({ queryKey: ["conversation", id] });
    await queryClient.invalidateQueries({ queryKey: ["pending-actions", id] });
    setBubbles([]);
  };

  const stop = async () => {
    const cancel = abortRef.current;
    if (!cancel) return;
    await cancel();
  };

  const confirmPending = async (action: PendingActionView) => {
    try {
      const result = await confirmAction(action.id);
      if (result.success) toast.success(result.resultMessage);
      else toast.error(result.resultMessage);
    } finally {
      refreshList();
      void queryClient.invalidateQueries({ queryKey: ["snapshot-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-facts"] });
      void queryClient.invalidateQueries({ queryKey: ["memories"] });
    }
  };

  const rejectPending = async (action: PendingActionView) => {
    const result = await rejectAction(action.id);
    toast.info(result.resultMessage);
    refreshList();
  };

  const runExtraction = async () => {
    if (id === null) return;
    const selected = activeProvider ?? (await getDefaultProvider());
    if (!selected) return;
    try {
      const key = await providerApiKey(selected);
      const transport = rustTransport({ base_url: selected.base_url, api_key: key, model: selected.model }, model || null);
      const proposals = await extractMemories(id, transport, `extract-${Date.now()}`);
      if (proposals.length === 0) {
        toast.info("No new facts found.");
        return;
      }
      const { createPendingAction } = await import("../../../db/repositories/chat");
      for (const proposal of proposals) {
        await createPendingAction({ conversationId: id, actionType: "create_memory", payload: proposal });
      }
      toast.success(`Found ${proposals.length} new fact(s) to review.`);
      refreshList();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteMessage = async (messageId: number) => {
    setPendingDelete(null);
    await deleteMessageFrom(messageId);
    refreshList();
  };

  const canChat = aiEnabled && providerList.length > 0;

  return (
    <div className="chat-page">
      <PageHeader
        title="Chat"
        subtitle="AI-powered financial assistant"
        icon="robot"
        showDate={false}
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => newChat.mutate()} disabled={!aiEnabled}>
            <i className="bi bi-plus-lg" aria-hidden="true" />
            New Chat
          </button>
        }
      />

      {!aiEnabled ? (
        <div className="alert alert-warning">
          <strong>AI is off.</strong> Turn it on in <a href="#/settings">Settings → Enable AI</a>. The assistant
          sends your questions, and whatever it reads, to the provider you configure.
        </div>
      ) : providerList.length === 0 ? (
        <div className="alert alert-info">
          <strong>No provider configured.</strong> Add one in{" "}
          <a href="#/settings/llm-providers">Settings → LLM Providers</a> to start chatting.
        </div>
      ) : null}

      <div className="chat-layout">
        <div className="chat-sidebar">
          <div className="chat-sidebar-header">
            <span className="chat-sidebar-title">Sessions</span>
            <button
              type="button"
              className="btn-icon-action"
              title="New session"
              aria-label="New session"
              onClick={() => newChat.mutate()}
              disabled={!aiEnabled}
            >
              <i className="bi bi-plus-lg" aria-hidden="true" />
            </button>
          </div>

          <div className="chat-sidebar-search">
            <input
              type="search"
              className="form-control form-control-sm"
              placeholder="Search"
              aria-label="Search sessions"
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
            />
          </div>

          <div className="chat-sidebar-list">
            {visibleGroups.length === 0 ? (
              <p className="chat-sidebar-empty">{sessionQuery ? "No session matches." : "No sessions yet."}</p>
            ) : null}
            {visibleGroups.map((group) => (
              <div className="chat-sidebar-group" key={group.title}>
                <div className="chat-sidebar-label">{group.title}</div>
                {group.items.map((conv) => (
                  <div
                    key={conv.id}
                    className={`chat-sidebar-item${id === conv.id ? " active" : ""}`}
                    onDoubleClick={() => startRename(conv.id, conv.title)}
                    title="Double-click to rename"
                  >
                    {renaming === conv.id ? (
                      <input
                        className="item-title-edit form-control form-control-sm"
                        value={renameValue}
                        autoFocus
                        maxLength={100}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => void commitRename()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void commitRename();
                          if (event.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <button type="button" className="item-title" onClick={() => navigate(`/chat/${conv.id}`)}>
                        {conv.title}
                      </button>
                    )}
                    <span className="item-meta">{conv.meta.label}</span>
                    <button
                      type="button"
                      className="btn-delete-conv"
                      title="Delete session"
                      aria-label={`Delete ${conv.title}`}
                      onClick={() => setPendingDelete({ kind: "conversation", id: conv.id, title: conv.title })}
                    >
                      <i className="bi bi-x" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="chat-main">
          {id === null ? (
            <div className="empty-state justify-content-center flex-grow-1">
              <i className="bi bi-chat-dots empty-state-icon" aria-hidden="true" />
              <p className="empty-state-title mb-0">No conversation selected</p>
              <p className="mb-2">Start a new chat to ask about your finances.</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => newChat.mutate()} disabled={!aiEnabled}>
                <i className="bi bi-plus-lg" aria-hidden="true" />
                New Chat
              </button>
            </div>
          ) : (
            <>
              <div className="chat-header">
                <select
                  id="providerSelect"
                  className="form-select form-select-sm"
                  style={{ width: "auto" }}
                  value={conversation.data?.provider_id ?? ""}
                  disabled={!aiEnabled}
                  onChange={(event) => void changeProvider(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">-- Provider --</option>
                  {providerList.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
                <select
                  id="modelSelect"
                  className="form-select form-select-sm"
                  style={{ width: "auto", maxWidth: 220 }}
                  value={model}
                  disabled={!activeProvider}
                  onFocus={() => void fetchModels()}
                  onChange={(event) => {
                    setModel(event.target.value);
                    if (id !== null) void setConversationModel(id, event.target.value || null);
                  }}
                >
                  <option value="">-- Model ({activeProvider?.model ?? "default"}) --</option>
                  {models.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <button type="button" className="btn btn-secondary btn-sm ms-auto" onClick={() => void runExtraction()} disabled={!canChat || streaming}>
                  <i className="bi bi-lightbulb" aria-hidden="true" />
                  Extract memories
                </button>
              </div>

              <div className="chat-messages" ref={scrollRef}>
                {(messages.data ?? []).length === 0 && bubbles.length === 0 ? (
                  <p className="text-muted text-center py-4 mb-0">Ask anything about your portfolio to get started.</p>
                ) : null}

                {(messages.data ?? []).map((message) => {
                  if (message.role === "user") {
                    return (
                      <div className="msg-bubble msg-user" key={message.id}>
                        <button
                          type="button"
                          className="btn-delete-msg"
                          title="Delete this message and rewind conversation"
                          onClick={() => setPendingDelete({ kind: "message", id: message.id })}
                        >
                          <i className="bi bi-x" aria-hidden="true" />
                        </button>
                        <span className="msg-text">{message.content}</span>
                      </div>
                    );
                  }
                  if (message.role === "assistant" && message.content) {
                    return (
                      <div className="msg-bubble msg-assistant" key={message.id}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    );
                  }
                  return null;
                })}

                {bubbles.map((bubble) => (
                  <div className={`msg-bubble ${bubble.role === "user" ? "msg-user" : "msg-assistant"}`} key={bubble.id}>
                    {bubble.role === "user" ? (
                      <span className="msg-text">{bubble.content}</span>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                        {bubble.content}
                      </ReactMarkdown>
                    )}
                  </div>
                ))}

                {activity && (activity.phase === "tool" || !streamAnswers) ? (
                  <div
                    className="msg-bubble msg-assistant"
                    role="status"
                    aria-label={activity.phase === "tool" ? (activity.label ?? "Working") : "Generating"}
                  >
                    <span className="spinner-border spinner-border-sm text-secondary me-2" aria-hidden="true" />
                    <span className="text-muted">
                      {activity.phase === "tool"
                        ? activity.label
                        : activity.phase === "writing"
                          ? "Writing the answer…"
                          : "Generating…"}
                    </span>
                  </div>
                ) : null}

                {(actions.data ?? []).map((action) => (
                  <div className="confirm-card" key={action.id}>
                    <div className="d-flex align-items-center mb-2">
                      <i className={`bi ${action.action_type === "create_memory" ? "bi-lightbulb-fill text-warning" : "bi-exclamation-triangle-fill text-warning"} me-2`} aria-hidden="true" />
                      <strong>{action.action_type === "create_memory" ? "Remember this?" : "Pending Action: Create Snapshot"}</strong>
                    </div>
                    {action.action_type === "create_memory" ? (
                      <p className="mb-1">
                        [{action.category}] {action.content} (importance: {action.importance}/5)
                      </p>
                    ) : (
                      <p className="mb-1">
                        <strong>{action.asset_name}</strong>: {action.amount} {action.currency} on {action.date}
                        {action.existing_snapshot_warning ? (
                          <span className="d-block text-warning small mt-1">{action.existing_snapshot_warning}</span>
                        ) : null}
                      </p>
                    )}
                    <div className="d-flex gap-2">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirmPending(action)}>Confirm</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void rejectPending(action)}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="chat-input-area">
                <form
                  className="d-flex gap-2 align-items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    id="chatInput"
                    className="form-control"
                    rows={1}
                    placeholder="Ask about your finances..."
                    title="Enter to send, Shift+Enter for a new line"
                    value={input}
                    disabled={!canChat}
                    maxLength={4000}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                  />
                  {streaming ? (
                    <button type="button" className="btn btn-danger" onClick={() => void stop()} title="Stop" aria-label="Stop">
                      <i className="bi bi-stop-circle" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="btn btn-primary"
                      aria-label="Send"
                      disabled={!canChat || input.trim() === ""}
                    >
                      <i className="bi bi-send" aria-hidden="true" />
                    </button>
                  )}
                </form>
              </div>
            </>
          )}
        </div>

        {id !== null && activeProvider && canChat ? (
          <aside className="chat-prompts" aria-label="Suggested questions">
            <div className="chat-prompts-label">Ask your advisor</div>
            <div className="chat-prompts-list">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  type="button"
                  className="prompt-btn"
                  key={prompt.id}
                  title={prompt.prompt}
                  disabled={streaming}
                  onClick={() => void send(prompt.prompt)}
                >
                  <i className={`bi ${prompt.icon}`} aria-hidden="true" />
                  <span className="prompt-btn-text">
                    <span className="prompt-btn-label">{prompt.label}</span>
                    <span className="prompt-btn-hint">{prompt.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        ) : null}
      </div>

      <DeleteConfirmModal
        show={pendingDelete !== null}
        title={pendingDelete?.kind === "message" ? "Delete message" : "Delete conversation"}
        message={
          pendingDelete?.kind === "message"
            ? "Delete this message and everything after it? The assistant will lose that context."
            : pendingDelete
              ? `Delete "${pendingDelete.title}"? Its messages go with it.`
              : ""
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.kind === "message") void deleteMessage(pendingDelete.id);
          else void removeConversation(pendingDelete.id);
        }}
      />
    </div>
  );
}

async function invokeModels(baseUrl: string, apiKey: string | null): Promise<string[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("list_models", { baseUrl, apiKey });
}
