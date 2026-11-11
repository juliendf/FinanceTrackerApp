---
title: Institutions, categories and tags
description: The three reference lists, and the system roles that make the summary numbers work.
---

Every asset points at one institution and one category, and can carry any number of tags.
All three lists are in the **Manage** section of the sidebar.

## Institutions

Banks and brokers your assets belong to. Name (1–100 characters) and an optional
description (500). Ordered alphabetically.

Deleting an institution is blocked while it still has assets:

> Cannot delete institution "UBS" — it has 4 associated asset(s). Please delete or
> reassign these assets first.

Names must be unique. The check is case-sensitive on the trimmed name.

## Categories and system roles

A category is what kind of money an asset is. It has a name (1–50), a colour used in badges
and charts, an optional description (500), and a **required system role**.

The role is the part the app understands. It is a fixed list:

| Role | Label in the UI | What it feeds |
|---|---|---|
| `cash` | Cash | Dashboard and Performance "Cash" figures |
| `emergency_fund` | Emergency fund | The "Emergency fund" figure |
| `bonds` | Bonds | Breakdown by role; holdings allowed |
| `stocks` | Stocks / ETF | Breakdown by role; holdings allowed |
| `real_estate` | Real estate | Breakdown by role |
| `retirement` | Retirement / Pension | Breakdown by role |
| `alternative` | Gold / Crypto / Commodities | Breakdown by role |
| `other` | Other | Everything unclassified |

Roles matter for three things:

1. **The Cash and Emergency fund figures** on Performance and in the assistant's liquidity
   calculation sum only categories with those roles. A category with no role makes them
   read zero, which looks like "no cash" rather than "not classified".
2. **The allocation breakdown** groups by role in the expanded Performance view.
3. **Holdings** are only available on assets whose category role is `stocks` or `bonds`.

A banner lists categories without a role whenever any exist. Fix them from the category
form; the asset form also offers a role select when you quick-add a category.

Deleting a category is blocked while assets use it, for the same reason as institutions.

## Tags

Free-form labels, no role, no rules beyond uniqueness:

- Name 1–50 characters.
- Colour accepts **3 or 6** hex digits (categories require exactly 6).
- Deleting a tag used by assets is **allowed**: the links are removed, the assets are kept,
  and the confirmation says how many were attached.
- A tag badge appears on the asset list and asset page.

Good tags describe intent, not structure: `retirement`, `liquid`, `kids`, `to-sell`. The
assistant sees them when it lists assets.

## Duplicate names

All three lists reject a duplicate name with a field error. The database also enforces
uniqueness, so an import that carries duplicates is refused before it writes anything.
