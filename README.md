# FinanceTracker (desktop)

A native macOS app for tracking assets and their value over time, ported feature-for-feature from the Flask web app FinanceTracker. Single user, offline, data stays on your Mac.

Stack: Tauri 2, React 19 + TypeScript + Vite, SQLite, Rust only for Keychain, LLM HTTP and file/transaction primitives.

Contents: [Status](#status) · [Requirements](#requirements) · [Run](#run) · [Build](#build) · [Test](#test) · [AI](#ai) · [Your data](#your-data) · [Troubleshooting](#troubleshooting) · [Documentation](#documentation)

## Status

Version 0.4.0. Phases 0 to 8 of the plan are done: backup import and export,
institutions, categories and tags, assets, snapshots, dashboards, settings, the AI
assistant (providers, chat with tools and confirm-before-write, profile, memories,
goals), and packaging (icon, About, ad-hoc signing, updater wiring, release
workflow). After Phase 8 the shell was rebuilt as a desktop app — sidebar
navigation, overlay title bar, fixed-height content and chat, toasts out of the
page flow — and the bugs found in daily use were fixed. See
[docs/CHANGELOG.md](docs/CHANGELOG.md). The optional MCP server (Phase 9) is not
built. Per-screen status is in [docs/PARITY_CHECKLIST.md](docs/PARITY_CHECKLIST.md).

## Requirements

- macOS 11 or newer, Apple silicon
- Node 20.19+ or 22.12+ (Vite 8's requirement) and npm
- Rust stable via `rustup`, with `cargo` on your `PATH`
- Xcode command line tools

If `which cargo` prints nothing, rustup's environment file is not sourced:

```sh
echo '. "$HOME/.cargo/env"' >> ~/.zshrc   # then open a new terminal
```

## Run

```sh
npm install
npm run tauri dev        # app with hot reload
```

`tauri dev` is the way to try a change without building or installing anything: it
compiles a debug binary once, serves the UI from Vite and reloads the frontend on
save. Rust changes restart the app.

Two things to know:

- **It uses the same database as the installed app** (same bundle identifier,
  same `~/Library/Application Support/ch.julien.financetrackerapp/`). Testing
  writes to your real data; take a backup from Settings → Data & Backup first if
  that matters.
- **Running the UI alone with `npm run dev` in a browser only works for static
  screens.** SQLite, dialogs, the Keychain and the updater are Tauri commands and
  are absent outside the webview.

## Build

```sh
npm run tauri build
# src-tauri/target/release/bundle/macos/FinanceTracker.app
# src-tauri/target/release/bundle/dmg/FinanceTracker_<version>_aarch64.dmg
```

The build is ad-hoc signed (no Developer ID on this machine yet), so the first
launch needs right-click → Open. Signing, notarisation, the updater keys and the
GitHub Actions release are documented in [docs/RELEASE.md](docs/RELEASE.md).

## Test

```sh
npm test            # vitest: domain, repositories, components, docs guards
npm run typecheck   # app and tests
cd src-tauri && cargo test
```

Rust tests cover the transaction primitive, the statement guard, migrations and
the keychain move; the ones needing the network, a live provider or the login
keychain are `#[ignore]`d (`cargo test -- --ignored`).

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

Chat is off until you enable it under Settings → LLM Providers. For a local model:

1. Settings → LLM Providers → New Provider: base URL `http://localhost:11434/v1`, no key. Press **Load models**, then enable the ones chat may use (a tool-capable one, e.g. `qwen3.5:4b`) and pick the default.
2. Tick **Enable AI features** on the same page (it sits above the provider list).
3. Chat. Write actions (recording a snapshot, saving a memory) always appear as a card you confirm or reject. The same page has *Stream answers as they arrive*; turn it off to get a spinner (which names the tool it is running) and the whole reply at once.

Keys live in the macOS Keychain, never in the database or a backup.

## Your data

- Database: `~/Library/Application Support/ch.julien.financetrackerapp/financetracker.db`
- Provider API keys: macOS Keychain, service `ch.julien.financetrackerapp`
- Import a Flask backup (JSON v2) from the first-run screen or Settings → Data & Backup; format in [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md). Never commit a real backup.

## Troubleshooting

The common failures and their fixes are in
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): `cargo` not found, port 1420
in use, Gatekeeper on an ad-hoc build, "no update feed", Gemini 400s, a model
that will not call tools, where the database lives, and what to do when a page
shows the error boundary.

## Documentation

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, data model, transactions |
| [SECURITY.md](SECURITY.md) | Threat model, secrets, open issues |
| [docs/RELEASE.md](docs/RELEASE.md) | Signing, notarisation, updater, releases |
| [docs/ANALYSIS.md](docs/ANALYSIS.md) | Analysis of the source app and the porting decisions |
| [docs/IMPLEMENTATION_PROMPT.md](docs/IMPLEMENTATION_PROMPT.md) | The brief and phase plan |
| [docs/DEVIATIONS.md](docs/DEVIATIONS.md) | Every intentional difference from the source |
| [docs/PARITY_CHECKLIST.md](docs/PARITY_CHECKLIST.md) | Screen-by-screen status |
| [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md) | Backup file format |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Layout, conventions, how to add a screen, tool or migration |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Symptoms, causes, fixes |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Release-by-release summary |
