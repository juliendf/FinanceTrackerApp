//! OpenAI-compatible chat completions, streamed to the webview.
//!
//! Every LLM request leaves from here, never from the webview. That keeps the
//! API key out of the renderer and makes the endpoint auditable in one place.
//!
//! The chat *loop* (tool rounds, pending actions) lives in TypeScript under
//! `src/llm/`; this module only does one HTTP round trip at a time.
//!
//! `stream_completion` is the testable core — it takes a plain emit callback
//! instead of a Tauri `Channel`, so `tests/llm_ollama.rs` can exercise the real
//! streaming path against a local model. `chat_completion` is the thin command
//! wrapper that owns cancellation registration and the IPC channel.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Row, SqliteConnection};
use tauri::ipc::Channel;
use tauri::AppHandle;

use crate::commands::db::database_file;
use crate::commands::secrets::read_key;

/// Events pushed to the webview while a completion streams.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    /// A chunk of assistant text.
    Delta { content: String },
    /// The assistant asked for a tool call. Arguments are a JSON string, as
    /// the OpenAI schema delivers them.
    ToolCall {
        id: String,
        name: String,
        arguments: String,
        /// Provider-specific extras that must travel back with the call.
        /// Gemini 3 puts a `thought_signature` here and rejects the next
        /// request without it. Omitted entirely when absent: sending
        /// `"extra_content": null` makes Gemini answer
        /// `400 Value is not a struct: null`.
        #[serde(rename = "extraContent", skip_serializing_if = "Option::is_none")]
        extra_content: Option<Value>,
    },
    /// Stream finished cleanly.
    Done { content: String },
    /// Stream finished with an error the UI should show.
    Error { message: String },
    /// The user cancelled. Nothing after this event.
    Cancelled,
}

/// Partially assembled streaming tool call.
#[derive(Default, Debug, Clone, PartialEq, Eq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
    /// Verbatim `extra_content` from the provider (Gemini's thought signature).
    pub extra_content: Option<Value>,
}

/// How often a running request checks for cancellation while it waits.
///
/// The stream only yields when the provider sends something, so a silent
/// provider (a model loading, or one that thinks for a minute) would otherwise
/// ignore Stop until the 300 s timeout.
const CANCEL_POLL: Duration = Duration::from_millis(100);

/// Resolves once the cancel flag is set. Used inside `tokio::select!`.
async fn wait_for_cancel(cancel: &Arc<AtomicBool>) {
    loop {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        tokio::time::sleep(CANCEL_POLL).await;
    }
}

/// Splits an SSE byte stream into lines without ever decoding half a character.
///
/// Decoding each network chunk on its own corrupts any UTF-8 sequence that
/// straddles a chunk boundary — `é`, `’`, `€` and emoji all become U+FFFD. Bytes
/// are buffered until a newline arrives, and a newline can never be part of a
/// multi-byte sequence, so every line handed out is whole.
#[derive(Default)]
struct LineBuffer {
    bytes: Vec<u8>,
}

impl LineBuffer {
    fn extend(&mut self, chunk: &[u8]) {
        self.bytes.extend_from_slice(chunk);
    }

    /// Next complete line, without its `\n` (and without a trailing `\r`).
    fn next_line(&mut self) -> Option<String> {
        let newline = self.bytes.iter().position(|byte| *byte == b'\n')?;
        let mut line: Vec<u8> = self.bytes.drain(..=newline).collect();
        line.pop(); // the newline itself
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        Some(String::from_utf8_lossy(&line).into_owned())
    }

    /// Whatever is left when the stream ends without a trailing newline.
    fn flush(&mut self) -> Option<String> {
        if self.bytes.is_empty() {
            return None;
        }
        let line = std::mem::take(&mut self.bytes);
        Some(String::from_utf8_lossy(&line).into_owned())
    }
}

/// What one round trip produced, for callers that need the values rather than
/// the event stream.
#[derive(Default, Debug, Clone)]
pub struct Outcome {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub cancelled: bool,
}

