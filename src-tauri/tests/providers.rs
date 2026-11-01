//! Provider rows: the half of the commands that touches SQLite.
//!
//! These call the same functions the commands call, against a throwaway database,
//! so the rules that decide where an API key may go are exercised without an
//! `AppHandle` and without touching the real Keychain. The Keychain half is
//! covered by `secrets`' own tests and by the ignored round-trip in `live.rs`.

use financetrackerapp_lib::commands::providers::{
    delete_row, replace_providers, reset_rows, save_row, set_default_row, ModelChoice,
    ProviderInput, RestoreInput,
};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::str::FromStr;

async fn fresh(name: &str) -> (String, String) {
    let dir = std::env::temp_dir().join(format!("ft-providers-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("test.db");
    let url = format!("sqlite://{}?mode=rwc", file.display());

    let mut connection = SqliteConnection::connect(&url).await.unwrap();
    sqlx::raw_sql(include_str!("../migrations/0001_init.sql"))
        .execute(&mut connection)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../migrations/0002_full_schema.sql"))
        .execute(&mut connection)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../migrations/0004_provider_models.sql"))
        .execute(&mut connection)
        .await
        .unwrap();

    (file.display().to_string(), url)
}

/// Replace every provider, committed — the shape `providers_restore` used to have.
async fn restore_rows(
    connection: &mut SqliteConnection,
    rows: &[RestoreInput],
) -> Result<Vec<financetrackerapp_lib::commands::providers::PendingKey>, String> {
    let mut transaction = connection.begin().await.unwrap();
    let keys = replace_providers(&mut transaction, rows).await?;
    transaction.commit().await.unwrap();
    Ok(keys)
}

async fn connection(url: &str) -> SqliteConnection {
    let options = SqliteConnectOptions::from_str(url).unwrap().foreign_keys(true);
    SqliteConnection::connect_with(&options).await.unwrap()
}

async fn scalar(url: &str, sql: &str) -> i64 {
    let mut connection = SqliteConnection::connect(url).await.unwrap();
    let row: (i64,) = sqlx::query_as(sql).fetch_one(&mut connection).await.unwrap();
    row.0
}

async fn text(url: &str, sql: &str) -> Option<String> {
    let mut connection = SqliteConnection::connect(url).await.unwrap();
    let row: (Option<String>,) = sqlx::query_as(sql).fetch_one(&mut connection).await.unwrap();
    row.0
}

fn input(name: &str, base_url: &str) -> ProviderInput {
    ProviderInput {
        id: None,
        name: name.to_string(),
        base_url: base_url.to_string(),
        model: "qwen3".to_string(),
        provider_type: "openai".to_string(),
        is_active: true,
        models: None,
        api_key: None,
    }
}

#[tokio::test]
async fn the_first_provider_becomes_the_default() {
    let (_file, url) = fresh("default").await;
    let mut connection = connection(&url).await;

    let first = save_row(&mut connection, &input("Local", "http://localhost:11434/v1"), false, false)
        .await
        .unwrap();
    assert_eq!(scalar(&url, "SELECT is_default FROM llm_providers WHERE id = 1").await, 1);

    save_row(&mut connection, &input("Cloud", "https://api.openai.com/v1"), false, false)
        .await
        .unwrap();
    assert_eq!(scalar(&url, "SELECT is_default FROM llm_providers WHERE id = 2").await, 0);
    assert_eq!(first, 1);
}

#[tokio::test]
async fn the_key_reference_follows_the_key_that_will_be_used() {
    let (_file, url) = fresh("ref").await;
    let mut connection = connection(&url).await;

    let id = save_row(&mut connection, &input("Cloud", "https://api.openai.com/v1"), true, false)
        .await
        .unwrap();
    assert_eq!(
        text(&url, "SELECT keychain_ref FROM llm_providers WHERE id = 1").await,
        Some(format!("provider:{id}")),
        "a key is about to be written, so the row must point at it"
    );

    // Updating without a key, but the stored one still belongs here: keep it.
    let mut update = input("Cloud renamed", "https://api.openai.com/v2");
    update.id = Some(id);
    save_row(&mut connection, &update, false, true).await.unwrap();
    assert_eq!(
        text(&url, "SELECT keychain_ref FROM llm_providers WHERE id = 1").await,
        Some(format!("provider:{id}")),
        "same origin, so the key survives a rename and a path change"
    );

    // The endpoint moved: the key no longer belongs to it and is dropped.
    let mut moved = input("Cloud", "https://attacker.tld/v1");
    moved.id = Some(id);
    save_row(&mut connection, &moved, false, false).await.unwrap();
    assert_eq!(
        text(&url, "SELECT keychain_ref FROM llm_providers WHERE id = 1").await,
        None,
        "a repointed provider must not keep a key bound to the old host"
    );
    assert_eq!(
        text(&url, "SELECT base_url FROM llm_providers WHERE id = 1").await,
        Some("https://attacker.tld/v1".to_string())
    );
}

#[tokio::test]
async fn models_are_replaced_not_appended() {
    let (_file, url) = fresh("models").await;
    let mut connection = connection(&url).await;

    let mut first = input("Local", "http://localhost:11434/v1");
    first.models = Some(vec![
        ModelChoice { model: "qwen3".into(), enabled: true },
        ModelChoice { model: "llama3".into(), enabled: false },
        ModelChoice { model: "qwen3".into(), enabled: true },
    ]);
    let id = save_row(&mut connection, &first, false, false).await.unwrap();
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM provider_models").await, 2);

    let mut second = input("Local", "http://localhost:11434/v1");
    second.id = Some(id);
    second.models = Some(vec![ModelChoice { model: "mistral".into(), enabled: true }]);
    save_row(&mut connection, &second, false, false).await.unwrap();

    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM provider_models").await, 1);
    assert_eq!(
        text(&url, "SELECT model FROM provider_models LIMIT 1").await,
        Some("mistral".to_string())
    );
}

#[tokio::test]
async fn an_invalid_endpoint_is_refused_before_anything_is_written() {
    let (_file, url) = fresh("invalid").await;
    let mut connection = connection(&url).await;

    for base_url in ["file:///etc/passwd", "javascript:alert(1)", "not a url"] {
        let error = save_row(&mut connection, &input("Bad", base_url), false, false)
            .await
            .unwrap_err();
        assert!(!error.is_empty(), "no error for {base_url}");
    }
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM llm_providers").await, 0);
}

#[tokio::test]
async fn updating_a_provider_that_does_not_exist_is_an_error() {
    let (_file, url) = fresh("missing").await;
    let mut connection = connection(&url).await;

    let mut update = input("Ghost", "https://api.openai.com/v1");
    update.id = Some(42);
    let error = save_row(&mut connection, &update, false, false).await.unwrap_err();
    assert!(error.contains("not found"), "{error}");
}

#[tokio::test]
async fn deleting_the_default_moves_the_flag_to_the_oldest_survivor() {
    let (_file, url) = fresh("delete").await;
    let mut connection = connection(&url).await;

    save_row(&mut connection, &input("A", "http://localhost:11434/v1"), false, false)
        .await
        .unwrap();
    save_row(&mut connection, &input("B", "https://api.openai.com/v1"), false, false)
        .await
        .unwrap();
    delete_row(&mut connection, 1).await.unwrap();

    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM llm_providers").await, 1);
    assert_eq!(
        scalar(&url, "SELECT is_default FROM llm_providers WHERE id = 2").await,
        1,
        "the survivor becomes the default"
    );

    assert!(delete_row(&mut connection, 1).await.is_err(), "deleting it twice is an error");
}

#[tokio::test]
async fn the_default_flag_moves_without_a_second_row_keeping_it() {
    let (_file, url) = fresh("set-default").await;
    let mut connection = connection(&url).await;

    save_row(&mut connection, &input("A", "http://localhost:11434/v1"), false, false)
        .await
        .unwrap();
    let second = save_row(&mut connection, &input("B", "https://api.openai.com/v1"), false, false)
        .await
        .unwrap();

    set_default_row(&mut connection, second).await.unwrap();
    assert_eq!(
        scalar(&url, "SELECT COUNT(*) FROM llm_providers WHERE is_default = 1").await,
        1
    );
    assert_eq!(
        scalar(&url, "SELECT is_default FROM llm_providers WHERE id = 2").await,
        1
    );
    assert!(set_default_row(&mut connection, 99).await.is_err());
}

#[tokio::test]
async fn a_backup_is_restored_with_its_ids_models_and_key_orders() {
    let (_file, url) = fresh("restore").await;
    let mut connection = connection(&url).await;

    // A leftover row that the restore must replace.
    save_row(&mut connection, &input("Stale", "http://localhost:11434/v1"), false, false)
        .await
        .unwrap();

    let rows = vec![
        RestoreInput {
            id: 7,
            name: "Gemini".into(),
            base_url: "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            model: "gemini-2.5-flash".into(),
            provider_type: Some("gemini".into()),
            is_default: true,
            is_active: Some(true),
            created_at: Some("2026-01-01T00:00:00.000Z".into()),
            updated_at: None,
            api_key: Some("AIza-not-a-real-key".into()),
            models: vec![ModelChoice { model: "gemini-2.5-flash".into(), enabled: true }],
        },
        RestoreInput {
            id: 3,
            name: "Ollama".into(),
            base_url: "http://localhost:11434/v1".into(),
            model: "qwen3".into(),
            provider_type: None,
            is_default: true, // a second default in the file must not collide
            is_active: None,
            created_at: None,
            updated_at: None,
            api_key: None,
            models: vec![],
        },
    ];

    let keys = restore_rows(&mut connection, &rows).await.unwrap();

    assert_eq!(
        keys.len(),
        1,
        "only the row with a key produces a pending key"
    );
    assert_eq!(keys[0].account, "provider:7");
    assert_eq!(keys[0].base_url, "https://generativelanguage.googleapis.com/v1beta/openai");

    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM llm_providers").await, 2);
    assert_eq!(
        scalar(&url, "SELECT COUNT(*) FROM llm_providers WHERE is_default = 1").await,
        1,
        "exactly one default survives a file that has two"
    );
    assert_eq!(
        scalar(&url, "SELECT is_default FROM llm_providers WHERE id = 7").await,
        1
    );
    assert_eq!(
        text(&url, "SELECT created_at FROM llm_providers WHERE id = 7").await,
        Some("2026-01-01T00:00:00.000Z".to_string())
    );
    assert_eq!(
        text(&url, "SELECT keychain_ref FROM llm_providers WHERE id = 7").await,
        Some("provider:7".to_string())
    );
    assert_eq!(
        text(&url, "SELECT keychain_ref FROM llm_providers WHERE id = 3").await,
        None
    );
}

#[tokio::test]
async fn a_backup_with_no_default_gets_one() {
    let (_file, url) = fresh("restore-nodefault").await;
    let mut connection = connection(&url).await;

    let rows = vec![RestoreInput {
        id: 1,
        name: "Only".into(),
        base_url: "http://localhost:11434/v1".into(),
        model: "qwen3".into(),
        provider_type: None,
        is_default: false,
        is_active: None,
        created_at: None,
        updated_at: None,
        api_key: None,
        models: vec![],
    }];
    restore_rows(&mut connection, &rows).await.unwrap();

    assert_eq!(
        scalar(&url, "SELECT is_default FROM llm_providers WHERE id = 1").await,
        1
    );
}

#[tokio::test]
async fn a_backup_pointing_at_a_file_url_is_refused() {
    let (_file, url) = fresh("restore-file").await;
    let mut connection = connection(&url).await;

    let rows = vec![RestoreInput {
        id: 1,
        name: "Evil".into(),
        base_url: "file:///etc/passwd".into(),
        model: "m".into(),
        provider_type: None,
        is_default: true,
        is_active: None,
        created_at: None,
        updated_at: None,
        api_key: Some("k".into()),
        models: vec![],
    }];

    assert!(restore_rows(&mut connection, &rows).await.is_err());
    assert_eq!(
        scalar(&url, "SELECT COUNT(*) FROM llm_providers").await,
        0,
        "the batch rolled back"
    );
}

#[tokio::test]
async fn reset_reports_the_providers_it_removed() {
    let (_file, url) = fresh("reset").await;
    let mut connection = connection(&url).await;

    save_row(&mut connection, &input("A", "http://localhost:11434/v1"), true, false)
        .await
        .unwrap();
    save_row(&mut connection, &input("B", "https://api.openai.com/v1"), false, false)
        .await
        .unwrap();

    let ids = reset_rows(&mut connection).await.unwrap();
    assert_eq!(ids, vec![1, 2], "the caller needs the ids to delete their keys");
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM llm_providers").await, 0);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM provider_models").await, 0);
}

