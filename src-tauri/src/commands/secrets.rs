//! Provider API keys in the macOS Keychain.
//!
//! The SQLite database only ever stores a `keychain_ref` such as
//! `provider:1`. The secret itself lives here, under the app's bundle
//! identifier as the Keychain service name.
//!
//! **Secrets are never read back into the webview.** There is no `secret_get`
//! command: the LLM commands take a provider id, read the reference from SQLite
//! and the secret from here, and make the request themselves. The webview can
//! write a key and delete it, but not read one.

use keyring::Entry;

/// Keychain service name. Matches the Tauri bundle identifier so the items are
/// easy to find in Keychain Access.
const SERVICE: &str = "ch.julien.financetrackerapp";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("keyring: {e}"))
}

/// Only `provider:<id>` accounts may be written or deleted.
///
/// The webview supplies the account name, so without this a compromised renderer
/// could overwrite or delete any item this app owns.
fn check_account(account: &str) -> Result<(), String> {
    let id = account.strip_prefix("provider:").unwrap_or("");
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(format!(
            "refusing Keychain account '{account}': expected provider:<id>"
        ))
    }
}

/// Read a secret. Internal: only the Rust commands may call this.
pub fn read_secret(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get failed: {e}")),
    }
}

/// Store or replace a secret. `account` is the database reference, e.g.
/// `provider:1`.
#[tauri::command]
pub fn secret_set(account: String, secret: String) -> Result<(), String> {
    check_account(&account)?;
    entry(&account)?
        .set_password(&secret)
        .map_err(|e| format!("keyring set failed: {e}"))
}

/// Delete a secret. Deleting a missing item is a no-op so the caller can always
/// call this when removing a provider.
#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    check_account(&account)?;
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::check_account;

    #[test]
    fn only_provider_accounts_are_writable() {
        for account in ["provider:1", "provider:42"] {
            assert!(check_account(account).is_ok(), "should accept {account}");
        }
        for account in [
            "",
            "provider:",
            "provider:abc",
            "provider:1/../x",
            "other:1",
            "ch.julien.financetrackerapp",
        ] {
            assert!(check_account(account).is_err(), "should refuse {account}");
        }
    }
}
