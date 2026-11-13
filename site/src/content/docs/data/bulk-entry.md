---
title: Recording many values at once
description: Bulk Entry, Bulk Edit, Copy previous, and why one bad row blocks the batch.
---

Two screens exist because typing twelve values one at a time is how people stop updating.

## Bulk Entry

**Snapshots → Bulk Entry** records one value per asset for a single date.

1. Pick the **Date** (defaults to today, cannot be in the future).
2. Optionally filter the rows by category, institution or currency.
3. Fill the **Amount** column. Blank rows are skipped.
4. **Create Snapshots**.

Two shortcuts:

- **Apply same amount** writes one number into every visible row. Useful for a sweep of
  identical accounts, dangerous if a row already has a snapshot that day — the batch will
  refuse it.
- **Copy previous** fills each row with that asset's latest snapshot **strictly before the
  chosen date**. This is the usual month-end path: copy last month, adjust what changed.

The header counts `<filled> of <visible> assets filled`.

## If one row is wrong, nothing is written

The whole batch is one transaction. One invalid amount, one future date, one duplicate for
the same asset and date, and **nothing** is written. The errors appear in a red alert and
under the offending field, prefixed with the asset label:

```
Global Equity Fund: A snapshot for this asset already exists on 2026-11-01
```

That is deliberate. A half-written month is worse than a refused one, because you cannot
tell which half.

## The Bulk Entry table

| Column | Meaning |
|---|---|
| Institution, Product, Category, Currency | Identity of the row |
| Amount | What you type |
| Last Snapshot | The most recent existing value and its date, or *No snapshots* |

## Bulk Edit

Select rows in **Snapshots** (the current page only) and press **Bulk Edit**. You get the
same table shape, with:

- Date and asset read-only.
- **Current Amount** next to an empty **New Amount**.
- Leaving a field blank keeps the existing value.
- **Clear Changes** resets every input.
- A single invalid value blocks the whole batch.

Bulk Edit changes amounts, never dates. To move a snapshot to another date, edit it
individually.

## When to use which

| Situation | Use |
|---|---|
| Month-end sweep of every account | Bulk Entry → Copy previous → adjust |
| Fill in a date you forgot | Bulk Entry with that date |
| Correct a fat-fingered month across several assets | Bulk Edit from the list |
| Fix one asset only | That asset's snapshot form |
