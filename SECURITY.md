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
- No analytics, crash reporting or auto-update channel exists yet. Phase 8 must decide on update delivery before shipping.

## Webview and IPC

- All assets are bundled (Bootstrap, icons and fonts from npm); there are no CDN or remote scripts.
- Capabilities (`src-tauri/capabilities/default.json`) grant the main window: `core:default`, SQL (load/select/execute/close), `dialog:default`, `fs:default`.
- Custom commands: `run_transaction`, `database_path`, `read_text_file`, `write_text_file`, `secret_set/get/delete`, `chat_completion`, `cancel_chat`, `list_models`, `test_connection`.

## SQL safety

- Single-statement queries use bind parameters.
- Multi-statement transactions must inline values (the plugin offers no transaction handle). Every value goes through `src/db/literals.ts`: text is escaped by doubling quotes, integers are validated, and the builders are unit-tested against quotes, newlines, semicolons and an injection attempt. New code must not concatenate raw strings into SQL.
- `run_transaction` executes whatever statements the webview sends. This is acceptable only because the webview is trusted, which is why the open issues below matter.

## Open issues (to fix before shipping, Phase 8)

1. **No Content Security Policy.** `tauri.conf.json` has `"csp": null`. Add a restrictive CSP (`default-src 'self'`, inline styles only if needed, `connect-src` limited to IPC) so injected markup cannot run script.
2. **`read_text_file` / `write_text_file` accept any path.** They exist so a dialog-picked file outside the fs plugin scope can be read, but nothing in Rust checks that the path came from a dialog. A compromised webview could read or overwrite any file the user can. Restrict to paths returned by the dialog (track them in Rust) or move the dialog into Rust.
3. **`run_transaction` accepts arbitrary SQL** from the webview. Replace with named, parameterised operations as the write set stabilises, or at minimum reject statements outside an allow-list of verbs and tables.
4. **`fs:default` and the sql permissions** are broader than the app needs once (2) is fixed; trim them.
5. **Real backups are not git-ignored.** `.gitignore` covers build output and credentials but not `*.json` backups. Keep backups outside the repo (the real one lives in `~/Downloads`), and add an ignore rule for `finance_tracker_data_*.json`.
6. **Keys pass through JS** (see Secrets).
7. **Unsigned build.** Phase 8 covers code signing and notarisation; until then Gatekeeper warns and there is no tamper evidence.

## Reporting

This is a personal project; open an issue or contact the owner directly.
