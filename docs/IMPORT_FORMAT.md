# Backup format

The app writes version 3 backups and reads version 2 backups. Both use the same
envelope; this file documents the fields so an older export can be imported
without guessing.

## Envelope

```json
{
  "version": 2,
  "exported_at": "2026-10-26T20:58:43.558894",
  "data": { "...": "..." }
}
```

Accepted versions: **2 and 3**. Newer versions are refused with a message
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

## What this app writes (v3)

Same envelope, `version: 3`, produced by `src/export/backup.ts`. Differences from
a v2 web export:

- **No `api_key`.** `llm_providers[].api_key` is always `null` and
  `keychain_ref` is not written; keys stay in the Keychain.
- **`categories[].system_role`** is included, so a round-trip keeps the Performance
  and the Cash/Emergency tiles working.
- **`memories` and `goals` arrays** are written (v2 has neither).
- **`provider_models`** lists the models each provider offers and whether chat
  may use them (`{provider_id, model, enabled}`).
- Amounts are JSON numbers in major units, rates are decimal strings.

Verified round-trip on the real backup: 196 statements into a fresh database
reproduce every exported table row for row (`tests/roundtrip/compare.py`).

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

Row ids are preserved rather than remapped, because the import only runs on an
empty database. That keeps `asset_tags` and `snapshots` foreign keys correct
without an id map.

## What version 3 adds

Version 3 is what this app writes. Compared with v2 it carries the fields that
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
