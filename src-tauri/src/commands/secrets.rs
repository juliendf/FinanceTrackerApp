//! Provider API keys in the macOS Keychain.
//!
//! The SQLite database only ever stores a `keychain_ref` such as
//! `provider:1`. The secret itself lives here, under the app's bundle
//! identifier as the Keychain service name.
//!
//! **Secrets are never read back into the webview**, and never written by it:
//! there is no `secret_get`, `secret_set` or `secret_delete` command. The named
//! commands (`provider_save`, `provider_delete`, `providers_restore`,
//! `providers_reset`) write and delete keys themselves.
//!
//! **A key is bound to the origin it was entered for.** The Keychain item holds
//! `{"key": …, "origin": "https://api.openai.com:443"}`. Every request compares
//! the provider's current `base_url` with that origin and refuses to send the key
//! anywhere else. Without this, moving `base_url` in SQLite would point a stored
//! key at any host: the row is writable, and the key is not supposed to be
//! readable back.
//!
//! Keys saved before this binding existed carry no origin, so they are refused
//! with a message asking for re-entry — an unbound key cannot be safely sent.
//!
//! The app lock's PIN hash also lives here, under its own `lock:<digest>`
//! accounts, so that one Keychain does not grow a second storage mechanism. See
//! `lock.rs` for the Argon2id side and the rules the two account families keep.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use url::Url;

/// Keychain service name. Deliberately the same for the normal and the demo
/// build: both use the same provider settings, only the financial data differs.
const SERVICE: &str = "app.financetracker";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("keyring: {e}"))
}

/// Only `provider:<id>` accounts may be written or deleted.
///
/// The callers are Rust commands that pass a derived account, but the check keeps
/// a future mistake from touching an unrelated item.
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

/// The account name for a provider id.
pub fn account_for(provider_id: i64) -> String {
    format!("provider:{provider_id}")
}

// --- app lock ---------------------------------------------------------------
//
// The lock's Argon2id hash lives in the Keychain, never in SQLite: `settings` is
// exported verbatim in every backup, and a hash there would travel into files the
// user shares and hand out a free offline target. Only `lock_enabled` and
// `lock_idle_minutes` live in the database.
//
// There is still no `secret_get`: the hash is written by `app_lock_set`, checked
// by `app_lock_verify` and removed by `app_lock_clear`, all in Rust, and never
// travels back to the webview.

/// Keychain account for the app lock of one installation.
///
/// The normal and the demo build share `SERVICE` on purpose and differ only by
/// their data directory, so the account is scoped on the database path: a PIN set
/// in one build must not lock the other, where it was never entered.
///
/// The digest is an identifier, not a security control: it only has to be stable
/// and to differ between installations. It is load-bearing anyway — **changing how
/// it is derived logs every installation out of its own lock**, because the stored
/// item is then simply not found, which the UI reports as "no PIN set".
///
/// The directory is canonicalised first for the same reason: a symlinked home or a
/// `/var` vs `/private/var` spelling of the same path must not derive a different
/// account.
pub fn lock_account(db_path: &std::path::Path) -> String {
    use sha2::{Digest, Sha256};

    let canonical = db_path
        .parent()
        .and_then(|dir| std::fs::canonicalize(dir).ok())
        .map(|dir| match db_path.file_name() {
            Some(name) => dir.join(name),
            None => dir,
        });
    let path = canonical.unwrap_or_else(|| db_path.to_path_buf());

    let digest = Sha256::digest(path.to_string_lossy().as_bytes());
    let mut account = String::with_capacity("lock:".len() + 16);
    account.push_str("lock:");
    for byte in &digest[..8] {
        account.push_str(&format!("{byte:02x}"));
    }
    account
}

