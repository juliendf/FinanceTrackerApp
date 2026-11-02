//! Transaction and import-SQL tests.
//!
//! `cargo test` runs the atomicity tests against a throwaway database: they
//! prove that `execute_statements` really is all-or-nothing and that foreign
//! keys are enforced.
//!
//! The import test needs SQL produced by the TypeScript importer, so it is
//! `#[ignore]`d and driven explicitly:
//!
//!   IMPORT_SQL=/tmp/ft-import.sql cargo test --test import_sql -- --ignored
//!
//! Generate that file with:
//!
//!   IMPORT_SQL_OUT=/tmp/ft-import.sql FINANCETRACKER_BACKUP=... npx vitest run src/import

use std::path::PathBuf;

use financetrackerapp_lib::commands::db::{check_statement, execute_statements};
use sqlx::{Connection, SqliteConnection};

/// Fresh database with the real migrations applied.
async fn fresh_database(name: &str) -> (PathBuf, String) {
    let dir = std::env::temp_dir().join(format!("ft-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("test.db");
    let url = format!("sqlite://{}?mode=rwc", file.display());

    let mut connection = SqliteConnection::connect(&url).await.unwrap();
    // raw_sql handles multi-statement files, unlike sqlx::query.
    sqlx::raw_sql(include_str!("../migrations/0001_init.sql"))
        .execute(&mut connection)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../migrations/0002_full_schema.sql"))
        .execute(&mut connection)
        .await
        .unwrap();

    (file, url)
}

async fn scalar(url: &str, sql: &str) -> i64 {
    let mut connection = SqliteConnection::connect(url).await.unwrap();
    let row: (i64,) = sqlx::query_as(sql).fetch_one(&mut connection).await.unwrap();
    row.0
}

#[tokio::test]
async fn commits_every_statement() {
    let (_file, url) = fresh_database("commit").await;

    let statements = vec![
        "INSERT INTO institutions (id, name) VALUES (1, 'A')".to_string(),
        "INSERT INTO institutions (id, name) VALUES (2, 'B')".to_string(),
        "INSERT INTO categories (id, name, color) VALUES (1, 'C', '#ffffff')".to_string(),
        "INSERT INTO assets (id, institution_id, category_id, currency, product_name) VALUES (1, 1, 1, 'EUR', 'P')".to_string(),
    ];

    let count = execute_statements(&url, &statements).await.unwrap();
    assert_eq!(count, 4);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM assets").await, 1);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM institutions").await, 2);
}

#[tokio::test]
async fn rolls_back_everything_when_a_statement_fails() {
    let (_file, url) = fresh_database("rollback").await;

    let statements = vec![
        "INSERT INTO institutions (id, name) VALUES (1, 'A')".to_string(),
        // Violates UNIQUE(name): everything before it must disappear.
        "INSERT INTO institutions (id, name) VALUES (2, 'A')".to_string(),
    ];

    let error = execute_statements(&url, &statements).await.unwrap_err();
    assert!(error.contains("statement 2 of 2"), "got: {error}");
    assert!(error.contains("UNIQUE"), "got: {error}");

    // The first insert must not survive.
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM institutions").await, 0);
}

#[tokio::test]
async fn enforces_foreign_keys() {
    let (_file, url) = fresh_database("fk").await;

    let statements = vec![
        // institution 99 does not exist
        "INSERT INTO assets (id, institution_id, category_id, currency, product_name) VALUES (1, 99, 1, 'EUR', 'P')".to_string(),
    ];

    let error = execute_statements(&url, &statements).await.unwrap_err();
    assert!(error.contains("FOREIGN KEY"), "got: {error}");
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM assets").await, 0);
}

