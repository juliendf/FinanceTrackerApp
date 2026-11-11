pub mod commands;

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
        .on_navigation(|_webview, url| allowed_navigation(url, cfg!(dev)))
        .build()
}

/// Whether the window may navigate to `url`.
///
/// Split out from the plugin so it can be tested without a runtime.
pub fn allowed_navigation(url: &tauri::Url, dev: bool) -> bool {
    match url.scheme() {
        // The app itself, its assets and its IPC.
        "tauri" | "asset" | "about" => true,
        // The IPC endpoint Tauri uses on some platforms, and — in a dev build
        // only — the Vite server. A release build never serves the app over http.
        "http" | "https" => {
            url.host_str() == Some("ipc.localhost")
                || (dev && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")))
        }
        _ => false,
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The schema is created and migrated before the window exists, so no
        // command can run against a database that is not there.
        .setup(|app| {
            tauri::async_runtime::block_on(commands::db::migrate(app.handle()))
                .map_err(|error| {
                    // Without a schema every screen fails; refuse to start rather
                    // than show an app that cannot work.
                    eprintln!("database migration failed: {error}");
                    Box::<dyn std::error::Error>::from(error)
                })
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(navigation_guard())
        .invoke_handler(tauri::generate_handler![
            commands::db::run_transaction,
            commands::db::run_transaction_returning_id,
            commands::db::execute_write,
            commands::db::db_select,
            commands::db::database_path,
            commands::files::pick_and_read_text_file,
            commands::files::read_limit_bytes,
            commands::files::save_text_file,
            commands::files::open_external,
            commands::providers::provider_save,
            commands::providers::provider_delete,
            commands::providers::provider_set_default,
            commands::import::import_all,
            commands::providers::providers_reset,
            commands::llm::chat_completion,
            commands::llm::cancel_chat,
            commands::llm::provider_models,
            commands::llm::provider_connection,
            commands::llm::probe_models,
            commands::llm::probe_connection,
            commands::rates::fetch_ecb_rates,
            commands::lock::app_lock_status,
            commands::lock::app_lock_verify,
            commands::lock::app_lock_set,
            commands::lock::app_lock_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::allowed_navigation;

    fn url(value: &str) -> tauri::Url {
        value.parse().expect("test URL")
    }

    #[test]
    fn the_window_only_navigates_to_the_app() {
        for allowed in ["tauri://localhost/", "asset://localhost/x", "about:blank"] {
            assert!(allowed_navigation(&url(allowed), false), "{allowed} should be allowed");
        }
        for refused in [
            "https://attacker.tld/",
            "http://example.com/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
        ] {
            assert!(!allowed_navigation(&url(refused), true), "{refused} should be refused");
        }
    }

    #[test]
    fn the_dev_server_is_allowed_in_a_dev_build_only() {
        assert!(allowed_navigation(&url("http://localhost:1420/"), true));
        assert!(allowed_navigation(&url("http://127.0.0.1:1420/"), true));
        // A release build serves the app from `tauri:`, never from a local server.
        assert!(!allowed_navigation(&url("http://localhost:1420/"), false));
        assert!(!allowed_navigation(&url("http://127.0.0.1:1420/"), false));
        // The IPC endpoint is allowed in both.
        assert!(allowed_navigation(&url("http://ipc.localhost/"), false));
    }
}
