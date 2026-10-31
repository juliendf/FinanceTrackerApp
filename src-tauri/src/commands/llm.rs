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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

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
        /// request without it.
        #[serde(rename = "extraContent")]
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

/// Merge one streaming `tool_calls` delta into the accumulator, keyed by index.
/// The provider fragments `arguments` across chunks, so this concatenates.
fn merge_tool_delta(acc: &mut Vec<ToolCall>, delta: &Value) {
    let index = delta["index"].as_u64().unwrap_or(0) as usize;
    while acc.len() <= index {
        acc.push(ToolCall::default());
    }
    let slot = &mut acc[index];

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

    let response = match http.send().await {
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
    let mut buffer = String::new();
    let mut content = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut saw_done = false;

    'outer: while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            emit(ChatEvent::Cancelled);
            return Ok(Outcome {
                content,
                tool_calls,
                cancelled: true,
            });
        }

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
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(newline) = buffer.find('\n') {
            let line = buffer[..newline].trim_end_matches('\r').to_string();
            buffer.drain(..=newline);

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
#[tauri::command]
pub async fn chat_completion(
    request_id: String,
    base_url: String,
    api_key: Option<String>,
    model: String,
    messages: Value,
    tools: Option<Value>,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let cancel = register(&request_id);

    let result = stream_completion(
        CompletionRequest {
            base_url: &base_url,
            api_key: api_key.as_deref(),
            model: &model,
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

/// `GET {base_url}/models`, returning the model ids. Used by the provider form
/// and the model picker.
#[tauri::command]
pub async fn list_models(
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let request = auth(
        client()?.get(endpoint(&base_url, "models")),
        api_key.as_deref(),
    );

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

/// Cheap reachability + auth probe for the provider form.
#[tauri::command]
pub async fn test_connection(base_url: String, api_key: Option<String>) -> Result<String, String> {
    let models = list_models(base_url.clone(), api_key).await?;
    Ok(match models.len() {
        0 => format!("{base_url} reachable, but it advertises no models"),
        1 => format!("{base_url} reachable, 1 model available"),
        n => format!("{base_url} reachable, {n} models available"),
    })
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
