# Security

Threat model: a single user's personal finance data on their own Mac. There is no server, no login, no multi-user isolation and no telemetry. The realistic risks are local data exposure, a leaked provider API key, and the webview executing untrusted content.

## Data at rest

- The database is a plain SQLite file in `~/Library/Application Support/ch.julien.financetrackerapp/`. It is **not encrypted** by the app; protection is macOS user permissions and FileVault. Turn FileVault on.
- Time Machine and other backups of that folder include the database.
- Backup exports (JSON) and CSV exports are plain text written wherever the user chooses. Treat them as sensitive.

## Secrets

- Provider API keys are stored in the **macOS Keychain** (`keyring` with the Apple native store), service `ch.julien.financetrackerapp`, account `provider:<id>`.
- SQLite stores only the reference (`keychain_ref`), never the key. Imports that carry a plaintext key in the source backup move it to the Keychain and drop it from the database; the app's own exports never contain keys.
- **Known limit:** `secret_get` returns the key to the webview, which then passes it to `chat_completion`. The key therefore lives briefly in JavaScript memory. A tighter design is for Rust to read the Keychain itself from the provider id; this is planned with the chat work in Phase 7.

## Network

- The app makes no network calls except to the LLM provider base URL the user configures (OpenAI-compatible, including local Ollama). All of it goes through Rust (`reqwest`, rustls) with 10 s connect and 300 s total timeouts.
- Chat sends conversation content, and any portfolio data the tools return, **to the configured provider**. With a hosted provider that means financial data leaves the machine. Use a local model for fully offline use.
- **AI is opt-in**: `ai_enabled` defaults to false, and chat, the prompt rail and memory extraction are disabled until you turn it on in Settings.
- Write tools (record a snapshot, save a memory) never execute from the model's call; they stage a pending action that only the confirm card can resolve.
- No analytics, crash reporting or auto-update channel exists yet. Phase 8 must decide on update delivery before shipping.

## Webview and IPC

- All assets are bundled (Bootstrap, icons and fonts from npm); there are no CDN or remote scripts.
- **Content Security Policy** (`tauri.conf.json`): `default-src 'self'`, `script-src 'self'`, `connect-src ipc: http://ipc.localhost`, `object-src 'none'`, `frame-ancestors 'none'`. `style-src` allows `'unsafe-inline'` because React, Bootstrap and Chart.js set inline styles. A separate `devCsp` adds the Vite dev server and its websocket, and applies only to `tauri dev`.
- Capabilities (`src-tauri/capabilities/default.json`) grant the main window `core:default` and the SQL plugin's load/select/execute/close. The `fs` and `dialog` plugin permissions are not granted; the `fs` plugin is not installed.
- Custom commands: `run_transaction`, `database_path`, `pick_and_read_text_file`, `save_text_file`, `secret_set/get/delete`, `chat_completion`, `cancel_chat`, `list_models`, `test_connection`.

## File access

The webview never passes a path. `pick_and_read_text_file` and `save_text_file` open the native dialog in Rust and only touch the file the user chose there. Reads are capped at 50 MB.

## SQL safety

- Single-statement queries use bind parameters.
- Multi-statement transactions must inline values (the plugin offers no transaction handle). Every value goes through `src/db/literals.ts`: text is escaped by doubling quotes, integers are validated, and the builders are unit-tested against quotes, newlines, semicolons and an injection attempt. New code must not concatenate raw strings into SQL.
- `run_transaction` guards every statement in Rust (`check_statement`): it must start with `INSERT`, `UPDATE` or `DELETE`, contain no second statement and no SQL comment outside a quoted literal. `DROP`, `ATTACH`, `PRAGMA`, `CREATE` and `SELECT` are refused. The guard is tested, including against all 196 statements generated from a real backup. It does not restrict *which tables* may be modified.

## Open issues (to fix before shipping, Phase 8)

1. **`run_transaction` has no table allow-list.** The verb guard stops schema changes and stacked statements, but a compromised webview could still delete or rewrite rows. Replace with named, parameterised operations as the write set stabilises.
2. **Keys pass through JS.** `secret_get` hands the key to the webview, which passes it to `chat_completion`. The planned fix is for Rust to read the Keychain from the provider id; it is not done yet. Note that `test_connection` and `list_models` also take the key from JS for the same reason.
3. **Unsigned build.** Phase 8 covers code signing and notarisation; until then Gatekeeper warns and there is no tamper evidence.
4. **Database is unencrypted** (see Data at rest).

Personal data is git-ignored: `finance_tracker_data_*.json`, `snapshots_export_*.csv`, `*.db`, `*.db-wal`, `*.db-shm`.

## Reporting

This is a personal project; open an issue or contact the owner directly.