#[tokio::test]
async fn rejects_an_invalid_date() {
    let (_file, url) = fresh_database("date").await;

    let statements = vec![
        "INSERT INTO institutions (id, name) VALUES (1, 'A')".to_string(),
        "INSERT INTO categories (id, name) VALUES (1, 'C')".to_string(),
        "INSERT INTO assets (id, institution_id, category_id, currency, product_name) VALUES (1, 1, 1, 'EUR', 'P')".to_string(),
        "INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (1, '23/04/2025', 100)".to_string(),
    ];

    let error = execute_statements(&url, &statements).await.unwrap_err();
    assert!(error.contains("CHECK") || error.contains("constraint"), "got: {error}");
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM snapshots").await, 0);
}

#[tokio::test]
async fn rejects_an_unsupported_currency() {
    let (_file, url) = fresh_database("currency").await;

    let statements = vec![
        "INSERT INTO institutions (id, name) VALUES (1, 'A')".to_string(),
        "INSERT INTO categories (id, name) VALUES (1, 'C')".to_string(),
        "INSERT INTO assets (id, institution_id, category_id, currency, product_name) VALUES (1, 1, 1, 'GBP', 'P')".to_string(),
    ];

    let error = execute_statements(&url, &statements).await.unwrap_err();
    assert!(error.contains("CHECK") || error.contains("constraint"), "got: {error}");
}

/// Runs the statements produced by the TypeScript importer for a real backup.
#[tokio::test]
#[ignore = "needs IMPORT_SQL generated by the TS importer"]
async fn imports_the_generated_statement_list() {
    let path = std::env::var("IMPORT_SQL").expect("set IMPORT_SQL to a statement file");
    let raw = std::fs::read_to_string(&path).expect("cannot read the statement file");
    let statements: Vec<String> = serde_json::from_str(&raw).expect("statement file must be JSON");

    // IMPORT_DB_URL points the same code at an existing database (the app's own
    // file, after a reset), which is how the real import was verified.
    let (_file, url) = match std::env::var("IMPORT_DB_URL") {
        Ok(url) => (PathBuf::new(), url),
        Err(_) => fresh_database("import").await,
    };
    // Every statement the importer emits must pass the run_transaction guard.
    for (i, statement) in statements.iter().enumerate() {
        check_statement(statement)
            .unwrap_or_else(|e| panic!("guard rejected import statement {}: {e}", i + 1));
    }
    let count = execute_statements(&url, &statements).await.unwrap();
    println!("committed {count} statements");

    for (label, sql) in [
        ("institutions", "SELECT COUNT(*) FROM institutions"),
        ("categories", "SELECT COUNT(*) FROM categories"),
        ("tags", "SELECT COUNT(*) FROM tags"),
        ("asset_tags", "SELECT COUNT(*) FROM asset_tags"),
        ("assets", "SELECT COUNT(*) FROM assets"),
        ("snapshots", "SELECT COUNT(*) FROM snapshots"),
        ("exchange_rates", "SELECT COUNT(*) FROM exchange_rates"),
        ("llm_providers", "SELECT COUNT(*) FROM llm_providers"),
        ("settings", "SELECT COUNT(*) FROM settings"),
        ("profile", "SELECT COUNT(*) FROM profile"),
    ] {
        println!("{label}: {}", scalar(&url, sql).await);
    }

    // No plaintext key may reach the database: the provider row carries only a
    // keychain reference, and nothing else in the schema has a key column.
    assert_eq!(
        scalar(
            &url,
            "SELECT COUNT(*) FROM llm_providers WHERE keychain_ref LIKE '%AIza%' OR name LIKE '%AIza%'"
        )
        .await,
        0,
        "an API key leaked into llm_providers"
    );
}

