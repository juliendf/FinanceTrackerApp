# Security

Threat model: a single user's personal finance data on their own Mac. There is no server, no login, no multi-user isolation and no telemetry. The realistic risks are local data exposure, a leaked provider API key, and the webview executing untrusted content.

## Data at rest

- The database is a plain SQLite file in `~/Library/Application Support/app.financetracker/`. It is **not encrypted** by the app; protection is macOS user permissions and FileVault. Turn FileVault on.
- Time Machine and other backups of that folder include the database.
- Backup exports (JSON) and CSV exports are plain text written wherever the user chooses. Treat them as sensitive.

## Secrets

- Provider API keys are stored in the **macOS Keychain** (`keyring` with the Apple native store), service `app.financetracker`, account `provider:<id>`. Only `provider:<id>` accounts can be written or deleted; anything else is refused.
- **A new endpoint is confirmed natively.** The key binding stops a stored key from following a changed `base_url`, but chat content goes wherever `base_url` points. So `provider_save` (a remote endpoint that is new or moved), `provider_set_default` (a keyless provider becoming the default) and `import_all` (every remote origin a backup names, once each, before the database is opened) raise a native Rust dialog that the webview cannot answer. Loopback endpoints never ask.
- **A key is bound to the endpoint it was entered for.** The item holds `{"key": …, "origin": "scheme://host:port"}`. Every request compares the provider's current base URL with that origin and refuses to send the key anywhere else — a different scheme, host or port is refused; a path change (`/v1` → `/v2`) is not. Changing a provider's base URL drops the stored key, so the user re-enters it for the new endpoint.
- **Plain http is refused for remote endpoints.** `origin_of` accepts `http://` only for `localhost`, `127.0.0.1` and `[::1]`; any other host must use `https://`. This applies when a provider is saved and when a stored key is read, so a key is never sent in cleartext.
- SQLite stores only the reference (`keychain_ref`), never the key. Imports that carry a plaintext key in the source backup move it to the Keychain and drop it from the database; the app's own exports never contain keys.
- **The webview can neither read nor write a key.** There is no `secret_get`, `secret_set` or `secret_delete`. `chat_completion`, `provider_models` and `provider_connection` take a **provider id**; Rust reads the base URL from SQLite and the secret from the Keychain, then makes the request. Keys are written and deleted only by `provider_save`, `provider_delete`, `import_all` and `providers_reset`, which all record the origin.
- **Old keys must be re-entered once.** A key saved before the binding existed has no origin, and an unbound key cannot be sent safely, so it is refused with a message until the user enters it again.
- The two `probe_*` commands do accept a base URL and a key, because the provider form must test an endpoint before it is saved. That key is the one the user just typed, not a stored one, so nothing is exposed that the user did not hand over.

## Network

