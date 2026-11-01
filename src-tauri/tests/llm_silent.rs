//! Stop must work while the provider is silent.
//!
//! The stream only yields when bytes arrive, so a provider that is loading a
//! model — or thinking for a minute — used to ignore cancellation until the
//! 300 s timeout. These tests stand up a local server that never answers, and
//! one that answers and then goes quiet, to prove the request returns quickly.
//!
//! No network access beyond 127.0.0.1, so they run in the default suite.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use financetrackerapp_lib::commands::llm::{
    stream_completion, ChatEvent, CompletionRequest,
};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn cancel_after(flag: Arc<AtomicBool>, delay: Duration) {
    tokio::spawn(async move {
        tokio::time::sleep(delay).await;
        flag.store(true, Ordering::Relaxed);
    });
}

#[tokio::test]
async fn cancelling_before_headers_arrive_returns_promptly() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0u8; 2048];
        let _ = socket.read(&mut buffer).await;
        // Accept the request and say nothing at all.
        tokio::time::sleep(Duration::from_secs(30)).await;
    });

    let cancel = Arc::new(AtomicBool::new(false));
    cancel_after(cancel.clone(), Duration::from_millis(300));

    let messages = json!([{ "role": "user", "content": "hi" }]);
    let started = Instant::now();
    let outcome = stream_completion(
        CompletionRequest {
            base_url: &format!("http://{address}"),
            api_key: None,
            model: "any",
            messages: &messages,
            tools: None,
        },
        cancel,
        |_| {},
    )
    .await
    .expect("cancelling is not an error");

    assert!(outcome.cancelled, "expected cancellation");
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "took {:?}, expected under a second",
        started.elapsed()
    );
}

#[tokio::test]
async fn cancelling_after_a_delta_returns_promptly() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0u8; 2048];
        let _ = socket.read(&mut buffer).await;
        let _ = socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n\
                  data: {\"choices\":[{\"delta\":{\"content\":\"Bonjour\"}}]}\n\n",
            )
            .await;
        let _ = socket.flush().await;
        // Then nothing: the model is "thinking".
        tokio::time::sleep(Duration::from_secs(30)).await;
    });

    let cancel = Arc::new(AtomicBool::new(false));
    cancel_after(cancel.clone(), Duration::from_millis(300));

    let messages = json!([{ "role": "user", "content": "hi" }]);
    let events: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = events.clone();

    let started = Instant::now();
    let outcome = stream_completion(
        CompletionRequest {
            base_url: &format!("http://{address}"),
            api_key: None,
            model: "any",
            messages: &messages,
            tools: None,
        },
        cancel,
        move |event: ChatEvent| {
            if let Ok(text) = serde_json::to_string(&event) {
                sink.lock().unwrap().push(text);
            }
        },
    )
    .await
    .expect("cancelling is not an error");

    assert!(outcome.cancelled, "expected cancellation");
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "took {:?}, expected under a second",
        started.elapsed()
    );
    // The text that did arrive was kept and delivered before the stop.
    assert_eq!(outcome.content, "Bonjour");
}
