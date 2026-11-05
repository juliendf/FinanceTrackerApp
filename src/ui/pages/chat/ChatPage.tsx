/**
 * Chat, with streamed replies.
 *
 * Conversations live in the URL (`/chat/:conversationId`). The transcript is the
 * `messages` table; the streaming bubbles live in local state until the turn
 * finishes and is persisted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Dropdown } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TranscriptMessage } from "./TranscriptMessage";
import {
  createConversation,
  deleteConversation,
  deleteMessageFrom,
  getConversation,
  listConversations,
  listMessages,
  renameConversation,
  setConversationModel,
  setConversationPinned,
  setConversationProvider,
} from "../../../db/repositories/chat";
import {
  getDefaultProvider,
  listActiveProviders,
  listEnabledModels,
  type LlmProvider,
} from "../../../db/repositories/llmProviders";
import { getAllSettings } from "../../../db/repositories/settings";
import { QUICK_PROMPTS } from "../../../llm/prompts";
import {
  confirmAction,
  extractMemories,
  loadPendingActions,
  rejectAction,
  sendMessage,
  summariseConversation,
  type PendingActionView,
} from "../../../llm/service";
import { rustTransport } from "../../../llm/transport";
import { toolStatusLabel } from "../../../llm/tools";
import { conversationFileName, conversationMarkdown, todayStamp } from "../../../export/conversationMarkdown";
import { useStoredBoolean } from "../../../lib/useStoredBoolean";

/**
 * How often streamed text reaches the screen.
 *
 * 60 ms is ~16 fps: fast enough that the answer reads as live typing, slow enough
 * that a 50 token/s answer causes ~1 render instead of 50.
 */
