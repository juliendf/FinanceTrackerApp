# Contributing

A single-author native macOS app (Tauri 2 + React + TypeScript + SQLite). The
tests are the contract: when behaviour is ambiguous, read the code and the tests
that pin it, and record a deliberate departure in `docs/CHANGELOG.md`.

Releases, versioning, signing and the rules that protect user data are in
[`docs/MAINTAINING.md`](docs/MAINTAINING.md). Read it before tagging anything.

## Layout

| Path | What lives there |
|---|---|
| `src/ui/pages/<area>/` | One folder per screen area (assets, snapshots, dashboard, settings, chat, profile) |
| `src/ui/components/` | Shared widgets: page header, cards, modals, tables, chart wrappers |
| `src/ui/layout/` | Shell: sidebar, toolbar, toasts, theme toggle |
| `src/domain/` | Pure logic: money, formatting, filters, dashboards, chat prompts. No Tauri, no SQL |
| `src/db/repositories/` | Typed SQL only, one file per aggregate |
| `src/db/client.ts`, `transaction.ts`, `literals.ts` | Command bridge (`db_select`, `execute_write`, `run_transaction`), escaped SQL literals |
| `src/llm/` | Chat loop, transport, tools, prompt building, service |
| `src/import/`, `src/export/` | Backup parse/plan/execute, and the v3 writer |
| `src-tauri/src/commands/` | Rust: `db` (selects, guarded writes, transactions, path), `files` (dialogs), `secrets` (Keychain), `llm` (HTTP streaming) |
| `src-tauri/migrations/` | Schema, applied by `sqlx::migrate!` from `Builder::setup` before the window exists |
| `tests/roundtrip/` | Backup round-trip diff |
| `docs/` | Release notes, import format, troubleshooting, changelog |

## Ground rules

- **Money is integer minor units.** Convert at the edges with
  `src/domain/money.ts` (`toMinorUnits`, `fromMinorUnits`, half-even). Never store
  or add floats; `decimal.js` is already configured for half-even rounding.
- **`domain` imports nothing from `ui` or `db`.** It is what the tests and the
  oracles exercise.
- **SQL lives only in repositories,** and repositories do no validation or
  formatting. Pages never build SQL.
- **SQL crosses IPC as text; Rust is the boundary.** Build statements with
  `sqlText` / `sqlInt` from `src/db/literals.ts` — values are inlined because
  the commands take a statement list, not bound parameters. Reads use the
  read-only `db_select`; single writes use `execute_write`; multi-statement
  writes go through `run_transaction`. The SQLite authorizer behind those
  commands admits only single `INSERT` / `UPDATE` / `DELETE` statements, so a
  compromised webview can neither run DDL nor read through a write path.
- **Never call `window.confirm` or `alert`.** They route to the dialog plugin,
  which this app does not permit; use `DeleteConfirmModal`. A test enforces it.
- **Query keys are part of the contract.** One key, one shape: `["assets"]` is
  always `AssetRow[]`, counts use their own key. Reusing a key for a different
  shape crashes a screen (this happened with the Data page).

## Adding a screen

1. Create `src/ui/pages/<area>/<Name>Page.tsx`; start with `PageHeader`.
2. Add the route in `src/router.tsx` inside `<AppShell>`.
3. Add sidebar navigation in `src/ui/layout/Sidebar.tsx` if it is a top-level area.
4. Data through TanStack Query with a fresh key; invalidate the affected keys
   after writes.
5. Test it in `src/ui/pages/<area>/<Name>.test.tsx` with `// @vitest-environment
   jsdom`, `afterEach(cleanup)`, mocked repositories.

## Adding a chat tool

1. Add the schema to `TOOL_DEFINITIONS` in `src/llm/tools.ts`.
2. Add a status label to `TOOL_STATUS` — a test fails if one is missing.
3. Implement the executor in the same file. Read-only tools answer with JSON;
   **write tools only stage a pending action** and must not touch the tables.
4. Extend `src/llm/tools.test.ts`, including the negative assertion that no write
   happened.

## Migrations

Add `src-tauri/migrations/000N_<name>.sql`; `sqlx::migrate!` (`src-tauri/src/commands/db.rs`)
picks it up by filename at compile time and the app applies it before the window
opens. Never edit a migration that has shipped; the migrator records applied
versions in `_sqlx_migrations`. Test the SQL against a copy of a real database
before shipping it.

## Tests

```sh
npm test                 # vitest: domain, repositories, components, docs guards
npm run typecheck        # app and tests
cd src-tauri && cargo test
```

Optional, and skipped without their environment:

- Backup round-trip: `tests/roundtrip/compare.py ORIGINAL.db REBUILT.db`.
- Live provider tests: `cargo test --test live -- --ignored` needs Ollama, or
  `GEMINI_API_KEY` for the two Gemini tests.

Never commit a real backup, a database file or an API key; `.gitignore` covers
those patterns.

## Versions and releases

One version number in three files, always in step: `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. `src/docs.test.ts` fails if
they drift. Signing, notarisation and the updater are in
[`docs/RELEASE.md`](docs/RELEASE.md).

## Commits

Imperative subject, a scope when it helps, one concern per commit:

```
feat: per-row record-snapshot shortcut on the asset list
fix: never send extra_content as null to Gemini
docs: bring README up to date for 0.2.7
```

## Documents to update

| Change | Update |
|---|---|
| Anything a user will notice | `docs/CHANGELOG.md` + version bump |
| Command, install or data path | `README.md` |
| Layer, schema or transaction model | `ARCHITECTURE.md` |
| Permissions, secrets, network | `SECURITY.md` |
