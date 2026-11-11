"""Enrich the demo database so the guide's screenshots show a realistic portfolio.

Demo data only: the database under app.financetracker.demo. Never point this at
the real app's data directory.
"""

import sqlite3
import sys

db = sys.argv[1]
con = sqlite3.connect(db)
cur = con.cursor()

now = "2026-11-10T15:00:00.000Z"

# --- institutions and categories ------------------------------------------
cur.execute("insert into institutions (name, description) values (?, ?)", ("PostFinance", "Swiss retail bank"))
postfinance = cur.lastrowid

new_categories = [
    ("Emergency fund", "emergency_fund", "#f59e0b", "Six months of expenses, kept liquid."),
    ("Gold & Crypto", "alternative", "#eab308", "Commodities and digital assets."),
    ("Real Estate", "real_estate", "#8b5cf6", None),
]
category_ids = {}
for name, role, color, description in new_categories:
    cur.execute(
        "insert into categories (name, system_role, color, description) values (?, ?, ?, ?)",
        (name, role, color, description),
    )
    category_ids[name] = cur.lastrowid

cash = 3
stocks = 4

# --- assets ----------------------------------------------------------------
assets = [
    # institution, category, currency, product, name, interest, cost
    (postfinance, category_ids["Emergency fund"], "CHF", "Savings Account", "Emergency fund", "1.25", None),
    (4, category_ids["Gold & Crypto"], "USD", "Bitcoin", None, None, None),
    (3, stocks, "CHF", "Global Bond Fund", "Bond allocation", None, "0.35"),
]
asset_ids = []
for institution, category, currency, product, name, interest, cost in assets:
    cur.execute(
        """insert into assets (institution_id, category_id, currency, product_name, name,
                               interest_rate, cost_charges, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (institution, category, currency, product, name, interest, cost, now, now),
    )
    asset_ids.append(cur.lastrowid)

# --- twelve monthly snapshots per new asset --------------------------------
months = [f"2026-{m:02d}-01" for m in range(1, 12)] + ["2025-12-01"]
months.sort()

series = {
    asset_ids[0]: (1_500_00, 250_00, "linear"),      # emergency fund, +250/month
    asset_ids[1]: (600_00, 0.065, "compound"),      # bitcoin, +6.5%/month
    asset_ids[2]: (3_000_00, 0.0045, "compound"),   # bond fund, +0.45%/month
}

for asset_id, (start, step, mode) in series.items():
    value = float(start)
    for index, date in enumerate(months):
        if index:
            value = value * (1 + step) if mode == "compound" else value + step
        cur.execute(
            "insert into snapshots (asset_id, date, amount_minor, created_at, updated_at) values (?, ?, ?, ?, ?)",
            (asset_id, date, int(round(value)), now, now),
        )

# --- holdings --------------------------------------------------------------
holdings = [
    (4, "IE00B4L5Y983", "iShares Core MSCI World", "420", "92.40"),
    (4, "IE00B5BMR087", "iShares Core S&P 500", "90", "610.20"),
    (5, "LU1781541179", "Amundi MSCI World", "300", "155.30"),
    (asset_ids[2], "LU0908500753", "iShares Core Global Bond", "250", "108.90"),
]
for asset_id, isin, label, quantity, price in holdings:
    cur.execute(
        """insert into asset_holdings (asset_id, isin, label, quantity, price, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?)""",
        (asset_id, isin, label, quantity, price, now, now),
    )

# --- tags ------------------------------------------------------------------
tags = [("retirement", "#0ea5e9"), ("liquid", "#22c55e"), ("swiss", "#ef4444")]
tag_ids = []
for name, color in tags:
    cur.execute("insert into tags (name, color) values (?, ?)", (name, color))
    tag_ids.append(cur.lastrowid)

for asset_id, tag_id in [(4, tag_ids[0]), (4, tag_ids[2]), (3, tag_ids[1]), (asset_ids[0], tag_ids[1])]:
    cur.execute("insert into asset_tags (asset_id, tag_id) values (?, ?)", (asset_id, tag_id))

# --- profile extras --------------------------------------------------------
cur.execute(
    """update profile set job_title = ?, financial_goals = ?, risk_profile = ?,
              ai_tone = ?, ai_verbosity = ?, ai_expertise = ?
       where id = 1""",
    (
        "Platform engineer",
        "Buy a flat in Zurich within five years, keep one year of expenses liquid, retire at 60.",
        "growth",
        "direct",
        "concise",
        "expert",
    ),
)

goals = [
    ("Flat downpayment", 12_000_000, "2031-06-01", "high", "Housing"),
    ("One year of expenses", 6_000_000, "2027-12-31", "medium", "Emergency Fund"),
    ("Sabbatical", 2_500_000, "2028-09-01", "low", "Travel"),
]
for label, amount, date, priority, category in goals:
    cur.execute(
        """insert into user_goals (label, target_amount_minor, target_date, priority, category, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?)""",
        (label, amount, date, priority, category, now, now),
    )

memories = [
    ("personal", "has_two_children", "User has two children, ages 6 and 9.", "manual", 4),
    ("financial", "emergency_fund_policy", "User keeps six months of expenses in CHF cash before investing.", "ai_extracted", 5),
    ("preference", "answer_style", "User prefers short answers with the numbers first.", "manual", 3),
]
for category, key, content, source, importance in memories:
    cur.execute(
        """insert into user_memories (category, key, content, source, importance, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?)""",
        (category, key, content, source, importance, now, now),
    )

con.commit()

for table in ("institutions", "categories", "assets", "snapshots", "tags", "asset_holdings", "user_goals", "user_memories"):
    print(table, cur.execute(f"select count(*) from {table}").fetchone()[0])

con.close()
