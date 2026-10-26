//! File dialogs and IO.
//!
//! The fs plugin is scoped to app directories, so reading a user-picked backup
//! from ~/Downloads or ~/Documents goes through these commands instead of
//! widening the plugin's scope.

use std::path::Path;

/// Read a UTF-8 text file the user picked in a native dialog.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    std::fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))
}

/// Write a UTF-8 text file (backup export, CSV export).
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path = Path::new(&path);
    std::fs::write(path, contents).map_err(|e| format!("cannot write {}: {e}", path.display()))
}
