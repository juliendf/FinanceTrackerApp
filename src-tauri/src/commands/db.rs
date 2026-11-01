//! A transaction primitive the SQL plugin does not offer.
//!
//! `tauri-plugin-sql` executes one prepared statement per call on a pool of up
//! to ten connections, so:
//!   * a `BEGIN … COMMIT` sent as three separate calls can land on three
//!     different connections, and
//!   * a single string holding several statements only runs the first one
//!     (sqlite3 prepares one statement and the tail is discarded).
//!
//! Both matter for bulk writes — the backup importer and the Phase 4 bulk
//! snapshot grid must be all-or-nothing. This module takes a list of statements
//! and runs them inside one real `sqlx` transaction on a dedicated connection,
//! with foreign keys enforced so a bad reference fails the import instead of
//! being written silently.
//!
//! SQL is still generated in TypeScript; Rust only executes the list.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::str::FromStr;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const DB_FILE: &str = "financetracker.db";

/// Resolve the database path used by the SQL plugin.
pub fn database_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("cannot resolve the app data directory: {e}"))?;
    Ok(directory.join(DB_FILE))
}

/// Run every statement in one transaction. Either all land or none do.
///
/// Shared by the command below and by `tests/import_sql.rs`, which is why it
/// takes a URL instead of an `AppHandle`.
pub async fn execute_statements(db_url: &str, statements: &[String]) -> Result<usize, String> {
    if statements.is_empty() {
        return Ok(0);
    }

    let options = SqliteConnectOptions::from_str(db_url)
        .map_err(|e| format!("invalid database URL: {e}"))?
        // Same file as the plugin's pool; WAL lets readers continue and the
        // timeout avoids an immediate SQLITE_BUSY if a pooled write is in flight.
        .busy_timeout(std::time::Duration::from_secs(5))
        // Enforced so a dangling reference fails the import instead of being
        // written. Must be set outside a transaction — SQLite ignores it inside.
        .foreign_keys(true);

    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| format!("cannot open the database: {e}"))?;

    let mut transaction = connection
        .begin()
        .await
        .map_err(|e| format!("cannot start a transaction: {e}"))?;

    for (index, statement) in statements.iter().enumerate() {
        if let Err(error) = sqlx::query(statement).execute(&mut *transaction).await {
            // Dropping the transaction rolls it back.
            return Err(format!(
                "statement {} of {} failed: {error}",
                index + 1,
                statements.len()
            ));
        }
    }

    transaction
        .commit()
        .await
        .map_err(|e| format!("cannot commit: {e}"))?;
    Ok(statements.len())
}

/// Reject anything that is not one plain data-modifying statement.
///
/// `run_transaction` receives SQL text from the webview. Every legitimate caller
/// sends `INSERT`, `UPDATE` or `DELETE`, so anything else (`DROP`, `ATTACH`,
/// `PRAGMA`, `CREATE`, ...) is refused, as is a second statement smuggled in
/// after a `;` and any SQL comment. Text inside single-quoted literals is
/// skipped, with `''` as the escaped quote, so values may contain `;` and `--`.
pub fn check_statement(statement: &str) -> Result<(), String> {
    let trimmed = statement.trim_start();
    let verb: String = trimmed
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_uppercase();
    if !matches!(verb.as_str(), "INSERT" | "UPDATE" | "DELETE") {
        return Err(format!("only INSERT, UPDATE and DELETE are allowed, got `{verb}`"));
    }

    let mut in_string = false;
    let mut chars = statement.trim_end().chars().peekable();
    while let Some(c) = chars.next() {
        if in_string {
            if c == '\'' {
                if chars.peek() == Some(&'\'') {
                    chars.next();
                } else {
                    in_string = false;
                }
            }
            continue;
        }
        match c {
            '\'' => in_string = true,
            ';' => {
                // A single trailing semicolon is harmless; anything after it is not.
                if chars.peek().is_some() {
                    return Err("multiple statements are not allowed".to_string());
                }
            }
            '-' if chars.peek() == Some(&'-') => return Err("SQL comments are not allowed".to_string()),
            '/' if chars.peek() == Some(&'*') => return Err("SQL comments are not allowed".to_string()),
            _ => {}
        }
    }
    if in_string {
        return Err("unterminated string literal".to_string());
    }
    Ok(())
}

/// Result of one write, shaped like the SQL plugin's so call sites do not care
/// which path they went through.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub last_insert_id: i64,
    pub rows_affected: u64,
}

