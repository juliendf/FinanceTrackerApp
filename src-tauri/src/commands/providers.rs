//! LLM provider rows, and the API keys attached to them.
//!
//! These live in Rust rather than in the webview's SQL because the provider row
//! decides **where an API key is sent**, and the key itself is stored by
//! `secrets`. The generic write path (`execute_write`, `run_transaction`) refuses
//! to touch `llm_providers` and `provider_models` for exactly that reason, so
//! every legitimate change goes through a command here, which also does the
//! Keychain work in the same call.
//!
//! Two rules keep a stored key from being redirected:
//!
//! * a new key is bound (`secrets::store_key`) to the origin of the base URL it
//!   was entered for;
//! * changing the base URL of a provider whose key belongs to another origin
//!   **drops the key** and clears `keychain_ref`, so the user has to enter it
//!   again for the new endpoint.
//!
//! The SQL half of each command is a separate function taking a connection, so
//! `tests/providers.rs` can exercise it against a throwaway database without an
//! `AppHandle` and without touching the real Keychain.

use serde::Deserialize;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Row, SqliteConnection};
use std::str::FromStr;
use std::time::Duration;
use tauri::AppHandle;

use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use super::db::database_file;
use super::secrets::{account_for, delete_key, origin_of, read_key, store_key};

const PROVIDER_TYPES: [&str; 2] = ["openai", "gemini"];

/// Accept `true`/`false` and `1`/`0`.
///
/// The backup schema allows either (`is_default: z.union([z.boolean(), z.number()])`),
/// and SQLite hands the same columns back as integers, so a strict `bool` here
/// rejected a perfectly valid file.
fn boolish<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;

    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Bool(flag) => Ok(flag),
        serde_json::Value::Number(number) => Ok(number.as_i64().unwrap_or(0) != 0),
        serde_json::Value::Null => Ok(false),
        other => Err(D::Error::custom(format!("expected a boolean, got {other}"))),
    }
}

fn boolish_option<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    if value.is_null() {
        return Ok(None);
    }
    boolish(value).map(Some).map_err(serde::de::Error::custom)
}

/// One model row, as the form sends it.
///
/// **Field names are the ones TypeScript uses** (`base_url`, not `baseUrl`):
/// Tauri renames only the command's own arguments, never the fields of a nested
/// struct, so a `rename_all` here silently rejected every create and edit.
#[derive(Deserialize, Debug, Clone)]
pub struct ModelChoice {
    pub model: String,
    #[serde(default, deserialize_with = "boolish")]
    pub enabled: bool,
}

/// What the form sends, in the webview's own field names.
#[derive(Deserialize, Debug)]
pub struct ProviderInput {
    /// `None` creates, `Some` updates.
    pub id: Option<i64>,
    pub name: String,
    /// Already normalised by the webview (trailing slashes, Gemini's `/openai`).
    pub base_url: String,
    pub model: String,
    pub provider_type: String,
    pub is_active: bool,
    /// `None` leaves the stored model rows alone.
    pub models: Option<Vec<ModelChoice>>,
    /// A key the user typed. Empty or absent means "unchanged".
    pub api_key: Option<String>,
}

/// A provider as a backup holds it, with its id and timestamps.
///
/// Booleans arrive as `true`/`false` or `1`/`0` depending on the file's vintage
/// (`providerSchema` allows both), and either must be accepted.
#[derive(Deserialize, Debug)]
pub struct RestoreInput {
    pub id: i64,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub provider_type: Option<String>,
    #[serde(default, deserialize_with = "boolish")]
    pub is_default: bool,
    #[serde(default, deserialize_with = "boolish_option")]
    pub is_active: Option<bool>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub api_key: Option<String>,
    #[serde(default)]
    pub models: Vec<ModelChoice>,
}

/// A key to write once the rows are committed.
#[derive(Debug)]
pub struct PendingKey {
    pub account: String,
    pub key: String,
    pub base_url: String,
}

