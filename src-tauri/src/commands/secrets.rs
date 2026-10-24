//! Provider API keys in the macOS Keychain.
//!
//! The SQLite database only ever stores a `keychain_ref` such as
//! `provider:1`. The secret itself lives here, under the app's bundle
//! identifier as the Keychain service name.

use keyring::Entry;

/// Keychain service name. Matches the Tauri bundle identifier so the items are
/// easy to find in Keychain Access.
const SERVICE: &str = "ch.julien.financetrackerapp";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("keyring: {e}"))
}

/// Store or replace a secret. `account` is the database reference, e.g.
/// `provider:1`.
#[tauri::command]
pub fn secret_set(account: String, secret: String) -> Result<(), String> {
    entry(&account)?
        .set_password(&secret)
        .map_err(|e| format!("keyring set failed: {e}"))
}

/// Read a secret. Returns `None` when nothing is stored, which is not an error.
#[tauri::command]
pub fn secret_get(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get failed: {e}")),
    }
}

/// Delete a secret. Deleting a missing item is a no-op so the caller can always
/// call this when removing a provider.
#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete failed: {e}")),
    }
}
