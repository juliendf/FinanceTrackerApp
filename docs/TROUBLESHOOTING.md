# Troubleshooting

Symptom first. Each entry names the cause and the fix; most of these have
actually happened during development.

## Building and running

**`failed to run 'cargo metadata' … No such file or directory`**

Rust is not on your `PATH`. rustup installs `~/.cargo/env` but nothing sources it:

```sh
echo '. "$HOME/.cargo/env"' >> ~/.zshrc   # then open a new terminal
which cargo                               # /Users/<you>/.cargo/bin/cargo
```

**`Port 1420 is already in use`**

An earlier `tauri dev` is still alive.

```sh
lsof -ti tcp:1420 | xargs kill
```

**`tauri dev` rebuilds every few seconds on its own**

Something is writing into `src-tauri/` that you did not change — usually a
`cargo test` run or an editor touching `target/`. Stop the other process; the
watcher only rebuilds for source, migrations and `tauri.conf.json`.

**The window cannot be dragged after switching to the overlay title bar**

The drag regions need the window permissions. `src-tauri/capabilities/default.json`
must contain `core:window:allow-start-dragging`, and the capability is compiled
into the binary — **restart** `tauri dev`, do not rely on hot reload.

## Installing

**"FinanceTracker cannot be opened because the developer cannot be verified"**

Expected: the build is ad-hoc signed, not notarised (there is no Developer ID
certificate on this machine). Right-click the app → **Open** → **Open**, once.
If macOS says the app is damaged, it carries a quarantine flag:

```sh
xattr -dr com.apple.quarantine /Applications/FinanceTracker.app
```

A properly signed and notarised build removes all of this; see
[RELEASE.md](RELEASE.md).

**The DMG installs an app that crashes or behaves like an old version**

The image holds the app as it was *before* the post-build `codesign`, so it must
be repacked after signing — `docs/RELEASE.md` has the recipe. Check what you have:

```sh
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
  /Applications/FinanceTracker.app/Contents/Info.plist
```

## Updates

**"No update feed reachable yet"**

Two possible causes, both expected: no release has been published, or
`plugins.updater.endpoints` in `src-tauri/tauri.conf.json` still says `OWNER`.
Checking is harmless; nothing is downloaded.

## AI assistant

**The Chat page says "AI is off"**

Settings → LLM Providers → **Enable AI features** (above the provider list). It is off by default because
chat sends your questions, and the portfolio facts it looks up, to the provider
you configure.

**"No provider is configured"**

Settings → LLM Providers → New. For Ollama: base URL `http://localhost:11434/v1`,
model as listed by `ollama list`, no API key.

**`400 INVALID_ARGUMENT` — "Function call is missing a thought_signature"**

Gemini's fault line, fixed in 0.1.1: the model returns a signature with every
tool call and refuses the follow-up without it. Update.

**`400 INVALID_ARGUMENT` — "Value is not a struct: null"**

Fixed in 0.1.3. An absent `extra_content` was serialised as `null` and echoed
back. Update.

**`Unknown tool: get_allocationget_allocationlist_assets`**

Fixed in 0.1.2: Gemini streams tool calls without an `index`, and they were being
merged into one call. Update. Old conversations containing those rows are
skipped by the history repair, so start a new chat rather than retrying one.

**The model answers in text instead of calling a tool**

Some models do not emit structured tool calls through the OpenAI-compatible
endpoint. `qwen2.5-coder:14b` is one; `qwen3.5:4b` and `ministral-3:8b` work.
The model must also be listed by `Fetch models` on the provider form.

**"The saved API key belongs to …, but this provider now points at …"**

A key is bound to the endpoint it was entered for, so it is never sent to another
scheme, host or port. Either put the old base URL back, or enter the key again for
the new one — changing a provider's base URL deliberately drops the old key.

**"This API key was saved before keys were bound to their endpoint"**

A key stored by an older version has no recorded origin, and an unbound key cannot
be sent safely. Open the provider and enter the key again once.

**Changing a provider's URL cleared the key**

Intended: the key belonged to the old endpoint. Enter it again after saving if the
new endpoint needs one.

**Stop does nothing**

Fixed in 0.2.2; before that the cancel went to the base request id while the
round in flight used a suffixed one.

**Deleting a provider, conversation or message does nothing**

Fixed in 0.1.4. `window.confirm` is routed to a dialog plugin this app does not
permit, so the confirmation rejected and the delete never ran. Confirmations are
in-app modals now.

## Data

**Where is my data?**

```
~/Library/Application Support/ch.julien.financetrackerapp/financetracker.db
```

The version line at the bottom of the sidebar opens About, which prints the path. Provider keys are in the
macOS Keychain under service `ch.julien.financetrackerapp`, account
`provider:<id>`.

**I want a copy before experimenting**

Settings → Data & Backup → **Export backup** (JSON v3, no API keys). The app also
writes nothing else outside its database.

**I want to start over**

Settings → Data & Backup → **Reset the database**. Type `RESET`; it deletes every
row, restores the defaults and removes provider keys from the Keychain.

**The import is blocked before it starts**

The pre-flight refuses structural problems (an asset pointing at a missing
institution, duplicate ids, unparseable amounts) rather than half-writing. The
wizard lists them; fix the file or re-export from the web app.

**Amounts look wrong after an import**

Check the exchange rates (Settings → Exchange Rates). A pair at `0` reads
`unset`, and converted totals fall back to the unconverted amount, which the
dashboard badges as "unconverted".

**The dashboard is empty**

It is built from snapshots: an asset with no snapshot contributes nothing. Record
one from the asset list (camera icon) or via Bulk Entry.

## Screens

**A page shows "This page hit an error"**

That is the error boundary; the message and stack are in the developer console
(`tauri dev`). Before 0.1.1 a bad query key crashed the Data page; if you see
that, update.

**The window keeps its old size when I change `tauri.conf.json`**

macOS restores the last window frame per application, so a fresh build opens at
the size you last used. Resize it by hand; the config width only applies to the
first launch after macOS forgets it.

## Still stuck

Run the app from a terminal (`npm run tauri dev`) so the webview console is
visible, and note the version from the sidebar footer (About). Most reports so far were
solved by identifying the build first.
