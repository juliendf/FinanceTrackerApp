# Code review, round 2 — 2026-11-01 (Claude)

Read-only review of HEAD `e141bc6`, in two parallel passes:

- **Regressions:** the fix commits `2066543..HEAD`, looking for bugs the fixes introduced.
- **Quality and performance:** the whole codebase. This is the first time these were reviewed.

Nothing in the repository was changed. Test suites at HEAD: 508 JS passed, typecheck clean, Rust 65 passed. **None of the blockers below are caught by the tests**: the TS tests mock `invoke`, and the Rust tests build their own structs and schemas, so nothing checks one side against the other.

Previous rounds: [`code-review-claude-2026-11-01.md`](./code-review-claude-2026-11-01.md), [`code-review-fixes-2026-11-01.md`](./code-review-fixes-2026-11-01.md).

## Summary

| # | Severity | Category | Location | Issue |
|---|---|---|---|---|
| B1 | Critical | Correctness | `src-tauri/tauri.conf.json`, `src/db/client.ts` | Schema migrations never run; a fresh install has no database — **fixed** |
| B2 | Critical | Correctness | `src-tauri/src/commands/providers.rs:43` | `provider_save` cannot deserialize the input TS sends — **fixed** |
| B3 | Critical | Correctness | `src/db/seed.ts:95` | The first-run seed inserts a provider through the write path the authorizer refuses — **fixed** |
| R1 | High | Correctness / data loss | `providers.rs:61`, `src/import/execute.ts:230` | `providers_restore` fails after the import has already wiped providers and keys — **deserialization fixed, ordering open** |
| P1 | High | Performance | `src/ui/pages/chat/ChatPage.tsx:243` | Every streamed token re-renders and re-parses the whole transcript |
| Q1 | High | Quality | tests | No test covers the TS/Rust boundary or the startup path |
| R2 | Medium | Robustness | `src/db/reset.ts:13`, `src/import/execute.ts:13` | Import and reset are four separate commits, but documented as atomic |
| R3 | Medium | Robustness / data loss | `providers.rs:267` | A transient Keychain error during an edit deletes the key |
| R4 | Medium | Correctness | `LlmProviderFormPage.tsx:117` | Test connection checks the saved URL, not the edited one |
| S1 | Medium | Security (design) | `providers.rs` | A compromised webview can point a keyless default provider at any URL |
| P2 | Medium | Performance | `src-tauri/src/commands/db.rs` | A new SQLite connection per call, about 40 times slower than a pool |
| P3 | Medium | Performance | `src/App.tsx:15` | `staleTime: 0` refetches the whole snapshots table on every navigation |
| P4 | Medium | Performance | `src/llm/tools.ts:277` | Chat tools load the whole portfolio to answer about one asset |
| P5 | Medium | Performance | `src-tauri/src/commands/llm.rs:161` | A new `reqwest::Client` per request, with a new TLS handshake each tool round |
| Q2 | Medium | Quality | `db.rs` | Connection setup copy-pasted four times |
| Q3 | Medium | Quality | `src/db/literals.ts`, `transaction.ts` | Two write styles; batches still inline literals |
| Q4 | Medium | Quality | `ChatPage.tsx`, `commands/` | Fire-and-forget chat actions; untyped `String` errors |
| Q5 | Medium | Quality | `src/db/client.ts:28`, `service.ts`, `tools.ts` | Rows and JSON payloads are cast, never validated |
| R5 | Low | Correctness | `src/llm/service.ts:217` | Pending-action status can disagree with what was written |
| R6 | Low | Robustness | `providers.rs:484` | `providers_reset` is not atomic |
| R7 | Low | Integrity | `db.rs` `write_authorizer` | DML on `sqlite_sequence` is still allowed |
| P6 | Low | Performance | `src/lib/useDashboardData.ts:36` | The dashboard `useMemo` recomputes on every render |
| P7 | Low | Performance | bundle, `0001_init.sql` | A single 1.25 MB bundle; a redundant snapshot index |
| Q6 | Low | Quality | various | Duplicated logic, dead code, stale comments |
| Q7 | Low | Quality | page components | Oversized page components (660 to 690 lines) |
| R8 | Low | Cosmetic | `externalLinks.ts:26`, `files.rs` | Link scheme case mismatch; misplaced doc comments |

## Blockers

All three come from the last security commits. The current dev database keeps working for reads and ordinary writes only because it already exists and is already migrated.

### B1. Critical — Schema migrations never run

**Where:** `src-tauri/src/lib.rs:81`, `src-tauri/tauri.conf.json`, `src/db/client.ts`

