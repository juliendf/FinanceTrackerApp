# Architecture

FinanceTracker is a native macOS desktop port of a Flask web app. It is a single-user, offline-first Tauri v2 app. The source app is the behavioural specification; see `docs/ANALYSIS.md` for the analysis and `docs/DEVIATIONS.md` for every intentional difference.

## Principle: thin Rust

The UI and all business logic are TypeScript. Rust does only what a webview cannot or should not do:

| Concern | Where | Why |
|---|---|---|
| UI, routing, forms, validation | `src/ui` (React 19, react-bootstrap) | Same Bootstrap classes as the source, so `custom.css` applies unchanged |
| Business logic, money math, formatting | `src/domain` (pure TypeScript) | Pure functions, unit-tested, no I/O |
| SQL | `src/db/repositories` | One file per aggregate, typed SQL only, no business logic |
| Atomic multi-statement writes | Rust `run_transaction` | The SQL plugin cannot hold a transaction (see below) |
| Provider API keys | Rust `secret_*` (macOS Keychain) | Keys never enter SQLite |
| LLM HTTP and streaming | Rust `chat_completion` (reqwest) | Streams over a Tauri channel; cancellable |
| User-picked file read/write | Rust `pick_and_read_text_file`, `save_text_file` | The webview never supplies a path; Rust opens the dialog |

## Layers

```
src/ui/pages/*        screens (one folder per area)
src/ui/components/*   ports of the Jinja macros (FormCard, DataTable, modals, StatCard)
src/ui/layout/*       AppShell, navbar, sidebar, toasts, theme toggle
        |
        v  (TanStack Query for reads and invalidation)
src/db/repositories/* typed SQL -> tauri-plugin-sql  /  run_transaction
        |
src/domain/*          pure logic imported by both pages and repositories
src/llm/*             chat loop, tools, pending actions (TypeScript)
src/import/*          backup importer: parse -> plan -> SQL statements
src-tauri/src/commands/{db,files,llm,secrets}.rs
```

Rules the code follows:
- `domain` imports nothing from `ui` or `db`. It is what the tests and the oracles exercise.
- Pages never write SQL. Repositories never format or validate.
- Reads go through TanStack Query; every write invalidates the affected query keys (`snapshot-rows`, `assets`, `snapshot-points`, ...).
- Filters, sort and page live in the URL query (hash router), as in the web app.

## Data model

SQLite at `~/Library/Application Support/ch.julien.financetrackerapp/financetracker.db`, created by migrations in `src-tauri/migrations/` (applied by the SQL plugin at startup). Differences from the source schema:

- **Money is `INTEGER` minor units** (`amount_minor`). Conversion happens at the edge in `src/domain/money.ts`, half-even rounding, `decimal.js`. No float money anywhere.
- **Exchange rates are `TEXT` decimals.**
- **No `user_id`.** One user; per-user uniques became global.
- **Secrets are never columns.** `llm_providers.keychain_ref` is a reference such as `provider:2`; the secret is in the Keychain.
- **Profile is a single-row table.** The former user profile fields live there.
- **`ChatJob` is gone**, replaced by a Tauri channel.
- Calendar dates are `YYYY-MM-DD` text with CHECK constraints; one snapshot per `(asset_id, date)` is enforced by a unique index.
- Foreign keys are on; `journal_mode=WAL` is set once per database file (`src/db/client.ts`).

## Transactions

`tauri-plugin-sql` runs one statement per call over a pool of connections and exposes no transaction handle, so `BEGIN`/`COMMIT` across calls can land on different connections. Instead:

1. Multi-statement writes build a statement list in TypeScript, with every value passed through the escaped literal builders in `src/db/literals.ts` (`sqlText`, `sqlInt`, ...).
2. `run_transaction` (`src-tauri/src/commands/db.rs`) opens its own connection to the same file with foreign keys on and a 5 s busy timeout, runs the list in one transaction, and rolls back on the first failure, reporting `statement N of M`.

Used by: the backup importer (196 statements, atomic), asset create/update (asset + tags + first snapshot), bulk snapshot create/update/delete.

New asset ids are allocated inside the transaction (`nextId` / `justInserted` against `sqlite_sequence` in `src/db/transaction.ts`), so later statements can reference the id without a round trip.

## Money and parity

- All displayed numbers go through `src/domain/format.ts`, a port of the Python template filters.
- Behaviour is verified against the source, not assumed: independent Python oracles in `tests/oracle/` recompute results from a real backup file and the tests compare (asset filters; snapshot CSV byte-for-byte). The dashboards go further: `tests/oracle/dashboard.py` runs the *source's own code* with the clock frozen and the TypeScript is compared with the JSON its endpoints return.
- Oracle-backed tests are opt-in via environment variables and skip otherwise, so the default suite needs no private data.

## Build and layout

```
src/              React app
src-tauri/        Rust: commands, migrations, capabilities, tests
tests/oracle/     independent Python re-implementations of source behaviour
docs/             analysis, brief, deviations, parity checklist, import format
```

Stack: Tauri 2, React 19, TypeScript, Vite, react-router (hash), TanStack Query, react-hook-form + zod, react-bootstrap, Chart.js, decimal.js, SQLite via `tauri-plugin-sql`, `sqlx` and `keyring` (Rust).

## Phases

0 spike, 1 schema/shell/components, 1b importer, 2 reference data, 3 assets, 4 snapshots, 5 dashboards, 6 settings and data, 7 AI chat (all done); 8 ship, 9 optional MCP remain. Status per screen: `docs/PARITY_CHECKLIST.md`.
