"""
Row-level diff after a backup round-trip.

    python3 tests/roundtrip/compare.py ORIGINAL.db REBUILT.db

Every exported table is compared row by row. Columns the export deliberately
does not carry are ignored: `llm_providers.keychain_ref` (keys live in the
Keychain) and, for the tables whose ids are not preserved by the importer
(`exchange_rates`, `settings`, `user_memories`, `user_goals`), the `id` column.
`pending_actions` is not exported at all: it is a confirmation still on screen,
not history.
"""
import sqlite3
import sys

FULL = {
    "institutions": ("id", "name", "description", "created_at", "updated_at"),
    "categories": ("id", "name", "description", "color", "system_role", "created_at", "updated_at"),
    "tags": ("id", "name", "color", "created_at", "updated_at"),
    "assets": ("id", "institution_id", "category_id", "currency", "product_name", "name", "description",
               "notes", "code_nin", "cost_charges", "interest_rate", "created_at", "updated_at"),
    "snapshots": ("id", "asset_id", "date", "amount_minor", "created_at", "updated_at"),
    "asset_holdings": ("asset_id", "isin", "label", "quantity", "price"),
    "llm_providers": ("id", "name", "base_url", "model", "provider_type", "is_default", "is_active",
                      "created_at", "updated_at"),
    "provider_models": ("provider_id", "model", "enabled"),
    "profile": ("first_name", "last_name", "job_title", "financial_goals", "birth_date", "currency",
                "timezone", "date_format", "salary_minor",
                "monthly_savings_target_minor", "risk_profile", "ai_tone", "ai_verbosity", "ai_expertise"),
    "exchange_rates": ("from_currency", "to_currency", "rate", "created_at", "updated_at"),
    "settings": ("key", "value", "created_at", "updated_at"),
    "user_memories": ("category", "key", "content", "source", "importance", "conversation_id", "created_at", "updated_at"),
    "user_goals": ("label", "target_amount_minor", "target_date", "priority", "category", "created_at", "updated_at"),
    "conversations": ("id", "provider_id", "model_override", "title", "pinned_at", "created_at", "updated_at"),
    "messages": ("id", "conversation_id", "role", "content", "tool_calls", "tool_call_id", "created_at", "updated_at"),
}

ORDER = ["institutions", "categories", "tags", "assets", "snapshots", "asset_tags", "asset_holdings", "exchange_rates",
         "llm_providers", "settings", "profile", "user_memories", "user_goals", "conversations", "messages"]


def dump(path):
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    out = {}
    for table, columns in FULL.items():
        cols = ", ".join(columns)
        rows = conn.execute(f"SELECT {cols} FROM {table}").fetchall()
        out[table] = sorted(tuple(str(value) for value in row) for row in rows)
    out["asset_tags"] = sorted(conn.execute("SELECT asset_id, tag_id FROM asset_tags").fetchall())
    conn.close()
    return out


def main(original, rebuilt):
    before, after = dump(original), dump(rebuilt)
    failed = False
    for table in ORDER:
        a, b = before[table], after[table]
        if a == b:
            print(f"  ok    {table:14} {len(a)} rows")
            continue
        failed = True
        print(f"  DIFF  {table:14} {len(a)} vs {len(b)} rows")
        for row in [row for row in a if row not in b][:5]:
            print(f"          missing now: {row}")
        for row in [row for row in b if row not in a][:5]:
            print(f"          unexpected:  {row}")
    print("ROUND-TRIP OK" if not failed else "ROUND-TRIP FAILED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