/// Only `lock:<16 hex>` accounts reach the lock items.
///
/// Kept apart from `check_account` so provider code can never be pointed at the
/// lock item, nor the lock at a provider key.
fn check_lock_account(account: &str) -> Result<(), String> {
    let digest = account.strip_prefix("lock:").unwrap_or("");
    // Lowercase only: that is what `lock_account` emits, so anything else did not
    // come from it.
    if digest.len() == 16 && digest.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')) {
        Ok(())
    } else {
        Err(format!(
            "refusing Keychain account '{account}': expected lock:<digest>"
        ))
    }
}

/// Store the Argon2id PHC string.
pub fn store_lock_hash(account: &str, phc: &str) -> Result<(), String> {
    check_lock_account(account)?;
    entry(account)?
        .set_password(phc)
        .map_err(|e| format!("keyring set failed: {e}"))
}

/// Read the stored PHC string. `None` when no PIN is set.
fn read_lock_hash(account: &str) -> Result<Option<String>, String> {
    check_lock_account(account)?;
    read_raw(account)
}

/// Whether a PIN is set, without returning the hash.
pub fn has_lock_hash(account: &str) -> Result<bool, String> {
    Ok(read_lock_hash(account)?.is_some())
}

/// The stored hash, for verification. Not a command: the value stays in Rust.
pub fn lock_hash(account: &str) -> Result<Option<String>, String> {
    read_lock_hash(account)
}

/// Remove the lock item. A missing item is not an error.
pub fn delete_lock_hash(account: &str) -> Result<(), String> {
    check_lock_account(account)?;
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete failed: {e}")),
    }
}

/// `scheme://host:port`, which is what "the same endpoint" means here.
///
/// A path may change (`/v1` vs `/v1/`) without moving the key, but scheme, host or
/// port may not: those decide who receives it.
pub fn origin_of(base_url: &str) -> Result<String, String> {
    let parsed = Url::parse(base_url.trim()).map_err(|e| format!("invalid base URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!(
            "refusing a {} URL: only http and https are supported",
            parsed.scheme()
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| format!("invalid base URL: {base_url}"))?;
    // Plain http is only allowed on loopback, so a key never travels in cleartext
    // to a remote host. `url` renders IPv6 hosts with brackets.
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "[::1]");
    match parsed.scheme() {
        "https" => {}
        "http" if loopback => {}
        other => {
            return Err(format!(
                "refusing {other}:// for {host}: remote endpoints must use https"
            ))
        }
    }
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| format!("invalid port in {base_url}"))?;
    Ok(format!("{}://{}:{}", parsed.scheme(), host, port))
}

/// What is stored in the Keychain item.
#[derive(Serialize, Deserialize)]
struct StoredKey {
    key: String,
    origin: String,
}

/// Read the raw item, whatever its format.
fn read_raw(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get failed: {e}")),
    }
}

/// Store a key, bound to the origin of `base_url`.
pub fn store_key(account: &str, key: &str, base_url: &str) -> Result<(), String> {
    check_account(account)?;
    let origin = origin_of(base_url)?;
    let payload = serde_json::to_string(&StoredKey {
        key: key.to_string(),
        origin,
    })
    .map_err(|e| format!("cannot encode the key: {e}"))?;
    entry(account)?
        .set_password(&payload)
        .map_err(|e| format!("keyring set failed: {e}"))
}

/// The key for `base_url`, if one is stored **for that origin**.
///
/// Returns an error rather than a key when the origin does not match, or when the
/// item predates the binding: both mean the key must be re-entered.
pub fn read_key(account: &str, base_url: &str) -> Result<Option<String>, String> {
    check_account(account)?;
    let Some(raw) = read_raw(account)? else {
        return Ok(None);
    };

    let parsed: StoredKey = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(_) => {
            return Err(
                "this API key was saved before keys were bound to their endpoint. \
                 Open the provider and enter the key again."
                    .to_string(),
            )
        }
    };

    let wanted = origin_of(base_url)?;
    if parsed.origin != wanted {
        return Err(format!(
            "the saved API key belongs to {}, but this provider now points at {wanted}. \
             Enter the key again to send it there.",
            parsed.origin
        ));
    }

    Ok(Some(parsed.key))
}

