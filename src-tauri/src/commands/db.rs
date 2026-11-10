//! SQL access, and the only way the webview reaches SQLite.
//!
//! `tauri-plugin-sql` executes one prepared statement per call on a pool of up
//! to ten connections, so:
//!   * a `BEGIN … COMMIT` sent as three separate calls can land on three
//!     different connections, and
//!   * a single string holding several statements only runs the first one
//!     (sqlite3 prepares one statement and the tail is discarded).
//!
//! Both matter for bulk writes — the backup importer and the bulk snapshot grid
//! must be all-or-nothing. This module takes a list of statements
//! and runs them inside one real `sqlx` transaction on a dedicated connection,
//! with foreign keys enforced so a bad reference fails the import instead of
//! being written silently.
//!
//! SQL is still generated in TypeScript; Rust only executes the list.
//!
//! **No webview SQL goes through the plugin any more.** `sql:allow-select` used to
//! be granted, and the plugin's `select` runs the string through sqlx's
//! `fetch_all`, which executes the whole string — so `SELECT 1; DROP TABLE
//! snapshots` came back `Ok` with the table gone, past the scanner and the
//! authorizer because it was a different connection. Reads now go through
//! `db_select`, below, on a read-only connection with a read-only authorizer.
//!
//! **Guarding the text is not enough.** `check_statement` is a first filter, but a
//! hand-written scanner is exactly the kind of thing that gets bypassed: an early
//! version tracked only `'…'`, so a quote inside a `"…"` identifier desynchronised
//! it and a `;` hid a second statement. sqlx prepares and runs whatever follows the
//! `;` as well, so `DELETE …; DROP TABLE t; …` passed the guard and dropped the
//! table. Every write connection therefore also installs a real SQLite
//! **authorizer** (`sqlite3_set_authorizer`, see `write_authorizer`): the engine
//! itself refuses anything that is not a data modification, whatever the text
//! looks like.

use libsqlite3_sys as ffi;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::sqlite::{SqliteArguments, SqliteRow};
use sqlx::{Connection, Sqlite, SqliteConnection};
use std::ffi::CStr;
use std::os::raw::{c_char, c_int, c_void};
use std::str::FromStr;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const DB_FILE: &str = "financetracker.db";

/// The schema, embedded at compile time.
///
/// Filenames are `<version>_<description>.sql`, which is what `sqlx::migrate!`
/// expects. Applied versions are recorded in `_sqlx_migrations`, the same table
/// `tauri-plugin-sql` used, so an existing install is recognised and nothing is
/// re-applied.
pub static MIGRATIONS: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Create the database file if needed, then apply the pending migrations.
///
/// This runs in `Builder::setup`, before the window exists. The SQL plugin used
/// to do it, but only for a database the webview opened — and the webview no
/// longer has that permission, so a fresh install would never have had a schema.
pub async fn migrate(app: &AppHandle) -> Result<(), String> {
    migrate_at(&database_file(app)?).await
}

/// Same, for an explicit path — what the tests use.
pub async fn migrate_at(file: &std::path::Path) -> Result<(), String> {
    if let Some(directory) = file.parent() {
        std::fs::create_dir_all(directory)
            .map_err(|e| format!("cannot create {}: {e}", directory.display()))?;
    }

    // `filename` rather than a `sqlite://` URL: the path contains a space, and
    // the URL form needs escaping.
    let options = SqliteConnectOptions::new()
        .filename(file)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));

    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| format!("cannot open {}: {e}", file.display()))?;

    MIGRATIONS
        .run(&mut connection)
        .await
        .map_err(|e| format!("cannot migrate {}: {e}", file.display()))?;

    connection
        .close()
        .await
        .map_err(|e| format!("cannot close the migrated database: {e}"))?;
    Ok(())
}

