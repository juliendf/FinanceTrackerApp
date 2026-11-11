---
title: Where your data lives
description: The database file, the Keychain, and the complete list of outbound requests.
---

## The database

```
~/Library/Application Support/app.financetracker/financetracker.db
```

One SQLite file. It holds assets, snapshots, institutions, categories, tags, holdings,
exchange rates, providers (without keys), settings, profile, goals, memories and chat.

**In a terminal, quote the path.** The folder name has a space in it, so an unquoted
`cat ~/Library/Application Support/…` is read as two arguments. `~` does not expand inside
double quotes either, so use `$HOME`, and read it with `sqlite3` — `cat` prints binary:

```sh
DIR="$HOME/Library/Application Support/app.financetracker"
ls "$DIR"

sqlite3 "$DIR/financetracker.db" "select count(*) from snapshots;"
```

**About** (bottom of the sidebar) prints the exact path for the build you are running.

Nothing else is written outside that directory: no logs directory, no caches of your
figures, no documents.

## API keys

Provider keys live in the **macOS Keychain**, service `app.financetracker`, account
`provider:<id>`. The database stores only a reference. This is why:

- A backup never contains a key.
- Deleting a provider removes its key.
- A key is bound to the endpoint it was entered for (`scheme://host:port`). Changing the
  base URL drops the key instead of sending it somewhere new.

## The complete list of outbound requests

| Request | When | What is sent |
|---|---|---|
| ECB daily rates (`ecb.europa.eu`) | Only if you enable the source; once a day at launch, or when you press the button | Nothing. It is a plain GET for a public file |
| LLM provider (`/chat/completions`, `/models`) | Only if you enable AI features and send a message, load models or test a connection | Your messages, the system prompt (profile, goals, style, standing instructions, top memories) and the data returned by tools — balances, asset names, notes, holdings, history |
| Update check (`github.com`) | Only when you press **Check for updates** | A GET for `latest.json`; nothing about your data |

There is no telemetry, no analytics, no crash reporting, no automatic update check and no
background sync.

## What the assistant can leak

The AI section is explicit about this because it is the only real exposure:

- AI features are **off by default** and need two deliberate steps to work: enable the
  toggle, and configure a provider.
- Every request goes through the Rust side, so the API key never enters the page.
- Tool results are wrapped in `<data>` tags and the prompt tells the model to treat them as
  data, not instructions. That reduces prompt injection; it does not eliminate it. Assets
  with names or notes you would not paste into a chat are still sent when the model reads
  them.
- A local provider (Ollama, LM Studio) keeps everything on the Mac. A hosted provider does
  not.

## Backups are plain text

The JSON export is readable by anyone with the file: balances, account names, notes,
profile, and — if you tick Chat History — your conversations. It has no key, so it cannot
be used to call your provider, but it is still your financial life in a text file.

## Deleting everything

**Reset the database** (Settings → Data & Backup) removes all rows and the Keychain keys,
then restores defaults. Deleting the app alone leaves the database in place; delete the
folder yourself if that is what you want.