// ---------------------------------------------------------------------------
// The TS/Rust boundary
// ---------------------------------------------------------------------------
//
// Every payload below is copied from what the webview actually sends. These are
// the tests that would have caught `provider_save` rejecting every create and
// edit: the struct had `#[serde(rename_all = "camelCase")]` while TypeScript
// sent `base_url`, and nothing compared the two sides.

#[test]
fn the_form_payload_deserializes_as_the_webview_sends_it() {
    // `createProvider` / `updateProvider` in src/db/repositories/llmProviders.ts.
    let payload = serde_json::json!({
        "id": serde_json::Value::Null,
        "name": "Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-2.5-flash",
        "provider_type": "gemini",
        "is_active": true,
        "models": [{ "model": "gemini-2.5-flash", "enabled": true }],
        "api_key": "AIza-not-a-real-key"
    });

    let input: ProviderInput = serde_json::from_value(payload).expect("the form payload must deserialize");
    assert_eq!(input.id, None);
    assert_eq!(input.base_url, "https://generativelanguage.googleapis.com/v1beta/openai");
    assert_eq!(input.provider_type, "gemini");
    assert!(input.is_active);
    assert_eq!(input.api_key.as_deref(), Some("AIza-not-a-real-key"));
    assert_eq!(input.models.expect("models").len(), 1);
}