/// Resolve the database path used by the write and read commands.
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
    install_write_authorizer(&mut connection).await?;

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
/// This is the *first* filter, not the boundary: `write_authorizer` is what
/// actually stops a smuggled statement. Both are kept, because a readable error
/// beats an engine-level denial when the caller made a mistake.
///
/// Every legitimate caller sends `INSERT`, `UPDATE` or `DELETE`, so anything else
/// (`DROP`, `ATTACH`, `PRAGMA`, `CREATE`, ...) is refused, as is a second
/// statement smuggled in after a `;` and any SQL comment.
///
/// Text is skipped inside all four kinds of quoted token — `'text'`, `"column"`,
/// `` `column` `` and `[column]` — because a `'` inside a double-quoted identifier
/// is not a string delimiter, and treating it as one lets a `;` slip through.
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

    // The table, not just the verb: the importer hands whole statements to Rust,
    // so "which table" is part of what has to be checked. The authorizer enforces
    // the same list at the engine level; this gives a message a human can read.
    let table = statement_table(statement)
        .ok_or_else(|| format!("cannot tell which table this statement writes: {statement}"))?;
    if !is_writable_table(&table) {
        return Err(format!(
            "`{table}` is not a writable table: only the app's own data may be changed here"
        ));
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Quoted {
        None,
        Text,
        Identifier,
        Backtick,
        Bracket,
    }

    let mut quoted = Quoted::None;
    let mut chars = statement.trim_end().chars().peekable();
    while let Some(c) = chars.next() {
        match quoted {
            // 'it''s', "a""b" and `a``b` escape the delimiter by doubling it.
            Quoted::Text => {
                if c == '\'' {
                    if chars.peek() == Some(&'\'') {
                        chars.next();
                    } else {
                        quoted = Quoted::None;
                    }
                }
            }
            Quoted::Identifier => {
                if c == '"' {
                    if chars.peek() == Some(&'"') {
                        chars.next();
                    } else {
                        quoted = Quoted::None;
                    }
                }
            }
            Quoted::Backtick => {
                if c == '`' {
                    if chars.peek() == Some(&'`') {
                        chars.next();
                    } else {
                        quoted = Quoted::None;
                    }
                }
            }
            Quoted::Bracket => {
                if c == ']' {
                    quoted = Quoted::None;
                }
            }
            Quoted::None => match c {
                '\'' => quoted = Quoted::Text,
                '"' => quoted = Quoted::Identifier,
                '`' => quoted = Quoted::Backtick,
                '[' => quoted = Quoted::Bracket,
                ';' => {
                    // A single trailing semicolon is harmless; anything after it is not.
                    if chars.peek().is_some() {
                        return Err("multiple statements are not allowed".to_string());
                    }
                }
                '-' if chars.peek() == Some(&'-') => {
                    return Err("SQL comments are not allowed".to_string())
                }
                '/' if chars.peek() == Some(&'*') => {
                    return Err("SQL comments are not allowed".to_string())
                }
                _ => {}
            },
        }
    }
    if quoted != Quoted::None {
        return Err("unterminated quoted text".to_string());
    }
    Ok(())
}

/// The tables the webview may write.
///
/// Everything else is refused, by the authorizer and by `check_statement`:
/// `llm_providers` and `provider_models`, because those rows decide where an API
/// key is sent and only the named Rust commands may change them; and SQLite's
/// own bookkeeping (`_sqlx_migrations`, `sqlite_sequence`, `sqlite_stat1`).
///
/// The list is deliberately explicit: a table added by a migration is *not*
/// writable until it is added here, so the surface cannot widen by accident.
pub const WRITABLE_TABLES: [&str; 15] = [
    "institutions",
    "categories",
    "tags",
    "assets",
    "asset_tags",
    "asset_holdings",
    "snapshots",
    "exchange_rates",
    "settings",
    "profile",
    "user_memories",
    "user_goals",
    "conversations",
    "messages",
    "pending_actions",
];

pub fn is_writable_table(name: &str) -> bool {
    WRITABLE_TABLES
        .iter()
        .any(|table| table.eq_ignore_ascii_case(name))
}