const FRAME_MS = 60;
import { filterSessions, groupSessions } from "./sessionList";
import {
  getRunningTurn,
  getVisibleConversation,
  registerTurn,
  setVisibleConversation,
  unregisterTurn,
} from "./runningTurns";
import { useRememberedModel } from "../../../llm/modelChoice";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
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
  /** The card being confirmed or rejected, so its buttons lock while it runs. */
  const [busyAction, setBusyAction] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "conversation"; id: number; title: string } | { kind: "message"; id: number } | null
  >(null);
  const [model, setModel] = useRememberedModel(conversation.data?.provider_id ?? null);
  const requestIdRef = useRef<string>("");
  const abortRef = useRef<(() => Promise<void>) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * Streaming text is buffered here and flushed on a timer.
   *
   * A delta can arrive 30 to 60 times a second; re-rendering the page per delta
   * rebuilt the whole transcript and re-parsed the answer from scratch. Batching at
   * ~16 fps keeps the text visibly streaming while the main thread stays free.
   */
  const streamTextRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The activity already shown, so an unchanged phase does not re-render. */
  const activityKeyRef = useRef<string | null>(null);

  /** Show whatever has arrived so far. */
  const flushStream = useCallback(() => {
    const text = streamTextRef.current;
    // After a conversation switch the buffer is empty; do not leave a blank bubble.
    if (text === "") return;
    setBubbles((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        if (last.content === text) return current;
        next[next.length - 1] = { ...last, content: text };
      } else {
        next.push({ id: "streaming", role: "assistant", content: text });
      }
      return next;
    });
  }, []);

  /** Flush at most every FRAME_MS instead of on every token. */
  const scheduleStreamFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushStream();
    }, FRAME_MS);
  }, [flushStream]);

  const stopFlushing = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  /** Only update the spinner when what it says actually changes. */
  const showActivity = useCallback((next: { phase: "thinking" | "tool" | "writing"; label?: string } | null) => {
    const key = next ? `${next.phase}:${next.label ?? ""}` : null;
    if (activityKeyRef.current === key) return;
    activityKeyRef.current = key;
    setActivity(next);
  }, []);

  /** Deleting a message opens the modal; stable so the memoised rows do not rerender. */
  const requestDeleteMessage = useCallback((messageId: number) => {
    setPendingDelete({ kind: "message", id: messageId });
  }, []);

  const visibleGroups = useMemo(
    () => groupSessions(filterSessions(conversations.data ?? [], sessionQuery)),
    [conversations.data, sessionQuery],
  );

  const providerList = providers.data ?? [];
  const activeProvider: LlmProvider | null = useMemo(
    () => providerList.find((row) => row.id === conversation.data?.provider_id) ?? null,
    [providerList, conversation.data?.provider_id],
  );

  /**
   * The conversation the page is showing, read from inside the async send.
   *
   * A turn belongs to the conversation it started in. Without this, switching
   * chat mid-answer left the spinner and the Stop button on the new page and
   * poured the old answer's text into it.
   */
  const activeIdRef = useRef<number | null>(id);

  useEffect(() => {
    setVisibleConversation(id);
  }, [id]);

  useEffect(
    () => () => {
      // The page is gone: a turn finishing now must not assume it is on screen.
      setVisibleConversation(null);
    },
    [],
  );

  useEffect(() => {
    activeIdRef.current = id;
    setBubbles([]);
    streamTextRef.current = "";
    stopFlushing();
    showActivity(null);
    setStreaming(false);

    // Leaving a conversation no longer stops its request. `sendMessage` was
    // already saving the answer, so cancelling threw work away; with a slow local
    // model it also meant the user could not leave the screen until it finished.
    // Coming back re-attaches to the turn if it is still running, which keeps the
    // Stop button reachable.
    const running = id === null ? undefined : getRunningTurn(id);
    abortRef.current = running?.cancel ?? null;
    setStreaming(running !== undefined);
    showActivity(running ? { phase: "writing" } : null);
    // `stopFlushing` and `showActivity` are stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const togglePin = async (convId: number, pinned: boolean) => {
    await setConversationPinned(convId, !pinned);
    // Only the list changed: pinning does not touch messages or the transcript.
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
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

  /**
   * The picker offers what the provider form enabled, not everything the
   * endpoint advertises. With nothing configured yet, the provider's own default
   * is the only option, which keeps chat working before models are curated.
   */
  const fetchModels = async () => {
    if (!activeProvider) return;
    try {
      const list = await listEnabledModels(activeProvider.id);
      setModels(list.length > 0 ? list : [activeProvider.model]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  // Load the models as soon as the provider is known, not when the select is
  // focused: a focus-triggered fetch starts on the same click that opens the
  // menu, so the first click always showed an empty list and the second showed
  // the models.
  useEffect(() => {
    if (!activeProvider) {
      setModels([]);
      return;
    }
    void fetchModels();
    // `fetchModels` closes over the active provider, so its id is the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider?.id]);

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
    streamTextRef.current = "";
    showActivity({ phase: "thinking" });
    // Only the user's own line shows until the model produces text. No
    // "Thinking…" placeholder and no tool-call chatter: those are plumbing, and
    // they used to flash in and out of the transcript on every turn.
    setBubbles([{ id: `user-${Date.now()}`, role: "user", content }]);

    const requestId = `chat-${Date.now()}`;
    requestIdRef.current = requestId;
    /** The conversation this turn belongs to, for the guards below. */
    const sendingFor = id;
    let cancelled = false;

    try {
      const transport = rustTransport({ provider_id: selected.id }, model || null);
      abortRef.current = transport.cancel;
      registerTurn(sendingFor, { cancel: transport.cancel });

      const result = await sendMessage({
        conversationId: id,
        text: content,
        transport,
        provider: selected,
        modelOverride: model || null,
        requestId,
        onEvent: (event) => {
          // Events from a turn whose conversation is no longer on screen: the
          // request is cancelled, but a chunk already in flight may still arrive.
          if (activeIdRef.current !== sendingFor) return;
          // A tool round starts a fresh answer: the text before the call was
          // preamble, and appending the final answer to it produced a jumble.
          if (event.type === "toolCall") {
            // The text before a tool call was preamble; the answer starts clean.
            streamTextRef.current = "";
            stopFlushing();
            setBubbles((current) => current.filter((bubble) => bubble.role === "user"));
            showActivity({ phase: "tool", label: toolStatusLabel(event.name) });
            return;
          }
          if (event.type !== "delta") return;
          showActivity(streamAnswers ? null : { phase: "writing" });
          if (!streamAnswers) return;
          streamTextRef.current += event.content;
          scheduleStreamFlush();
        },
      });

      cancelled = result.cancelled;
      if (result.cancelled) toast.info("Stopped.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      // Show the last token before the transcript is refetched over it — but only
      // if this conversation is still the one on screen.
      if (activeIdRef.current === sendingFor) {
        stopFlushing();
        flushStream();
        setStreaming(false);
        showActivity(null);
      }
      abortRef.current = null;
    }
    // Settled either way: finished, cancelled or failed.
    unregisterTurn(sendingFor);

    // The answer was saved regardless; only the view is conditional. The module
    // signal is used rather than `activeIdRef`, which still holds the last
    // conversation after the page unmounts and would claim the user is there.
    if (getVisibleConversation() !== sendingFor) {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      // A turn that finishes while the user is elsewhere is invisible work: say
      // it landed, and give them the way back to it.
      if (!cancelled) {
        const named = conversation.data?.title ? `"${conversation.data.title}"` : "Your chat";
        toast.success(`${named} is ready.`, {
          title: "Answer ready",
          action: { href: `#/chat/${sendingFor}`, label: "Open chat" },
          durationMs: 12_000,
        });
      }
      return;
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
    if (busyAction !== null) return;
    setBusyAction(action.id);
    try {
      const result = await confirmAction(action.id);
      if (result.success) toast.success(result.resultMessage);
      else toast.error(result.resultMessage);
    } finally {
      setBusyAction(null);
      refreshList();
      void queryClient.invalidateQueries({ queryKey: ["snapshot-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-facts"] });
      void queryClient.invalidateQueries({ queryKey: ["memories"] });
    }
  };

  const rejectPending = async (action: PendingActionView) => {
    if (busyAction !== null) return;
    setBusyAction(action.id);
    try {
      const result = await rejectAction(action.id);
      toast.info(result.resultMessage);
      refreshList();
    } finally {
      setBusyAction(null);
    }
  };

  const [summarising, setSummarising] = useState(false);
  // Remembered in localStorage: it is how this window is arranged, not a setting
  // that belongs in a backup.
  const [showAdvisor, setShowAdvisor] = useStoredBoolean("chat-advisor", true);

  /**
   * Write the conversation to a Markdown file.
   *
   * The transcript is read again rather than taken from the query cache: an
   * export must be what is stored, not what happens to be on screen.
   */
  const exportConversation = async () => {
    if (id === null) return;
    const title = conversation.data?.title ?? "Conversation";
    try {
      const rows = await listMessages(id);
      const path = await invoke<string | null>("save_text_file", {
        defaultName: conversationFileName(title, todayStamp()),
        filterName: "Markdown",
        extensions: ["md"],
        contents: conversationMarkdown({
          title,
          createdAt: conversation.data?.created_at ?? null,
          messages: rows,
        }),
      });
      if (!path) return;
      toast.success(`Conversation exported to ${path}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const summarise = async () => {
    if (id === null || summarising) return;
    const selected = activeProvider ?? (await getDefaultProvider());
    if (!selected) {
      toast.error("Choose a provider first.");
      return;
    }
    setSummarising(true);
    try {
      const transport = rustTransport({ provider_id: selected.id }, model || null);
      await summariseConversation(id, transport, `summary-${Date.now()}`);
      refreshList();
      toast.success("Summary added to the conversation.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSummarising(false);
    }
  };

  const runExtraction = async () => {
    if (id === null) return;
    const selected = activeProvider ?? (await getDefaultProvider());
    if (!selected) return;
    try {
      const transport = rustTransport({ provider_id: selected.id }, model || null);
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

  /**
   * Rewind to the edited message and ask again.
   *
   * `deleteMessageFrom` already removes that message and everything after it,
   * together with the pending actions they produced — which is exactly the
   * semantics an edit needs, because a user message is always a safe cut: the
   * assistant turn and its tool results sit after it and go as a block. Cutting
   * on a `role='tool'` row would orphan a `tool_call_id`, but nothing here can.
   */
  // `send` is rebuilt on every render, so it goes through a ref: passing it in
  // the callback's dependencies would make `saveEditedMessage` new each time and
  // defeat the memo on every transcript row.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  const saveEditedMessage = useCallback(
    (messageId: number, content: string) => {
      void (async () => {
        if (id === null) return;
        try {
          await deleteMessageFrom(messageId);
          // Drop the discarded branch before streaming, or it stays on screen
          // next to the new question until the final refetch.
          await queryClient.invalidateQueries({ queryKey: ["messages", id] });
          await queryClient.invalidateQueries({ queryKey: ["pending-actions", id] });
          await sendRef.current(content);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [id, queryClient],
  );

  const canChat = aiEnabled && providerList.length > 0;
  /** The rail only exists for a conversation with a provider and AI on. */
  const advisorAvailable = id !== null && Boolean(activeProvider) && canChat;

  return (
    <div className="chat-page">
      {!aiEnabled ? (
        <div className="alert alert-warning">
          <strong>AI is off.</strong> Turn it on in <a href="#/settings/llm-providers">Settings → LLM Providers</a>. The assistant
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
                    <span className="item-meta" title={conv.meta.title}>{conv.meta.label}</span>
                    <button
                      type="button"
                      className={`btn-pin-conv${conv.pinned_at ? " is-pinned" : ""}`}
                      title={conv.pinned_at ? "Unpin session" : "Pin session"}
                      aria-label={`${conv.pinned_at ? "Unpin" : "Pin"} ${conv.title}`}
                      aria-pressed={conv.pinned_at !== null}
                      onClick={() => void togglePin(conv.id, conv.pinned_at !== null)}
                    >
                      <i className={`bi ${conv.pinned_at ? "bi-pin-fill" : "bi-pin-angle"}`} aria-hidden="true" />
                    </button>
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
              {/* Two groups, never five equal buttons: where this conversation
                  goes, then what to do with it. The actions live behind one menu
                  so the row cannot wrap into a second line of stray controls. */}
              <div className="chat-header">
                <div className="chat-model-group">
                  <span className="chat-header-label">Model</span>
                  <select
                    id="providerSelect"
                    className="form-select form-select-sm"
                    style={{ width: "auto" }}
                    aria-label="Provider"
                    value={conversation.data?.provider_id ?? ""}
                    disabled={!aiEnabled}
                    onChange={(event) => void changeProvider(event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Provider</option>
                    {providerList.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.name}</option>
                    ))}
                  </select>
                  <select
                    id="modelSelect"
                    className="form-select form-select-sm"
                    style={{ width: "auto", maxWidth: 200 }}
                    aria-label="Model"
                    value={model}
                    disabled={!activeProvider}
                    onFocus={() => void fetchModels()}
                    onChange={(event) => {
                      setModel(event.target.value);
                      if (id !== null) void setConversationModel(id, event.target.value || null);
                    }}
                  >
                    <option value="">Default</option>
                    {models.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>

                <div className="chat-header-actions">
                  <Dropdown align="end">
                    <Dropdown.Toggle
                      variant="secondary"
                      size="sm"
                      id="chat-actions"
                      aria-label="Conversation actions"
                      title="Conversation actions"
                    >
                      <i className="bi bi-three-dots me-1" aria-hidden="true" />
                      Actions
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Item as="button" onClick={() => void exportConversation()}>
                        <i className="bi bi-download me-2" aria-hidden="true" />
                        Export as Markdown
                      </Dropdown.Item>
                      <Dropdown.Item
                        as="button"
                        onClick={() => void summarise()}
                        disabled={!canChat || streaming || summarising}
                      >
                        <i className="bi bi-file-text me-2" aria-hidden="true" />
                        {summarising ? "Summarising…" : "Summarise"}
                      </Dropdown.Item>
                      <Dropdown.Item
                        as="button"
                        onClick={() => void runExtraction()}
                        disabled={!canChat || streaming}
                      >
                        <i className="bi bi-lightbulb me-2" aria-hidden="true" />
                        Extract memories
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </div>
              </div>

              <div className="chat-messages" ref={scrollRef}>
                {(messages.data ?? []).length === 0 && bubbles.length === 0 ? (
                  <p className="text-muted text-center py-4 mb-0">Ask anything about your portfolio to get started.</p>
                ) : null}

                {(messages.data ?? []).map((message) => (
                  <TranscriptMessage
                    key={message.id}
                    message={message}
                    onRequestDelete={requestDeleteMessage}
                    onSaveEdit={saveEditedMessage}
                    canEdit={!streaming}
                  />
                ))}

                {bubbles.map((bubble) => (
                  <div className={`msg-bubble ${bubble.role === "user" ? "msg-user" : "msg-assistant"}`} key={bubble.id}>
                    {/* Plain text while streaming: markdown is re-parsed on every
                        flush otherwise, and the saved message renders it anyway. */}
                    <span className="msg-text">{bubble.content}</span>
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
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyAction !== null}
                        onClick={() => void confirmPending(action)}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyAction !== null}
                        onClick={() => void rejectPending(action)}
                      >
                        Reject
                      </button>
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

        {advisorAvailable && !showAdvisor ? (
          <button
            type="button"
            className="chat-prompts-handle"
            onClick={() => setShowAdvisor(true)}
            aria-label="Show suggested questions"
            title="Show suggested questions"
          >
            <i className="bi bi-chevron-left" aria-hidden="true" />
          </button>
        ) : null}

        {advisorAvailable && showAdvisor ? (
          <aside className="chat-prompts" aria-label="Suggested questions">
            {/* The control lives on the pane it hides, not in the toolbar. */}
            <div className="chat-prompts-header">
              <span className="chat-prompts-label">Ask your advisor</span>
              <button
                type="button"
                className="chat-prompts-toggle"
                onClick={() => setShowAdvisor(false)}
                aria-label="Hide suggested questions"
                title="Hide suggested questions"
              >
                <i className="bi bi-chevron-right" aria-hidden="true" />
              </button>
            </div>
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