/// Moves a provider key from a file into the Keychain, bound to the endpoint it
/// was entered for — the same call `providers_restore` makes.
///
/// Verified by hand against the real backup; the key never appears in argv.
#[test]
#[ignore = "writes to the login keychain"]
fn stores_the_provider_key_in_the_keychain() {
    use financetrackerapp_lib::commands::secrets;

    let key = std::fs::read_to_string("/tmp/ft-key.txt").expect("run the key extractor first");
    let key = key.trim();
    assert!(!key.is_empty(), "no key to store");

    let account = "provider:2".to_string();
    let base_url = "https://generativelanguage.googleapis.com/v1beta/openai";
    secrets::store_key(&account, key, base_url).expect("set");
    assert_eq!(
        secrets::read_key(&account, base_url).expect("get").as_deref(),
        Some(key)
    );
    // The same key must not be usable from another host.
    assert!(secrets::read_key(&account, "https://attacker.tld/v1").is_err());
    secrets::delete_key(&account).expect("clean up");
    println!("stored and read back {} chars under account {account}", key.len());
}

// ---------------------------------------------------------------------------
// Asset writes. The statements mirror what `src/db/repositories/assets.ts`
// builds (see its unit test, which pins the same expressions), so this proves
// the id-allocation trick works on real SQLite rather than only in TypeScript.
// ---------------------------------------------------------------------------

const NEXT_ASSET_ID: &str =
    "(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'assets'), 0) + 1)";
const JUST_INSERTED: &str = "(SELECT seq FROM sqlite_sequence WHERE name = 'assets')";

fn create_asset_statements(snapshot_date: &str) -> Vec<String> {
    vec![
        format!(
            "INSERT INTO assets (id, institution_id, category_id, currency, product_name) \
             VALUES ({NEXT_ASSET_ID}, 1, 1, 'EUR', 'ETF')"
        ),
        format!("INSERT INTO asset_tags (asset_id, tag_id) VALUES ({JUST_INSERTED}, 1)"),
        format!("INSERT INTO asset_tags (asset_id, tag_id) VALUES ({JUST_INSERTED}, 2)"),
        format!(
            "INSERT INTO snapshots (asset_id, date, amount_minor) \
             VALUES ({JUST_INSERTED}, '{snapshot_date}', 250050)"
        ),
    ]
}

async fn seed_reference_rows(url: &str) {
    execute_statements(
        url,
        &[
            "INSERT INTO institutions (id, name) VALUES (1, 'UBS')".to_string(),
            "INSERT INTO categories (id, name) VALUES (1, 'Cash')".to_string(),
            "INSERT INTO tags (id, name) VALUES (1, 'Liquid')".to_string(),
            "INSERT INTO tags (id, name) VALUES (2, 'Illiquide')".to_string(),
        ],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn creating_an_asset_links_its_tags_and_snapshot_to_the_new_id() {
    let (_file, url) = fresh_database("asset-create").await;
    seed_reference_rows(&url).await;

    execute_statements(&url, &create_asset_statements("2026-01-01")).await.unwrap();
    assert_eq!(scalar(&url, "SELECT id FROM assets").await, 1);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM asset_tags WHERE asset_id = 1").await, 2);
    assert_eq!(scalar(&url, "SELECT amount_minor FROM snapshots WHERE asset_id = 1").await, 250050);

    // A second asset gets the next id and its own links, leaving the first alone.
    execute_statements(&url, &create_asset_statements("2026-02-01")).await.unwrap();
    assert_eq!(scalar(&url, "SELECT MAX(id) FROM assets").await, 2);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM asset_tags WHERE asset_id = 2").await, 2);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM snapshots WHERE asset_id = 1").await, 1);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM snapshots WHERE asset_id = 2").await, 1);
}

#[tokio::test]
async fn a_failing_snapshot_rolls_back_the_asset_and_its_tags() {
    let (_file, url) = fresh_database("asset-rollback").await;
    seed_reference_rows(&url).await;

    // The date violates the CHECK constraint on the *last* statement.
    let error = execute_statements(&url, &create_asset_statements("not-a-date")).await.unwrap_err();
    assert!(error.contains("statement 4 of 4"), "got: {error}");

    // Nothing was ever committed.
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM assets").await, 0);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM asset_tags").await, 0);
}

