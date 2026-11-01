//! Live integration tests.
//!
//! These need a running local Ollama (or any OpenAI-compatible endpoint) and,
//! for the Keychain test, permission to write to the login keychain. They are
//! `#[ignore]`d so `cargo test` stays hermetic.
//!
//!   cargo test --test live -- --ignored --nocapture
//!
//! Env overrides:
//!   OLLAMA_BASE_URL  default http://localhost:11434/v1
//!   OLLAMA_MODEL     default qwen3.5:4b  (must support tool calls)

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use financetrackerapp_lib::commands::llm::{
    stream_completion, ChatEvent, CompletionRequest,
};
use serde_json::json;

fn base_url() -> String {
    std::env::var("OLLAMA_BASE_URL").unwrap_or_else(|_| "http://localhost:11434/v1".into())
}

fn model() -> String {
    std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "qwen3.5:4b".into())
}

type Events = Arc<Mutex<Vec<String>>>;

/// Capture events as JSON so assertions stay readable.
fn collector() -> (Events, impl Fn(ChatEvent) + Send + Sync) {
    let events: Events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let emit = move |event: ChatEvent| {
        if let Ok(text) = serde_json::to_string(&event) {
            sink.lock().unwrap().push(text);
        }
    };
    (events, emit)
}

fn tool_definitions() -> serde_json::Value {
    json!([{
        "type": "function",
        "function": {
            "name": "get_portfolio_summary",
            "description": "Get the user's portfolio summary: total value, asset count, last update date.",
            "parameters": { "type": "object", "properties": {}, "required": [] }
        }
    }])
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a live OpenAI-compatible endpoint"]
async fn streams_text_and_closes_cleanly() {
    let (events, emit) = collector();
    let messages = json!([{ "role": "user", "content": "Reply with exactly: hello" }]);

    let outcome = stream_completion(
        CompletionRequest {
            base_url: &base_url(),
            api_key: None,
            model: &model(),
            messages: &messages,
            tools: None,
        },
        Arc::new(AtomicBool::new(false)),
        emit,
    )
    .await
    .expect("completion should succeed");

    let captured = events.lock().unwrap().clone();
    let deltas = captured.iter().filter(|e| e.contains("\"delta\"")).count();

    println!("outcome: {outcome:?}");
    println!("events: {}", captured.len());

    assert!(deltas > 0, "expected at least one streamed delta");
    assert!(!outcome.content.trim().is_empty(), "expected some content");
    assert!(captured.iter().any(|e| e.contains("\"done\"")), "expected a done event");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a live OpenAI-compatible endpoint"]
async fn streams_a_tool_call() {
    let (events, emit) = collector();
    let messages = json!([{
        "role": "user",
        "content": "What is my portfolio worth? Use the get_portfolio_summary tool."
    }]);

    let outcome = stream_completion(
        CompletionRequest {
            base_url: &base_url(),
            api_key: None,
            model: &model(),
            messages: &messages,
            tools: Some(&tool_definitions()),
        },
        Arc::new(AtomicBool::new(false)),
        emit,
    )
    .await
    .expect("completion should succeed");

    let captured = events.lock().unwrap().clone();
    let tool_events = captured
        .iter()
        .filter(|e| e.contains("\"toolCall\""))
        .count();

    println!("outcome: {outcome:?}");
    println!("tool call events: {tool_events}");

    assert_eq!(outcome.tool_calls.len(), 1, "expected exactly one tool call");
    assert_eq!(outcome.tool_calls[0].name, "get_portfolio_summary");
    assert!(!outcome.tool_calls[0].id.is_empty(), "tool call must have an id");
    assert!(tool_events > 0, "expected a toolCall event on the stream");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a live OpenAI-compatible endpoint"]
async fn cancelling_mid_stream_stops_within_a_second() {
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};

    let flag = Arc::new(AtomicBool::new(false));
    let flipped_at = Arc::new(Mutex::new(None::<Instant>));

    let sink = flag.clone();
    let stamp = flipped_at.clone();
    let emit = move |event: ChatEvent| {
        // Flip the flag as soon as the first token lands, as the UI's Stop button
        // does between chunks.
        if matches!(event, ChatEvent::Delta { .. }) && !sink.load(Ordering::Relaxed) {
            *stamp.lock().unwrap() = Some(Instant::now());
            sink.store(true, Ordering::Relaxed);
        }
    };

    let messages = json!([{ "role": "user", "content": "Count from 1 to 500, one number per line." }]);
    let outcome = stream_completion(
        CompletionRequest {
            base_url: &base_url(),
            api_key: None,
            model: &model(),
            messages: &messages,
            tools: None,
        },
        flag.clone(),
        emit,
    )
    .await
    .expect("cancellation is not an error");

    assert!(outcome.cancelled, "expected the outcome to report cancellation");
    let elapsed = flipped_at
        .lock()
        .unwrap()
        .map(|at| at.elapsed())
        .expect("the stream should have produced at least one token");
    assert!(
        elapsed < Duration::from_secs(1),
        "stop took {elapsed:?}, expected under 1s"
    );
}

async fn cancellation_stops_the_stream() {
    let (_events, emit) = collector();
    let messages = json!([{ "role": "user", "content": "Count to 500." }]);

    // Pre-set the flag: cancellation must be observed before any content lands.
    let cancel = Arc::new(AtomicBool::new(true));

    let outcome = stream_completion(
        CompletionRequest {
            base_url: &base_url(),
            api_key: None,
            model: &model(),
            messages: &messages,
            tools: None,
        },
        cancel,
        emit,
    )
    .await
    .expect("cancellation is not an error");

    assert!(outcome.cancelled, "expected the outcome to report cancellation");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a live OpenAI-compatible endpoint"]
async fn unreachable_endpoint_is_a_clean_error() {
    let (events, emit) = collector();
    let messages = json!([{ "role": "user", "content": "hi" }]);

    let error = stream_completion(
        CompletionRequest {
            base_url: "http://127.0.0.1:9/v1",
            api_key: None,
            model: "none",
            messages: &messages,
            tools: None,
        },
        Arc::new(AtomicBool::new(false)),
        emit,
    )
    .await
    .expect_err("a dead endpoint must return an error");

    assert!(error.contains("cannot reach"), "got: {error}");
    assert!(
        events.lock().unwrap().iter().any(|e| e.contains("\"error\"")),
        "an error event should reach the UI"
    );
}

#[test]
#[ignore = "writes to the login keychain"]
fn keychain_round_trip() {
    use financetrackerapp_lib::commands::secrets;

    let account = "provider:test-integration".to_string();

    // Start from a known state, then prove the round trip.
    secrets::secret_delete(account.clone()).expect("delete is idempotent");
    assert_eq!(
        secrets::read_secret(&account).expect("get on a missing item"),
        None,
        "a missing secret reads as None, not an error"
    );

    secrets::secret_set(account.clone(), "sk-test-123".into()).expect("set");
    assert_eq!(
        secrets::read_secret(&account).expect("get"),
        Some("sk-test-123".to_string())
    );

    secrets::secret_set(account.clone(), "sk-test-456".into()).expect("overwrite");
    assert_eq!(
        secrets::read_secret(&account).expect("get after overwrite"),
        Some("sk-test-456".to_string())
    );

    secrets::secret_delete(account.clone()).expect("delete");
    assert_eq!(secrets::read_secret(&account).expect("get after delete"), None);
}

/// Gemini 3 refuses a follow-up request that drops the `thought_signature` it
/// returned with a tool call.
///
/// This is the bug that made chat answer `400 INVALID_ARGUMENT`: the streamed
/// tool call carries `extra_content.google.thought_signature`, and echoing the
/// assistant turn back without it is invalid. The test proves both halves
/// against the real endpoint — failing without the signature, succeeding with
/// it — so the plumbing is verified, not just unit-tested.
///
///   GEMINI_API_KEY=... cargo test --test live gemini_keeps -- --ignored --nocapture
#[tokio::test]
#[ignore = "needs GEMINI_API_KEY"]
async fn gemini_keeps_the_thought_signature_across_a_tool_round() {
    let Ok(api_key) = std::env::var("GEMINI_API_KEY") else {
        eprintln!("set GEMINI_API_KEY to run this test");
        return;
    };
    let base_url = std::env::var("GEMINI_BASE_URL")
        .unwrap_or_else(|_| "https://generativelanguage.googleapis.com/v1beta/openai".into());
    let model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-3-flash-preview".into());
    let tools = json!([{
        "type": "function",
        "function": {
            "name": "get_portfolio_summary",
            "description": "Get the portfolio summary",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    }]);
    let first = json!([{ "role": "user", "content": "Call the get_portfolio_summary tool now." }]);

    let (events, emit) = collector();
    let outcome = stream_completion(
        CompletionRequest {
            base_url: &base_url,
            api_key: Some(&api_key),
            model: &model,
            messages: &first,
            tools: Some(&tools),
        },
        Arc::new(AtomicBool::new(false)),
        emit,
    )
    .await
    .expect("the first round should stream");

    assert_eq!(outcome.tool_calls.len(), 1, "expected one tool call, events: {events:?}");
    let call = &outcome.tool_calls[0];
    let signature = call
        .extra_content
        .clone()
        .expect("Gemini 3 returns a thought signature with the call");

    let follow_up = |include_signature: bool| {
        let mut echoed = json!({
            "id": call.id,
            "type": "function",
            "function": {"name": call.name, "arguments": call.arguments}
        });
        if include_signature {
            echoed["extra_content"] = signature.clone();
        }
        json!([
            { "role": "user", "content": "Call the get_portfolio_summary tool now." },
            { "role": "assistant", "content": "", "tool_calls": [echoed] },
            {
                "role": "tool",
                "tool_call_id": call.id,
                "name": call.name,
                "content": "{\"total_value_base\": 406860.98}"
            }
        ])
    };

    let without = stream_completion(
        CompletionRequest {
            base_url: &base_url,
            api_key: Some(&api_key),
            model: &model,
            messages: &follow_up(false),
            tools: Some(&tools),
        },
        Arc::new(AtomicBool::new(false)),
        collector().1,
    )
    .await;
    let without = without.expect_err("dropping the signature must be rejected");
    assert!(without.contains("400"), "got: {without}");

    let with = stream_completion(
        CompletionRequest {
            base_url: &base_url,
            api_key: Some(&api_key),
            model: &model,
            messages: &follow_up(true),
            tools: Some(&tools),
        },
        Arc::new(AtomicBool::new(false)),
        collector().1,
    )
    .await
    .expect("echoing the signature must work");
    println!("answer: {}", with.content);
    assert!(!with.content.is_empty() || !with.tool_calls.is_empty());
}

/// Gemini streams tool calls without an `index`, one delta per call.
///
/// Keying the accumulator on `index` alone merged every call into the first
/// slot, so names came out as `get_allocationget_allocationlist_assets` and the
/// app answered its own model with "Unknown tool", which then made the next
/// request invalid.
///
///   GEMINI_API_KEY=... cargo test --test live gemini_streams_two -- --ignored --nocapture
#[tokio::test]
#[ignore = "needs GEMINI_API_KEY"]
async fn gemini_streams_two_tool_calls_kept_apart() {
    let Ok(api_key) = std::env::var("GEMINI_API_KEY") else {
        eprintln!("set GEMINI_API_KEY to run this test");
        return;
    };
    let base_url = std::env::var("GEMINI_BASE_URL")
        .unwrap_or_else(|_| "https://generativelanguage.googleapis.com/v1beta/openai".into());
    let model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-3-flash-preview".into());
    let tools = json!([
        {
            "type": "function",
            "function": {
                "name": "get_portfolio_summary",
                "description": "Get the portfolio summary",
                "parameters": {"type": "object", "properties": {}, "required": []}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_allocation",
                "description": "Portfolio allocation by dimension",
                "parameters": {
                    "type": "object",
                    "properties": {"dimension": {"type": "string", "enum": ["category", "institution", "currency"]}},
                    "required": ["dimension"]
                }
            }
        }
    ]);
    let messages = json!([{
        "role": "user",
        "content": "Call BOTH get_portfolio_summary and get_allocation with dimension category in the same turn, now, without asking."
    }]);

    let outcome = stream_completion(
        CompletionRequest {
            base_url: &base_url,
            api_key: Some(&api_key),
            model: &model,
            messages: &messages,
            tools: Some(&tools),
        },
        Arc::new(AtomicBool::new(false)),
        collector().1,
    )
    .await
    .expect("stream should succeed");

    let names: Vec<&str> = outcome.tool_calls.iter().map(|c| c.name.as_str()).collect();
    println!("tool calls: {names:?}");
    assert_eq!(names.len(), 2, "expected two separate calls, got {names:?}");
    for name in &names {
        assert!(
            ["get_portfolio_summary", "get_allocation"].contains(name),
            "merged or unknown name: {name}"
        );
    }
}
