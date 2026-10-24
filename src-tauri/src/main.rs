// Prevents an additional console window on Windows in release. macOS only here,
// but the attribute is harmless and keeps the scaffold standard.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    financetrackerapp_lib::run()
}