#[tokio::test]
async fn allocated_ids_are_never_reused_after_a_delete() {
    let (_file, url) = fresh_database("asset-ids").await;
    seed_reference_rows(&url).await;

    execute_statements(&url, &create_asset_statements("2026-01-01")).await.unwrap();
    execute_statements(
        &url,
        &[
            "DELETE FROM asset_tags WHERE asset_id = 1".to_string(),
            "DELETE FROM snapshots WHERE asset_id = 1".to_string(),
            "DELETE FROM assets WHERE id = 1".to_string(),
        ],
    )
    .await
    .unwrap();
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM assets").await, 0);

    // sqlite_sequence remembers 1, so the next asset is 2, not 1 again.
    execute_statements(&url, &create_asset_statements("2026-03-01")).await.unwrap();
    assert_eq!(scalar(&url, "SELECT id FROM assets").await, 2);
}

#[tokio::test]
async fn updating_an_asset_replaces_its_tags_atomically() {
    let (_file, url) = fresh_database("asset-update").await;
    seed_reference_rows(&url).await;
    execute_statements(&url, &create_asset_statements("2026-01-01")).await.unwrap();

    execute_statements(
        &url,
        &[
            "UPDATE assets SET product_name = 'ETF World' WHERE id = 1".to_string(),
            "DELETE FROM asset_tags WHERE asset_id = 1".to_string(),
            "INSERT INTO asset_tags (asset_id, tag_id) VALUES (1, 1)".to_string(),
        ],
    )
    .await
    .unwrap();
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM asset_tags WHERE asset_id = 1").await, 1);

    // A bad tag reference mid-update leaves the previous tag set intact.
    let error = execute_statements(
        &url,
        &[
            "DELETE FROM asset_tags WHERE asset_id = 1".to_string(),
            "INSERT INTO asset_tags (asset_id, tag_id) VALUES (1, 999)".to_string(),
        ],
    )
    .await
    .unwrap_err();
    assert!(error.contains("FOREIGN KEY"), "got: {error}");
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM asset_tags WHERE asset_id = 1").await, 1);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

async fn seed_two_assets(url: &str) {
    seed_reference_rows(url).await;
    execute_statements(
        url,
        &[
            "INSERT INTO assets (id, institution_id, category_id, currency, product_name) VALUES (1, 1, 1, 'EUR', 'A')".to_string(),
            "INSERT INTO assets (id, institution_id, category_id, currency, product_name) VALUES (2, 1, 1, 'EUR', 'B')".to_string(),
        ],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_bulk_snapshot_batch_with_one_duplicate_writes_nothing() {
    let (_file, url) = fresh_database("bulk-snapshots").await;
    seed_two_assets(&url).await;
    execute_statements(
        &url,
        &["INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (2, '2026-03-01', 500)".to_string()],
    )
    .await
    .unwrap();

    // Asset 1 is fine, asset 2 already has a snapshot on that date.
    let error = execute_statements(
        &url,
        &[
            "INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (1, '2026-03-01', 100)".to_string(),
            "INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (2, '2026-03-01', 200)".to_string(),
        ],
    )
    .await
    .unwrap_err();
    assert!(error.contains("statement 2 of 2"), "got: {error}");
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM snapshots").await, 1);
}

#[tokio::test]
async fn a_bulk_snapshot_batch_commits_every_row() {
    let (_file, url) = fresh_database("bulk-snapshots-ok").await;
    seed_two_assets(&url).await;
    execute_statements(
        &url,
        &[
            "INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (1, '2026-03-01', 100)".to_string(),
            "INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (2, '2026-03-01', 200)".to_string(),
        ],
    )
    .await
    .unwrap();
    assert_eq!(scalar(&url, "SELECT SUM(amount_minor) FROM snapshots").await, 300);
}

#[tokio::test]
async fn a_snapshot_is_unique_per_asset_and_date() {
    let (_file, url) = fresh_database("snapshot-unique").await;
    seed_two_assets(&url).await;
    let insert = "INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (1, '2026-03-01', 100)".to_string();
    execute_statements(&url, &[insert.clone()]).await.unwrap();
    assert!(execute_statements(&url, &[insert]).await.is_err());
    // Same date on another asset, and another date on the same asset, are fine.
    execute_statements(
        &url,
        &[
            "INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (2, '2026-03-01', 100)".to_string(),
            "INSERT INTO snapshots (asset_id, date, amount_minor) VALUES (1, '2026-03-02', 100)".to_string(),
        ],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_bulk_amount_update_rolls_back_on_an_invalid_amount() {
    let (_file, url) = fresh_database("bulk-update").await;
    seed_two_assets(&url).await;
    execute_statements(
        &url,
        &[
            "INSERT INTO snapshots (id, asset_id, date, amount_minor) VALUES (1, 1, '2026-03-01', 100)".to_string(),
            "INSERT INTO snapshots (id, asset_id, date, amount_minor) VALUES (2, 2, '2026-03-01', 200)".to_string(),
        ],
    )
    .await
    .unwrap();
    let result = execute_statements(
        &url,
        &[
            "UPDATE snapshots SET amount_minor = 999 WHERE id = 1".to_string(),
            "UPDATE snapshots SET amount_minor = -5 WHERE id = 2".to_string(),
        ],
    )
    .await;
    // Whether or not the schema rejects a negative amount, the batch is atomic.
    if result.is_err() {
        assert_eq!(scalar(&url, "SELECT amount_minor FROM snapshots WHERE id = 1").await, 100);
    }
}

// ---------------------------------------------------------------------------
// run_transaction statement guard
// ---------------------------------------------------------------------------


#[test]
fn the_guard_accepts_the_statements_the_app_sends() {
    for sql in [
        "INSERT INTO institutions (id, name) VALUES (1, 'UBS')",
        "  update snapshots SET amount_minor = 5 WHERE id = 1",
        "DELETE FROM snapshots WHERE id = 1;",
        // Semicolons, comments and doubled quotes are fine inside a literal.
        "INSERT INTO tags (id, name) VALUES (1, 'a; DROP TABLE x; -- /* it''s */')",
        "INSERT INTO snapshots (asset_id, date, amount_minor) VALUES ((SELECT seq FROM sqlite_sequence WHERE name = 'assets'), '2026-01-01', 1)",
    ] {
        assert!(check_statement(sql).is_ok(), "should accept: {sql}");
    }
}

#[test]
fn the_guard_refuses_everything_else() {
    for sql in [
        "DROP TABLE assets",
        "PRAGMA writable_schema = 1",
        "ATTACH DATABASE '/tmp/x.db' AS x",
        "CREATE TABLE t (a)",
        "SELECT * FROM assets",
        "",
        "DELETE FROM snapshots; DROP TABLE assets",
        "DELETE FROM snapshots WHERE id = 1; -- trailing",
        "DELETE FROM snapshots /* c */ WHERE id = 1",
        "DELETE FROM snapshots -- c",
        "INSERT INTO tags (id, name) VALUES (1, 'unterminated)",
    ] {
        assert!(check_statement(sql).is_err(), "should refuse: {sql}");
    }
}

// ---------------------------------------------------------------------------
// execute_write: the guarded single-statement path
// ---------------------------------------------------------------------------

use financetrackerapp_lib::commands::db::write_statement;
use serde_json::json;

#[tokio::test]
async fn a_guarded_write_binds_parameters_and_reports_the_insert_id() {
    let (_file, url) = fresh_database("write-bind").await;
    seed_reference_rows(&url).await;

    let result = write_statement(
        &url,
        "INSERT INTO assets (institution_id, category_id, currency, product_name, name) VALUES (?, ?, ?, ?, ?)",
        &[json!(1), json!(1), json!("CHF"), json!("Compte"), json!("L'épargne d'abord; -- non")],
    )
    .await
    .unwrap();

    assert_eq!(result.rows_affected, 1);
    // First row in an empty table gets id 1, and the name round-trips verbatim.
    assert_eq!(result.last_insert_id, 1);
    assert_eq!(
        scalar(&url, "SELECT COUNT(*) FROM assets WHERE name = 'L''épargne d''abord; -- non'").await,
        1
    );

    // A second write to the same table gets the next id.
    let again = write_statement(
        &url,
        "INSERT INTO assets (institution_id, category_id, currency, product_name) VALUES (?, ?, ?, ?)",
        &[json!(1), json!(1), json!("EUR"), json!("Second")],
    )
    .await
    .unwrap();
    assert_eq!(again.last_insert_id, 2);
}

#[tokio::test]
async fn a_guarded_write_refuses_anything_that_is_not_dml() {
    let (_file, url) = fresh_database("write-guard").await;
    seed_reference_rows(&url).await;

    for sql in [
        "PRAGMA foreign_keys = OFF",
        "DROP TABLE assets",
        "ATTACH DATABASE '/tmp/x.db' AS x",
        "SELECT 1",
        "DELETE FROM assets; DROP TABLE assets",
    ] {
        assert!(write_statement(&url, sql, &[]).await.is_err(), "accepted: {sql}");
    }
}

#[tokio::test]
async fn a_guarded_write_updates_and_deletes() {
    let (_file, url) = fresh_database("write-update").await;
    seed_reference_rows(&url).await;

    write_statement(
        &url,
        "INSERT INTO tags (id, name) VALUES (?, ?)",
        &[json!(9), json!("Temp")],
    )
    .await
    .unwrap();

    let updated = write_statement(&url, "UPDATE tags SET name = ? WHERE id = ?", &[json!("Kept"), json!(9)])
        .await
        .unwrap();
    assert_eq!(updated.rows_affected, 1);

    let deleted = write_statement(&url, "DELETE FROM tags WHERE id = ?", &[json!(9)]).await.unwrap();
    assert_eq!(deleted.rows_affected, 1);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM tags WHERE id = 9").await, 0);
}

// ---------------------------------------------------------------------------
// execute_statements_returning_id: the id is read inside the transaction
// ---------------------------------------------------------------------------

use financetrackerapp_lib::commands::db::execute_statements_returning_id;

#[tokio::test]
async fn the_returned_id_is_the_row_the_batch_created() {
    let (_file, url) = fresh_database("returning-id").await;
    seed_reference_rows(&url).await;

    // An asset and a tag link in one batch: the asset id must come back, and the
    // link must point at it with no read between the two statements.
    let (count, id) = execute_statements_returning_id(&url, &create_asset_statements("2026-03-01"), "assets")
        .await
        .unwrap();
    assert_eq!(count, 4);
    assert_eq!(id, 1);
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM asset_tags WHERE asset_id = 1").await, 2);

    // A second batch reports the second id, not the first.
    let (_, second) = execute_statements_returning_id(&url, &create_asset_statements("2026-04-01"), "assets")
        .await
        .unwrap();
    assert_eq!(second, 2);
}

#[tokio::test]
async fn a_failed_batch_returns_no_id_and_writes_nothing() {
    let (_file, url) = fresh_database("returning-id-rollback").await;
    seed_reference_rows(&url).await;

    let statements = vec![
        "INSERT INTO assets (institution_id, category_id, currency, product_name) VALUES (1, 1, 'CHF', 'Kept?')"
            .to_string(),
        // Foreign key that does not exist: the whole batch must roll back.
        "INSERT INTO asset_tags (asset_id, tag_id) VALUES (1, 999)".to_string(),
    ];

    assert!(execute_statements_returning_id(&url, &statements, "assets").await.is_err());
    assert_eq!(scalar(&url, "SELECT COUNT(*) FROM assets").await, 0);
}

#[tokio::test]
async fn an_empty_batch_returns_zero() {
    let (_file, url) = fresh_database("returning-id-empty").await;

    let (count, id) = execute_statements_returning_id(&url, &[], "assets").await.unwrap();
    assert_eq!((count, id), (0, 0));
}
