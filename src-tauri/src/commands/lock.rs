//! The app lock: a four-digit PIN in front of the UI.
//!
//! This stops a person at the keyboard from browsing the app on an unlocked Mac.
//! It is **not** encryption: `financetracker.db` stays plaintext SQLite, so anyone
//! who can read the data directory can open the file instead of the app. Closing
//! that gap is a separate problem (encrypt the database at rest), and neither
//! replaces the other.
//!
//! Four digits is a deliberate trade — quick to type on a desktop keyboard, and
//! 10,000 times easier to search than a passphrase. It is defensible only because
//! the gate protects the screen and not the file: the same person who can read the
//! Keychain item can read the database.
//!
//! The delay below slows a person typing guesses. It is held in memory, so quitting
//! the app resets it: three free attempts per launch is what it really buys, which
//! stops a curious housemate rather than a determined one. Nothing here stops an
//! offline attack on the hash, and `SECURITY.md` says so.
//!
//! Where the PIN lives:
//!
//! * the Argon2id PHC string is a Keychain item, under `lock:<digest of the db
//!   path>` (see `secrets.rs`), so two builds on one Mac do not share a PIN;
//! * `settings` only holds `lock_enabled` and `lock_idle_minutes`. Those travel in
//!   a backup, so a restore can bring the lock back — but never the PIN.
//!
//! Why the hash is checked here rather than in the webview: there is no command
//! that returns it. `app_lock_verify` takes a PIN and returns an outcome, so an
//! offline attack needs the Keychain item, not just a `db_select`.
//!
//! The gate is deliberately recoverable: no security question, no reset command.
//! A forgotten PIN costs the lock, not the data, and the UI says so.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::Serialize;
use tauri::AppHandle;

use super::db::database_file;
use super::secrets::{delete_lock_hash, has_lock_hash, lock_account, lock_hash, store_lock_hash};

/// The PIN is exactly this long. Four digits is what the UI promises, and a
/// longer one would not be a PIN.
pub const PIN_LENGTH: usize = 4;

/// Bound on a candidate at verify time. Argon2 hashes whatever it is given, and
/// hashing a megabyte on every attempt is a free denial of service on the app.
/// A PIN is four characters; this only exists to refuse the absurd cheaply.
pub const MAX_CANDIDATE_LENGTH: usize = 32;

/// Whether a candidate is worth a hash. A longer one is wrong by construction.
pub fn should_hash(candidate: &str) -> bool {
    candidate.len() <= MAX_CANDIDATE_LENGTH
}

/// Failures allowed before the gate starts making the user wait. Three, not five:
/// the search space is 10,000, so the free attempts are the expensive ones.
const FREE_ATTEMPTS: u32 = 3;

/// The wait after the first failure past `FREE_ATTEMPTS`, doubled from there.
const FIRST_DELAY_SECONDS: u64 = 2;

/// Ceiling on the wait: a typo must never feel like a hung app.
const MAX_DELAY_SECONDS: u64 = 60;

/// Whether a PIN may be set at all: exactly four digits, nothing else.
pub fn validate_pin(pin: &str) -> Result<(), String> {
    if pin.len() != PIN_LENGTH || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("Use {PIN_LENGTH} digits."));
    }
    Ok(())
}

/// How long the next attempt must wait, given the number of failures so far.
///
/// Nothing for the first three — mistyping a PIN is not an attack — then 2, 4,
/// 8, 16, 32 and finally 60 seconds, never longer.
pub fn delay_after(failures: u32) -> Duration {
    if failures <= FREE_ATTEMPTS {
        return Duration::ZERO;
    }
    // Capped before the shift so the multiplication cannot overflow.
    let exponent = (failures - FREE_ATTEMPTS - 1).min(6);
    let seconds = FIRST_DELAY_SECONDS
        .saturating_mul(1u64 << exponent)
        .min(MAX_DELAY_SECONDS);
    Duration::from_secs(seconds)
}

/// Hash a PIN. The PHC string carries its own salt and parameters.
pub fn hash_password(pin: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| format!("cannot hash the PIN: {e}"))
}

/// Whether `pin` matches `stored`. Argon2 compares in constant time.
pub fn verify_hash(pin: &str, stored: &str) -> Result<bool, String> {
    let parsed =
        PasswordHash::new(stored).map_err(|e| format!("the stored PIN cannot be read: {e}"))?;
    Ok(Argon2::default()
        .verify_password(pin.as_bytes(), &parsed)
        .is_ok())
}

/// Failures and the time they bought, in memory only.
///
/// Deliberately not persisted: restarting the app to clear a two-second wait is
/// not an attack worth defending against, and a file on disk would be one more
/// thing to corrupt.
#[derive(Default)]
struct Gate {
    failures: u32,
    blocked_until: Option<Instant>,
}