tauri-plugin-sql 2.6.0 runs migrations only for the databases listed in `plugins.sql.preload`, or when the webview calls `Database.load` (plugin source `lib.rs:219-235`, `commands.rs`). `e141bc6` removed `Database.load` and every `sql:*` permission, and the config has no `preload`. Nothing triggers the migrations any more.

**Impact:** on a fresh install the database file is never created, so every `db_select`, `execute_write` and `provider_*` call returns "database not found". On existing installs, future migrations (0007 and later) are skipped without any error.

**Fix:** add `"plugins": {"sql": {"preload": ["sqlite:financetracker.db"]}}`. Better: run the migrations with `sqlx::migrate::Migrator` in `Builder::setup` before any command can run, and drop the plugin entirely.

**Status: done (2026-11-01).** Rust owns the schema now; the plugin is gone entirely (crate, JS package, config, capabilities).

- `commands::db::migrate` runs `sqlx::migrate!("./migrations")` from `Builder::setup`, before the window exists. It opens with `SqliteConnectOptions::new().filename(…)` — a path, not a URL, since the app-data path contains a space — and sets `create_if_missing`, `foreign_keys` and WAL.
- The migrator uses the same `_sqlx_migrations` table the plugin used, and SQLite's migrator does not verify checksums for applied rows, so **an existing install is recognised and nothing is re-applied**. Verified against a copy of the real database: versions 1–6 already recorded, migration reports success, 18 assets intact.
- A failed migration aborts startup rather than opening a window in which every screen fails.

**Proof** (`src-tauri/tests/migrations.rs`, 4 tests): a fresh file is created with the full schema and 6 applied versions; a second run is a no-op and leaves existing rows alone; a database already at version 6 keeps its data; the file ends up in WAL mode. Also run end to end: the built binary started with `HOME=/tmp/ft-fresh`, created the database, applied 6 migrations and 18 tables.

### B2. Critical — `provider_save` cannot deserialize its input

**Where:** `src-tauri/src/commands/providers.rs:43-58`, `src/db/repositories/llmProviders.ts:116-131`

`ProviderInput` has `#[serde(rename_all = "camelCase")]`, so it expects `baseUrl`, `providerType`, `isActive` and `apiKey`. TS sends `base_url`, `provider_type`, `is_active` and `api_key`. Tauri renames only top-level command arguments, never fields of a nested struct.

**Impact:** every create and edit is rejected with `missing field 'baseUrl'`. That also means **the Gemini key cannot be re-entered**, which the origin binding requires for every legacy key.

**Fix:** remove `rename_all` from `ProviderInput` and `RestoreInput`, or send camelCase from TS. Add a Rust test that deserializes the exact JSON the TS sends.

**Status: done (2026-11-01).** `rename_all` is gone from `ProviderInput`, `RestoreInput` and `ModelChoice`; the struct fields are the names TypeScript already sends (`base_url`, `provider_type`, `is_active`, `api_key`). Tauri renames only a command's own arguments, never nested struct fields, which is what made this invisible.

**Proof** (`src-tauri/tests/providers.rs`): four tests deserialize the payloads copied from the webview — the create form, an edit (id + null key + null models), the first-run seed, and a restore row with `1`/`0` flags and missing optionals. Without the fix, the first three fail with `missing field 'baseUrl'`.

### B3. Critical — The first-run seed inserts a provider through the refused path

**Where:** `src/db/seed.ts:95`; `write_authorizer` in `db.rs`; asserted by `tests/sql_guard.rs:156`

On an empty provider table, `seedFirstRun` inserts the default provider with `executeWrite`. The authorizer refuses writes to `llm_providers` on that path, so the seed throws and SeedGate fails. This compounds B1.

**Fix:** seed the provider in Rust, through `provider_save` or in a migration.

**Status: done (2026-11-01).** `seedFirstRun` calls `invoke("provider_save", …)` for the default provider instead of `executeWrite`; the first provider still becomes the default, now inside the Rust command. A new `src/db/seed.test.ts` asserts the call and that no `executeWrite` touches `llm_providers` — the seed had no test at all before.

## Correctness and robustness

### R1. High — `providers_restore` fails after the import has wiped providers and keys

**Where:** `providers.rs:61-75`, `src/import/execute.ts:230-261`, `src/import/schema.ts:92`

- The same field-name mismatch as B2 applies.
- Even with the names fixed, `is_default: bool` is required, while the backup schema allows a number or nothing. So `is_default: 1`, or a missing field, still fails, and `is_active: 1` fails `Option<bool>`.
- `executeImport` first calls `resetDatabase()`, which runs `providers_reset` and deletes every provider row and Keychain item. It then imports the data, then `providers_restore` throws.

