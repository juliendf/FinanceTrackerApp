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
    ]
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
        .invoke_handler(tauri::generate_handler![
            commands::db::run_transaction,
            commands::db::database_path,
            commands::files::pick_and_read_text_file,
            commands::files::save_text_file,
            commands::secrets::secret_set,
            commands::secrets::secret_get,
            commands::secrets::secret_delete,
            commands::llm::chat_completion,
            commands::llm::cancel_chat,
            commands::llm::list_models,
            commands::llm::test_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