/// Whether a loopback endpoint can skip the confirmation.
///
/// A local model cannot receive the data anywhere else, and the user runs it
/// themselves, so asking would be noise on every save.
pub fn is_loopback(origin: &str) -> bool {
    url::Url::parse(origin)
        .ok()
        .and_then(|url| url.host_str().map(|host| {
            host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
        }))
        .unwrap_or(false)
}

/// Whether saving this provider must ask the user before it takes effect.
///
/// The webview can call `provider_save` with any URL. A stored key cannot follow it
/// (it is bound to its origin), but **the chat content can**: answers, tool results
/// and portfolio figures go wherever `base_url` points. So a change of endpoint — or
/// the first endpoint, when other providers already exist — is confirmed natively.
pub fn endpoint_needs_confirmation(
    existing_origin: Option<&str>,
    new_origin: &str,
    other_providers: i64,
) -> bool {
    if is_loopback(new_origin) {
        return false;
    }
    match existing_origin {
        Some(previous) => previous != new_origin,
        // A brand-new endpoint: worth asking unless this is the very first
        // provider (a fresh install has no data to send yet).
        None => other_providers > 0,
    }
}

/// Whether making this provider the default must ask the user.
///
/// A provider with a key cannot have been configured silently: the key was typed
/// into the form for that origin. A keyless endpoint that becomes the default
/// receives every chat, which is exactly what a compromised renderer would set up.
pub fn default_needs_confirmation(origin: &str, has_key: bool) -> bool {
    !has_key && !is_loopback(origin)
}

/// Ask the user, natively, before data starts flowing to a new endpoint.
///
/// The dialog is raised by Rust, so a compromised renderer can trigger the
/// question but cannot answer it: the answer is a value returned to this command.
pub async fn confirm_endpoint(app: &AppHandle, origin: &str, question: &str) -> Result<(), String> {
    let handle = app.clone();
    let message = format!(
        "{question}\n\nEndpoint: {origin}\n\nYour questions, and the portfolio figures the \
         assistant looks up, are sent there. Only continue if you set this endpoint up yourself."
    );

    let approved = tokio::task::spawn_blocking(move || {
        handle
            .dialog()
            .message(message)
            .title("Confirm the LLM endpoint")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Send data there".to_string(),
                "Cancel".to_string(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|e| format!("cannot ask for confirmation: {e}"))?;

    if approved {
        Ok(())
    } else {
        Err("cancelled: the endpoint was not confirmed, nothing was saved".to_string())
    }
}

pub async fn connect(app: &AppHandle) -> Result<SqliteConnection, String> {
    let file = database_file(app)?;
    if !file.exists() {
        return Err(format!("database not found at {}", file.display()));
    }
    connect_url(&format!("sqlite://{}", file.display())).await
}

/// Same options as the write commands, minus the authorizer: these statements are
/// ours, not the webview's.
pub async fn connect_url(db_url: &str) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::from_str(db_url)
        .map_err(|e| format!("invalid database URL: {e}"))?
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);
    SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| format!("cannot open the database: {e}"))
}

fn validate(input: &ProviderInput) -> Result<(), String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("provider name is required".to_string());
    }
    if name.chars().count() > 50 {
        return Err("provider name must be at most 50 characters".to_string());
    }
    if !PROVIDER_TYPES.contains(&input.provider_type.as_str()) {
        return Err(format!("unknown provider type '{}'", input.provider_type));
    }
    if input.model.trim().is_empty() {
        return Err("a default model is required".to_string());
    }
    // Refuses anything that is not http(s), and anything unparseable.
    origin_of(&input.base_url)?;
    Ok(())
}

async fn write_models(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    provider_id: i64,
    models: &[ModelChoice],
) -> Result<(), String> {
    sqlx::query("DELETE FROM provider_models WHERE provider_id = ?")
        .bind(provider_id)
        .execute(&mut **transaction)
        .await
        .map_err(|e| format!("cannot replace the model list: {e}"))?;

    for choice in models {
        let model = choice.model.trim();
        if model.is_empty() {
            continue;
        }
        sqlx::query("INSERT OR IGNORE INTO provider_models (provider_id, model, enabled) VALUES (?, ?, ?)")
            .bind(provider_id)
            .bind(model)
            .bind(i64::from(choice.enabled))
            .execute(&mut **transaction)
            .await
            .map_err(|e| format!("cannot save model '{model}': {e}"))?;
    }
    Ok(())
}

