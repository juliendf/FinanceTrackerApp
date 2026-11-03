# AGENTS.md

Short brief for an AI agent (or a new maintainer) working in this repository.
Read `docs/MAINTAINING.md` before changing anything; it explains the reasoning.

## What this is

A native macOS app (Tauri 2 + React 19 + TypeScript + SQLite) for tracking
assets and snapshots, with dashboards and an optional AI assistant. Single user,
local data, MIT. Pre-1.0, alpha.

## Commands

```sh
npm install
npm run tauri dev        # try a change first; uses the real data directory
npm run typecheck        # must pass
npm test                 # vitest: domain, repositories, components, docs guards
cd src-tauri && cargo test
npm run tauri build      # local bundle
```

## Hard rules

1. **Never edit an applied migration.** sqlx checksums them; editing one breaks
   every existing install at startup. Add a new `src-tauri/migrations/000N_*.sql`.
2. **Changing the bundle identifier is a breaking change**: new data directory,
   new Keychain namespace, no automatic update from the old identifier. Document
   the manual copy step.
3. **Keep the version in three files in step** (`package.json`,
   `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`) plus the README line and
   `src-tauri/Cargo.lock`; the tag must be `v<version>`.
4. **Never commit** the updater private key, certificates, real backups or
   databases.
5. **Never mark a release as a pre-release**: `releases/latest` feeds the
   updater, and pre-releases are excluded from it.
6. **Do not break the data path between versions** without a migration and a
   changelog entry. A user's database is the product.

## Workflow

`tauri dev` → test → `typecheck` + `npm test` + `cargo test` → changelog + version
bump → commit → tag `v<x.y.z>` → push both → CI builds, signs and drafts the
release → test the DMG → publish → verify `latest.json` → test the in-app update.

Details, including the demo build and the verification commands:
`docs/MAINTAINING.md`.

## Layout

| Path | Where |
|---|---|
| `src/domain/` | pure logic, no Tauri, no SQL |
| `src/db/repositories/` | typed SQL only |
| `src/ui/` | React screens and components |
| `src/llm/` | chat loop, tools, prompts |
| `src-tauri/src/commands/` | Rust: guarded SQL, files, secrets, LLM HTTP |
| `src-tauri/migrations/` | schema, append-only |
| `docs/` | release, maintaining, import format, troubleshooting, changelog |

## Conventions

- Money is INTEGER minor units; convert only through `src/domain/money.ts`.
- Repositories hold SQL and nothing else; `src/domain` imports no UI or DB code.
- Writes go through the Rust guard (`execute_write` / `run_transaction`).
- No `window.confirm`/`alert`; use the in-app modals.
- Commit subjects: `type: lowercase sentence`, no trailing period.
