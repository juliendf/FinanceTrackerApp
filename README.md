# FinanceTracker (desktop)

A native macOS app for tracking assets and their value over time, ported feature-for-feature from the Flask web app FinanceTracker. Single user, offline, data stays on your Mac.

Stack: Tauri 2, React 19 + TypeScript + Vite, SQLite, Rust only for Keychain, LLM HTTP and file/transaction primitives.

## Status

Phases 0 to 5 are done: backup import, institutions, categories and tags, assets, snapshots, and the dashboards (home, Résumé, distribution, asset evolution). Settings and data, AI chat and packaging are still to come. Per-screen status is in [docs/PARITY_CHECKLIST.md](docs/PARITY_CHECKLIST.md).

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

The dashboards are checked against the *source app's own output*. `tests/oracle/dashboard.py` runs the real Flask code (read-only, throwaway SQLite database, clock frozen) against a backup and writes the chart endpoints' JSON; `src/domain/dashboard.golden.test.ts` compares the TypeScript results with it at several pinned dates. It needs a Python 3.12 venv with the source's requirements plus `freezegun`; the header of the script has the command.

See the header of each `*.golden.test.ts` for the exact variables.

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