/// Reads identifiers out of SQL, honouring the four quoted forms.
struct IdentifierReader<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl<'a> IdentifierReader<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            chars: text.chars().peekable(),
        }
    }

    fn next(&mut self) -> Option<String> {
        self.skip_trivia()?;
        let mut token = self.read_token()?;
        // `main.institutions`: the table is the part after the last dot.
        while self.chars.peek() == Some(&'.') {
            self.chars.next();
            token = self.read_token()?;
        }
        Some(token)
    }

    fn skip_trivia(&mut self) -> Option<()> {
        loop {
            match self.chars.peek() {
                Some(c) if c.is_whitespace() || *c == ',' => {
                    self.chars.next();
                }
                // A second statement is a separate problem, already refused.
                Some(';') | None => return None,
                Some(_) => return Some(()),
            }
        }
    }

    fn read_token(&mut self) -> Option<String> {
        match *self.chars.peek()? {
            open @ ('"' | '`' | '[') => {
                self.chars.next();
                let close = if open == '[' { ']' } else { open };
                let mut out = String::new();
                while let Some(c) = self.chars.next() {
                    if c == close {
                        // `"a""b"` is an escaped quote inside a quoted name.
                        if close != ']' && self.chars.peek() == Some(&close) {
                            self.chars.next();
                            out.push(close);
                            continue;
                        }
                        return Some(out);
                    }
                    out.push(c);
                }
                None
            }
            _ => {
                let mut out = String::new();
                while let Some(c) = self.chars.peek() {
                    if c.is_alphanumeric() || *c == '_' || *c == '$' {
                        out.push(*c);
                        self.chars.next();
                    } else {
                        break;
                    }
                }
                if out.is_empty() {
                    None
                } else {
                    Some(out)
                }
            }
        }
    }
}

/// The table a data-modifying statement writes, lowercased.
///
/// A table name is a literal identifier — SQL does not allow an expression
/// there — so reading it cannot be fooled by a computed name. Quoted forms and a
/// schema prefix are normalised. `None` means the statement is not one of the
/// three shapes this app generates.
pub fn statement_table(statement: &str) -> Option<String> {
    let mut reader = IdentifierReader::new(statement);
    let verb = reader.next()?.to_ascii_lowercase();
    match verb.as_str() {
        "insert" => loop {
            let token = reader.next()?;
            if token.eq_ignore_ascii_case("into") {
                return reader.next();
            }
        },
        "update" => {
            let mut token = reader.next()?;
            if token.eq_ignore_ascii_case("or") {
                reader.next()?; // ROLLBACK | ABORT | REPLACE | FAIL | IGNORE
                token = reader.next()?;
            }
            Some(token)
        }
        "delete" => {
            if !reader.next()?.eq_ignore_ascii_case("from") {
                return None;
            }
            reader.next()
        }
        _ => None,
    }
}

/// Refuse, at the engine level, anything that is not a data modification.
///
/// Installed on every connection that runs SQL supplied by the webview. SQLite
/// calls it while preparing each operation, so it sees the operations of *every*
/// statement in the string — including one hidden behind a `;` that the text
/// scanner did not notice, and including one hidden inside a quoted identifier.
/// The text scanner cannot be trusted to be exhaustive; this can.
///
/// What it permits is [`WRITABLE_TABLES`]: the app's own data, and nothing else.
/// `llm_providers` and `provider_models` are absent from it because those rows
/// decide where an API key is sent, so only the named Rust commands may change
/// them; `_sqlx_migrations` and `sqlite_sequence` are absent because corrupting
/// either breaks every future start.
unsafe extern "C" fn write_authorizer(
    user_data: *mut c_void,
    action: c_int,
    arg1: *const c_char,
    arg2: *const c_char,
    database: *const c_char,
    trigger: *const c_char,
) -> c_int {
    // SAFETY: forwarded unchanged from SQLite's callback arguments.
    unsafe { decide(user_data, action, arg1, arg2, database, trigger, is_writable_table) }
}

/// Same rules as [`write_authorizer`], plus the two provider tables the backup
/// restore replaces. Used only by [`install_import_authorizer`].
unsafe extern "C" fn import_authorizer(
    user_data: *mut c_void,
    action: c_int,
    arg1: *const c_char,
    arg2: *const c_char,
    database: *const c_char,
    trigger: *const c_char,
) -> c_int {
    // SAFETY: forwarded unchanged from SQLite's callback arguments.
    unsafe {
        decide(user_data, action, arg1, arg2, database, trigger, |table| {
            is_writable_table(table) || IMPORT_ONLY_TABLES.iter().any(|t| t.eq_ignore_ascii_case(table))
        })
    }
}

/// The provider tables a backup restore writes. The webview may not write them.
pub const IMPORT_ONLY_TABLES: [&str; 2] = ["llm_providers", "provider_models"];

