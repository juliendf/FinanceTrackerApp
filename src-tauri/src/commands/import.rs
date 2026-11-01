//! Import a backup — all of it, or none of it.
//!
//! The import used to be four commits: provider reset, data reset, data insert,
//! provider restore. A failure in any of the later steps left the database
//! half-replaced, and a failing provider restore in particular left the user with
//! their data imported and every provider and key gone.
//!
//! Here it is one transaction on one connection: the tables are emptied, the rows
//! are inserted, the providers are replaced, and only then is anything committed.
//! The Keychain writes happen *before* the commit, so a Keychain refusal cancels
//! the import (the transaction is dropped and rolls back) rather than leaving rows
//! that point at keys which were never written. If the commit itself fails, the
//! keys this call stored are removed again.

use serde::Deserialize;
use sqlx::{Connection, Sqlite};
use tauri::AppHandle;

use super::db::check_statement;
use super::providers::{
    confirm_endpoint, connect, default_needs_confirmation, replace_providers, PendingKey,
    RestoreInput,
};
use super::secrets::{delete_key, origin_of, store_key};

/// Tables an import empties, children before parents so the foreign keys hold.
///
/// The provider tables are not listed: `replace_providers` owns those, because it
/// also has to reconcile the Keychain.
const WIPE: [&str; 14] = [
    "pending_actions",
    "messages",
    "conversations",
    "asset_tags",
    "snapshots",
    "assets",
    "tags",
    "categories",
    "institutions",
    "exchange_rates",
    "user_memories",
    "user_goals",
    "settings",
    "profile",
];

/// What the wizard sends: the data rows, then the providers with their keys.
#[derive(Deserialize, Debug)]
pub struct ImportRequest {
    pub statements: Vec<String>,
    pub providers: Vec<RestoreInput>,
}

/// Replace the database contents inside an open transaction.
///
/// Returns the keys the caller must write; no Keychain access happens here, so
/// this can be tested against a throwaway database.
pub async fn import_into(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    request: &ImportRequest,
) -> Result<Vec<PendingKey>, String> {
    for table in WIPE {
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&mut **transaction)
            .await
            .map_err(|e| format!("cannot clear {table}: {e}"))?;
    }

    let total = request.statements.len();
    for (index, statement) in request.statements.iter().enumerate() {
        // The same first filter the generic write path applies; the provider rows
        // and the wipes above are ours and cannot come from the backup.
        check_statement(statement)
            .map_err(|e| format!("statement {} of {total} rejected: {e}", index + 1))?;
        if let Err(error) = sqlx::query(statement).execute(&mut **transaction).await {
            return Err(format!("statement {} of {total} failed: {error}", index + 1));
        }
    }

    replace_providers(transaction, &request.providers).await
}

/// The origin to confirm before an import, if the file's default provider is one
/// the user has not implicitly agreed to.
///
/// A backup is a file the user picked, but the same command can be called by a
/// compromised renderer with a fabricated one, and the default provider receives
/// every chat afterwards. The rule is the same as for `provider_set_default`: a
/// keyless, non-loopback endpoint has to be confirmed natively.
pub fn backup_default_needs_confirmation(providers: &[RestoreInput]) -> Option<String> {
    // The row `replace_providers` will mark as default: the first with the flag,
    // or the lowest id when the file has none.
    let default = providers
        .iter()
        .find(|row| row.is_default)
        .or_else(|| providers.iter().min_by_key(|row| row.id))?;

    let has_key = default
        .api_key
        .as_deref()
        .map(str::trim)
        .is_some_and(|key| !key.is_empty());
    let origin = origin_of(&default.base_url).ok()?;

    default_needs_confirmation(&origin, has_key).then_some(origin)
}

/// Replace the whole database with a backup, in one transaction.
///
/// Returns how many API keys were written to the Keychain.
#[tauri::command]
pub async fn import_all(app: AppHandle, request: ImportRequest) -> Result<usize, String> {
    let mut connection = connect(&app).await?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|e| format!("cannot start a transaction: {e}"))?;

    let keys = match import_into(&mut transaction, &request).await {
        Ok(keys) => keys,
        Err(error) => {
            // Roll back explicitly rather than relying on the drop order: the
            // caller gets an error only once the database is back to what it was.
            let _ = transaction.rollback().await;
            return Err(error);
        }
    };

    // A fabricated "backup" could point the default provider anywhere. Ask before
    // the rows become visible, and roll back if the user says no.
    if let Some(origin) = backup_default_needs_confirmation(&request.providers) {
        if let Err(error) = confirm_endpoint(
            &app,
            &origin,
            "This backup's default provider points at an endpoint you have not used.",
        )
        .await
        {
            let _ = transaction.rollback().await;
            return Err(error);
        }
    }

    // Keys before the commit. A refusal here (a locked Keychain, "Deny" on the
    // access prompt) aborts everything: the transaction is dropped uncommitted and
    // the database is left exactly as it was.
    let mut stored: Vec<String> = Vec::new();
    for pending in &keys {
        if let Err(error) = store_key(&pending.account, &pending.key, &pending.base_url) {
            for account in &stored {
                let _ = delete_key(account);
            }
            let _ = transaction.rollback().await;
            return Err(format!("the import was cancelled, nothing was written: {error}"));
        }
        stored.push(pending.account.clone());
    }

    if let Err(error) = transaction.commit().await {
        // The rows did not land, so neither should the keys.
        for account in &stored {
            let _ = delete_key(account);
        }
        return Err(format!("cannot commit the import: {error}"));
    }

    Ok(stored.len())
}