/// Everything needed for one completion. Borrowed so the command does not have
/// to clone the message history.
pub struct CompletionRequest<'a> {
    pub base_url: &'a str,
    pub api_key: Option<&'a str>,
    pub model: &'a str,
    pub messages: &'a Value,
    pub tools: Option<&'a Value>,
}

fn cancellations() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register(request_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = cancellations().lock() {
        map.insert(request_id.to_string(), flag.clone());
    }
    flag
}

fn unregister(request_id: &str) {
    if let Ok(mut map) = cancellations().lock() {
        map.remove(request_id);
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        // Generous: a slow local model can take a while to close the stream.
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

/// `_is_reasoning_model`: models whose visible answer comes after a long
/// chain of thought need a bigger token budget.
const REASONING_MODELS: [&str; 4] = ["qwen3.5", "qwen3", "deepseek-r1", "deepseek-v3"];

fn reasoning_max_tokens(model: &str) -> Option<u32> {
    REASONING_MODELS
        .iter()
        .any(|prefix| model.starts_with(prefix))
        .then_some(4096)
}

/// Join a user-supplied base URL with an OpenAI path, tolerating a trailing
/// slash.
fn endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn auth(req: reqwest::RequestBuilder, api_key: Option<&str>) -> reqwest::RequestBuilder {
    match api_key.map(str::trim).filter(|k| !k.is_empty()) {
        Some(key) => req.bearer_auth(key),
        None => req,
    }
}

/// Human-readable error for a non-2xx response.
fn status_error(status: reqwest::StatusCode, body: &str) -> String {
    let hint = match status.as_u16() {
        401 | 403 => " — check the API key",
        404 => " — check the base URL and the model name",
        429 => " — rate limited",
        500..=599 => " — the provider is failing",
        _ => "",
    };
    let detail: String = body.chars().take(400).collect();
    format!(
        "provider returned {} {}{}\n{}",
        status.as_u16(),
        status.canonical_reason().unwrap_or(""),
        hint,
        detail
    )
}

/// Merge one streaming `tool_calls` delta into the accumulator.
///
/// OpenAI puts an `index` on every fragment, so that is the natural key.
/// Gemini does not: each call arrives in its own delta carrying an `id`, with no
/// index at all, so keying on index alone merged every call into slot 0 and
/// produced names like `get_allocationget_allocationlist_assets`.
///
/// The rule, in order: use `index` when present; otherwise start a new slot for
/// an unseen `id` and continue the matching one; with neither, continue the last
/// slot (a fragment of the call being streamed).
fn merge_tool_delta(acc: &mut Vec<ToolCall>, delta: &Value) {
    let slot = match delta["index"].as_u64() {
        Some(index) => {
            let index = index as usize;
            while acc.len() <= index {
                acc.push(ToolCall::default());
            }
            index
        }
        None => {
            let id = delta["id"].as_str().unwrap_or("");
            if id.is_empty() {
                if acc.is_empty() {
                    acc.push(ToolCall::default());
                }
                acc.len() - 1
            } else {
                match acc.iter().position(|call| call.id == id) {
                    Some(index) => index,
                    None => {
                        acc.push(ToolCall::default());
                        acc.len() - 1
                    }
                }
            }
        }
    };

    let slot = &mut acc[slot];
    if let Some(id) = delta["id"].as_str() {
        if !id.is_empty() {
            slot.id = id.to_string();
        }
    }
    if let Some(name) = delta["function"]["name"].as_str() {
        if !name.is_empty() {
            slot.name.push_str(name);
        }
    }
    if let Some(args) = delta["function"]["arguments"].as_str() {
        slot.arguments.push_str(args);
    }
    // Sent whole in one delta; a later delta omits it, so do not clear it.
    if delta["extra_content"].is_object() {
        slot.extra_content = Some(delta["extra_content"].clone());
    }
}

/// One streamed chat completion round trip.
///
/// `emit` receives every event in order, ending with exactly one of `Done`,
/// `Error` or `Cancelled`.
pub async fn stream_completion<F>(
    request: CompletionRequest<'_>,
    cancel: Arc<AtomicBool>,
    emit: F,
) -> Result<Outcome, String>
where
    F: Fn(ChatEvent),
{
    let emit = &emit;

    let mut body = json!({
        "model": request.model,
        "messages": request.messages,
        "stream": true,
    });
    // Reasoning models spend tokens thinking before they answer, so give them
    // room, as `llm_client.py` does.
    if let Some(max_tokens) = reasoning_max_tokens(request.model) {
        body["max_tokens"] = json!(max_tokens);
    }
    if let Some(tools) = request.tools {
        let has_tools = tools.as_array().map(|a| !a.is_empty()).unwrap_or(false);
        if has_tools {
            body["tools"] = tools.clone();
        }
    }

    let http = auth(
        client()?.post(endpoint(request.base_url, "chat/completions")),
        request.api_key,
    )
    .json(&body);

    // Cancellation has to cover the wait for the response, not just the stream:
    // a provider that is loading a model sends no headers for a long time.
    let response = tokio::select! {
        response = http.send() => response,
        _ = wait_for_cancel(&cancel) => {
            emit(ChatEvent::Cancelled);
            return Ok(Outcome { content: String::new(), tool_calls: Vec::new(), cancelled: true });
        }
    };

    let response = match response {
        Ok(r) => r,
        Err(e) if e.is_connect() => {
            let message = format!(
                "cannot reach {} — is the provider running?",
                request.base_url
            );
            emit(ChatEvent::Error {
                message: message.clone(),
            });
            return Err(message);
        }
        Err(e) => {
            let message = format!("request failed: {e}");
            emit(ChatEvent::Error {
                message: message.clone(),
            });
            return Err(message);
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let message = status_error(status, &text);
        emit(ChatEvent::Error {
            message: message.clone(),
        });
        return Err(message);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = LineBuffer::default();
    let mut content = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut saw_done = false;

    'outer: loop {
        let chunk = tokio::select! {
            chunk = stream.next() => chunk,
            _ = wait_for_cancel(&cancel) => {
                emit(ChatEvent::Cancelled);
                return Ok(Outcome {
                    content,
                    tool_calls,
                    cancelled: true,
                });
            }
        };

        let Some(chunk) = chunk else {
            break;
        };

        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                let message = format!("stream interrupted: {e}");
                emit(ChatEvent::Error {
                    message: message.clone(),
                });
                return Err(message);
            }
        };
        buffer.extend(&bytes);

        while let Some(line) = buffer.next_line() {
            let Some(payload) = line.strip_prefix("data:") else {
                // Blank separator lines and SSE comments.
                continue;
            };
            let payload = payload.trim();
            if payload.is_empty() {
                continue;
            }
            if payload == "[DONE]" {
                saw_done = true;
                break 'outer;
            }
            let Ok(event) = serde_json::from_str::<Value>(payload) else {
                continue;
            };

            let Some(delta) = event["choices"].get(0).and_then(|c| c.get("delta")) else {
                continue;
            };

            if let Some(text) = delta["content"].as_str() {
                if !text.is_empty() {
                    content.push_str(text);
                    emit(ChatEvent::Delta {
                        content: text.to_string(),
                    });
                }
            }

            if let Some(calls) = delta["tool_calls"].as_array() {
                for call in calls {
                    merge_tool_delta(&mut tool_calls, call);
                }
            }
        }
    }

    // A stream that ends without a trailing newline still has one last line.
    if let Some(line) = buffer.flush().filter(|_| !saw_done) {
        if let Some(payload) = line.strip_prefix("data:") {
            let payload = payload.trim();
            if !payload.is_empty() && payload != "[DONE]" {
                if let Ok(event) = serde_json::from_str::<Value>(payload) {
                    if let Some(delta) = event["choices"].get(0).and_then(|c| c.get("delta")) {
                        if let Some(text) = delta["content"].as_str() {
                            if !text.is_empty() {
                                content.push_str(text);
                                emit(ChatEvent::Delta {
                                    content: text.to_string(),
                                });
                            }
                        }
                        if let Some(calls) = delta["tool_calls"].as_array() {
                            for call in calls {
                                merge_tool_delta(&mut tool_calls, call);
                            }
                        }
                    }
                }
            }
        }
    }

    for call in &tool_calls {
        if call.name.is_empty() {
            continue;
        }
        emit(ChatEvent::ToolCall {
            id: call.id.clone(),
            name: call.name.clone(),
            arguments: call.arguments.clone(),
            extra_content: call.extra_content.clone(),
        });
    }

    if !saw_done && content.is_empty() && tool_calls.is_empty() {
        let message = "provider closed the stream without sending any content".to_string();
        emit(ChatEvent::Error {
            message: message.clone(),
        });
        return Err(message);
    }

    emit(ChatEvent::Done {
        content: content.clone(),
    });

    Ok(Outcome {
        content,
        tool_calls,
        cancelled: false,
    })
}

/// IPC wrapper around [`stream_completion`]: owns cancellation registration and
/// forwards events onto the channel.
/// Everything a request needs, read from the provider row rather than accepted
/// from the webview.
struct ProviderConfig {
    base_url: String,
    model: String,
    keychain_ref: Option<String>,
}

async fn provider_config(app: &AppHandle, provider_id: i64) -> Result<ProviderConfig, String> {
    let file = database_file(app)?;
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", file.display()))
        .map_err(|e| format!("invalid database URL: {e}"))?
        .busy_timeout(Duration::from_secs(5));

    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| format!("cannot open the database: {e}"))?;

    let row = sqlx::query("SELECT base_url, model, keychain_ref FROM llm_providers WHERE id = ?")
        .bind(provider_id)
        .fetch_optional(&mut connection)
        .await
        .map_err(|e| format!("cannot read provider {provider_id}: {e}"))?;

    let Some(row) = row else {
        return Err(format!("provider {provider_id} not found"));
    };

    Ok(ProviderConfig {
        base_url: row.get(0),
        model: row.get(1),
        keychain_ref: row.get(2),
    })
}