/// Shared decision for both authorizers. `allowed_table` decides which tables may
/// be written; reads, transactions and savepoints are the same for both.
#[allow(clippy::too_many_arguments)]
unsafe fn decide(
    _user_data: *mut c_void,
    action: c_int,
    arg1: *const c_char,
    _arg2: *const c_char,
    _database: *const c_char,
    _trigger: *const c_char,
    allowed_table: impl Fn(&str) -> bool,
) -> c_int {
    // SAFETY: SQLite passes a NUL-terminated string for the arguments it
    // documents as non-null; the pointer is only read during this call.
    let table = if arg1.is_null() {
        None
    } else {
        unsafe { CStr::from_ptr(arg1).to_str().ok() }
    };

    let allowed = match action {
        ffi::SQLITE_SELECT | ffi::SQLITE_READ | ffi::SQLITE_FUNCTION | ffi::SQLITE_RECURSIVE => true,
        // Only the tables the app writes. The provider tables are simply absent
        // from the write list, which is the same refusal by another route.
        ffi::SQLITE_INSERT | ffi::SQLITE_UPDATE | ffi::SQLITE_DELETE => {
            table.map(allowed_table).unwrap_or(false)
        }
        // sqlx wraps a batch in BEGIN/COMMIT and a nested one in SAVEPOINT; denying
        // those would break every transaction. A smuggled COMMIT cannot grant
        // anything: the operations inside it are still authorised one by one.
        ffi::SQLITE_TRANSACTION | ffi::SQLITE_SAVEPOINT => true,
        _ => false,
    };

    if allowed {
        ffi::SQLITE_OK
    } else {
        ffi::SQLITE_DENY
    }
}

/// Refuse everything on a read connection except reading.
///
/// Paired with `read_only(true)` in [`select_rows`], so a `SELECT …; DROP TABLE t`
/// is refused twice over: the connection cannot write, and the authorizer denies
/// the second statement.
unsafe extern "C" fn read_authorizer(
    _user_data: *mut c_void,
    action: c_int,
    _arg1: *const c_char,
    _arg2: *const c_char,
    _database: *const c_char,
    _trigger: *const c_char,
) -> c_int {
    match action {
        ffi::SQLITE_SELECT | ffi::SQLITE_READ | ffi::SQLITE_FUNCTION | ffi::SQLITE_RECURSIVE => {
            ffi::SQLITE_OK
        }
        _ => ffi::SQLITE_DENY,
    }
}

/// Attach [`read_authorizer`] to a connection this module owns.
pub async fn install_read_authorizer(connection: &mut SqliteConnection) -> Result<(), String> {
    let mut handle = connection
        .lock_handle()
        .await
        .map_err(|e| format!("cannot lock the connection: {e}"))?;
    // SAFETY: the handle is locked for the duration of the call, the callback is a
    // `'static` fn pointer and has no user data.
    let status = unsafe {
        ffi::sqlite3_set_authorizer(
            handle.as_raw_handle().as_ptr(),
            Some(read_authorizer),
            std::ptr::null_mut(),
        )
    };
    if status != ffi::SQLITE_OK {
        return Err(format!("cannot install the SQL authorizer (code {status})"));
    }
    Ok(())
}

/// One row as JSON, keyed by column name.
///
/// The webview only ever reads these values to render them, so the mapping is
/// deliberately small: NULL, integers, reals (JSON numbers) and text. A BLOB — no
/// table in the schema has one — becomes a placeholder rather than a value that
/// would be silently misread.
fn row_to_json(row: &SqliteRow) -> Value {
    use sqlx::{Column, Row, TypeInfo, ValueRef};

    let mut object = serde_json::Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        // The *value's* type, not the column's declared type: an expression like
        // `COUNT(*)` has no declared type, and guessing from it turned numbers
        // into NULL.
        let value = match row.try_get_raw(index) {
            Ok(raw) if raw.is_null() => Value::Null,
            Ok(raw) => match raw.type_info().name() {
                "INTEGER" => row
                    .try_get::<i64, _>(index)
                    .map(Value::from)
                    .unwrap_or(Value::Null),
                "REAL" => row
                    .try_get::<f64, _>(index)
                    .ok()
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
                    .unwrap_or(Value::Null),
                "TEXT" => row
                    .try_get::<String, _>(index)
                    .map(Value::from)
                    .unwrap_or(Value::Null),
                // No column in the schema holds a BLOB; refuse to guess one.
                _ => Value::Null,
            },
            Err(_) => Value::Null,
        };
        object.insert(column.name().to_string(), value);
    }
    Value::Object(object)
}

