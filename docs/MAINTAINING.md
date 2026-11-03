# Maintaining this app

How this repository is worked on: the loop, the rules that must not be broken,
and the exact release procedure. `AGENTS.md` at the root is the short version
for agents; this file is the reasoning.

## The loop

1. **Try it in `tauri dev` first.** `npm run tauri dev` compiles a debug binary
   once, serves the UI from Vite and reloads the frontend on save. Rust changes
   restart the app. It uses the real database directory (same identifier), so
   take a backup before poking at real data.
2. **Write the test with the fix.** Domain rules, repositories and screens each
   have a test file next to the code; a UI change that a person would notice
   should be reproducible in jsdom.
3. **Run the suite**: `npm run typecheck`, `npm test`, `cd src-tauri && cargo test`.
   The release workflow runs the same three, so a green local run means a green
   build.
4. **Commit small, with a why.** Subjects are `type: sentence`, lowercase, no
   trailing period. Docs that describe the change go in the same commit.
5. **Release by tagging**, never by hand-building a DMG.

## Rules that break installs if ignored

- **Never edit a migration that has shipped.** `sqlx::migrate!` stores a checksum
  per file; changing a comment makes every existing install refuse to start
  ("previously applied but has been modified"). Add `src-tauri/migrations/000N_*.sql`
  and, if a column needs reconciling, do it in the new migration.
- **The bundle identifier is the data directory and the Keychain service.**
  Changing `identifier` in `tauri.conf.json` gives macOS a different app: new
  `~/Library/Application Support/<identifier>/`, new Keychain namespace, no
  automatic update from the previous identifier. That is a breaking release:
  document the copy step in the changelog and release notes.
- **The demo build shares the Keychain but not the data.** Its identifier is
  `app.financetracker.demo`; provider keys are shared on purpose
  (`secrets.rs` uses one service name), financial data is not.
- **Never commit the updater private key**, a `.p12`, a real backup or a real
  database. `.gitignore` covers the usual names; the key lives at
  `~/.config/financetrackerapp/updater.key`.
- **Do not mark a release as a pre-release.** GitHub excludes pre-releases from
  `releases/latest`, which is the updater's endpoint; every install would stop
  seeing updates.

## Versioning

- The app is pre-1.0 and alpha. Patch releases for fixes, minor for features,
  and a breaking change (data or identity) gets a minor bump plus a migration
  note in `docs/CHANGELOG.md`.
- The version lives in three files and must agree:
  `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. The README
  repeats it (`Version x.y.z`), and `src/docs.test.ts` fails if they drift.
- The git tag must be exactly `v<version>`; the release workflow refuses a
  mismatch.

## Signing and updates

- Builds are ad-hoc signed unless `APPLE_SIGNING_IDENTITY` is set. Users allow
  the first launch in System Settings → Privacy & Security → Open Anyway. A
  Developer ID (paid) removes that step; the release workflow already accepts the
  six `APPLE_*` secrets, and the environment overrides the ad-hoc identity.
- Update artifacts are minisign-signed with `TAURI_SIGNING_PRIVATE_KEY`. The
  matching public key is in `tauri.conf.json`. **Losing the private key means no
  installed app can ever update again**: back it up.
- The updater checks `releases/latest/download/latest.json`. The demo checks
  `latest-demo.json`, written by `scripts/updater-manifest.mjs`. `tauri-action`
  writes API asset URLs (`api.github.com/.../assets/<id>`), which are limited to
  60 anonymous requests per hour and make downloads fail with `403`; the release
  job therefore rewrites `latest.json` with direct
  `releases/download/<tag>/<file>` URLs before publishing.
- Updates install from inside the app: check, confirm, download with progress,
  verify, restart. Nothing downloads or restarts unasked.

## Releasing

1. Bump the three version files, the README version line and
   `src-tauri/Cargo.lock` (`cargo metadata` in `src-tauri` refreshes it).
2. Add the `docs/CHANGELOG.md` entry, user-facing, in the present tense.
3. `npm run typecheck && npm test && (cd src-tauri && cargo test)`.
4. Commit, `git tag v<x.y.z>`, `git push origin main`, `git push origin v<x.y.z>`.
5. The `release` workflow runs the same checks, builds both apps, signs them and
   creates a **draft** release, then uploads `latest.json` and `latest-demo.json`.
6. Download the draft's DMG, mount it, launch the app, then publish the draft.
   Never publish an untested draft.
7. Verify what the updater will see:

   ```sh
   curl -sL https://github.com/juliendf/FinanceTrackerApp/releases/latest/download/latest.json \
     | python3 -m json.tool | head -20
   curl -sL https://github.com/juliendf/FinanceTrackerApp/releases/latest/download/latest-demo.json \
     | python3 -m json.tool | head -20
   ```

   `version` must be the new one, `platforms.darwin-aarch64.signature` must match
   the published `.sig`, and the `url` must point at the release's archive.
8. On a machine running the previous version, **Check for updates** must find the
   new one, install it and restart. That is the only end-to-end proof.

## When a release fails

- A failed workflow run can be retried with **Re-run all jobs**; it rebuilds from
  the same tag.
- If the *content* of the tag is wrong, delete the tag and the draft release,
  fix `main`, and re-tag. Only do this while the release is still a draft.
- Never move a published tag: the artifacts and their signatures are already
  out there.

## Demo build

`npm run tauri build -- --config src-tauri/tauri.demo.conf.json` builds the demo
locally (product name "FinanceTracker Demo", identifier `app.financetracker.demo`,
sample data enabled, own data directory). Every release also publishes the demo
DMG, its signed archive and `latest-demo.json`, so the installed demo updates
itself like the normal app.
