# Backup format

The app writes version 4 backups and reads versions 2, 3 and 4. They all use the
same envelope; this file documents the fields so an older export can be imported
without guessing.

## Envelope

```json
{
  "version": 2,
  "exported_at": "2026-10-26T20:58:43.558894",
  "data": { "...": "..." }
}
```

Accepted versions: **2, 3 and 4**. Newer versions are refused with a message
telling the user to update the app. Version 1 predates the shape this importer
relies on and is refused with a message telling the user to re-export.

## What v2 actually contains

Verified against a real export, not against the planning notes — the plan said
v2 had no profile, and it does:

| Entity | Rows in a real export | Notes |
|---|---|---|
| `institutions` | 9 | `id, name, description, created_at, updated_at` |
| `categories` | 7 | `id, name, description, color` — **no `system_role`** |
| `tags` | 4 | `id, name, color` |
| `assets` | 18 | plus denormalised `institution_name`, `category_name`, `tag_names` |
| `snapshots` | 118 | `amount` as a float, plus denormalised asset labels |
| `exchange_rates` | 6 | `rate` as a float, full precision |
| `llm_providers` | 1 | **`api_key` in plaintext** |
| `settings` | 13 | `key` + `value`, all values as strings |
| `profile` | 1 object | `default_currency, timezone, date_format, salary, salary_currency, monthly_savings_target, risk_profile, ai_tone, ai_verbosity, ai_expertise, first_name, last_name, financial_goals, job_title, username, email` |

Not present in v2: `memories`, `goals` (only the free-text `financial_goals`).

## What this app writes (v4)

Same envelope, `version: 4`, produced by `src/export/backup.ts`. Differences from
a v2 web export:

- **No `api_key`.** `llm_providers[].api_key` is always `null` and
  `keychain_ref` is not written; keys stay in the Keychain.
- **`categories[].system_role`** is included, so a round-trip keeps the Performance
  and the Cash/Emergency tiles working.
- **`memories` and `goals` arrays** are written (v2 has neither).
- **`provider_models`** lists the models each provider offers and whether chat
  may use them (`{provider_id, model, enabled}`).
- **`conversations` and `messages`** carry the chat, under one export checkbox
  ("Chat History"). `memories[].conversation_id` links a memory to the chat that
  produced it.
- **`asset_holdings`** carries what an asset is made of, under the same checkbox
  as `assets`: `{asset_id, isin, label, quantity, price}`. `label` is the optional
  instrument name ("iShares MSCI World"); `price` is the last known price per
  unit, in the asset's currency. The snapshot remains the only valuation: the
  price exists so the composition can be read as a share of the asset.
- Amounts are JSON numbers in major units, rates are decimal strings.

Verified round-trip on the real backup: every exported table row is reproduced
in a fresh database, row for row (`tests/roundtrip/compare.py`).

## How the desktop app maps it

| Source | Destination | Transform |
|---|---|---|
| `institutions`, `categories`, `tags`, `assets` | same tables | ids preserved; `user_id` dropped |
| `assets.tag_names` | `asset_tags` | tag name → tag id |
| `snapshots.amount` (float) | `snapshots.amount_minor` (INTEGER) | half-even, 2 dp; non-exact values listed in the report |
| `assets.cost_charges`, `interest_rate` | same columns, TEXT | float → decimal string |
| `exchange_rates.rate` (float) | `exchange_rates.rate` (TEXT) | shortest round-trip representation, full precision kept |
| `llm_providers.api_key` | macOS Keychain, service `app.financetracker`, account `provider:<id>` | never written to SQLite; the row stores `keychain_ref` |
| `settings` | `settings` | values inserted verbatim as text |
| `profile.default_currency` | `profile.currency` | |
| `profile.salary`, `monthly_savings_target` | `*_minor` | half-even, 2 dp |
| `profile.job_title`, `profile.financial_goals` | `profile.job_title`, `profile.financial_goals` | added in migration 5; both feed the assistant's profile section |
| `profile.birth_date` | `profile.birth_date` | absent from v2; written by this app so age survives a round-trip |
| `profile.username`, `email` | **dropped** | no account any more; listed in the report |
| `categories` (no `system_role`) | asks the user to map roles after import | the Performance view needs them |
| `asset_holdings` | same table | `quantity` is a decimal string; ISIN and quantity are validated before the write |
| `conversations`, `messages` | same tables | ids preserved; providers are restored first so `provider_id` holds |
| `memories[].conversation_id` | same column | kept when the chat is in the file, NULL plus a warning otherwise |
| `pending_actions` | **not exported** | a confirmation still on screen, not history |