/// Bind the webview's JSON parameters, in order.
fn bind_params<'q>(
    sql: &'q str,
    params: &'q [Value],
) -> Result<sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>, String> {
    let mut query = sqlx::query(sql);
    for param in params {
        query = match param {
            Value::Null => query.bind(Option::<String>::None),
            Value::Bool(flag) => query.bind(i64::from(*flag)),
            Value::Number(number) => match number.as_i64() {
                Some(value) => query.bind(value),
                None => query.bind(number.as_f64().unwrap_or_default()),
            },
            Value::String(text) => query.bind(text.clone()),
            other => return Err(format!("unsupported parameter: {other}")),
        };
    }
    Ok(query)
}

/// Run one statement on a read-only connection and return its rows.
///
/// SQL built by the webview, so it gets the same treatment as a write: a filter
/// and an engine-level backstop. The connection is opened `read_only`, and the
/// authorizer allows only `SELECT`, `READ`, `FUNCTION` and `RECURSIVE`, so a
/// stacked statement cannot run even if the first one parses.
pub async fn select_rows(db_url: &str, sql: &str, params: &[Value]) -> Result<Vec<Value>, String> {
    let options = SqliteConnectOptions::from_str(db_url)
        .map_err(|e| format!("invalid database URL: {e}"))?
        .read_only(true)
        .busy_timeout(Duration::from_secs(5));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| format!("cannot open the database: {e}"))?;
    install_read_authorizer(&mut connection).await?;

    let rows = bind_params(sql, params)?
        .fetch_all(&mut connection)
        .await
        .map_err(|e| format!("read failed: {e}"))?;

    Ok(rows.iter().map(row_to_json).collect())
}

/// Read rows for the app database. The only way the webview reads SQL.
#[tauri::command]
pub async fn db_select(app: AppHandle, sql: String, params: Vec<Value>) -> Result<Vec<Value>, String> {
    let file = database_file(&app)?;
    if !file.exists() {
        return Err(format!("database not found at {}", file.display()));
    }
    select_rows(&format!("sqlite://{}", file.display()), &sql, &params).await
}

/// Attach [`write_authorizer`] to a connection this module owns.
pub async fn install_write_authorizer(connection: &mut SqliteConnection) -> Result<(), String> {
    install_authorizer(connection, write_authorizer).await
}

/// Attach [`import_authorizer`] to the backup-restore connection.
///
/// The restore replaces the provider tables, which the webview's write path
/// refuses, so it cannot use [`install_write_authorizer`]. It gets the writable
/// tables plus exactly the two provider tables, and nothing else: in particular
/// `_sqlx_migrations` stays refused, so a crafted backup cannot make the next
/// start replay a migration.
pub async fn install_import_authorizer(connection: &mut SqliteConnection) -> Result<(), String> {
    install_authorizer(connection, import_authorizer).await
}

async fn install_authorizer(
    connection: &mut SqliteConnection,
    callback: unsafe extern "C" fn(
        *mut c_void,
        c_int,
        *const c_char,
        *const c_char,
        *const c_char,
        *const c_char,
    ) -> c_int,
) -> Result<(), String> {
    let mut handle = connection
        .lock_handle()
        .await
        .map_err(|e| format!("cannot lock the connection: {e}"))?;
    // SAFETY: the handle is locked for the duration of the call, the callback is a
    // `'static` fn pointer and has no user data.
    let status = unsafe {
        ffi::sqlite3_set_authorizer(
            handle.as_raw_handle().as_ptr(),
            Some(callback),
            std::ptr::null_mut(),
        )
    };
    if status != ffi::SQLITE_OK {
        return Err(format!("cannot install the SQL authorizer (code {status})"));
    }
    Ok(())
}

/// Result of one write, shaped like the SQL plugin's so call sites do not care
/// which path they went through.
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
    install_write_authorizer(&mut connection).await?;

    let result = bind_params(sql, params)?

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
    install_write_authorizer(&mut connection).await?;
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