/// Whether a key is stored for this origin, without returning it.
pub fn has_key(account: &str, base_url: &str) -> bool {
    matches!(read_key(account, base_url), Ok(Some(_)))
}

/// Delete a key. A missing item is not an error.
pub fn delete_key(account: &str) -> Result<(), String> {
    check_account(account)?;
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{account_for, check_account, lock_account, origin_of};

    #[test]
    fn only_provider_accounts_are_writable() {
        assert_eq!(account_for(7), "provider:7");
        for account in ["provider:1", "provider:42"] {
            assert!(check_account(account).is_ok(), "should accept {account}");
        }
        for account in [
            "",
            "provider:",
            "provider:abc",
            "provider:1/../x",
            "other:1",
            "app.financetracker",
            // The lock items are a different family, and provider code must not
            // be able to reach them.
            "lock:0123456789abcdef",
        ] {
            assert!(check_account(account).is_err(), "should refuse {account}");
        }
    }

    #[test]
    fn a_lock_account_is_scoped_to_its_data_directory() {
        let normal = lock_account(std::path::Path::new(
            "/Users/x/Library/Application Support/app.financetracker/financetracker.db",
        ));
        let demo = lock_account(std::path::Path::new(
            "/Users/x/Library/Application Support/app.financetracker.demo/financetracker.db",
        ));

        assert_eq!(
            normal,
            lock_account(std::path::Path::new(
                "/Users/x/Library/Application Support/app.financetracker/financetracker.db",
            )),
            "the same path must always give the same account"
        );
        assert_ne!(normal, demo, "two builds must not share a PIN");
        assert!(normal.starts_with("lock:"));
        assert_eq!(normal.len(), "lock:".len() + 16);
    }

    #[test]
    fn lock_accounts_are_the_only_ones_the_lock_accepts() {
        for account in ["lock:0123456789abcdef", "lock:ffffffffffffffff"] {
            assert!(
                super::check_lock_account(account).is_ok(),
                "should accept {account}"
            );
        }
        for account in [
            "",
            "lock:",
            "lock:0123456789abcde",
            "lock:0123456789abcdef0",
            "lock:0123456789abcdeg",
            "lock:0123456789ABCDEF",
            "provider:1",
            "app.financetracker",
        ] {
            assert!(
                super::check_lock_account(account).is_err(),
                "should refuse {account}"
            );
        }
    }

    #[test]
    fn an_origin_is_scheme_host_and_port() {
        assert_eq!(origin_of("https://api.openai.com/v1").unwrap(), "https://api.openai.com:443");
        assert_eq!(origin_of("https://api.openai.com/v1/").unwrap(), "https://api.openai.com:443");
        assert_eq!(
            origin_of("http://localhost:11434/v1").unwrap(),
            "http://localhost:11434"
        );
        // A different port, host or scheme is a different endpoint.
        assert_ne!(
            origin_of("http://localhost:11434/v1").unwrap(),
            origin_of("http://localhost:11435/v1").unwrap()
        );
        // Scheme still matters on loopback.
        assert_ne!(
            origin_of("https://localhost:11434/v1").unwrap(),
            origin_of("http://localhost:11434/v1").unwrap()
        );
    }

    #[test]
    fn remote_plain_http_is_refused() {
        assert!(origin_of("http://api.openai.com/v1").is_err());
        assert!(origin_of("http://192.168.1.10:8080/v1").is_err());
        assert!(origin_of("https://api.openai.com/v1").is_ok());
        assert!(origin_of("http://127.0.0.1:11434/v1").is_ok());
        assert!(origin_of("http://[::1]:11434/v1").is_ok());
    }

    #[test]
    fn non_web_urls_are_refused() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://example.com",
            "not a url",
            "",
        ] {
            assert!(origin_of(url).is_err(), "accepted {url}");
        }
    }
}
