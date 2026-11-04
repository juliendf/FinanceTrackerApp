//! The schema is created before the window opens.
//!
//! It used to be `tauri-plugin-sql`'s job, and the plugin only migrated a database
//! the webview opened. Once the webview lost every `sql:*` permission, nothing
//! created the file on a fresh install: every command answered "database not
//! found". The migrator now runs from `Builder::setup`, and these tests pin the
//! three cases that matter: first run, second run, and an install that was
//! migrated by the plugin back when the plugin did it.

use financetrackerapp_lib::commands::db::migrate_at;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ft-migrate-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

async fn connect(file: &std::path::Path) -> SqliteConnection {
    let options = SqliteConnectOptions::new().filename(file);
    SqliteConnection::connect_with(&options).await.unwrap()
}

async fn scalar(file: &std::path::Path, sql: &str) -> i64 {
    let mut connection = connect(file).await;
    let row: (i64,) = sqlx::query_as(sql).fetch_one(&mut connection).await.unwrap();
    row.0
}

/// How many migrations the migrator is expected to have applied.
///
/// Counted from the directory rather than hardcoded: the point of these
/// assertions is "every migration is recorded", not "there are eight files".
/// A literal here only has to be edited every time a migration is added, which
/// is exactly when a stale number would go unnoticed.
fn expected_migrations() -> i64 {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    std::fs::read_dir(dir)
        .expect("the migrations directory")
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "sql"))
        .count() as i64
}

#[tokio::test]
async fn creates_the_database_and_its_schema() {
    let dir = temp_dir("fresh");
    let file = dir.join("financetracker.db");
    assert!(!file.exists());

    migrate_at(&file).await.expect("a fresh install must migrate");

    assert!(file.exists(), "the file must be created");
    for table in ["assets", "snapshots", "llm_providers", "provider_models", "settings"] {
        assert_eq!(
            scalar(&file, &format!("SELECT COUNT(*) FROM {table}")).await,
            0,
            "{table} should exist"
        );
    }
    // The column migration 7 added, so "the schema is there" is checked rather
    // than only "a table exists".
    for column in ["tax_residence", "monthly_expenses_minor", "dependants_count", "dependant_ages", "employment_status"] {
        assert_eq!(
            scalar(&file, &format!("SELECT COUNT(*) FROM pragma_table_info('profile') WHERE name = '{column}'")).await,
            1,
            "profile.{column} should exist"
        );
    }
    // Every migration is recorded, so a later release only applies the new ones.
    assert_eq!(scalar(&file, "SELECT COUNT(*) FROM _sqlx_migrations").await, expected_migrations());
}

#[tokio::test]
async fn running_twice_is_a_no_op() {
    let dir = temp_dir("twice");
    let file = dir.join("financetracker.db");

    migrate_at(&file).await.unwrap();
    // Something the app would have written; a re-run of 0001 would drop the tables.
    let mut connection = connect(&file).await;
    sqlx::raw_sql(
        "INSERT INTO institutions (id, name) VALUES (1, 'UBS')",
    )
    .execute(&mut connection)
    .await
    .unwrap();
    drop(connection);

    migrate_at(&file).await.expect("a second run must succeed");

    assert_eq!(scalar(&file, "SELECT COUNT(*) FROM institutions").await, 1);
    assert_eq!(scalar(&file, "SELECT COUNT(*) FROM _sqlx_migrations").await, expected_migrations());
}

#[tokio::test]
async fn an_install_migrated_by_the_plugin_is_left_alone() {
    let dir = temp_dir("legacy");
    let file = dir.join("financetracker.db");

    // What `tauri-plugin-sql` left behind: the same `_sqlx_migrations` table, its
    // versions already applied, and the user's data.
    migrate_at(&file).await.unwrap();
    let mut connection = connect(&file).await;
    sqlx::raw_sql("INSERT INTO institutions (id, name) VALUES (42, 'Before')")
        .execute(&mut connection)
        .await
        .unwrap();
    drop(connection);

    migrate_at(&file).await.expect("an existing install must not fail");

    assert_eq!(
        scalar(&file, "SELECT COUNT(*) FROM institutions WHERE id = 42").await,
        1,
        "existing data must survive the upgrade"
    );
}

#[tokio::test]
async fn the_database_is_in_wal_mode() {
    let dir = temp_dir("wal");
    let file = dir.join("financetracker.db");
    migrate_at(&file).await.unwrap();

    let mut connection = connect(&file).await;
    let row: (String,) = sqlx::query_as("PRAGMA journal_mode").fetch_one(&mut connection).await.unwrap();
    assert_eq!(row.0, "wal");
}