/// The stored key, if it was saved for the endpoint this provider now uses.
///
/// `read_key` refuses when the provider's base URL no longer matches the origin
/// the key was entered for, so moving the row cannot redirect a saved key to
/// another host.
fn provider_key(config: &ProviderConfig) -> Result<Option<String>, String> {
    match config.keychain_ref.as_deref() {
        Some(account) => read_key(account, &config.base_url),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn chat_completion(
    app: AppHandle,
    request_id: String,
    provider_id: i64,
    model: Option<String>,
    messages: Value,
    tools: Option<Value>,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let config = provider_config(&app, provider_id).await?;
    let api_key = provider_key(&config)?;
    let effective_model = model.unwrap_or_else(|| config.model.clone());

    let cancel = register(&request_id);
    let result = stream_completion(
        CompletionRequest {
            base_url: &config.base_url,
            api_key: api_key.as_deref(),
            model: &effective_model,
            messages: &messages,
            tools: tools.as_ref(),
        },
        cancel,
        |event| {
            let _ = on_event.send(event);
        },
    )
    .await;

    unregister(&request_id);
    result.map(|_| ())
}

/// Ask the running completion to stop. The stream observes the flag between
/// chunks, so cancellation lands within one chunk.
#[tauri::command]
pub fn cancel_chat(request_id: String) {
    if let Ok(map) = cancellations().lock() {
        if let Some(flag) = map.get(&request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// `GET {base_url}/models`, returning the model ids.
async fn fetch_models(base_url: &str, api_key: Option<&str>) -> Result<Vec<String>, String> {
    let request = auth(client()?.get(endpoint(base_url, "models")), api_key);

    let response = request
        .send()
        .await
        .map_err(|e| format!("cannot reach {base_url}: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(status_error(status, &text));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("invalid JSON from {base_url}/models: {e}"))?;

    let mut ids: Vec<String> = body["data"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|m| m["id"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

fn probe_message(base_url: &str, models: usize) -> String {
    match models {
        0 => format!("{base_url} reachable, but it advertises no models"),
        1 => format!("{base_url} reachable, 1 model available"),
        n => format!("{base_url} reachable, {n} models available"),
    }
}

/// Model list for a saved provider. The key and the URL come from the app, not
/// from the webview.
#[tauri::command]
pub async fn provider_models(app: AppHandle, provider_id: i64) -> Result<Vec<String>, String> {
    let config = provider_config(&app, provider_id).await?;
    let api_key = provider_key(&config)?;
    fetch_models(&config.base_url, api_key.as_deref()).await
}

/// Reachability check for a saved provider.
#[tauri::command]
pub async fn provider_connection(app: AppHandle, provider_id: i64) -> Result<String, String> {
    let config = provider_config(&app, provider_id).await?;
    let api_key = provider_key(&config)?;
    let models = fetch_models(&config.base_url, api_key.as_deref()).await?;
    Ok(probe_message(&config.base_url, models.len()))
}

/// Model list for an endpoint the user is still editing.
///
/// The key here is one the user just typed into the form, not one read from the
/// Keychain, so there is nothing to exfiltrate: it is only used for this request.
#[tauri::command]
pub async fn probe_models(base_url: String, api_key: Option<String>) -> Result<Vec<String>, String> {
    fetch_models(&base_url, api_key.as_deref()).await
}

/// Reachability check for an endpoint the user is still editing.
#[tauri::command]
pub async fn probe_connection(
    base_url: String,
    api_key: Option<String>,
) -> Result<String, String> {
    let models = fetch_models(&base_url, api_key.as_deref()).await?;
    Ok(probe_message(&base_url, models.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasoning_models_get_a_bigger_budget() {
        assert_eq!(reasoning_max_tokens("qwen3:32b"), Some(4096));
        assert_eq!(reasoning_max_tokens("deepseek-r1:14b"), Some(4096));
        assert_eq!(reasoning_max_tokens("qwen2.5-coder:14b"), None);
        assert_eq!(reasoning_max_tokens("gpt-4o-mini"), None);
    }

    #[test]
    fn endpoint_joins_without_double_slash() {
        assert_eq!(
            endpoint("http://localhost:11434/v1", "/chat/completions"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            endpoint("http://localhost:11434/v1/", "chat/completions"),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn tool_deltas_accumulate_by_index() {
        let mut acc: Vec<ToolCall> = Vec::new();

        merge_tool_delta(
            &mut acc,
            &json!({"index": 0, "id": "call_1", "function": {"name": "get_", "arguments": "{\"a\":"}}),
        );
        merge_tool_delta(
            &mut acc,
            &json!({"index": 0, "function": {"name": "portfolio_summary", "arguments": "1}"}}),
        );

        assert_eq!(acc.len(), 1);
        assert_eq!(acc[0].id, "call_1");
        assert_eq!(acc[0].name, "get_portfolio_summary");
        assert_eq!(acc[0].arguments, "{\"a\":1}");
    }

    #[test]
    fn tool_deltas_without_an_index_are_keyed_by_id() {
        // Gemini sends one delta per call, with an id and no index at all.
        let mut acc: Vec<ToolCall> = Vec::new();
        merge_tool_delta(
            &mut acc,
            &json!({"id": "call_a", "function": {"name": "get_portfolio_summary", "arguments": "{}"}}),
        );
        merge_tool_delta(
            &mut acc,
            &json!({"id": "call_b", "function": {"name": "get_allocation", "arguments": "{\"dimension\":"}}),
        );
        merge_tool_delta(&mut acc, &json!({"function": {"arguments": "\"category\"}"}}));

        assert_eq!(acc.len(), 2, "two calls must not merge: {acc:?}");
        assert_eq!(acc[0].name, "get_portfolio_summary");
        assert_eq!(acc[1].name, "get_allocation");
        assert_eq!(acc[1].arguments, "{\"dimension\":\"category\"}");
    }

    #[test]
    fn tool_deltas_with_an_index_still_accumulate_fragments() {
        let mut acc: Vec<ToolCall> = Vec::new();
        merge_tool_delta(&mut acc, &json!({"index": 0, "id": "x", "function": {"name": "a"}}));
        merge_tool_delta(&mut acc, &json!({"index": 0, "function": {"name": "b"}}));
        assert_eq!(acc.len(), 1);
        assert_eq!(acc[0].name, "ab");
    }

    #[test]
    fn a_multibyte_character_split_across_chunks_survives() {
        let text = "CHF 1’000.50 — éé€ 🙂\n";
        let bytes = text.as_bytes();
        let mut buffer = LineBuffer::default();

        // Feed it one byte at a time: no chunk boundary may corrupt a character.
        let mut lines = Vec::new();
        for byte in bytes {
            buffer.extend(std::slice::from_ref(byte));
            while let Some(line) = buffer.next_line() {
                lines.push(line);
            }
        }

        assert_eq!(lines, vec![text.trim_end_matches('\n').to_string()]);
        assert!(!lines[0].contains('\u{FFFD}'), "replacement character appeared");
    }

    #[test]
    fn a_trailing_line_without_a_newline_is_flushed() {
        let mut buffer = LineBuffer::default();
        buffer.extend(b"data: {\"a\":1}");
        assert_eq!(buffer.next_line(), None);
        assert_eq!(buffer.flush().as_deref(), Some("data: {\"a\":1}"));
        assert_eq!(buffer.flush(), None);
    }

    #[test]
    fn carriage_returns_are_trimmed() {
        let mut buffer = LineBuffer::default();
        buffer.extend(b"data: one\r\ndata: two\n");
        assert_eq!(buffer.next_line().as_deref(), Some("data: one"));
        assert_eq!(buffer.next_line().as_deref(), Some("data: two"));
    }

    #[test]
    fn tool_deltas_keep_the_provider_extra_content() {
        let mut acc: Vec<ToolCall> = Vec::new();
        let signature = json!({"google": {"thought_signature": "sig-123"}});

        merge_tool_delta(
            &mut acc,
            &json!({"index": 0, "id": "c1", "extra_content": signature, "function": {"name": "one", "arguments": "{}"}}),
        );
        // A following delta without extra_content must not wipe it.
        merge_tool_delta(&mut acc, &json!({"index": 0, "function": {"arguments": ""}}));

        assert_eq!(
            acc[0].extra_content,
            Some(json!({"google": {"thought_signature": "sig-123"}}))
        );
    }

    #[test]
    fn absent_extra_content_is_not_serialized() {
        let event = ChatEvent::ToolCall {
            id: "c1".into(),
            name: "get_portfolio_summary".into(),
            arguments: "{}".into(),
            extra_content: None,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(!json.contains("extraContent"), "got: {json}");
        assert!(json.contains("get_portfolio_summary"));

        let with = ChatEvent::ToolCall {
            id: "c1".into(),
            name: "n".into(),
            arguments: "{}".into(),
            extra_content: Some(json!({"google": {"thought_signature": "s"}})),
        };
        let json = serde_json::to_string(&with).unwrap();
        assert!(json.contains("extraContent"), "got: {json}");
    }

    #[test]
    fn tool_calls_without_extra_content_stay_none() {
        let mut acc: Vec<ToolCall> = Vec::new();
        merge_tool_delta(&mut acc, &json!({"index": 0, "id": "c1", "function": {"name": "one"}}));
        assert_eq!(acc[0].extra_content, None);
    }

    #[test]
    fn tool_deltas_of_two_calls_stay_separate() {
        let mut acc: Vec<ToolCall> = Vec::new();

        merge_tool_delta(&mut acc, &json!({"index": 0, "id": "a", "function": {"name": "one"}}));
        merge_tool_delta(&mut acc, &json!({"index": 1, "id": "b", "function": {"name": "two"}}));

        assert_eq!(acc.len(), 2);
        assert_eq!(acc[0].name, "one");
        assert_eq!(acc[1].name, "two");
    }

    #[test]
    fn status_error_carries_a_hint_per_class() {
        let unauthorized = status_error(reqwest::StatusCode::UNAUTHORIZED, "nope");
        assert!(unauthorized.contains("401"));
        assert!(unauthorized.contains("API key"));

        let missing = status_error(reqwest::StatusCode::NOT_FOUND, "nope");
        assert!(missing.contains("base URL"));
    }
}