/// Insert or update one provider, and say whether `keychain_ref` should point at
/// the provider's Keychain item.
///
/// `bind_key` is set when the caller is about to write a key for this provider;
/// `keep_key` when the existing key still belongs to this endpoint. Anything else
/// clears the reference, so a row never claims a key that will not be used.
pub async fn save_row(
    connection: &mut SqliteConnection,
    input: &ProviderInput,
    bind_key: bool,
    keep_key: bool,
) -> Result<i64, String> {
    validate(input)?;

    let name = input.name.trim();
    let base_url = input.base_url.trim();
    let model = input.model.trim();
    let mut transaction = connection
        .begin()
        .await
        .map_err(|e| format!("cannot start a transaction: {e}"))?;

    let id = match input.id {
        Some(id) => {
            let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM llm_providers WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|e| format!("cannot read provider {id}: {e}"))?;
            if exists.is_none() {
                return Err(format!("provider {id} not found"));
            }
            id
        }
        None => {
            let result = sqlx::query(
                "INSERT INTO llm_providers (name, base_url, model, provider_type, is_active)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(name)
            .bind(base_url)
            .bind(model)
            .bind(&input.provider_type)
            .bind(i64::from(input.is_active))
            .execute(&mut *transaction)
            .await
            .map_err(|e| format!("cannot create the provider: {e}"))?;
            result.last_insert_rowid()
        }
    };

    let keychain_ref = if bind_key || keep_key {
        Some(account_for(id))
    } else {
        None
    };

    if input.id.is_some() {
        sqlx::query(
            "UPDATE llm_providers
                SET name = ?, base_url = ?, model = ?, provider_type = ?, is_active = ?,
                    keychain_ref = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              WHERE id = ?",
        )
        .bind(name)
        .bind(base_url)
        .bind(model)
        .bind(&input.provider_type)
        .bind(i64::from(input.is_active))
        .bind(keychain_ref.as_deref())
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("cannot update the provider: {e}"))?;
    } else if keychain_ref.is_some() {
        // A new provider: the id is only known now.
        sqlx::query("UPDATE llm_providers SET keychain_ref = ? WHERE id = ?")
            .bind(keychain_ref.as_deref())
            .bind(id)
            .execute(&mut *transaction)
            .await
            .map_err(|e| format!("cannot record the key reference: {e}"))?;
    }

    if let Some(models) = input.models.as_deref() {
        write_models(&mut transaction, id, models).await?;
    }

    // The first provider becomes the default, as a fresh install needs one.
    sqlx::query(
        "UPDATE llm_providers SET is_default = 1
          WHERE id = ? AND NOT EXISTS (SELECT 1 FROM llm_providers WHERE is_default = 1)",
    )
    .bind(id)
    .execute(&mut *transaction)
    .await
    .map_err(|e| format!("cannot set the default provider: {e}"))?;

    transaction
        .commit()
        .await
        .map_err(|e| format!("cannot commit: {e}"))?;
    Ok(id)
}

