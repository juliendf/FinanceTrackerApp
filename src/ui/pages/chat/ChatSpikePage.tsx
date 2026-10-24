/**
 * AI chat — Phase 0 spike page.
 *
 * Proves the loop end to end: the browser sends a prompt, Rust calls an
 * OpenAI-compatible endpoint, streams tokens back through a Channel, the tool
 * call is answered from SQLite, and the model's final answer is rendered.
 *
 * Phase 7 replaces this with the real chat UI (conversations, pending actions,
 * memories, markdown).
 */

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Col, Form, Row } from "react-bootstrap";
import { invoke } from "@tauri-apps/api/core";
import { cancelChat, chatCompletion } from "../../../llm/client";
import { runTurn } from "../../../llm/chatLoop";
import type { ChatMessage, StreamEvent } from "../../../llm/client";

const SETTINGS_KEY = "llm.spike.settings";
const KEYCHAIN_ACCOUNT = "provider:spike";

interface ProviderSettings {
  baseUrl: string;
  model: string;
}

const DEFAULT_SETTINGS: ProviderSettings = {
  baseUrl: "http://localhost:11434/v1",
  // Must be a model that actually emits `tool_calls`. Verified with Ollama:
  // qwen3.5:4b and qwen3.6:35b-a3b do; ministral-3:3b and qwen2.5-coder:14b
  // answer in prose instead and never trigger the tool round.
  model: "qwen3.5:4b",
};

