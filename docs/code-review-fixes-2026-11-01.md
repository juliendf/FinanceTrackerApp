# Fix report — code review of 2026-11-01

What was changed in response to
[`code-review-claude-2026-11-01.md`](./code-review-claude-2026-11-01.md), why,
and how each fix is proved. The review document holds the findings themselves;
this one holds the work.

**Result:** all 10 findings fixed, 3 of 4 minor items fixed, 1 minor item
deliberately left as a release task. 510 JS tests and 38 Rust tests pass;
typecheck is clean.

**Not covered:** the review looked only at security and correctness. Code quality
(module boundaries, duplication, error handling) and performance (indexes, query
counts, re-renders during streaming) have not been reviewed at all, before or
after these fixes. See [Residual risk](#residual-risk).

## Commits

| Commit | Findings | Tests added |
|---|---|---|
| `fd0b6ce` | #2 provider keys never reach the webview | transport/form tests updated |
| `78e8274` | #1 `sql:allow-execute` removed | 3 Rust (`import_sql.rs`) |
| `a8f1ecf` | #3 UTF-8 split across chunks | 3 Rust unit tests |
| `f2d61ce` | #4 Stop while the provider is silent | 2 Rust (`llm_silent.rs`) |
| `72f7b0a` | #5, #6, #7 | 6 JS, 3 updated |
| `4bca038` | #8, #9, #10, minors | 14 JS, 4 Rust |

## Method

Each finding was handled in the same order: confirm the bug in the code as it
actually is (not as the review describes it — the line numbers had drifted),
write the smallest change that removes the failure mode, add a test that fails
without it, run the full suites, then mark the finding in the review document with
what was done and what was not.

Two findings needed a different fix than the review proposed. Both are noted
below; in each case the review's mechanism does not exist in the versions in use.

## Findings

### 1. `sql:allow-execute` bypassed the SQL guard

`src-tauri/capabilities/default.json:10` now grants `sql:default`,
`sql:allow-load`, `sql:allow-select` and `sql:allow-close` — `allow-execute` is
gone, so the webview cannot reach SQLite's write path directly.

Writes go through two Rust commands that share one guard:

- `write_statement` (`src-tauri/src/commands/db.rs:145`) — one statement, values
  **bound**, not inlined. Exposed as `execute_write` (`db.rs:191`) and
  `executeWrite` (`src/db/client.ts:58`).
- `execute_statements` — unchanged, for batches that must be atomic.

Both call `check_statement` (`db.rs:89`), which requires the statement to start
with `INSERT`/`UPDATE`/`DELETE`, allows no second statement and no comment outside
a quoted literal, and refuses `DROP`, `ATTACH`, `PRAGMA`, `CREATE` and `SELECT`.

The PRAGMAs the webview used to send at connect time went with the permission.
WAL mode is persistent in the file header; the write commands set `foreign_keys`
on their own connection.

*Cost:* 49 single-statement writes across the repositories, the first-run seed and
the sample data moved from inline SQL to bound parameters. That is a migration
risk in itself, which is why the guard tests run against a real database rather
than a mock.

*Proof:* three Rust tests — a bound write round-trips a value containing quotes,
semicolons and `--`; successive inserts report the right `lastInsertId`; and
`PRAGMA`, `DROP`, `ATTACH`, `SELECT` and stacked statements are all refused
before touching the database.

### 2. API key and base URL came from the webview

`secret_get` no longer exists. The commands that need a credential take a
`provider_id` and read `base_url` from SQLite and the key from the Keychain in
Rust, so neither value crosses IPC:

- `chat_completion(providerId, model?, messages, tools, onEvent)` — `llm.rs:528`
- `provider_models(providerId)` — `llm.rs:617`
- `provider_connection(providerId)` — `llm.rs:625`

`probe_models` / `probe_connection` (`llm.rs:637`, `llm.rs:643`) still accept a
raw base URL and key, because the provider form has to test an endpoint before it
is saved. That key is typed into the form by the user; no stored key is reachable
that way. `secret_set` and `secret_delete` are limited to `provider:<id>` accounts
by `check_account` (`secrets.rs:26`).

*Proof:* the transport and form tests were updated to the provider-id shape; the
live provider tests still pass against Ollama and Gemini.

### 3. UTF-8 split across chunks was corrupted

`LineBuffer` (`llm.rs:93`) accumulates raw bytes and decodes a line only once its
newline has arrived. A newline byte can never be part of a multi-byte sequence, so
no character can be split. `\r\n` is trimmed, and the trailing line is flushed
when the stream ends without a newline.

*Proof:* a unit test feeds `"CHF 1’000.50 — éé€ 🙂"` one **byte** at a time and
asserts no replacement character survives, plus tests for the trailing flush and
CRLF trimming. Live Ollama and Gemini runs still stream correctly.

### 4. Stop did nothing while the provider was silent

Cancellation used to be checked only when a chunk arrived, so a model that was
loading sent no bytes and Stop waited out the 300 s timeout. Both waits now race a
100 ms poll (`wait_for_cancel`, `llm.rs:77`; `CANCEL_POLL`, `llm.rs:74`):

- `http.send()` runs inside a `tokio::select!`, so a provider that never sends
  headers can be stopped;
- the stream read does too, so a provider that goes quiet mid-answer can be
  stopped.

Text that already arrived is kept and returned with `cancelled: true`.

*Proof:* `src-tauri/tests/llm_silent.rs` stands up a local server that never
answers and one that answers then goes silent; both requests return in under a
second (the pair runs in ~0.35 s), and the delta received before the stop is
preserved. The live Ollama mid-stream test still passes.

### 5. Divide-by-zero guard checked the wrong variable

`src/llm/tools.ts:292` now guards `first.amount_minor === 0`, the value it divides
by. Two consequences, both now tested: a fall from 800 to 0 reports `-100`
(previously swallowed as "no change"), and a window that starts at 0 reports
`null` instead of `Infinity`.

### 6. `list_assets` truncated before sorting

`src/llm/tools.ts:262` sorts by institution and product, then caps at 50. The 50
that survive are now the first 50 by name instead of an arbitrary slice, so a
named asset cannot be dropped by the cap.

**Different from the review's suggestion:** the payload stays a bare array rather
than becoming `{ assets, truncated }`. That is the shape the source returns and
what the model expects; making the cap deterministic fixes the actual failure
(the asset silently missing) without changing the protocol. A test with 60 assets
asserts the survivors are ids 1–50, not the repository's insertion order.

### 7. `confirmAction` could write twice

`confirmAction` and `rejectAction` now **claim** the row before doing anything:
one conditional `UPDATE … WHERE id = ? AND status = 'pending'`
(`claimPendingAction`, `src/db/repositories/chat.ts:197`), through `execute_write`
so the affected-row count comes back. The loser of a race gets no row, reports
"already resolved" and writes nothing. A write that throws marks the action
`failed` with the error instead of leaving it pending. The card's Confirm and
Reject buttons disable while a request is in flight (`ChatPage.tsx:574`).

*Proof:* three service tests (claim ordering, second-confirm refusal, failure
path) and a UI-level busy state.

### 8. Assistant links could replace the app window

**Different from the review's suggestion:** `Builder::on_navigation` does not
exist in Tauri v2 — the suggested fix does not compile. The guard is in the
webview:

- `installExternalLinkGuard` (`src/lib/externalLinks.ts:24`) adds one capturing
  `click` listener on the document before React renders. A click on an absolute
  `http(s)` link is `preventDefault()`ed and handed to `openExternal`, which calls
  the new `open_external` command.
- `open_external` (`src-tauri/src/commands/files.rs:29`) re-checks the scheme and
  refuses anything that is not `http://` or `https://`, so a `file:` or
  `javascript:` URL never reaches the system opener even if the webview guard is
  bypassed.

Hash routes (`#/assets`), relative hrefs, modifier-clicks and non-web schemes are
left alone — modifier-clicks are a deliberate "open in a new tab" intent that
should not be hijacked.

Done document-wide rather than per component because replies render in three
places (history, streaming bubble, delete modal), and a custom `a` component would
have to be threaded through each.

*Proof:* nine jsdom tests — https, http, hash route, relative path, `file:`, a
rejected command, a modifier-click, a click on a child element, and reinstall —
plus a Rust test for the scheme refusal. SECURITY.md documents both halves.

### 9. First snapshot dated in UTC

`src/db/repositories/assets.ts:152` uses `todayIso()` instead of
`new Date().toISOString()`, so an asset created before 02:00 in Zurich is no
longer dated to the previous day.

### 10. Wrong "already exists" value; impossible dates accepted

`propose_snapshot` (`src/llm/tools.ts:392`) validates with `isValidIsoDate`, which
rejects `2026-02-31`, and reads the existing snapshot with
`getSnapshotOn(assetId, isoDate)` (`tools.ts:398`) so the warning shows the value
**on that date** rather than the asset's latest balance.

## Minor items

- **`deleteProvider` removed the key before the rows.** Now rows first, Keychain
  item after (`src/db/repositories/llmProviders.ts:178`). A failed delete leaves a
  provider that keeps its key and can be retried, instead of one that lingers
  without a credential. Tests assert the call order and that a failed delete never
  touches the Keychain.
- **`createAsset` read its id from a pooled connection.** New
  `run_transaction_returning_id` (`db.rs:258`), backed by
  `execute_statements_returning_id` (`db.rs:208`), which reads `sqlite_sequence`
  **inside** the transaction on the same connection. Rust tests cover two
  successive batches, a rolled-back batch (no id, nothing written) and an empty
  batch.
- **SSE trailing line.** Fixed with #3; `LineBuffer::flush` plus a test.
- **Updater `OWNER` placeholder.** Not fixed, by choice. It needs the real
  repository URL and a published release to mean anything; guessing a value is
  worse than leaving the placeholder. Recorded in `docs/RELEASE.md` and
  SECURITY.md. Until then the only visible effect is a failed update check.

## Verification

```
npx vitest run        # 510 passed, 5 skipped (45 files)
npm run typecheck     # no errors
cargo test            # 15 lib + 21 import_sql + 2 llm_silent passed, 9 ignored
```

The ignored Rust tests are the live-provider ones (they need Ollama or Gemini) and
the import test (needs SQL generated by the TypeScript importer). They were run
separately against a local Ollama:

```
OLLAMA_MODEL=qwen3.5:4b cargo test --test live -- --ignored
```

## Residual risk

These fixes close the reported failure modes; they do not make the app hardened.

- **`run_transaction` still has no table allow-list.** Statements are validated
  (DML only, no stacking, no comments) but any table can be modified, so a
  compromised webview could still rewrite or delete rows.
- **The database is unencrypted.** Portfolio and profile data sit in plain SQLite
  in `~/Library/Application Support/`.
- **The link guard is a webview mechanism.** It stops a click from navigating, and
  Rust refuses non-web schemes, but there is no app-level navigation hook to fall
  back on. A link with a `mailto:` or `tel:` scheme is neither intercepted nor
  opened: the click does nothing.
- **#8 is tested in jsdom only.** No test drives a real click in the running app;
  the Rust side is covered, the wiring to `main.tsx` is not automated.
- **Code quality and performance are still unreviewed.** No index analysis, no
  query-count measurement, no look at re-renders during streaming or the cost of
  rebuilding the system prompt each turn.
