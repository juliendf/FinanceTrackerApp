pub mod commands;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Schema migrations, applied by the SQL plugin at startup.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "phase0_init",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "full_schema",
            sql: include_str!("../migrations/0002_full_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "gemini_openai_base_url",
            sql: include_str!("../migrations/0003_gemini_openai_base_url.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "provider_models",
            sql: include_str!("../migrations/0004_provider_models.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "profile_free_text",
            sql: include_str!("../migrations/0005_profile_free_text.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "profile_birth_date",
            sql: include_str!("../migrations/0006_profile_birth_date.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// Backstop for the link guard in `src/lib/externalLinks.ts`.
///
/// The webview guard intercepts clicks, which covers the app's own UI; this stops
/// the window from navigating anywhere else even if a click gets through — a
/// dropped handler, a future component, a `window.location` assignment. Assistant
/// links are opened in the browser by `open_external`, so any document navigation
/// away from the app itself is unwanted.
///
/// `tauri::Builder` has no `on_navigation`; the hook lives on the plugin builder,
/// which is why this is a (tiny, inline) plugin.
fn navigation_guard() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::<tauri::Wry, ()>::new("navigation-guard")
        .on_navigation(|_webview, url| match url.scheme() {
            // The app itself, its assets and its IPC.
            "tauri" | "asset" | "about" => true,
            // The dev server, and the IPC endpoint Tauri uses on some platforms.
            "http" | "https" => matches!(
                url.host_str(),
                Some("localhost") | Some("127.0.0.1") | Some("ipc.localhost")
            ),
            _ => false,
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                // macOS: resolves to ~/Library/Application Support/<identifier>/
                .add_migrations("sqlite:financetracker.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(navigation_guard())
        .invoke_handler(tauri::generate_handler![
            commands::db::run_transaction,
            commands::db::run_transaction_returning_id,
            commands::db::execute_write,
            commands::db::database_path,
            commands::files::pick_and_read_text_file,
            commands::files::save_text_file,
            commands::files::open_external,
            commands::providers::provider_save,
            commands::providers::provider_delete,
            commands::providers::provider_set_default,
            commands::providers::providers_restore,
            commands::providers::providers_reset,
            commands::llm::chat_completion,
            commands::llm::cancel_chat,
            commands::llm::provider_models,
            commands::llm::provider_connection,
            commands::llm::probe_models,
            commands::llm::probe_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
