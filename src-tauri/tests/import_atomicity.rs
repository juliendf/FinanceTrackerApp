//! An import replaces everything, or changes nothing.
//!
//! The failure this pins: providers were reset, data was reset, data was inserted
//! and providers were restored as four separate steps. When the last step failed,
//! the user was left with their portfolio imported and **every provider and key
//! gone**. Now one transaction covers the whole replacement, and the Keychain is
//! written before the commit.

use financetrackerapp_lib::commands::import::{import_into, ImportRequest};
use financetrackerapp_lib::commands::providers::{ModelChoice, RestoreInput};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};

async fn fresh(name: &str) -> (String, String) {
    let dir = std::env::temp_dir().join(format!("ft-import-{name}-{}", std::process::id()));
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

async fn connect(url: &str) -> SqliteConnection {
    let options = SqliteConnectOptions::from_str(url).unwrap().foreign_keys(true);
    SqliteConnection::connect_with(&options).await.unwrap()
}

use std::str::FromStr;

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

/// The database as it is before an import: one institution, one asset, one
/// provider with a key.
async fn seed_existing(url: &str) {
    let mut connection = connect(url).await;
    sqlx::raw_sql(
        "INSERT INTO institutions (id, name) VALUES (1, 'Old bank');
         INSERT INTO categories (id, name) VALUES (1, 'Cash');
         INSERT INTO assets (id, institution_id, category_id, currency, product_name)
           VALUES (1, 1, 1, 'CHF', 'Old asset');",
    )
    .execute(&mut connection)
    .await
    .unwrap();
    financetrackerapp_lib::commands::providers::save_row(
        &mut connection,
        &financetrackerapp_lib::commands::providers::ProviderInput {
            id: None,
            name: "Old provider".to_string(),
            base_url: "http://localhost:11434/v1".to_string(),
            model: "old".to_string(),
            provider_type: "openai".to_string(),
            is_active: true,
            models: None,
            api_key: None,
        },
        false,
        false,
    )
    .await
    .unwrap();
}

fn provider(id: i64, name: &str) -> RestoreInput {
    RestoreInput {
        id,
        name: name.to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        model: "gpt-x".to_string(),
        provider_type: Some("openai".to_string()),
        is_default: false,
        is_active: Some(true),
        created_at: None,
        updated_at: None,
        api_key: None,
        models: vec![ModelChoice { model: "gpt-x".into(), enabled: true }],
    }
}

fn request(statements: Vec<String>, providers: Vec<RestoreInput>) -> ImportRequest {
    ImportRequest { statements, providers }
}

const GOOD_ROWS: [&str; 3] = [
    "INSERT INTO institutions (id, name) VALUES (10, 'New bank')",
    "INSERT INTO categories (id, name) VALUES (10, 'New category')",
    "INSERT INTO assets (id, institution_id, category_id, currency, product_name)
       VALUES (10, 10, 10, 'EUR', 'New asset')",
];

#[tokio::test]
async fn a_good_import_replaces_everything_in_one_go() {
    let (_file, url) = fresh("good").await;
    seed_existing(&url).await;

    let mut connection = connect(&url).await;
    let mut transaction = connection.begin().await.unwrap();
    let keys = import_into(
        &mut transaction,
        &request(GOOD_ROWS.iter().map(|s| s.to_string()).collect(), vec![provider(5, "New provider")]),
    )
    .await
    .expect("a valid import must succeed");
    transaction.commit().await.unwrap();

    assert!(keys.is_empty(), "no API key in the payload, so nothing for the Keychain");
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM institutions").await, 1);
    assert_eq!(text(&url, "SELECT name FROM institutions").await.as_deref(), Some("New bank"));
    assert_eq!(text(&url, "SELECT product_name FROM assets").await.as_deref(), Some("New asset"));
    assert_eq!(text(&url, "SELECT name FROM llm_providers").await.as_deref(), Some("New provider"));
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM provider_models").await, 1);
    assert_eq!(scalar(&url, "SELECT is_default FROM llm_providers WHERE id = 5").await, 1);
}

#[tokio::test]
async fn a_failing_row_changes_nothing() {
    let (_file, url) = fresh("bad-row").await;
    seed_existing(&url).await;

    let mut rows: Vec<String> = GOOD_ROWS.iter().map(|s| s.to_string()).collect();
    // A dangling foreign key: the batch cannot land.
    rows.push("INSERT INTO assets (id, institution_id, category_id, currency, product_name) VALUES (11, 999, 10, 'EUR', 'Orphan')".to_string());

    let mut connection = connect(&url).await;
    let mut transaction = connection.begin().await.unwrap();
    let error = import_into(&mut transaction, &request(rows, vec![provider(5, "New provider")]))
        .await
        .expect_err("the batch must be refused");
    assert!(error.contains("statement"), "{error}");
    transaction.rollback().await.unwrap();

    // The old database is untouched: this is the R1 failure.
    assert_eq!(text(&url, "SELECT name FROM institutions").await.as_deref(), Some("Old bank"));
    assert_eq!(text(&url, "SELECT product_name FROM assets").await.as_deref(), Some("Old asset"));
    assert_eq!(text(&url, "SELECT name FROM llm_providers").await.as_deref(), Some("Old provider"));
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM provider_models").await, 0);
}

#[tokio::test]
async fn a_failing_provider_restore_keeps_the_old_providers() {
    let (_file, url) = fresh("bad-provider").await;
    seed_existing(&url).await;

    let mut bad = provider(5, "Attacker");
    bad.base_url = "file:///etc/passwd".to_string();

    let mut connection = connect(&url).await;
    let mut transaction = connection.begin().await.unwrap();
    let error = import_into(
        &mut transaction,
        &request(GOOD_ROWS.iter().map(|s| s.to_string()).collect(), vec![bad]),
    )
    .await
    .expect_err("a file: endpoint must be refused");
    assert!(!error.is_empty());
    transaction.rollback().await.unwrap();

    assert_eq!(
        text(&url, "SELECT name FROM llm_providers").await.as_deref(),
        Some("Old provider"),
        "the providers must survive a failed restore"
    );
    assert_eq!(
        text(&url, "SELECT product_name FROM assets").await.as_deref(),
        Some("Old asset"),
        "and so must the data"
    );
}

#[tokio::test]
async fn an_import_carries_its_keys_for_the_caller_to_write() {
    let (_file, url) = fresh("keys").await;
    let mut connection = connect(&url).await;

    let mut with_key = provider(5, "Gemini");
    with_key.base_url = "https://generativelanguage.googleapis.com/v1beta/openai".to_string();
    with_key.api_key = Some("AIza-not-a-real-key".to_string());

    let mut transaction = connection.begin().await.unwrap();
    let keys = import_into(&mut transaction, &request(vec![], vec![with_key]))
        .await
        .unwrap();

    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].account, "provider:5");
    assert_eq!(keys[0].base_url, "https://generativelanguage.googleapis.com/v1beta/openai");
    transaction.commit().await.unwrap();
}