Row ids are preserved rather than remapped, because the import only runs on an
empty database. That keeps `asset_tags` and `snapshots` foreign keys correct
without an id map.

## What version 4 adds

Chat history, and what a portfolio is made of. Before v4 a restore silently
discarded every conversation and every message — the reasoning behind the
numbers, and the input that produced the memories.

```jsonc
{
  "version": 4,
  "data": {
    "conversations": [
      {
        "id": 7,
        "provider_id": 2,              // NULL when the chat was not bound to one
        "model_override": null,
        "title": "Retirement",
        "pinned_at": "2026-02-01T09:12:00.000Z"   // v9 schema; NULL when unpinned
      }
    ],
    "messages": [
      {
        "id": 70,
        "conversation_id": 7,
        "role": "system|user|assistant|tool",
        "content": "How am I doing?",
        "tool_calls": null,            // JSON array as text, assistant turns only
        "tool_call_id": null           // set on role = "tool"
      }
    ],
    "memories": [
      { "key": "house_downpayment", "conversation_id": 7, "...": "..." }
    ],
    "asset_holdings": [
      { "asset_id": 12, "isin": "FR0000120073", "label": "iShares MSCI World",
        "quantity": "12.5", "price": "45.20" }
    ]
  }
}
```

Three consequences the importer handles:

- **Order.** Providers are restored before the rows, because
  `conversations.provider_id` references them and the provider table is emptied
  as it is written. Conversations are written before messages, and before the
  memories that point at them.
- **A message without its conversation is refused**, not dropped: the file is
  inconsistent. The same goes for a conversation pointing at a provider the file
  does not contain — export both or neither.
- **A memory whose chat is missing is kept**, with `conversation_id` set to NULL
  and a warning in the report. The fact is still worth keeping; only the
  provenance is lost.
- **A holding needs its asset**, and an ISIN appears once per asset: a duplicate
  is a mistake, not a position split across two accounts.

**`pending_actions` is not exported, deliberately.** It holds a confirmation that
is still on screen — "create this snapshot?" — not history. Restoring one would
offer to apply an action from another database, against assets that may have
changed since. It is UI state; the conversation that led to it is what is worth
keeping.

`tool_calls` holds tool output, so a long chat with portfolio queries is larger
than one without. The limit that matters is the read cap, below.

## What version 3 adds

Version 3 is what the app wrote before version 4. Compared with v2 it carries the fields that
remove the category-role mapping step and the "not included in this backup"
warnings:

```jsonc
{
  "version": 3,
  "data": {
    "categories": [ /* as v2, plus */ { "system_role": "cash" } ],
    "memories": [
      {
        "category": "personal|financial|goal|preference|life_event",
        "key": "house_downpayment",
        "content": "User is saving for a house downpayment",
        "source": "manual|ai_extracted",
        "importance": 1
      }
    ],
    "goals": [
      {
        "label": "House downpayment",
        "target_amount": 100000,
        "target_date": "2028-06-01",
        "priority": "high",
        "category": "real_estate"
      }
    ]
  }
}
```

Keys are never written into a backup: they stay in the macOS Keychain. The
importer accepts a v2 file that carries one only to move it there.

## Size limits

The app reads a picked file through a native dialog that refuses anything over
**50 MB** (`MAX_READ_BYTES` in `src-tauri/src/commands/files.rs`). That is the one
hard number in this format.

An export is checked against it **before it is written**: a backup larger than
the limit could never be imported again, so the export screen shows its size and
asks before saving one, and every successful export reports its size in the
toast. The limit is fetched from Rust (`read_limit_bytes`), not duplicated in the
UI, so raising it is a one-line change.

Measured on a real database: 12 conversations and 150 messages add about 240 KB,
most of it message text. Snapshots grow linearly — 18 assets daily for ten years
is roughly 65,000 rows, 15 MB. The limit is therefore years away for a personal
history, but it is not infinite.

If it ever gets close, in this order: stop pretty-printing (about 15% of the
file), compress the same single file, raise or stream the read limit. Splitting
the backup into several files does not help with size — it only helps once the
payload is not JSON-shaped, which is what attaching documents (FIN-21) would
bring: that is when a container with a manifest and a `documents/` directory
becomes the right answer.
