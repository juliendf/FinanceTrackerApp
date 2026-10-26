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

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Executor, SqliteConnection};
use std::str::FromStr;
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

/// Run a list of statements atomically against the app database.
#[tauri::command]
pub async fn run_transaction(app: AppHandle, statements: Vec<String>) -> Result<usize, String> {
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
