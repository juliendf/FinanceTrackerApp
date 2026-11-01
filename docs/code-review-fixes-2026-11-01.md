# Fix report — code review of 2026-11-01

What was changed in response to
[`code-review-claude-2026-11-01.md`](./code-review-claude-2026-11-01.md), why,
and how each fix is proved.

**Result:** all 10 findings addressed. **#1 was reopened twice**: a second review
found the text guard bypassable, and a third found the remaining hole — the SQL
plugin's `select`, which skipped both the guard and the authorizer entirely. #2 and
#8 were also corrected after the second review. The corrections are the part worth
reading.

**Not covered:** the review looked only at security and correctness. Code quality
and performance have not been reviewed at all, before or after these fixes. See
[Residual risk](#residual-risk).

## Corrections from the second pass

The first version of this report said #1 and #2 were fixed and that #8's suggested
`on_navigation` hook does not exist in Tauri v2. All three statements were wrong:

| Claim | Reality |
|---|---|
| "The text guard closes #1" | It scanned only `'…'`. A `'` inside a `"…"` identifier desynchronised it, a `;` hid a second statement, and **sqlx runs the tail**: `DELETE FROM t WHERE (SELECT 1 AS "'") = 0; DROP TABLE t; SELECT 1 AS "'"` passed the guard and dropped the table. Reproduced against the app's own `write_statement`. |
| "Moving to provider ids closes #2" | It stopped the *key* from crossing IPC, not the *destination*. `provider_connection` reads `base_url` from `llm_providers`, and the webview could `UPDATE` that row through `execute_write`, then ask for a connection: the key went out in the `Authorization` header to the new host. |
| "`Builder::on_navigation` does not exist in Tauri v2" | It does — on `tauri::plugin::Builder` (`plugin.rs:459`) and `WebviewWindowBuilder` (`webview_window.rs:266`). Only `tauri::Builder` lacks it, and an inline plugin provides it. |
| "The authorizer closes #1" (second attempt) | Only for statements that reach it. `sql:allow-select` was still granted, and the plugin's `select` runs `pool.fetch_all(sqlx::query(sql))` on its own pool: `SELECT 1; DROP TABLE snapshots` returned `Ok` with the table gone, the provider row rewriteable, and no authorizer in sight. |

The security fixes are now structural rather than textual: a SQLite
**authorizer** at the engine level on every connection that runs webview SQL, no
plugin command granted at all (so there is no unguarded pool), and a **Keychain
item bound to the origin it was entered for**, with the provider tables removed from
the generic write path.

## Commits

| Commit | Findings | Tests |
|---|---|---|
| `fd0b6ce` | #2 (first attempt) | transport/form tests updated |
| `78e8274` | #1 (first attempt) | 3 Rust |
| `a8f1ecf` | #3 UTF-8 split across chunks | 3 Rust |
| `f2d61ce` | #4 Stop while the provider is silent | 2 Rust |
| `72f7b0a` | #5, #6, #7 | 6 JS, 3 updated |
| `4bca038` | #8, #9, #10, minors | 14 JS, 4 Rust |
| this pass | #1 and #2 reopened and closed, #8 completed | 20 Rust, JS updated |

## Findings

### 1. SQL guard bypassed by a hand-written scanner

**Where:** `src-tauri/src/commands/db.rs`

**What was wrong.** `check_statement` tracked single quotes only. SQLite's other
quoted tokens — `"identifier"`, `` `identifier` ``, `[identifier]` — were invisible
to it, so a `'` inside one opened a phantom string and every later `;` was skipped.
sqlx prepares and executes the *tail* of a multi-statement string, so the hidden
statement ran. Three tests passed because they only fed payloads with balanced
single quotes.

**Fix, in two layers.**

1. **The scanner now understands every quoted token.** `check_statement`
   (`db.rs:109`) tracks `'…'`, `"…"`, `` `…` `` and `[…]`, with the doubled-delimiter
   escape each one uses, so a `;` inside any of them is text, and a `;` outside one
   is still a refusal. Comments are still refused.
2. **The engine refuses what the text cannot be trusted to describe.** Every
   connection that runs webview SQL installs a SQLite authorizer
   (`write_authorizer`, `db.rs:203`; `install_write_authorizer`, `db.rs:239`), through
   sqlx's `lock_handle()`/`as_raw_handle()` and `sqlite3_set_authorizer`:

   | Authorized | Refused |
   |---|---|
   | `SELECT`, `READ`, `FUNCTION`, `RECURSIVE` | `PRAGMA`, `ATTACH`, `DETACH` |
   | `INSERT`, `UPDATE`, `DELETE` | `CREATE_*`, `DROP_*`, `ALTER_TABLE` |
   | `TRANSACTION`, `SAVEPOINT` (sqlx needs them) | `REINDEX`, `ANALYZE`, `VACUUM`, `CREATE_VTABLE` |
   | — | any write to `llm_providers` / `provider_models` |

   The authorizer sees the operations of every statement in the string, including a
   tail the scanner missed, so the bypass is dead at the engine even if the scanner
   regresses again. `libsqlite3-sys` is pinned to `0.30.1`, the version sqlx links
   against, as sqlx's own docs require for direct FFI.

   `TRANSACTION` stays allowed because sqlx issues `BEGIN`/`COMMIT`/`SAVEPOINT` on
   the same connection; a smuggled `COMMIT` cannot grant anything, since each
   operation inside it is authorised separately.

**Proof** (`src-tauri/tests/sql_guard.rs`, 14 tests):

- the reported payload, and the same trick with backticks and brackets, are
  refused by the scanner;
- `DELETE FROM t; DROP TABLE t; SELECT 1` sent as **raw SQL with no scanning at
  all** is refused by the authorizer, and the table survives;
- `DROP`, `ALTER`, `CREATE TABLE`, `CREATE INDEX`, `PRAGMA`, `ATTACH`, `VACUUM INTO`
  are all refused with an authorization error;
- writes to `llm_providers` and `provider_models` are refused;
- ordinary `INSERT`/`UPDATE`/`DELETE` still work, including an `AUTOINCREMENT` table
  whose `sqlite_sequence` is maintained internally;
- legitimate statements with quoted identifiers (including `"odd;name"`) still pass.

The reported bypass was reproduced against `write_statement` **before** the fix
(`DROP TABLE t` dropped the table) and is refused **after**.

**Reopened again (third review, 2026-11-01): reads were unguarded.**
`sql:allow-select` was still granted. `tauri-plugin-sql` runs a select as
`pool.fetch_all(sqlx::query(sql))` on **its own pool**, so `SELECT 1; DROP TABLE
snapshots` ran both statements and returned `Ok` — past the scanner and past the
authorizer, which only ever sat on the connections this module opens. The same
trick rewrote a provider's `base_url`, which is how chat content (not the key) could
have been pointed at another host.

**Closed by taking the plugin away from the webview:**

- **`db_select`** (`db.rs`) is the only way the webview reads. It opens the file
  with `read_only(true)`, installs a **read-only authorizer** (only `SELECT`,
  `READ`, `FUNCTION`, `RECURSIVE`), binds parameters, and returns rows as JSON keyed
  by column name — decoded from each *value's* own type, so `COUNT(*)` is a number
  rather than `NULL`.
- **No `sql:*` permission is granted.** The plugin stays registered in Rust to own
  the schema migrations; the webview cannot call `load`, `select` or `close`, so
  there is no pool it can reach.
- `src/db/client.ts` keeps the `db.select(sql, params)` shape the repositories
  already used, so no repository changed.

Five more tests (`sql_guard.rs`, now 14): `SELECT 1 AS x; DROP TABLE t` is refused
and the table survives; `SELECT 1; UPDATE llm_providers SET base_url =
'https://attacker.tld'` is refused and the row still points where the user put it;
a single write, `PRAGMA` and `ATTACH` are refused on the reader; rows come back with
names, bound parameters and `NULL`; and a read-only read works while a writer holds
the WAL open.

### 2. A stored API key could be sent to any URL

**Where:** `src-tauri/src/commands/secrets.rs`, `src-tauri/src/commands/providers.rs`,
`src-tauri/src/commands/llm.rs:525`

**What was wrong.** `provider_connection(1)` read `base_url` from SQLite and sent
the Keychain key there. The webview could change `base_url` with one
`execute_write` and then call the command. Removing `secret_get` had hidden the key
but not the redirect: two calls were enough to mail it to `attacker.tld`.

**Fix, in three parts.**

1. **The key is bound to its origin.** The Keychain item is now
   `{"key": …, "origin": "https://api.openai.com:443"}`, written by
   `secrets::store_key`. `secrets::read_key(account, base_url)` compares
   `scheme://host:port` and returns an **error**, never a key, when they differ
   (`secrets.rs:109`). A path change (`/v1` → `/v2`) keeps the key; a scheme, host or
   port change does not. A key saved in the old plain format is refused with a
   message asking for re-entry, because an unbound key cannot be sent safely.
2. **The provider tables are out of the generic write path.** The authorizer
   refuses `INSERT`/`UPDATE`/`DELETE` on `llm_providers` and `provider_models` for
   anything arriving through `execute_write` or `run_transaction`. Provider writes
   are named commands that do the Keychain work in the same call:
   `provider_save`, `provider_delete`, `provider_set_default`,
   `providers_restore` (import), `providers_reset` (reset the database).
3. **Changing the endpoint drops the key.** `provider_save` keeps a stored key only
   if `read_key` still resolves it for the *new* base URL; otherwise it deletes the
   item and clears `keychain_ref`, so the row never claims a key that will not be
   used. `save_row` (`providers.rs`) is the only writer of that column.

`secret_set` and `secret_delete` are **gone from the IPC surface**. The webview can
no longer create, overwrite, read or delete a Keychain item; it can only ask for an
operation on a provider id, and Rust decides what that means.

**Proof.**

- `secrets` unit tests: origin parsing (`https` default port, explicit port, scheme
  differences, refused `file:`/`javascript:`/`ftp:`/garbage).
- `src-tauri/tests/providers.rs` (11 tests) against a real migrated database:
  the first provider becomes the default; a renamed provider on the same origin
  keeps its key; **a provider moved to `https://attacker.tld` loses `keychain_ref`**;
  models are replaced not appended; an invalid endpoint is refused before any row is
  written; deleting the default moves the flag; a backup restores ids, timestamps
  and models, collapses a duplicate default, and is refused when it points at a
  `file:` URL; a reset reports the ids whose keys must be deleted.
- `sql_guard.rs` asserts the authorizer refuses `UPDATE llm_providers SET base_url
  = 'https://attacker.tld'` outright.
- The ignored Keychain round-trip was run against the real login Keychain: a key
  stored for `http://localhost:11434/v1` reads back for that URL and is **refused**
  for `https://attacker.tld/v1` and for `http://localhost:11435/v1`.

**Consequence for an existing install:** a key saved before this change is refused
until it is entered again, once. The provider list still shows the badge, and the
form says what to do.

### 3. UTF-8 split across chunks was corrupted

`LineBuffer` (`llm.rs:93`) accumulates raw bytes and decodes a line only when its
newline has arrived; a newline byte cannot be part of a multi-byte sequence.
`\r\n` is trimmed and the trailing line is flushed at end of stream.

**Proof:** a unit test feeds `"CHF 1’000.50 — éé€ 🙂"` one byte at a time and
asserts no replacement character, plus tests for the trailing flush and CRLF.

### 4. Stop did nothing while the provider was silent

Both waits race a 100 ms cancellation poll (`wait_for_cancel`, `llm.rs:77`):
`http.send()` inside a `tokio::select!`, and the stream read. Text received before
the stop is kept and returned with `cancelled: true`.

**Proof:** `tests/llm_silent.rs` — a server that never answers, and one that answers
then goes quiet; both return in under a second (0.35 s for the pair).

### 5. Divide-by-zero guard checked the wrong variable

`src/llm/tools.ts:292` guards `first.amount_minor`, the value it divides by. A fall
from 800 to 0 now reports `-100` (previously "no change"); a window starting at 0
reports `null` instead of `Infinity`.

### 6. `list_assets` truncated before sorting

`src/llm/tools.ts:262` sorts by institution and product, then caps at 50, so a
named asset cannot be dropped by the cap.

**Different from the review's suggestion:** the payload stays a bare array rather
than `{ assets, truncated }` — the shape the source returns and the model expects.
Determinism was the property that mattered.

### 7. `confirmAction` could write twice

`confirmAction`/`rejectAction` claim the row with one conditional
`UPDATE … WHERE id = ? AND status = 'pending'` (`claimPendingAction`,
`src/db/repositories/chat.ts:197`) before writing anything. The loser gets no row
and writes nothing; a failed write marks the action `failed`; the card's buttons
lock while a request is in flight.

### 8. Assistant links could replace the app window

**Correction:** `on_navigation` does exist in Tauri v2, on
`tauri::plugin::Builder`. The first version of this report said it did not, because
I looked at `tauri::Builder`, which genuinely lacks it. It is now used.

Three layers:

1. **`navigation_guard()`** (`src-tauri/src/lib.rs`) — a five-line inline plugin
   whose `on_navigation` allows only the app's own schemes (`tauri`, `asset`,
   `about`) and `localhost`/`127.0.0.1`/`ipc.localhost` over http(s). Any other
   document navigation is cancelled by the framework, whatever triggered it: a
   missed click, a new component, a `window.location` assignment.