**Impact:** you end up with the data restored and every provider and key gone.

**Fix:**
- Fix the field names.
- Coerce the booleans in TS, or accept 0/1 in Rust.
- Validate the provider payload before `resetDatabase()`.

**Status (2026-11-01): the two deserialization causes are fixed, the ordering is not.**

- Field names: fixed with B2.
- Booleans: `is_default` and `is_active` go through a `boolish` deserializer that accepts `true`/`false` and `1`/`0` (and a missing field), and `enabled` does too; TypeScript also sends real booleans now.
- **Still open:** `executeImport` resets before it restores, so a restore that fails for any *other* reason still leaves the data imported and the providers gone. That is R2's atomicity problem and needs the provider reset/restore moved into the import transaction.

### R2. Medium — Import and reset are not all-or-nothing

**Where:** `src/db/reset.ts:13-33`, `src/import/execute.ts:13` (its comment says "a failure leaves no trace")

Provider reset, data reset, data import and provider restore are four separate commits. If any step after the first fails, the database is left half-replaced.

**Fix:** do the provider reset and restore in the same Rust transaction as the data, and write the Keychain after the commit. At minimum, correct the comment.

### R3. Medium — A transient Keychain error deletes the key

**Where:** `providers.rs:267-287`

`keep = matches!(read_key(..), Ok(Some(_)))` treats every error the same: origin mismatch, legacy format, locked keychain, or clicking "Deny" on the access prompt (common after rebuilding an unsigned dev build). Renaming a provider at that moment clears `keychain_ref` and deletes the item.

**Fix:** a typed error. Drop the key only for the "origin mismatch" and "legacy unbound" cases; return every other error.

### R4. Medium — Test connection checks the saved URL, not the edited one

**Where:** `src/ui/pages/settings/LlmProviderFormPage.tsx:117-123`

`canProbeSaved` ignores `draft.base_url`. If you edit the URL to a bad host and click Test, it reports success against the old endpoint.

**Fix:** use `provider_connection` only when the draft URL equals the saved one, as the model fetch at line 151 already does.

### R5. Low — Pending-action status can disagree with what was written

**Where:** `src/llm/service.ts:217-229`, `:284`

If the write succeeds but `resolvePendingAction` or `appendMessage` then throws, the action is marked `failed` although the data was saved. An unknown `action_type` is claimed as `confirmed` and never resolved.

**Fix:** after the write has happened, never mark the action `failed`. Resolve unknown types as `failed`.

### R6. Low — `providers_reset` is not atomic

**Where:** `providers.rs:484-508`

The two DELETEs run without a transaction, and the Keychain loop stops at the first error, leaving the remaining items orphaned.

**Fix:** use one transaction, and make the Keychain loop best-effort with the errors collected.

### R7. Low — DML on `sqlite_sequence` is still allowed

**Where:** `write_authorizer` in `db.rs`

`UPDATE sqlite_sequence SET seq = …` passes both layers and can break the id logic behind `justInserted`, `nextId` and `run_transaction_returning_id`.

**Fix:** deny every `sqlite_*` table name.

### R8. Low — Cosmetic

- `externalLinks.ts:26` matches the scheme case-insensitively, but `files.rs` does not, so an `HTTPS://` link is swallowed silently.
- Doc comments:
  - `db.rs:405-407`: the `WriteResult` doc line is duplicated.
  - `llm.rs:483-486`: the `chat_completion` doc sits on `ProviderConfig`.
  - `transaction.ts`: its header still describes the plugin pool.

## Security

### S1. Medium — A compromised webview can repoint a keyless default provider

**Where:** `provider_save`, `provider_set_default` in `providers.rs`

These are legitimate commands, so a compromised renderer can create a provider without a key that points at attacker.tld and make it the default. From then on, chat content, including portfolio data from tool results, goes there. The origin binding protects the key, but not that data.

**Fix:** whenever an origin is new or changed, or becomes the default, show a native confirmation from Rust (the dialog plugin is already registered) that the webview cannot answer for the user.

**Verified clean in this round:**
- The `unsafe` authorizer FFI is sound, and every connection that runs webview SQL installs it.
- SQLite passes canonical lowercase table names to the authorizer, and foreign-key cascades are authorized per table.
- `row_to_json` decodes by each value's runtime type, and its shapes match what the plugin used to return.
- The 49 writes moved to bound parameters show no change in parameter order or count.

## Performance

### P1. High — Every streamed token re-renders and re-parses the whole transcript