/// Create or update a provider, and its key, in one call. Returns the provider id.
#[tauri::command]
pub async fn provider_save(app: AppHandle, input: ProviderInput) -> Result<i64, String> {
    let typed = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string);

    // An untyped key is kept only if the stored one was entered for this very
    // endpoint. Reading it is the check, and the key itself is discarded.
    let keep = match (input.id, &typed) {
        (Some(id), None) => matches!(read_key(&account_for(id), &input.base_url), Ok(Some(_))),
        _ => false,
    };

    let mut connection = connect(&app).await?;

    // Before anything is written: an endpoint the user has not agreed to.
    let new_origin = origin_of(&input.base_url)?;
    let existing_origin: Option<String> = match input.id {
        Some(id) => sqlx::query_scalar("SELECT base_url FROM llm_providers WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut connection)
            .await
            .map_err(|e| format!("cannot read provider {id}: {e}"))?
            .map(|base_url: String| origin_of(&base_url))
            .transpose()?,
        None => None,
    };
    let other_providers: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM llm_providers WHERE id IS NOT ?")
            .bind(input.id)
            .fetch_one(&mut connection)
            .await
            .map_err(|e| format!("cannot count the providers: {e}"))?;

    if endpoint_needs_confirmation(existing_origin.as_deref(), &new_origin, other_providers) {
        let question = match existing_origin {
            Some(_) => "This provider's endpoint has changed.",
            None => "This is a new endpoint.",
        };
        confirm_endpoint(&app, &new_origin, question).await?;
    }

    let id = save_row(&mut connection, &input, typed.is_some(), keep).await?;
    let account = account_for(id);

    if let Some(key) = typed {
        if let Err(error) = store_key(&account, &key, &input.base_url) {
            // The row must not claim a key that was never written.
            let _ = sqlx::query("UPDATE llm_providers SET keychain_ref = NULL WHERE id = ?")
                .bind(id)
                .execute(&mut connection)
                .await;
            return Err(error);
        }
    } else if !keep {
        delete_key(&account)?;
    }

    Ok(id)
}

/// Delete a provider, its model rows and its key. The default flag moves to the
/// oldest survivor.
#[tauri::command]
pub async fn provider_delete(app: AppHandle, id: i64) -> Result<(), String> {
    let mut connection = connect(&app).await?;
    delete_row(&mut connection, id).await?;
    delete_key(&account_for(id))
}

pub async fn delete_row(connection: &mut SqliteConnection, id: i64) -> Result<(), String> {
    let mut transaction = connection
        .begin()
        .await
        .map_err(|e| format!("cannot start a transaction: {e}"))?;

    let was_default: Option<i64> = sqlx::query_scalar("SELECT is_default FROM llm_providers WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|e| format!("cannot read provider {id}: {e}"))?;
    let Some(was_default) = was_default else {
        return Err(format!("provider {id} not found"));
    };

    // Rows first: if this fails the provider keeps its key and can be retried.
    sqlx::query("DELETE FROM provider_models WHERE provider_id = ?")
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("cannot delete the model list: {e}"))?;
    sqlx::query("DELETE FROM llm_providers WHERE id = ?")
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("cannot delete the provider: {e}"))?;

    if was_default == 1 {
        sqlx::query("UPDATE llm_providers SET is_default = 1 WHERE id = (SELECT MIN(id) FROM llm_providers)")
            .execute(&mut *transaction)
            .await
            .map_err(|e| format!("cannot move the default flag: {e}"))?;
    }

    transaction
        .commit()
        .await
        .map_err(|e| format!("cannot commit: {e}"))?;
    Ok(())
}