2. **`installExternalLinkGuard`** (`src/lib/externalLinks.ts:32`) — one capturing
   click listener on the document; an absolute `http(s)` link calls
   `preventDefault()` and goes to the browser through `open_external`. Hash routes,
   relative hrefs and non-web schemes are left alone. **Modifier-clicks are now
   intercepted too**: this window has no tabs, so Cmd- or Shift-clicking a link used
   to do nothing (or navigate); it now opens in the browser like a plain click.
3. **`open_external`** (`src-tauri/src/commands/files.rs:29`) re-checks the scheme
   and refuses anything that is not `http://` or `https://`.

**Proof:** nine jsdom tests (https, http, hash route, relative path, `file:`,
rejected command, modifier-click, click on a child element, reinstall) and a Rust
test for the scheme refusal. The navigation guard itself is not unit-tested — it is
a five-line closure over a framework callback; it is verified by hand.

### 9. First snapshot dated in UTC

`src/db/repositories/assets.ts:152` uses `todayIso()`; a repository test asserts the
emitted statement carries the local day.

### 10. Wrong "already exists" value; impossible dates accepted

`propose_snapshot` validates with `isValidIsoDate` (`tools.ts:392`), so `2026-02-31`
is refused, and warns with `getSnapshotOn(assetId, isoDate)` (`tools.ts:398`) — the
value **on that date**, not the asset's latest.