#[test]
fn an_edit_payload_carries_the_id() {
    let payload = serde_json::json!({
        "id": 3,
        "name": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "model": "qwen3",
        "provider_type": "openai",
        "is_active": true,
        "models": serde_json::Value::Null,
        "api_key": serde_json::Value::Null,
    });

    let input: ProviderInput = serde_json::from_value(payload).expect("the edit payload must deserialize");
    assert_eq!(input.id, Some(3));
    assert_eq!(input.api_key, None, "an empty key means 'unchanged', not 'clear'");
    assert!(input.models.is_none(), "null models means 'leave the rows alone'");
}

#[test]
fn the_seed_payload_deserializes_too() {
    // `seedFirstRun` in src/db/seed.ts.
    let payload = serde_json::json!({
        "id": serde_json::Value::Null,
        "name": "Ollama (default)",
        "base_url": "http://localhost:11434/v1",
        "model": "qwen2.5:7b",
        "provider_type": "openai",
        "is_active": true,
        "models": serde_json::Value::Null,
        "api_key": serde_json::Value::Null,
    });

    let input: ProviderInput = serde_json::from_value(payload).expect("the seed payload must deserialize");
    assert_eq!(input.name, "Ollama (default)");
    assert!(input.api_key.is_none());
}

#[test]
fn a_restore_payload_accepts_booleans_numbers_and_missing_fields() {
    // `providerSchema` allows `boolean | number | undefined` for both flags, and a
    // v2 backup has neither `models` nor a real boolean.
    let payload = serde_json::json!({
        "id": 7,
        "name": "Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-2.5-flash",
        "provider_type": "gemini",
        "is_default": 1,
        "is_active": 0,
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": serde_json::Value::Null,
        "api_key": serde_json::Value::Null,
        "models": [{ "model": "gemini-2.5-flash", "enabled": 1 }]
    });

    let row: RestoreInput = serde_json::from_value(payload).expect("a numeric flag must deserialize");
    assert!(row.is_default);
    assert_eq!(row.is_active, Some(false));
    assert!(row.models[0].enabled);

    // Missing flags: a provider without a default, active by default.
    let minimal = serde_json::json!({
        "id": 8,
        "name": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "model": "qwen3",
        "models": []
    });
    let row: RestoreInput = serde_json::from_value(minimal).expect("missing optional fields must deserialize");
    assert!(!row.is_default);
    assert_eq!(row.is_active, None);
    assert_eq!(row.provider_type, None);
}