function readSettings(): ProviderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ProviderSettings>;
    return {
      baseUrl: parsed.baseUrl || DEFAULT_SETTINGS.baseUrl,
      model: parsed.model || DEFAULT_SETTINGS.model,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface TranscriptEntry {
  who: "user" | "assistant" | "tool" | "error";
  text: string;
}

export function ChatSpikePage() {
  const [settings, setSettings] = useState<ProviderSettings>(readSettings);
  const [apiKey, setApiKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [connection, setConnection] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("What is my portfolio worth?");
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [rounds, setRounds] = useState(0);

  const historyRef = useRef<ChatMessage[]>([]);
  const requestIdRef = useRef<string>("");
  const streamBuffer = useRef<string>("");

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const appendEntry = (entry: TranscriptEntry) =>
    setEntries((current) => [...current, entry]);

  const saveKey = async () => {
    try {
      await invoke("secret_set", { account: KEYCHAIN_ACCOUNT, secret: apiKey });
      setKeyStatus("Stored in the macOS Keychain");
      setApiKey("");
    } catch (error) {
      setKeyStatus(`Could not store the key: ${String(error)}`);
    }
  };

  const testConnection = async () => {
    setConnection("Checking…");
    try {
      const stored = await invoke<string | null>("secret_get", {
        account: KEYCHAIN_ACCOUNT,
      });
      const message = await invoke<string>("test_connection", {
        baseUrl: settings.baseUrl,
        apiKey: stored,
      });
      setConnection(message);
    } catch (error) {
      setConnection(String(error));
    }
  };

  const send = async () => {
    if (!prompt.trim() || streaming) return;

    const requestId = `spike-${Date.now()}`;
    requestIdRef.current = requestId;
    streamBuffer.current = "";

    const userMessage: ChatMessage = { role: "user", content: prompt.trim() };
    historyRef.current = [...historyRef.current, userMessage];

    appendEntry({ who: "user", text: prompt.trim() });
    appendEntry({ who: "assistant", text: "" });
    setStreaming(true);
    setRounds(0);
    setPrompt("");

    const storedKey = await invoke<string | null>("secret_get", {
      account: KEYCHAIN_ACCOUNT,
    });

    const onEvent = (event: StreamEvent) => {
      switch (event.type) {
        case "delta":
          streamBuffer.current += event.content;
          setEntries((current) => {
            const next = [...current];
            next[next.length - 1] = {
              who: "assistant",
              text: streamBuffer.current,
            };
            return next;
          });
          break;
        case "toolCall":
          appendEntry({
            who: "tool",
            text: `${event.name}(${event.arguments || "{}"})`,
          });
          // Next assistant round starts a fresh bubble.
          streamBuffer.current = "";
          appendEntry({ who: "assistant", text: "" });
          break;
        case "error":
          appendEntry({ who: "error", text: event.message });
          break;
        case "cancelled":
          appendEntry({ who: "error", text: "Cancelled." });
          break;
        default:
          break;
      }
    };

    try {
      const result = await runTurn({
        requestId,
        history: historyRef.current,
        onEvent,
        transport: async ({ requestId: id, messages, tools, onEvent: emit }) => {
          const response = await chatCompletion({
            requestId: id,
            baseUrl: settings.baseUrl,
            apiKey: storedKey,
            model: settings.model,
            messages,
            tools,
            onEvent: emit,
          });
          return response;
        },
      });

      historyRef.current = result.messages;
      setRounds(result.rounds);

      if (!result.cancelled) {
        setEntries((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last?.who === "assistant" && !last.text) {
            next[next.length - 1] = {
              who: "assistant",
              text: result.finalContent || "(empty response)",
            };
          }
          return next;
        });
      }
    } catch (error) {
      appendEntry({ who: "error", text: String(error) });
    } finally {
      setStreaming(false);
    }
  };

  const stop = async () => {
    if (requestIdRef.current) await cancelChat(requestIdRef.current);
  };

  return (
    <>
      <h1 className="h3 mb-1">AI chat</h1>
      <p className="text-muted mb-4">
        Spike page: streaming through a Rust <code>Channel</code>, one tool call
        answered from SQLite. Requests go to the endpoint below, nowhere else.
      </p>

      <Card className="mb-4">
        <Card.Body>
          <h2 className="h6 text-uppercase text-muted mb-3">Provider</h2>
          <Row className="g-3 align-items-end">
            <Col md={5}>
              <Form.Group controlId="baseUrl">
                <Form.Label>Base URL</Form.Label>
                <Form.Control
                  value={settings.baseUrl}
                  onChange={(e) =>
                    setSettings({ ...settings, baseUrl: e.target.value })
                  }
                />
                <Form.Text className="text-muted">
                  OpenAI-compatible. Ollama: <code>http://localhost:11434/v1</code>
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group controlId="model">
                <Form.Label>Model</Form.Label>
                <Form.Control
                  value={settings.model}
                  onChange={(e) =>
                    setSettings({ ...settings, model: e.target.value })
                  }
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group controlId="apiKey">
                <Form.Label>API key</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control
                    type="password"
                    value={apiKey}
                    placeholder="Optional for local models"
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <Button
                    variant="outline-secondary"
                    onClick={saveKey}
                    disabled={!apiKey}
                  >
                    Save
                  </Button>
                </div>
              </Form.Group>
            </Col>
          </Row>

          <div className="d-flex align-items-center gap-3 mt-3">
            <Button variant="outline-primary" size="sm" onClick={testConnection}>
              Test connection
            </Button>
            {connection ? (
              <span className="text-muted small">{connection}</span>
            ) : null}
            {keyStatus ? (
              <span className="text-muted small">{keyStatus}</span>
            ) : null}
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <div className="mb-3" style={{ minHeight: 200 }}>
            {entries.length === 0 ? (
              <p className="text-muted mb-0">
                Ask something about the portfolio to exercise the tool call.
              </p>
            ) : (
              entries.map((entry, index) => (
                <div key={index} className="mb-3">
                  <Badge
                    bg={
                      entry.who === "user"
                        ? "primary"
                        : entry.who === "tool"
                          ? "info"
                          : entry.who === "error"
                            ? "danger"
                            : "secondary"
                    }
                    className="me-2"
                  >
                    {entry.who}
                  </Badge>
                  <span style={{ whiteSpace: "pre-wrap" }}>{entry.text}</span>
                </div>
              ))
            )}
          </div>

          <Form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div className="d-flex gap-2">
              <Form.Control
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What is my portfolio worth?"
                disabled={streaming}
              />
              <Button type="submit" variant="primary" disabled={streaming}>
                {streaming ? "Streaming…" : "Send"}
              </Button>
              <Button
                type="button"
                variant="outline-danger"
                onClick={() => void stop()}
                disabled={!streaming}
              >
                Stop
              </Button>
            </div>
          </Form>

          {rounds > 0 ? (
            <p className="text-muted small mt-2 mb-0">Tool rounds: {rounds}</p>
          ) : null}
        </Card.Body>
      </Card>
    </>
  );
}