/// Make one provider the default; exactly one row may carry the flag.
#[tauri::command]
pub async fn provider_set_default(app: AppHandle, id: i64) -> Result<(), String> {
    let mut connection = connect(&app).await?;

    // Becoming the default is when a keyless endpoint starts receiving everything,
    // so that is where the user is asked.
    let row = sqlx::query("SELECT base_url, keychain_ref FROM llm_providers WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut connection)
        .await
        .map_err(|e| format!("cannot read provider {id}: {e}"))?;
    if let Some(row) = row {
        let base_url: String = Row::get(&row, 0);
        let keychain_ref: Option<String> = Row::get(&row, 1);
        let has_key = keychain_ref
            .as_deref()
            .map(|account| matches!(read_key(account, &base_url), Ok(Some(_))))
            .unwrap_or(false);
        let origin = origin_of(&base_url)?;
        if default_needs_confirmation(&origin, has_key) {
            confirm_endpoint(&app, &origin, "This provider is about to become your default.").await?;
        }
    }

    set_default_row(&mut connection, id).await
}

pub async fn set_default_row(connection: &mut SqliteConnection, id: i64) -> Result<(), String> {
    let mut transaction = connection
        .begin()
        .await
        .map_err(|e| format!("cannot start a transaction: {e}"))?;

    sqlx::query("UPDATE llm_providers SET is_default = 0 WHERE is_default = 1")
        .execute(&mut *transaction)
        .await
        .map_err(|e| format!("cannot clear the default: {e}"))?;
    let updated = sqlx::query(
        "UPDATE llm_providers SET is_default = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    )
    .bind(id)
    .execute(&mut *transaction)
    .await
    .map_err(|e| format!("cannot set the default: {e}"))?;
    if updated.rows_affected() == 0 {
        return Err(format!("provider {id} not found"));
    }

    transaction
        .commit()
        .await
        .map_err(|e| format!("cannot commit: {e}"))?;
    Ok(())
}

/// Replace every provider with the rows of a backup. Returns the keys to write.
/// Delete every provider and insert `rows` inside an open transaction.
///
/// Returns the keys that must be written once the transaction commits. Used by the
/// import path, which needs provider replacement in the *same* transaction as the
/// portfolio data — otherwise a failing restore leaves the user with data and no
/// providers.
pub async fn replace_providers(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    rows: &[RestoreInput],
) -> Result<Vec<PendingKey>, String> {
    sqlx::query("DELETE FROM provider_models")
        .execute(&mut **transaction)
        .await
        .map_err(|e| format!("cannot clear the model list: {e}"))?;
    sqlx::query("DELETE FROM llm_providers")
        .execute(&mut **transaction)
        .await
        .map_err(|e| format!("cannot clear the providers: {e}"))?;

    let mut keys = Vec::new();

    for row in rows {
        let base_url = row.base_url.trim().to_string();
        // Also refuses a `file:` or `javascript:` endpoint from a crafted backup.
        origin_of(&base_url)?;
        let provider_type = row.provider_type.clone().unwrap_or_else(|| "openai".to_string());
        if !PROVIDER_TYPES.contains(&provider_type.as_str()) {
            return Err(format!("unknown provider type '{provider_type}'"));
        }

        let key = row
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|key| !key.is_empty())
            .map(str::to_string);
        let account = key.as_ref().map(|_| account_for(row.id));

        sqlx::query(
            "INSERT INTO llm_providers
               (id, name, base_url, model, provider_type, keychain_ref, is_default, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?,
                     CASE WHEN EXISTS (SELECT 1 FROM llm_providers WHERE is_default = 1) THEN 0 ELSE ? END,
                     ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
        )
        .bind(row.id)
        .bind(row.name.trim())
        .bind(&base_url)
        .bind(row.model.trim())
        .bind(&provider_type)
        .bind(account.as_deref())
        .bind(i64::from(row.is_default))
        .bind(i64::from(row.is_active.unwrap_or(true)))
        .bind(row.created_at.as_deref())
        .bind(row.updated_at.as_deref())
        .execute(&mut **transaction)
        .await
        .map_err(|e| format!("cannot restore provider {}: {e}", row.id))?;

        write_models(transaction, row.id, &row.models).await?;

        if let (Some(account), Some(key)) = (account, key) {
            keys.push(PendingKey { account, key, base_url });
        }
    }

    // A backup with no default would leave the app without one.
    sqlx::query(
        "UPDATE llm_providers SET is_default = 1
          WHERE id = (SELECT MIN(id) FROM llm_providers)
            AND NOT EXISTS (SELECT 1 FROM llm_providers WHERE is_default = 1)",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|e| format!("cannot set a default provider: {e}"))?;

    Ok(keys)
}

/// Delete every provider and every stored key, for "reset the database".
#[tauri::command]
pub async fn providers_reset(app: AppHandle) -> Result<(), String> {
    let mut connection = connect(&app).await?;
    for id in reset_rows(&mut connection).await? {
        delete_key(&account_for(id))?;
    }
    Ok(())
}

pub async fn reset_rows(connection: &mut SqliteConnection) -> Result<Vec<i64>, String> {
    let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM llm_providers")
        .fetch_all(&mut *connection)
        .await
        .map_err(|e| format!("cannot read the providers: {e}"))?;

    sqlx::query("DELETE FROM provider_models")
        .execute(&mut *connection)
        .await
        .map_err(|e| format!("cannot clear the model list: {e}"))?;
    sqlx::query("DELETE FROM llm_providers")
        .execute(&mut *connection)
        .await
        .map_err(|e| format!("cannot clear the providers: {e}"))?;

    Ok(ids)
}