#[tokio::test]
async fn a_statement_the_guard_refuses_is_rejected_before_anything_runs() {
    let (_file, url) = fresh("guard").await;
    seed_existing(&url).await;

    let mut connection = connect(&url).await;
    let mut transaction = connection.begin().await.unwrap();
    let payload = r#"DELETE FROM assets WHERE (SELECT 1 AS "'") = 0; DROP TABLE assets; SELECT 1 AS "'""#;
    let error = import_into(&mut transaction, &request(vec![payload.to_string()], vec![]))
        .await
        .expect_err("a smuggled statement must be refused");
    assert!(error.contains("rejected"), "{error}");
    transaction.rollback().await.unwrap();

    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM assets").await, 1);
}

#[test]
fn an_import_asks_only_for_a_keyless_remote_default() {
    use financetrackerapp_lib::commands::import::backup_default_needs_confirmation;

    let mut remote = provider(5, "Remote");
    remote.is_default = true;
    // Keyless and remote: chat would go there without the user ever agreeing.
    assert_eq!(
        backup_default_needs_confirmation(std::slice::from_ref(&remote)),
        Some("https://api.openai.com:443".to_string())
    );

    // With a key the origin was typed into the form, so it was agreed to.
    let mut keyed = provider(5, "Remote");
    keyed.is_default = true;
    keyed.api_key = Some("sk-test".to_string());
    assert_eq!(backup_default_needs_confirmation(&[keyed]), None);

    // A local model is not going anywhere.
    let mut local = provider(6, "Local");
    local.is_default = true;
    local.base_url = "http://localhost:11434/v1".to_string();
    assert_eq!(backup_default_needs_confirmation(&[local]), None);

    // No providers at all: nothing to ask.
    assert_eq!(backup_default_needs_confirmation(&[]), None);
}