// ---------------------------------------------------------------------------
// S1: an endpoint the user has not agreed to
// ---------------------------------------------------------------------------
//
// The webview can call these commands with any URL. A stored key cannot follow it,
// but the chat content can, so a new endpoint (or a keyless default) asks the user
// through a native dialog that only Rust can answer.

use financetrackerapp_lib::commands::providers::{
    default_needs_confirmation, endpoint_needs_confirmation,
};

#[test]
fn a_loopback_endpoint_never_asks() {
    for origin in ["http://localhost:11434", "http://127.0.0.1:1234", "http://[::1]:8080"] {
        assert!(!endpoint_needs_confirmation(Some("https://api.openai.com:443"), origin, 5));
        assert!(!endpoint_needs_confirmation(None, origin, 5));
        assert!(!default_needs_confirmation(origin, false));
    }
}

#[test]
fn a_new_or_moved_remote_endpoint_asks() {
    let openai = "https://api.openai.com:443";
    let attacker = "https://attacker.tld:443";

    // Moving an existing provider to another host: the data path changed.
    assert!(endpoint_needs_confirmation(Some(openai), attacker, 1));
    // A second provider on a new host: it can receive data as soon as chat uses it.
    assert!(endpoint_needs_confirmation(None, attacker, 1));
    // The first provider on a fresh install has no data to leak yet.
    assert!(!endpoint_needs_confirmation(None, attacker, 0));
    // The same origin, a different path: nothing to ask.
    assert!(!endpoint_needs_confirmation(Some(openai), openai, 3));
}

#[test]
fn a_keyless_remote_default_asks_and_a_keyed_one_does_not() {
    assert!(default_needs_confirmation("https://attacker.tld:443", false));
    assert!(!default_needs_confirmation("https://api.openai.com:443", true));
    assert!(!default_needs_confirmation("http://localhost:11434", false));
}