**Where:** `src/ui/pages/chat/ChatPage.tsx:243-252`, `495-533`, scroll effect at `:127`

- Each `delta` calls `setBubbles`, which re-renders the whole page.
- Each assistant message is an inline `<ReactMarkdown>` with new plugin arrays every render, so nothing is memoised.
- The streaming bubble is re-parsed from scratch on every token, which is O(n²) over the answer.
- With streaming off, `setActivity({phase: "writing"})` still creates a new object on every delta.

**Impact:** one 730-character message takes about 0.8 ms to render (measured). With 30 messages that is about 25 ms of main-thread work per token. At 30 to 60 tokens/s, the main thread is close to saturated: expect jank and input lag in long conversations.

**Fix:**
- A `React.memo` `MessageBubble` with module-level plugin constants.
- Buffer the streaming text in a ref and flush it once per animation frame or every 50 ms.
- Render the streaming bubble as plain text and switch to markdown on `done`.
- Only call `setActivity` when the phase actually changes.

### P2. Medium — A new SQLite connection per call

**Where:** `src-tauri/src/commands/db.rs:62-102`, `356-372`, `420-446`

Measured on a scratch database with 40 assets, 4,800 snapshots and WAL:

| Path | Cost per call |
|---|---|
| New connection + authorizer + `listAssets` query | 1.9 to 3.3 ms |
| Same query on a pool | about 60 µs |
| A write on a new connection | about 1.5 ms |

- The authorizer itself costs nothing. The cost is a cold page cache, a schema parse and a new sqlx worker thread on every call.
- Typical call counts: about 6 for the dashboard, 7 for the assets list, 8 before the first byte of a chat reply, and 4 sequential calls at every launch.
- That adds roughly 10 to 25 ms per screen today, and it multiplies with P3.

**Fix:** one read-only `SqlitePool` (2 to 4 connections) and one write pool (1 connection), both in Tauri `State`, with each authorizer installed in `after_connect`. The security guarantee is unchanged.

### P3. Medium — `staleTime: 0` refetches the whole snapshots table on every navigation

**Where:** `src/App.tsx:15`, `src/lib/useDashboardData.ts:25`

`listFacts` returns every snapshot joined to four tables, about 750 KB of JSON for 4,800 snapshots (measured). The Dashboard, Assets, Performance and Résumé tabs each refetch it on mount.

**Fix:** a single-writer local database whose mutations already invalidate their keys can use `staleTime: Infinity`, or a few minutes. Later, aggregate in SQL instead of shipping raw facts.

### P4. Medium — Chat tools load the whole portfolio for one asset

**Where:** `src/llm/tools.ts:277-284`, `316-324`, `386`; `src/llm/service.ts:247`; `assets.ts:76`

`get_asset_details`, `get_asset_history`, `propose_snapshot` and `applyConfirmedAction` call `listAssets()` and `listAllSnapshotPoints()`, then filter for one id in JS. A typical turn chains three of these: about three full-table scans and roughly 1 MB of IPC traffic.

**Fix:** a `getAssetRow(id)` with `WHERE a.id = ?`, a `tagsForAsset(id)`, and a `listSnapshotsForAsset(id)` with the date filter pushed into SQL (the index already exists).

### P5. Medium — A new `reqwest::Client` per request

**Where:** `src-tauri/src/commands/llm.rs:161-168`, `307`, `579`

Each tool round of a multi-round turn pays a fresh DNS, TCP and TLS handshake to the cloud provider, typically 50 to 300 ms (estimated), and rebuilds the rustls root store.

**Fix:** build the client once in a `OnceLock<reqwest::Client>`, and keep the per-request `.timeout()`.

### P6. Low — The dashboard memo recomputes on every render

**Where:** `src/lib/useDashboardData.ts:36`, `DashboardPage.tsx:38-44`

`makeConverter` is a new closure on every render, and `facts.data ?? []` is a new array while loading, so the Decimal-heavy summaries recompute every time.

**Fix:** `useCallback` for the converter, and stable empty constants.

### P7. Low — Bundle size and a redundant index

- **Bundle:** one 1.25 MB chunk (371 KB gzipped), with every route imported eagerly. The markdown stack and chart.js are parsed at startup.
  - Fix: `React.lazy` for the chat and chart routes.
  - `@fontsource/inter` ships 5 weights across all subsets; import only the `latin-*` subsets.
- **Index:** `idx_snapshot_asset_date` duplicates the automatic index from `UNIQUE(asset_id, date)`, so every snapshot write updates two identical indexes.
- **Other queries:** the query plans checked are fine.

