//! File dialogs and IO.
//!
//! The webview never supplies a path. Each command opens the native dialog
//! itself and only reads or writes what the user picked there, so a compromised
//! webview cannot read or overwrite arbitrary files.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// A file the user picked in the open dialog.
#[derive(Serialize)]
pub struct PickedFile {
    /// File name only, for display.
    pub name: String,
    pub contents: String,
}

/// Upper bound on a file read through the dialog. A backup is a few hundred KB;
/// this stops a mistaken pick of a huge file from being loaded into the webview.
///
/// It is also the reason an export is checked before it is written: a file
/// larger than this could never be imported again, so writing one silently
/// would create a backup that only looks like a backup. The UI reads the limit
/// through `read_limit_bytes` rather than hard-coding its own copy.
pub const MAX_READ_BYTES: u64 = 50 * 1024 * 1024;

const MB: f64 = 1_048_576.0;

/// The limit, for the export screen to check against before it writes.
#[tauri::command]
pub fn read_limit_bytes() -> u64 {
    MAX_READ_BYTES
}

/// What the user sees when a picked file is over the limit. Says the limit, the
/// size, and the one thing they can do about it.
fn too_large_message(name: &str, size: u64) -> String {
    format!(
        "{name} is {:.1} MB, and this app reads files up to {:.0} MB. For a backup, export it again with fewer things included.",
        size as f64 / MB,
        MAX_READ_BYTES as f64 / MB,
    )
}

/// Open an http(s) URL in the user's default browser.
///
/// Assistant replies can contain links; the app never navigates to them itself.
/// Only web URLs are accepted, so a `file:` or `javascript:` scheme cannot be
/// handed to the system opener.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err(format!("refusing to open '{trimmed}': only http(s) links are allowed"));
    }
    std::process::Command::new("open")
        .arg(trimmed)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot open the link: {e}"))
}

/// Show an open dialog and read the chosen UTF-8 file. `None` when cancelled.
#[tauri::command]
pub async fn pick_and_read_text_file(
    app: AppHandle,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<PickedFile>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter(&filter_name, &exts)
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("unsupported path: {e}"))?;

    let size = std::fs::metadata(&path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?
        .len();
    if size > MAX_READ_BYTES {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        return Err(too_large_message(&name, size));
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Some(PickedFile { name, contents }))
}

/// Show a save dialog and write `contents` where the user chose. Returns the
/// chosen path, or `None` when cancelled.
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    contents: String,
) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let Some(picked) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &exts)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("unsupported path: {e}"))?;
    std::fs::write(&path, contents).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::{open_external, read_limit_bytes, too_large_message, MAX_READ_BYTES};

    #[test]
    fn the_read_limit_is_fifty_megabytes() {
        assert_eq!(read_limit_bytes(), MAX_READ_BYTES);
        assert_eq!(MAX_READ_BYTES, 52_428_800);
    }

    #[test]
    fn a_file_over_the_limit_is_refused_with_the_numbers() {
        let message = too_large_message("backup.json", 62 * 1024 * 1024);
        assert!(message.contains("backup.json"), "{message}");
        assert!(message.contains("62.0 MB"), "{message}");
        assert!(message.contains("up to 50 MB"), "{message}");
        assert!(message.contains("fewer things"), "{message}");
    }

    /// Only the refusal path is tested: a valid URL would launch the browser.
    #[test]
    fn refuses_anything_that_is_not_http() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "mailto:someone@example.com",
            "https:/example.com",
            "example.com",
            " ",
        ] {
            let error = open_external(url.to_string()).unwrap_err();
            assert!(error.contains("only http(s)"), "accepted {url}: {error}");
        }
    }
}
