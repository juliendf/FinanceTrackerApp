# Building and releasing

## Local build

```sh
npm install
npm run tauri build
```

Artifacts:

- `src-tauri/target/release/bundle/macos/FinanceTracker.app`
- `src-tauri/target/release/bundle/dmg/FinanceTracker_<version>_aarch64.dmg`

The bundle identifier is `ch.julien.financetrackerapp` and the version comes from
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

1. Replace `OWNER` in the endpoint with the real account/org:
   `https://github.com/OWNER/financeTrackerApp/releases/latest/download/latest.json`
2. The public key in the config matches the private key at
   `~/.config/financetrackerapp/updater.key` (generated with
   `npm run tauri signer generate`). **Back that file up**: losing it means
   existing installs can never accept an update. It is outside the repository on
   purpose.
3. Update artifacts are only produced with
   `src-tauri/tauri.release.conf.json`, which flips
   `bundle.createUpdaterArtifacts` on:

   ```sh
   TAURI_SIGNING_PRIVATE_KEY=~/.config/financetrackerapp/updater.key \
   npm run tauri build -- --config src-tauri/tauri.release.conf.json
   ```

   That writes `FinanceTracker.app.tar.gz` and its `.sig` next to the bundle.
4. Install-on-demand is intentionally absent: the card reports and links, it
   does not restart the app behind your back.

## GitHub Actions

`.github/workflows/release.yml` builds a universal binary on `macos-14`, runs the
test suite, then publishes a draft release through `tauri-action`. It has never
been executed — the repository has no remote yet. Secrets it expects:
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Release checklist

1. `npm test`, `npm run typecheck`, `cargo test` (in `src-tauri`).
2. Bump `version` in `src-tauri/tauri.conf.json`.
3. `npm run tauri build`; launch the app; check the dashboard numbers against
   the golden fixtures.
4. Tag `v<version>` and push; the workflow publishes a draft.
5. Publish the draft, then confirm **Check for updates** finds it.