## Minor items

- **`deleteProvider`** — rows first, Keychain after. Now one Rust command, so the
  ordering is inside `provider_delete`; `llm_providers.test.ts` asserts the single
  call and that the generic SQL path is not used.
- **`createAsset` id from a pooled connection** — fixed earlier with
  `run_transaction_returning_id`, which reads `sqlite_sequence` inside the
  transaction.
- **SSE trailing line** — fixed with #3.
- **Updater `OWNER` placeholder** — not fixed, by choice: it needs the real
  repository URL and a published release. See `docs/RELEASE.md`.

## Verification

```
npx vitest run        # 508 passed, 5 skipped (45 files)
npm run typecheck     # no errors
cargo test            # 65 passed, 9 ignored
```

The ignored Rust tests need a live provider or the login Keychain. The Keychain
round-trip was run by hand and passes:

```
cargo test --test live keychain_round_trip -- --ignored
```

## Residual risk

- **The renderer can still change a provider through `provider_save`.** That is not
  an escalation: the renderer already renders the portfolio it would be protecting,
  and moving the endpoint drops the key. What it cannot do is read a key or move one.
- **`db_select` returns whatever the query asks for**, including any table's rows —
  it is a read path for the app's own SQL, not a filter on *what* is read. A
  compromised renderer could read anything in the database, which it can already
  render.
- **`run_transaction` still has no table allow-list** beyond the provider tables:
  any other table can be modified, so a compromised renderer can rewrite or delete
  portfolio rows. The authorizer limits *what kind* of statement, not *which table*
  (apart from providers).
- **The database is unencrypted**, and portfolio data is in plain SQLite.
- **`document.cookie`/`localStorage` of the webview are not a trust boundary**;
  nothing sensitive lives there.
- **`navigation_guard` is untested by automation.** It is five lines; a wrong
  pattern would show up immediately as "the window is blank", not silently.
- **Code quality and performance are still unreviewed.**