/// Serialises a whole attempt: wait check, hash, record.
///
/// Without it the checks below are a check-then-act race across Tauri's per-invoke
/// tasks: N concurrent `app_lock_verify` calls would each read "no wait", each hash,
/// and the 10,000-combination space would fall in one burst. The mutex queue is the
/// rate limit; the seconds in `Gate` are the policy.
fn attempt_lock() -> &'static tokio::sync::Mutex<()> {
    static ATTEMPT: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    ATTEMPT.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn gate() -> &'static Mutex<Gate> {
    static GATE: OnceLock<Mutex<Gate>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(Gate::default()))
}

/// Run `f` against the gate, recovering from a poisoned lock rather than
/// panicking: a failed attempt must never take the app down.
fn with_gate<T>(f: impl FnOnce(&mut Gate) -> T) -> T {
    let mut guard = gate().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut guard)
}

fn seconds_left(gate: &Gate) -> u64 {
    match gate.blocked_until {
        Some(until) => match until.checked_duration_since(Instant::now()) {
            Some(left) => left.as_secs() + u64::from(left.subsec_nanos() > 0),
            None => 0,
        },
        None => 0,
    }
}

/// Seconds the caller must still wait before another attempt is accepted.
fn wait_before_attempt() -> u64 {
    with_gate(|gate| seconds_left(gate))
}

/// Count a failure and return the wait it earned.
fn record_failure() -> u64 {
    with_gate(|gate| {
        gate.failures = gate.failures.saturating_add(1);
        let delay = delay_after(gate.failures);
        if delay > Duration::ZERO {
            gate.blocked_until = Some(Instant::now() + delay);
        }
        delay.as_secs()
    })
}