/// One guarded statement with bound parameters, against any database URL.
///
/// Shared by the command below and by `tests/import_sql.rs`, which is why it
/// takes a URL instead of an `AppHandle`.
pub async fn write_statement(
    db_url: &str,
    sql: &str,
    params: &[Value],
) -> Result<WriteResult, String> {
    check_statement(sql)?;

    let options = SqliteConnectOptions::from_str(db_url)
        .map_err(|e| format!("invalid database URL: {e}"))?
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| format!("cannot open the database: {e}"))?;

    let mut query = sqlx::query(sql);
    for param in params.to_vec() {
        query = match param {
            Value::Null => query.bind(Option::<String>::None),
            Value::Bool(flag) => query.bind(i64::from(flag)),
            Value::Number(number) => match number.as_i64() {
                Some(value) => query.bind(value),
                None => query.bind(number.as_f64().unwrap_or_default()),
            },
            Value::String(text) => query.bind(text),
            other => return Err(format!("unsupported parameter: {other}")),
        };
    }

    let result = query
        .execute(&mut connection)
        .await
        .map_err(|e| format!("write failed: {e}"))?;

    Ok(WriteResult {
        last_insert_id: result.last_insert_rowid(),
        rows_affected: result.rows_affected(),
    })
}

/// Run one guarded statement with bound parameters against the app database.
///
/// This replaces the SQL plugin's own `execute` for writes: the plugin accepted
/// any SQL from the webview and bypassed `check_statement`, so its execute
/// permission is not granted. Values stay bound rather than inlined.
#[tauri::command]
pub async fn execute_write(
    app: AppHandle,
    sql: String,
    params: Vec<Value>,
) -> Result<WriteResult, String> {
    let file = database_file(&app)?;
    if !file.exists() {
        return Err(format!("database not found at {}", file.display()));
    }
    write_statement(&format!("sqlite://{}", file.display()), &sql, &params).await
}

/// Run a batch atomically and report the `sqlite_sequence` value of `table`.
///
/// Reading that afterwards on a *pooled* connection is a race: another insert
/// can land in between. Doing it inside the transaction, on the same
/// connection, makes "the id I just created" exact.
pub async fn execute_statements_returning_id(
    db_url: &str,
    statements: &[String],
    table: &str,
) -> Result<(usize, i64), String> {
    if statements.is_empty() {
        return Ok((0, 0));
    }

    let options = SqliteConnectOptions::from_str(db_url)
        .map_err(|e| format!("invalid database URL: {e}"))?
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);

    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| format!("cannot open the database: {e}"))?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|e| format!("cannot start a transaction: {e}"))?;

    for (index, statement) in statements.iter().enumerate() {
        check_statement(statement)
            .map_err(|e| format!("statement {} of {} rejected: {e}", index + 1, statements.len()))?;
        if let Err(error) = sqlx::query(statement).execute(&mut *transaction).await {
            return Err(format!(
                "statement {} of {} failed: {error}",
                index + 1,
                statements.len()
            ));
        }
    }

    let id: i64 = sqlx::query_scalar("SELECT seq FROM sqlite_sequence WHERE name = ?")
        .bind(table)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|e| format!("cannot read the new id: {e}"))?
        .unwrap_or(0);

    transaction
        .commit()
        .await
        .map_err(|e| format!("cannot commit: {e}"))?;
    Ok((statements.len(), id))
}

/// Run a list of statements atomically and return the id of `table`'s last row.
#[tauri::command]
pub async fn run_transaction_returning_id(
    app: AppHandle,
    statements: Vec<String>,
    table: String,
) -> Result<i64, String> {
    let file = database_file(&app)?;
    if !file.exists() {
        return Err(format!("database not found at {}", file.display()));
    }
    // The table name is a literal in TypeScript, but refuse anything that is not
    // a plain identifier before it reaches the query.
    if !table.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("invalid table name: {table}"));
    }
    let (_, id) = execute_statements_returning_id(
        &format!("sqlite://{}", file.display()),
        &statements,
        &table,
    )
    .await?;
    Ok(id)
}

/// Run a list of statements atomically against the app database.
#[tauri::command]
pub async fn run_transaction(app: AppHandle, statements: Vec<String>) -> Result<usize, String> {
    for (index, statement) in statements.iter().enumerate() {
        check_statement(statement)
            .map_err(|e| format!("statement {} of {} rejected: {e}", index + 1, statements.len()))?;
    }
    let file = database_file(&app)?;
    if !file.exists() {
        return Err(format!("database not found at {}", file.display()));
    }
    execute_statements(&format!("sqlite://{}", file.display()), &statements).await
}

/// Absolute path of the database file, for the Data screen.
#[tauri::command]
pub fn database_path(app: AppHandle) -> Result<String, String> {
    Ok(database_file(&app)?.display().to_string())
}
