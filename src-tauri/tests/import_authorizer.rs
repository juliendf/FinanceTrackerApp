//! The backup restore runs under its own SQLite authorizer (FIN-45).
//!
//! `check_statement` is the first filter on backup statements, and it is a text
//! scanner. The authorizer is the backstop: it must let a real restore through
//! and refuse the tables a crafted backup should never reach.
//!
//! No network access: every test uses a throwaway file in the temp directory.

use financetrackerapp_lib::commands::db::{install_import_authorizer, install_write_authorizer};
use financetrackerapp_lib::commands::import::{import_into, ImportRequest};
use financetrackerapp_lib::commands::providers::{ModelChoice, RestoreInput};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::str::FromStr;

async fn fresh(name: &str) -> String {
    let dir = std::env::temp_dir().join(format!("ft-import-auth-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("test.db");
    let url = format!("sqlite://{}?mode=rwc", file.display());

    let mut connection = SqliteConnection::connect(&url).await.unwrap();
    for migration in [
        include_str!("../migrations/0001_init.sql"),
        include_str!("../migrations/0002_full_schema.sql"),
        include_str!("../migrations/0004_provider_models.sql"),
    ] {
        sqlx::raw_sql(migration).execute(&mut connection).await.unwrap();
    }
    // Real name, so the authorizer is what refuses the write, not a missing table.
    sqlx::raw_sql(
        "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, description TEXT);
         INSERT INTO _sqlx_migrations (version, description) VALUES (1, 'init');",
    )
    .execute(&mut connection)
    .await
    .unwrap();
    url
}

async fn guarded_import(url: &str) -> SqliteConnection {
    let options = SqliteConnectOptions::from_str(url).unwrap().foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
    install_import_authorizer(&mut connection).await.unwrap();
    connection
}

async fn scalar(url: &str, sql: &str) -> i64 {
    let mut connection = SqliteConnection::connect(url).await.unwrap();
    let row: (i64,) = sqlx::query_as(sql).fetch_one(&mut connection).await.unwrap();
    row.0
}

fn provider(id: i64) -> RestoreInput {
    RestoreInput {
        id,
        name: "Restored".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        model: "gpt-x".to_string(),
        provider_type: Some("openai".to_string()),
        is_default: true,
        is_active: Some(true),
        created_at: None,
        updated_at: None,
        api_key: None,
        models: vec![ModelChoice { model: "gpt-x".into(), enabled: true }],
    }
}

/// The real restore path, under the import authorizer: data rows, and the
/// provider tables it replaces. A false refusal here would break every restore.
#[tokio::test]
async fn a_restore_passes_the_import_authorizer() {
    let url = fresh("restore").await;
    let mut connection = guarded_import(&url).await;
    let mut transaction = connection.begin().await.unwrap();

    let request = ImportRequest {
        statements: vec![
            "INSERT INTO institutions (id, name) VALUES (10, 'Bank')".to_string(),
            "INSERT INTO categories (id, name) VALUES (10, 'Cash')".to_string(),
            "INSERT INTO assets (id, institution_id, category_id, currency, product_name) \
             VALUES (10, 10, 10, 'EUR', 'Account')"
                .to_string(),
        ],
        providers: vec![provider(5)],
    };
    import_into(&mut transaction, &request)
        .await
        .expect("a valid restore must pass the import authorizer");
    transaction.commit().await.unwrap();

    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM assets").await, 1);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM llm_providers").await, 1);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM provider_models").await, 1);
}

/// The backstop: even with the text scanner skipped, a migration-table write is
/// refused on the restore connection.
#[tokio::test]
async fn the_import_authorizer_refuses_the_migration_table() {
    let url = fresh("migrations").await;
    let mut connection = guarded_import(&url).await;

    let error = sqlx::query("DELETE FROM _sqlx_migrations")
        .execute(&mut connection)
        .await
        .expect_err("the restore must not touch the migration bookkeeping");
    assert!(error.to_string().contains("not authorized"), "{error}");
}

/// Only the two provider tables are added. Other non-writable tables stay refused.
#[tokio::test]
async fn the_import_authorizer_refuses_other_tables() {
    let url = fresh("others").await;
    let mut connection = guarded_import(&url).await;

    for sql in [
        "INSERT INTO sqlite_sequence (name, seq) VALUES ('assets', 999)",
        "UPDATE sqlite_sequence SET seq = 0",
    ] {
        let result = sqlx::query(sql).execute(&mut connection).await;
        assert!(result.is_err(), "should refuse: {sql}");
    }
}

/// The webview's write path still refuses the provider tables: the import
/// authorizer widens only the restore connection.
#[tokio::test]
async fn the_webview_write_path_still_refuses_providers() {
    let url = fresh("webview").await;
    let options = SqliteConnectOptions::from_str(&url).unwrap().foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
    install_write_authorizer(&mut connection).await.unwrap();

    let result = sqlx::query("DELETE FROM llm_providers").execute(&mut connection).await;
    assert!(result.is_err(), "the webview path must not change providers");
}
