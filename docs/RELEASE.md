# Building and releasing

## Local build

```sh
npm install
npm run tauri build
```

Artifacts:

- `src-tauri/target/release/bundle/macos/FinanceTracker.app`
- `src-tauri/target/release/bundle/dmg/FinanceTracker_<version>_aarch64.dmg`

The bundle identifier is `app.financetracker` and the version comes from
`src-tauri/tauri.conf.json` (`version`). Bump it there for a release; the tag and
the About window both read from it. Keep it in step with `package.json` and
`src-tauri/Cargo.toml`, which carry the same number for the toolchain.

## Signing

**Current state: ad-hoc signing only.** `security find-identity -v -p codesigning`
reports no identities on this machine, so the build is signed ad hoc:

```sh
npm run tauri build
codesign --force --deep --sign - \
  "src-tauri/target/release/bundle/macos/FinanceTracker.app"
codesign --verify --deep --strict --verbose=2 \
  "src-tauri/target/release/bundle/macos/FinanceTracker.app"
```

Ad-hoc signing keeps the app runnable locally (Gatekeeper still warns, and it is
not notarised). It gives no tamper evidence and no update trust.

Signing after `tauri build` leaves the `.dmg` holding the *previous* signature,
and that one does not survive `codesign --verify --strict` ("code has no
resources but signature indicates they must be present"), so the image must be
repacked from the signed app:

```sh
APP="src-tauri/target/release/bundle/macos/FinanceTracker.app"
codesign --force --deep --sign - "$APP"

rm -rf /tmp/ftstage && mkdir -p /tmp/ftstage
cp -R "$APP" /tmp/ftstage/ && ln -s /Applications /tmp/ftstage/Applications
hdiutil create -volname "FinanceTracker" -srcfolder /tmp/ftstage -ov \
  -format UDZO src-tauri/target/release/bundle/dmg/FinanceTracker_<version>_aarch64.dmg
```

With a Developer ID, Tauri signs before bundling and this repack is unnecessary.

### With a Developer ID

1. Create a **Developer ID Application** certificate in the Apple Developer
   portal and export it from Keychain Access as a `.p12`.
2. Export the credentials as environment variables for the build:

   | Variable | Value |
   |---|---|
   | `APPLE_CERTIFICATE` | base64 of the `.p12` (`base64 -i cert.p12 \| pbcopy`) |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
   | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Julien (TEAMID)` |
   | `APPLE_ID` | Apple account email |
   | `APPLE_PASSWORD` | an app-specific password |
   | `APPLE_TEAM_ID` | the 10-character team id |

   Tauri picks these up automatically; `bundle.macOS` already sets
   `hardenedRuntime: true` and `entitlements.plist` (network client and
   user-selected files only; no JIT).
3. `npm run tauri build` now signs and notarises, and staples the ticket to the
   `.app` and the `.dmg`.

Never commit the certificate, the password, or `.env` files; `.gitignore`
already excludes `*.p12`, `.env*` and provisioning profiles.

## Updates

`tauri-plugin-updater` is wired (`src-tauri/tauri.conf.json` → `plugins.updater`)
and exposed as **Check for updates** on the Data page. It reads a static
`latest.json` from GitHub Releases.

1. The endpoint points at `juliendf/FinanceTrackerApp`. If the repository is
   ever renamed or moved, change it here too.
2. The public key in the config matches the private key at
   `~/.config/financetrackerapp/updater.key` (generated with
   `npx tauri signer generate`). **Back that file up**: losing it means
   existing installs can never accept an update. It is outside the repository on
   purpose.
3. Update artifacts are only produced with
   `src-tauri/tauri.release.conf.json`, which flips
   `bundle.createUpdaterArtifacts` on (and, without a Developer ID, pins the
   ad-hoc identity so the app is signed before the DMG is built):

   ```sh
   TAURI_SIGNING_PRIVATE_KEY=~/.config/financetrackerapp/updater.key \
   npm run tauri build -- --config src-tauri/tauri.release.conf.json
   ```

   That writes `FinanceTracker.app.tar.gz` and its `.sig` next to the bundle.
4. The card checks on request, and installs on a second explicit click: it
   downloads with progress, verifies the signature, replaces the bundle and
   restarts the app. Nothing downloads or restarts behind the user's back.

## Verify an artifact

Before handing someone a build:

```sh
APP=src-tauri/target/release/bundle/macos/FinanceTracker.app
codesign --verify --deep --strict --verbose=2 "$APP"     # must be silent and exit 0
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Signature"
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist"
shasum -a 256 src-tauri/target/release/bundle/dmg/FinanceTracker_<version>_aarch64.dmg
```

With an ad-hoc signature, `spctl -a -vv "$APP"` reports `rejected` — expected, and
the reason a downloaded build has to be allowed in System Settings → Privacy &
Security on first launch. A Developer ID build reports `accepted` with
`source=Notarized Developer ID`.

Mount the image and verify the copy inside too: the packaging step can pick up a
stale app if you signed after `tauri build` (see above).

## GitHub Actions

Two workflows:

- `.github/workflows/ci.yml` — typecheck, `npm test`, `cargo test` on every push
  to `main` and every pull request.
- `.github/workflows/release.yml` — on a `v*` tag: the same checks, then
  `tauri-action` builds a DMG + updater artifacts for `aarch64-apple-darwin`,
  signs them, and creates a **draft** release. Publish it when the DMG looks
  right. `latest.json` is only served once the release is published, so
  **Check for updates** finds nothing while the release is a draft.

Secrets (`gh secret set <NAME> --repo juliendf/FinanceTrackerApp`):

| Secret | Needed | Value |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | yes | content of `~/.config/financetrackerapp/updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | only if the key has one | its password |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | optional | the Developer ID set below |

The same job also builds the demo bundle and uploads it next to the normal
assets: `FinanceTracker-Demo_<version>_aarch64.dmg`, its `.app.tar.gz` and
`.sig`, and `latest-demo.json`. The demo config points its updater at
`latest-demo.json`, since `tauri-action` only writes the manifest for the normal
app; `scripts/demo-manifest.mjs` writes the second one.

Without the Apple secrets, `tauri.release.conf.json` sets
`bundle.macOS.signingIdentity: "-"`, so the app is signed ad hoc **during the
bundle** — no manual repack (the DMG is built from the already-signed app).
Setting `APPLE_SIGNING_IDENTITY` overrides that identity, so adding the
Developer ID secrets later needs no workflow change. Note that DMG signing is
skipped for an ad-hoc identity; that is expected. Do **not** add the `APPLE_*`
variables while they are empty: an empty `APPLE_SIGNING_IDENTITY` overrides the
ad-hoc identity with an empty string and signing fails.

```sh
# once, after the first push
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo juliendf/FinanceTrackerApp \
  < ~/.config/financetrackerapp/updater.key

# to cut a release
git tag v0.4.0 && git push origin v0.4.0
```

If a run fails, use **Re-run all jobs** on the workflow run; delete and re-push
the tag only when the tag itself is wrong.

## Release checklist

1. `npm test`, `npm run typecheck`, `cargo test` (in `src-tauri`).
2. Bump the version in `src-tauri/tauri.conf.json`, `package.json` and
   `src-tauri/Cargo.toml` — the release workflow refuses a tag that does not
   match `tauri.conf.json`.
3. `npm run tauri build`, launch the app, and walk the main screens.
4. Tag `v<version>` and push; the workflow runs the suite and creates a draft
   release with the DMG, `latest.json` and the signed updater artifacts.
5. Download the DMG from the draft, mount it, launch the copy inside, then
   publish the draft.
6. Confirm **Check for updates** on a previous install finds the new version.