## Code quality

### Q1. High — No tests across the TS/Rust boundary

All three blockers slipped through for the same reason: the TS tests mock `invoke`, and the Rust tests use hand-made structs and schemas. `navigation_guard` (`lib.rs:57`), which is security-relevant, has no test.

**Fix:**
- A Rust integration test that runs `migrations()` on a temp file, then replays the SQL from `seedFirstRun` and the repository builders through `write_statement` and `execute_statements`.
- A serde test with the exact JSON payloads the TS sends.
- Move the navigation check into a pure `allowed_navigation(&Url, dev: bool)` function and unit-test it.

### Q2. Medium — Connection setup copy-pasted in `db.rs`

- The options, connect and authorizer setup is repeated four times (`:67`, `:357`, `:427`, `:480`).
- The two `install_*_authorizer` functions are identical apart from the callback.
- `execute_statements` and `execute_statements_returning_id` are about 80% the same.
- `check_statement` runs at different points in different commands.

**Fix:**
- One `open(Mode)` helper, which becomes the pool from P2.
- One `install_authorizer(conn, cb)`.
- One `run_batch(statements, returning)`.
- Build options with `SqliteConnectOptions::new().filename(path)` instead of formatting a URL from a path that contains "Application Support".

### Q3. Medium — Two write styles

Single writes use bound parameters, while batches still inline escaped literals (`sqlInt`/`sqlText`) because `run_transaction` takes `Vec<String>`. A future batch caller that forgets a helper creates a quoting bug the compiler cannot catch.

**Fix:** make `run_transaction` accept `Vec<{sql, params}>` and bind in Rust. `literals.ts`, `justInserted` and `nextId` then mostly go away.

### Q4. Medium — Fire-and-forget actions and untyped errors

- `commitRename`, `removeConversation`, `changeProvider`, `deleteMessage` and `setConversationModel` in `ChatPage.tsx` are `void`ed with no catch. A Rust error becomes an unhandled rejection with no toast.
- All 48 commands return `Result<_, String>`, so the UI cannot tell "not authorized" from "busy" from "not found". `thiserror` is a dependency but is never used.

**Fix:** `useMutation` with a shared `onError` in the UI, and one serialisable `AppError` enum returned as `{kind, message}`.

### Q5. Medium — Rows and payloads are cast, never validated

- `db.select<T>` is an unchecked cast (77 call sites).
- `pending_actions.payload` and the tool arguments go through `JSON.parse(...) as Record<string, unknown>`, then `Number(...)`, so `asset_id: "abc"` becomes `NaN`.

**Fix:** zod is already a dependency. Add schemas for the pending-action payloads and for each tool's arguments, plus a `selectParsed(schema, sql)` for the row shapes that matter.

### Q6. Low — Duplication, dead code, stale comments

- **Duplicated:**
  - The currency-symbol map appears in 9 places; keep one `currencySymbol()` in `domain/format.ts`.
  - `major` and `round2` are duplicated in `tools.ts:203` and `dashboard.ts:33`.
- **Dead code:**
  - `recentToolActivity` and the re-exports in `tools.ts:513-518`.
  - `countSettings` and `databaseName`.
  - The npm package `@tauri-apps/plugin-sql`.
  - The `thiserror` crate.
- **Stale comments:**
  - `deleteAsset` (`assets.ts:192`) still mentions `foreign_keys` on the plugin pool.
  - The headers of `db.rs` and `transaction.ts` still describe the plugin pool.
- **Misplaced:** `src/llm/modelChoice.ts` is a React hook and belongs in `src/lib` or `src/ui`. The other module boundaries are clean.

### Q7. Low — Oversized page components

`AssetFormPage.tsx` (689 lines), `ChatPage.tsx` (681) and `ProfilePage.tsx` (660). Splitting `ChatPage` into `SessionSidebar`, a memoised `Transcript`, `PendingActionCards` and `Composer` fixes both maintainability and P1.

## What is good

- `domain/` is pure and golden-tested against the source app.
- The evolution chart algorithm is O(n log n), down from O(dates × assets × snapshots) in the source app.
- The list pages memoise filtering, sorting and pagination correctly.
- The indexes match the queries.
- The authorizer design is sound, and pooling (P2) does not weaken it.

## Suggested order

1. B1, B2, B3 and R1, plus the boundary tests from Q1 that would have caught them.
2. R2 and R3 (import and reset atomicity, Keychain error handling), then S1.
3. P1 and P2 (chat streaming re-renders, connection pooling), then P3 to P5.
4. Q2 to Q7 as follow-up refactors.