- The app makes no network calls except to the LLM provider base URL the user configures (OpenAI-compatible, including local Ollama), and — only when the user turns it on — to the European Central Bank's daily reference-rate file. All of it goes through Rust (`reqwest`, rustls).
- **Exchange rates are opt-in and read-only.** `rates_source_enabled` defaults to false. When on, `fetch_ecb_rates` downloads `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (10 s connect, 30 s total): a public 1.5 kB file of reference rates. Nothing about the user or their data is sent — it is a GET with no parameters, no key and no body. The response is parsed in Rust; the cross rates are computed in `src/domain` with `decimal.js`. Turning it off stops the request.
- **That endpoint may be called without a click.** With the toggle on, the app fetches once per calendar day when it starts, and records the attempt in `settings.rates_fetched_on` so a failed attempt (offline, endpoint moved) does not retry until the next day. This is the only request the app makes unprompted; updates remain a button, and the LLM is only contacted when a message is sent. With the toggle off — the default — the app contacts nothing at launch.
- Chat sends conversation content, and any portfolio data the tools return, **to the configured provider**. With a hosted provider that means financial data leaves the machine. Use a local model for fully offline use.
- **AI is opt-in**: `ai_enabled` defaults to false, and chat, the prompt rail and memory extraction are disabled until you turn it on in Settings.
- Write tools (record a snapshot, save a memory) never execute from the model's call; they stage a pending action that only the confirm card can resolve.
- **No analytics and no crash reporting.** The only outbound requests are to the provider.
- **Updates are opt-in checks.** `tauri-plugin-updater` reads a static `latest.json` from GitHub Releases when you press *Check for updates*; it never downloads or installs on its own. The endpoint in `tauri.conf.json` still says `OWNER` and must be pointed at the real repository before a release can be found — see `docs/RELEASE.md`.

## Webview and IPC

- All assets are bundled (Bootstrap, icons and fonts from npm); there are no CDN or remote scripts.
- **Content Security Policy** (`tauri.conf.json`): `default-src 'self'`, `script-src 'self'`, `connect-src ipc: http://ipc.localhost`, `object-src 'none'`, `frame-ancestors 'none'`. `style-src` allows `'unsafe-inline'` because React, Bootstrap and Chart.js set inline styles. A separate `devCsp` adds the Vite dev server and its websocket, and applies only to `tauri dev`.
- Capabilities (`src-tauri/capabilities/default.json`) grant the main window `core:default`, `updater:default`, and `core:window:allow-start-dragging` / `allow-internal-toggle-maximize` (the window uses an overlay title bar, so the toolbar and the sidebar's top strip drag it). **No SQL plugin is registered at all.** It used to own the schema migrations and exposed `select` to the webview, which ran every statement in the string (`SELECT 1; DROP TABLE snapshots` returned `Ok` with the table gone) on a pool outside the authorizer. The migrations now run from `Builder::setup` with `sqlx::migrate!`, before the window exists. The `fs` and `dialog` plugin permissions are **not** granted; the `fs` plugin is not installed, and `window.confirm`/`alert` do not work — the app uses its own modals.
- Custom commands: `run_transaction`, `run_transaction_returning_id`, `execute_write`, `database_path`, `pick_and_read_text_file`, `save_text_file`, `open_external`, `provider_save`, `provider_delete`, `provider_set_default`, `providers_reset`, `import_all`, `chat_completion`, `cancel_chat`, `provider_models`, `provider_connection`, `probe_models`, `probe_connection` (the last two take a key typed into the form, never a stored one).
- **Links never navigate the window.** Three layers: `src/lib/externalLinks.ts` intercepts every click on an absolute http(s) link for the whole document (including Cmd- and Shift-clicks, since the window has no tabs) and hands it to the system browser through `open_external`, which refuses anything that is not `http://` or `https://`; and `navigation_guard()` in `src-tauri/src/lib.rs` — an inline plugin using `tauri::plugin::Builder::on_navigation` — cancels any document navigation that is not the app itself (`tauri`/`asset`/`about`, or http(s) on `localhost`/`127.0.0.1`/`ipc.localhost`). Relative and hash hrefs are left alone; `javascript:` and `file:` hrefs are never passed to the opener.

## File access

The webview never passes a path. `pick_and_read_text_file` and `save_text_file` open the native dialog in Rust and only touch the file the user chose there. Reads are capped at 50 MB.

## SQL safety

- Single-statement queries use bind parameters.
- Multi-statement transactions must inline values (the plugin offers no transaction handle). Every value goes through `src/db/literals.ts`: text is escaped by doubling quotes, integers are validated, and the builders are unit-tested against quotes, newlines, semicolons and an injection attempt. New code must not concatenate raw strings into SQL.
- **Every statement goes through Rust.** No plugin command is granted to the webview, so a compromised renderer cannot run arbitrary SQL: reads use `db_select`, single writes `execute_write`, atomic batches `run_transaction`. Each opens its own connection with the right open mode (read-only for reads) and installs an authorizer.
- `db_select` opens the file with `read_only(true)` **and** installs a read-only authorizer (only `SELECT`, `READ`, `FUNCTION`, `RECURSIVE`), so a stacked statement is refused twice over.
- **SQLite enforces the split, not just a text filter.** Every write connection installs an authorizer (`sqlite3_set_authorizer`, see `write_authorizer` in `src-tauri/src/commands/db.rs`) that allows `SELECT`/`READ`/`FUNCTION`/`RECURSIVE`/`INSERT`/`UPDATE`/`DELETE` and the transaction control sqlx itself needs, and refuses `PRAGMA`, `ATTACH`, `DETACH`, `CREATE_*`, `DROP_*`, `ALTER_TABLE`, `REINDEX`, `ANALYZE` and `VACUUM` — for **every** statement in a string, including a tail hidden behind a `;`.
- `check_statement` is the first filter: the statement must start with `INSERT`, `UPDATE` or `DELETE`, contain no second statement and no SQL comment outside a quoted token, where quoted tokens are `'…'`, `"…"`, `` `…` `` and `[…]` with their own doubling escapes. It is tested against the payload that used to bypass it (a `'` hidden inside a `"…"` identifier), against all 196 statements generated from a real backup, and against `execute_write` directly.
- **The provider tables are not reachable from the generic path.** `llm_providers` and `provider_models` decide where an API key is sent, so the authorizer refuses `INSERT`/`UPDATE`/`DELETE` on them from `execute_write` and `run_transaction`; only the named provider commands write them. Every other table is still writable through the generic path.
- **The backup restore has its own authorizer.** `import_all` runs on a connection with `install_import_authorizer`: the writable tables plus `llm_providers` and `provider_models`, and nothing else. `_sqlx_migrations` and `sqlite_sequence` stay refused even if a crafted backup gets past `check_statement`.

## Distribution

- **The local build is ad-hoc signed**, so Gatekeeper warns on first launch and
  there is no tamper evidence. `docs/RELEASE.md` covers the Developer ID
  certificate, notarisation and the hardened runtime (already enabled, with
  `src-tauri/entitlements.plist` granting only network client and
  user-selected files).
- **Updater keys live outside the repository** at
  `~/.config/financetrackerapp/updater.key`. Losing that file permanently breaks
  updates for existing installs; leaking it lets anyone sign an update.
- **The updater shows a check result only**; it never downloads or restarts on
  its own.

## Open issues (to fix before shipping)

1. **`run_transaction` has no table allow-list** beyond the provider tables. Statements are validated (DML only, no stacking, no comments, enforced by the authorizer) and `llm_providers`/`provider_models` are refused outright, but any other table can still be rewritten or deleted by a compromised webview. Replace with named, parameterised operations as the write set stabilises.
2. **Database is unencrypted** (see Data at rest).

Personal data is git-ignored: `finance_tracker_data_*.json`, `snapshots_export_*.csv`, `*.db`, `*.db-wal`, `*.db-shm`.

## Reporting

This is a personal project; open an issue or contact the owner directly.
