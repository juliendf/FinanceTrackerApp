//! The write guard, attacked.
//!
//! `check_statement` is a text filter, so it is assumed to be bypassable. These
//! tests pin two things: the scanner now understands every kind of quoted token
//! (the reported bypass put a `'` inside a `"…"` identifier to desynchronise it),
//! and the SQLite authorizer refuses the dangerous operations even when the
//! scanner is skipped entirely, which is what happens to the tail of a string
//! that holds several statements.
//!
//! No network access: every test uses a throwaway file in the temp directory.

use financetrackerapp_lib::commands::db::{check_statement, install_write_authorizer, write_statement};
use serde_json::json;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::str::FromStr;

/// A database with one table, and its `sqlite://` URL.
async fn fresh(name: &str) -> (String, String) {
    let dir = std::env::temp_dir().join(format!("ft-guard-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("t.db");
    let url = format!("sqlite://{}?mode=rwc", file.display());

    let mut connection = SqliteConnection::connect(&url).await.unwrap();
    sqlx::raw_sql(
        "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
         CREATE TABLE llm_providers (id INTEGER PRIMARY KEY, base_url TEXT);
         CREATE TABLE provider_models (provider_id INTEGER, model TEXT);
         INSERT INTO t (name) VALUES ('first');",
    )
    .execute(&mut connection)
    .await
    .unwrap();
    (file.display().to_string(), url)
}

/// A connection with the authorizer attached, as the write commands install it.
async fn guarded(url: &str) -> SqliteConnection {
    let options = SqliteConnectOptions::from_str(url).unwrap().foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
    install_write_authorizer(&mut connection).await.unwrap();
    connection
}

async fn count(url: &str, sql: &str) -> Result<i64, String> {
    let mut connection = SqliteConnection::connect(url).await.map_err(|e| e.to_string())?;
    let row: (i64,) = sqlx::query_as(sql).fetch_one(&mut connection).await.map_err(|e| e.to_string())?;
    Ok(row.0)
}

// ---------------------------------------------------------------------------
// The text scanner
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_reported_bypass_is_refused() {
    // A `'` inside a double-quoted identifier used to flip the scanner into
    // "inside a string" mode, so the `;` and the DROP were invisible.
    let payload = r#"DELETE FROM t WHERE (SELECT 1 AS "'") = 0; DROP TABLE t; SELECT 1 AS "'""#;
    assert!(check_statement(payload).is_err(), "the scanner let this through");
}

#[tokio::test]
async fn the_same_trick_with_backticks_and_brackets_is_refused() {
    for payload in [
        "DELETE FROM t WHERE (SELECT 1 AS `'`) = 0; DROP TABLE t; SELECT 1 AS `'`",
        "DELETE FROM t WHERE (SELECT 1 AS ['']) = 0; DROP TABLE t; SELECT 1 AS [']",
    ] {
        assert!(check_statement(payload).is_err(), "the scanner let this through: {payload}");
    }
}

#[test]
fn legitimate_statements_still_pass() {
    for sql in [
        "INSERT INTO t (name) VALUES ('a;b -- not a comment')",
        "UPDATE t SET name = 'o''brien' WHERE id = 1",
        r#"UPDATE t SET "odd;name" = 'x' WHERE id = 1"#,
        "UPDATE t SET `odd;name` = 'x' WHERE id = 1",
        "UPDATE t SET [odd;name] = 'x' WHERE id = 1",
        "DELETE FROM t WHERE id = 1;",
    ] {
        assert!(check_statement(sql).is_ok(), "refused a legitimate statement: {sql}");
    }
}

#[test]
fn comments_and_second_statements_are_refused() {
    for sql in [
        "DELETE FROM t -- why\nWHERE id = 1",
        "DELETE FROM t /* x */ WHERE id = 1",
        "DELETE FROM t WHERE id = 1; DROP TABLE t",
        "SELECT 1",
        "INSERT INTO t (name) VALUES ('unterminated)",
    ] {
        assert!(check_statement(sql).is_err(), "accepted: {sql}");
    }
}

// ---------------------------------------------------------------------------
// The authorizer, with no text filter at all
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_authorizer_refuses_a_hidden_second_statement() {
    let (_file, url) = fresh("tail").await;
    let mut connection = guarded(&url).await;

    // One string, three statements, no scanning: exactly what the tail of a
    // smuggled payload looks like to the engine.
    let payload = "DELETE FROM t; DROP TABLE t; SELECT 1";
    let error = sqlx::raw_sql(payload).execute(&mut connection).await.unwrap_err();
    assert!(error.to_string().contains("not authorized"), "unexpected error: {error}");

    assert_eq!(count(&url, "SELECT COUNT(*) FROM t").await.unwrap(), 0, "the delete should have run");
    // The table survived, which is the point.
    assert_eq!(count(&url, "SELECT COUNT(*) FROM t").await.unwrap(), 0);
}

#[tokio::test]
async fn the_authorizer_refuses_ddl_pragma_and_attach() {
    let (file, url) = fresh("ddl").await;

    for sql in [
        // REINDEX and ANALYZE are refused when they would do work, but a no-op
        // never reaches the authorizer, so they are not listed here.
        "DROP TABLE t".to_string(),
        "ALTER TABLE t ADD COLUMN extra TEXT".to_string(),
        "CREATE TABLE fresh (id INTEGER)".to_string(),
        "CREATE INDEX idx ON t (name)".to_string(),
        "PRAGMA foreign_keys = OFF".to_string(),
        format!("ATTACH DATABASE '{file}' AS copy"),
        "VACUUM INTO '/tmp/ft-vacuum-copy.db'".to_string(),
    ] {
        let mut connection = guarded(&url).await;
        match sqlx::raw_sql(&sql).execute(&mut connection).await {
            Ok(_) => panic!("{sql} was not refused"),
            Err(error) => {
                // SQLite words this "not authorized" for most actions and
                // "authorization denied" for others; both are a refusal.
                let message = error.to_string();
                assert!(message.contains("authoriz"), "{sql} failed for another reason: {message}")
            }
        }
    }
}

#[tokio::test]
async fn the_authorizer_refuses_provider_table_writes() {
    let (_file, url) = fresh("provider").await;

    for sql in [
        "UPDATE llm_providers SET base_url = 'https://attacker.tld' WHERE id = 1",
        "INSERT INTO llm_providers (id, base_url) VALUES (9, 'https://attacker.tld')",
        "DELETE FROM llm_providers",
        "INSERT INTO provider_models (provider_id, model) VALUES (1, 'anything')",
        "DELETE FROM provider_models",
    ] {
        let mut connection = guarded(&url).await;
        let error = sqlx::raw_sql(sql).execute(&mut connection).await.unwrap_err();
        assert!(error.to_string().contains("not authorized"), "{sql} was not refused: {error}");
    }
}

#[tokio::test]
async fn ordinary_writes_still_work_under_the_authorizer() {
    let (_file, url) = fresh("ordinary").await;
    let mut connection = guarded(&url).await;

    sqlx::raw_sql("INSERT INTO t (name) VALUES ('second'); UPDATE t SET name = 'third' WHERE id = 1;")
        .execute(&mut connection)
        .await
        .expect("plain DML must pass the authorizer");
    // AUTOINCREMENT maintains sqlite_sequence internally; the authorizer must not
    // refuse that, or every insert into an autoincrement table would fail.
    assert_eq!(count(&url, "SELECT COUNT(*) FROM t").await.unwrap(), 2);
    assert_eq!(count(&url, "SELECT seq FROM sqlite_sequence WHERE name = 't'").await.unwrap(), 2);
}

#[tokio::test]
async fn the_guarded_write_path_refuses_the_bypass_before_touching_the_database() {
    let (_file, url) = fresh("write-path").await;
    let payload = r#"DELETE FROM t WHERE (SELECT 1 AS "'") = 0; DROP TABLE t; SELECT 1 AS "'""#;

    let error = write_statement(&url, payload, &[json!(1)]).await.unwrap_err();
    assert!(error.contains("multiple statements"), "unexpected error: {error}");
    assert_eq!(count(&url, "SELECT COUNT(*) FROM t").await.unwrap(), 1, "the delete ran anyway");
}
