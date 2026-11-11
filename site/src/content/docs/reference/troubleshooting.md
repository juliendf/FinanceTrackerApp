---
title: Troubleshooting
description: Symptom first — the cause and the fix for the problems that actually happened.
---

## Installing

**"Apple could not verify that FinanceTracker is free of malware"**

Expected. The build is signed ad hoc, not notarised. Open **System Settings → Privacy &
Security**, scroll down, click **Open Anyway**, authenticate, launch again. On macOS 14 and
older, right-click the app → **Open** → **Open**. [Full detail](/start/install/).

**macOS says the app is damaged**

It carries a quarantine flag. For a copy from the release page:

```sh
xattr -dr com.apple.quarantine /Applications/FinanceTracker.app
```

**The DMG installs an old version**

Only happens with a hand-signed local build, where the image holds the app from before
`codesign` ran. Rebuild or repack. Check what you have:

```sh
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
  /Applications/FinanceTracker.app/Contents/Info.plist
```

## Updates

**"No update feed reachable"**

No release is published (drafts are invisible to `releases/latest`), or the endpoint moved.
Checking is harmless; nothing is downloaded until you press **Install and restart**.

## The AI assistant

**The Chat page says "AI is off"**

**Settings → LLM Providers → Enable AI features**, then **Save AI settings**. It is off by
default because chat sends your questions and the figures it looks up to the provider.

**"No provider is configured"**

Add one. For Ollama: base URL `http://localhost:11434/v1`, model as listed by `ollama list`,
no API key.

**The model answers in text and never reads my data**

It does not support tool calls through the OpenAI-compatible endpoint.
`qwen2.5-coder:14b` is one such model; `qwen3.5:4b` and `ministral-3:8b` work. The model must
also be ticked under **Load models** on the provider form.

**`400 INVALID_ARGUMENT` — "Function call is missing a thought_signature"**

A Gemini issue fixed in 0.1.1. Update.

**`400 INVALID_ARGUMENT` — "Value is not a struct: null"**

Fixed in 0.1.3. Update.

**`Unknown tool: get_allocationget_allocationlist_assets`**

Fixed in 0.1.2 — Gemini streams tool calls without an index and they were merged. Old
conversations containing those rows are skipped by the history repair, so start a new chat
rather than retrying one.

**"The saved API key belongs to …, but this provider now points at …"**

A key is bound to the endpoint it was entered for. Put the old base URL back, or enter the
key again for the new one. Changing a provider's URL deliberately drops the old key.

**"This API key was saved before keys were bound to their endpoint"**

A key stored by an older version has no recorded origin and cannot be sent safely. Open the
provider and enter it once.

**Stop does nothing**

Fixed in 0.2.2. Update.

**Job title or "Other Aspirations" is empty after saving**

Fixed in 0.4.0: the profile query did not read those columns, and the next save wrote NULL
over them. Re-enter them once.

## Data

**Where is my data?**

```
~/Library/Application Support/app.financetracker/financetracker.db
```

The folder name contains a space, so quote it in a terminal — with `$HOME`, because `~`
does not expand inside quotes:

```sh
ls "$HOME/Library/Application Support/app.financetracker/"
```

**About** (bottom of the sidebar) prints the exact path. Keys are in the Keychain under
service `app.financetracker`, account `provider:<id>`.

**The import is blocked before it starts**

The pre-flight refuses structural problems — an asset pointing at a missing institution,
duplicate ids, unparseable amounts — rather than half-writing. The wizard lists every
problem; fix the file or re-export it.

**Amounts look wrong after an import**

Check **Settings → Exchange Rates**. A pair at `0` reads `unset`, and totals fall back to the
unconverted amount, which the dashboard badges as `unconverted`.

**The dashboard is empty**

It is built from snapshots. An asset with no snapshot contributes nothing. Record one from
the asset list (camera icon) or via Bulk Entry.

**I want a copy before experimenting**

**Settings → Data & Backup → Export backup**. JSON, no API keys.

**I want to start over**

**Settings → Data & Backup → Reset the database**, type `RESET`.

## Screens

**"This page hit an error"**

That is the error boundary. The message and stack are in the webview console — run
`npm run tauri dev` to see it. Note the version first; most reports so far were solved by
identifying the build.

**The window keeps its old size after changing the config**

macOS restores the last window frame per application. Resize by hand; the configured width
only applies the first time macOS has no memory of the window.

## Still stuck

Open **About** from the sidebar footer and note:

- the version,
- the database path,
- what you did immediately before the problem.

Then file it at
[github.com/juliendf/FinanceTrackerApp/issues](https://github.com/juliendf/FinanceTrackerApp/issues).
A backup attached to a report is a real risk: it contains your balances. Describe the
problem instead.
