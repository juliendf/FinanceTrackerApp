# FinanceTracker (desktop)

A native macOS app for tracking assets and their value over time, ported feature-for-feature from the Flask web app FinanceTracker. Single user, offline, data stays on your Mac.

Stack: Tauri 2, React 19 + TypeScript + Vite, SQLite, Rust only for Keychain, LLM HTTP and file/transaction primitives.

## Status

Phases 0 to 7 are done: backup import and export, institutions, categories and tags, assets, snapshots, dashboards, settings, and the AI assistant (providers, streaming chat, tools with confirm-before-write, profile, memories, goals). Packaging is still to come. Per-screen status is in [docs/PARITY_CHECKLIST.md](docs/PARITY_CHECKLIST.md).

## Requirements

- macOS on Apple silicon
- Node 20+ and npm
- Rust stable (`rustup`) and Xcode command line tools

## Run

```sh
npm install
npm run tauri dev        # app with hot reload
```

## Build

```sh
npm run tauri build
# src-tauri/target/release/bundle/macos/FinanceTracker.app
# src-tauri/target/release/bundle/dmg/FinanceTracker_0.1.0_aarch64.dmg
```

The build is unsigned for now; right-click, Open the first time.

## Test

```sh
npm test                                  # vitest
npm run typecheck                         # app + tests
cd src-tauri && cargo test                # Rust (transactions, importer, keychain tests are opt-in)
```

Parity tests against real data are opt-in. They compare the app with independent Python oracles in `tests/oracle/`:

```sh
python3 tests/oracle/snapshots_csv.py backup.json out.csv > filters.json
SNAPSHOT_ROWS=... ORACLE_CSV=out.csv ORACLE_FILTERS=filters.json \
  npx vitest run src/domain/snapshots.golden.test.ts
```

The backup round-trip can be re-checked on real data: export the database, import it into a fresh one, diff the rows.

```sh
python3 tests/roundtrip/compare.py ORIGINAL.db REBUILT.db
```

The dashboards are checked against the *source app's own output*. `tests/oracle/dashboard.py` runs the real Flask code (read-only, throwaway SQLite database, clock frozen) against a backup and writes the chart endpoints' JSON; `src/domain/dashboard.golden.test.ts` compares the TypeScript results with it at several pinned dates. It needs a Python 3.12 venv with the source's requirements plus `freezegun`; the header of the script has the command.

See the header of each `*.golden.test.ts` for the exact variables.

## AI

Chat is off until you enable it under Settings → AI assistant. For a local model:

1. Settings → LLM Providers → New Provider: base URL `http://localhost:11434/v1`, model as listed by `ollama list` (a tool-capable one, e.g. `qwen3.5:4b`), no key.
2. Tick Enable AI features on the Settings page.
3. Chat. Write actions (recording a snapshot, saving a memory) always appear as a card you confirm or reject.

Keys live in the macOS Keychain, never in the database or a backup.

## Your data

- Database: `~/Library/Application Support/ch.julien.financetrackerapp/financetracker.db`
- Provider API keys: macOS Keychain, service `ch.julien.financetrackerapp`
- Import a Flask backup (JSON v2) from the first-run screen or the Data page; format in [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md). Never commit a real backup.

## Documentation

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, data model, transactions |
| [SECURITY.md](SECURITY.md) | Threat model, secrets, open issues |
| [docs/ANALYSIS.md](docs/ANALYSIS.md) | Analysis of the source app and the porting decisions |
| [docs/IMPLEMENTATION_PROMPT.md](docs/IMPLEMENTATION_PROMPT.md) | The brief and phase plan |
| [docs/DEVIATIONS.md](docs/DEVIATIONS.md) | Every intentional difference from the source |
| [docs/PARITY_CHECKLIST.md](docs/PARITY_CHECKLIST.md) | Screen-by-screen status |
| [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md) | Backup file format |
