---
title: Backup, import and reset
description: The version 4 JSON export, what the importer checks before it writes, and how to start over.
---

Your database is the product. Treat exports as the real backup, not as an extra.

## Export a backup

**Settings → Data & Backup → Export backup** writes a JSON file. Twelve checkboxes, all
ticked by default:

| Included | Notes |
|---|---|
| Institutions, Categories, Tags | Names, colours, system roles |
| Assets | Includes holdings (ISIN composition) with the asset |
| Snapshots | The whole history |
| Exchange Rates | Current rates only — there is no history |
| LLM Providers | Names, URLs, models. **Never the API keys** |
| Application Settings | Every stored preference |
| User Profile | Identity, financial context, style |
| Memories, Goals | Structured goals and remembered facts |
| Chat History | Conversations and messages, one checkbox |

**API keys are never in the file.** They stay in the macOS Keychain; `api_key` is written as
`null`. A restored backup therefore needs its keys entered once.

The file is plain text — anyone who opens it can read your balances. Store it accordingly.

If the file would exceed the 50 MB limit the app can read back, it refuses to write a
backup you could not restore, and offers to export without Chat History (usually the
largest part). You can override it, but then the file is an archive, not a backup.

Default name: `finance_tracker_data_YYYYMMDD_HHMMSS.json`.

## Import a backup

**Settings → Data & Backup → Import a backup** opens the wizard.

:::danger[Import replaces, it does not merge]
The wizard deletes every row in fourteen tables, then writes the file's contents in one
transaction. Either everything lands or nothing does. Existing local data is gone.
:::

Accepted versions: **2, 3 and 4**. Version 1 is refused, and a newer version tells you to
update the app first.

### Pre-flight

Before anything is written, the plan is validated. **Blocking errors** include:

- An asset pointing at a missing institution or category.
- A currency other than EUR/USD/CHF.
- A snapshot whose date is not `YYYY-MM-DD`, two snapshots for the same asset and date, or
  an amount that cannot be read.
- A conversation pointing at a missing provider, or a message with no conversation.
- A holding pointing at a missing asset, or the same ISIN twice for one asset.
- Duplicate institution, category, tag, provider or setting names.
- More than one default provider.

**Warnings** do not block: categories with no system role (you will be asked to map them),
API keys that will move to the Keychain, memories whose conversation is not in the file.

### The role step

A version 2 export carries no category system roles. The wizard asks you to map each
category to one, because Performance and the liquidity figures need it. You can skip and
come back from **Categories**.

### After the import

A report lists what was written: counts per entity, the elapsed time, and how many API keys
moved to the Keychain. Then a toast summarises it: *"Imported 118 snapshots and 18
assets."*

## Settings-only export and import

Separate from the data backup, **Settings → Export** writes the preference keys to a
textarea you can save as JSON, and **Settings → Import** reads one back. Unknown keys are
ignored and listed. Useful for copying your display and base-currency choices to another
install without touching data.

## Reset

**Settings → Data & Backup → Reset the database** deletes every asset, snapshot,
institution, category, tag, rate, provider, memory, goal, setting and profile, removes
provider keys from the Keychain, and restores the defaults. Type **RESET** to confirm; any
other text cancels with a warning toast.

**Settings → Reset to Defaults** is narrower: it resets preferences only and leaves assets,
snapshots and rates alone.

## A backup routine that survives mistakes

- Export before every version update.
- Export before every import, so a bad file can be undone by importing the good one.
- Keep at least one copy off this Mac.
- Once a quarter, open the file and check it is not empty. A 0-byte backup looks like a
  backup until you need it.