fn clear_failures() {
    with_gate(|gate| *gate = Gate::default());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    /// Whether a PIN is stored for this installation.
    pub pin_set: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockOutcome {
    pub unlocked: bool,
    /// Seconds the next attempt has to wait, `0` when it may happen at once.
    pub retry_after_seconds: u64,
    /// True when the wait alone refused the attempt, so the PIN was never checked.
    /// The UI must not tell the user their PIN was wrong in that case.
    pub blocked: bool,
}

/// The Keychain account for this installation's lock.
fn account(app: &AppHandle) -> Result<String, String> {
    Ok(lock_account(&database_file(app)?))
}

/// Whether a PIN is set. Read at launch, so the UI knows whether to ask.
#[tauri::command]
pub fn app_lock_status(app: AppHandle) -> Result<LockStatus, String> {
    Ok(LockStatus {
        pin_set: has_lock_hash(&account(&app)?)?,
    })
}

/// Check a PIN. The hash never leaves this process.
#[tauri::command]
pub async fn app_lock_verify(app: AppHandle, pin: String) -> Result<UnlockOutcome, String> {
    let stored = lock_hash(&account(&app)?)?
        .ok_or_else(|| "no PIN is set for this installation".to_string())?;

    // One attempt at a time, for the whole check.
    let _slot = attempt_lock().lock().await;

    let waiting = wait_before_attempt();
    if waiting > 0 {
        return Ok(UnlockOutcome {
            unlocked: false,
            retry_after_seconds: waiting,
            blocked: true,
        });
    }

    // An absurdly long candidate is a wrong one, and must not cost a hash.
    let plausible = should_hash(&pin);
    let checked = tokio::task::spawn_blocking(move || {
        if plausible {
            verify_hash(&pin, &stored)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| format!("cannot check the PIN: {e}"))??;

    if checked {
        clear_failures();
        return Ok(UnlockOutcome {
            unlocked: true,
            retry_after_seconds: 0,
            blocked: false,
        });
    }

    Ok(UnlockOutcome {
        unlocked: false,
        retry_after_seconds: record_failure(),
        blocked: false,
    })
}

/// Set or change the PIN.
///
/// `current_pin` is required as soon as one is stored: without it, anyone at the
/// keyboard could replace the hash and walk in. It is ignored only on the first
/// set, which is also the recovery path when the Keychain item is gone.
#[tauri::command]
pub async fn app_lock_set(
    app: AppHandle,
    current_pin: Option<String>,
    new_pin: String,
) -> Result<(), String> {
    validate_pin(&new_pin)?;
    let account = account(&app)?;

    if let Some(stored) = lock_hash(&account)? {
        let current = current_pin.ok_or_else(|| "enter the current PIN".to_string())?;
        require_pin(current, stored).await?;
    }

    let hashed = tokio::task::spawn_blocking(move || hash_password(&new_pin))
        .await
        .map_err(|e| format!("cannot hash the PIN: {e}"))??;

    store_lock_hash(&account, &hashed)?;
    clear_failures();
    Ok(())
}

/// Remove the PIN. The caller turns `lock_enabled` off as well.
#[tauri::command]
pub async fn app_lock_clear(app: AppHandle, current_pin: String) -> Result<(), String> {
    let account = account(&app)?;
    let stored = lock_hash(&account)?
        .ok_or_else(|| "no PIN is set for this installation".to_string())?;

    require_pin(current_pin, stored).await?;
    delete_lock_hash(&account)?;
    clear_failures();
    Ok(())
}

/// Verify the current PIN for a change, under the same failure delay as an
/// unlock attempt — otherwise `app_lock_set` would be a free oracle.
async fn require_pin(current: String, stored: String) -> Result<(), String> {
    let _slot = attempt_lock().lock().await;

    let waiting = wait_before_attempt();
    if waiting > 0 {
        return Err(format!("try again in {waiting} seconds"));
    }

    // Same bound as an unlock attempt: an oversized candidate is a wrong one and
    // must not cost a hash, here either.
    let plausible = should_hash(&current);
    let checked = tokio::task::spawn_blocking(move || {
        if plausible {
            verify_hash(&current, &stored)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| format!("cannot check the PIN: {e}"))??;

    if checked {
        Ok(())
    } else {
        let waiting = record_failure();
        if waiting > 0 {
            Err(format!("the current PIN is wrong, try again in {waiting} seconds"))
        } else {
            Err("the current PIN is wrong".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        delay_after, hash_password, should_hash, validate_pin, verify_hash, MAX_CANDIDATE_LENGTH,
        MAX_DELAY_SECONDS, PIN_LENGTH,
    };
    use std::time::Duration;

    /// Not a credential: the hash under test is thrown away, and Argon2 in the
    /// tests never touches the Keychain.
    const SAMPLE: &str = "1234";

    #[test]
    fn only_four_digits_are_a_pin() {
        assert!(validate_pin("0000").is_ok());
        assert!(validate_pin("1234").is_ok());
        assert!(validate_pin("9999").is_ok());

        for refused in [
            "", "123", "12345", "12a4", "abcd", " 123", "12 4", "١٢٣٤", "1234 ", "12.4", "-123",
        ] {
            assert!(validate_pin(refused).is_err(), "accepted {refused:?}");
        }
    }

    #[test]
    fn a_pin_round_trips_and_a_wrong_one_does_not() {
        let stored = hash_password(SAMPLE).expect("hash");
        assert!(stored.starts_with("$argon2id$"), "unexpected hash: {stored}");
        assert!(verify_hash(SAMPLE, &stored).expect("verify"));
        assert!(!verify_hash("1235", &stored).expect("verify"));
        assert!(!verify_hash("", &stored).expect("verify"));
    }

    #[test]
    fn the_same_pin_hashes_differently_every_time() {
        let first = hash_password(SAMPLE).expect("hash");
        let second = hash_password(SAMPLE).expect("hash");
        assert_ne!(first, second, "the salt must be random");
        assert!(verify_hash(SAMPLE, &first).expect("verify"));
        assert!(verify_hash(SAMPLE, &second).expect("verify"));
    }

    #[test]
    fn an_unreadable_hash_is_an_error_not_a_pass() {
        assert!(verify_hash(SAMPLE, "not a phc string").is_err());
    }

    #[test]
    fn only_a_short_candidate_is_worth_a_hash() {
        assert!(should_hash(SAMPLE));
        assert!(should_hash(&"9".repeat(MAX_CANDIDATE_LENGTH)));
        // Above the bound the attempt is refused without hashing anything, so a
        // megabyte of input cannot cost Argon2 time.
        assert!(!should_hash(&"9".repeat(MAX_CANDIDATE_LENGTH + 1)));
        assert!(MAX_CANDIDATE_LENGTH >= PIN_LENGTH);
    }

    #[test]
    fn failures_get_an_increasing_but_capped_wait() {
        for failures in 0..=3 {
            assert_eq!(
                delay_after(failures),
                Duration::ZERO,
                "{failures} failures should not make the user wait"
            );
        }
        assert_eq!(delay_after(4), Duration::from_secs(2));
        assert_eq!(delay_after(5), Duration::from_secs(4));
        assert_eq!(delay_after(6), Duration::from_secs(8));
        assert_eq!(delay_after(7), Duration::from_secs(16));
        assert_eq!(delay_after(8), Duration::from_secs(32));

        // Growth stops at a minute, and never overflows however many attempts
        // arrive.
        assert_eq!(delay_after(9), Duration::from_secs(MAX_DELAY_SECONDS));
        assert_eq!(delay_after(1_000), Duration::from_secs(MAX_DELAY_SECONDS));
        assert_eq!(
            delay_after(u32::MAX),
            Duration::from_secs(MAX_DELAY_SECONDS)
        );
    }
}
