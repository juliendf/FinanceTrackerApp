---
title: Currencies and exchange rates
description: How totals are converted, what a zero rate means, and what the ECB fetch does and does not replace.
---

The app supports **EUR, USD and CHF**. An asset keeps its own currency for its whole life;
conversion happens only when a total needs one number.

## Base currency

**Settings → General → Base Currency** (EUR by default) is what totals, the dashboard, the
performance figures and the assistant use. Changing it re-reads every rate immediately —
no data is rewritten.

## How a conversion is resolved

For each amount, in order:

1. Same currency → nothing to do.
2. A direct rate exists → use it.
3. Only the inverse exists → use `1 / rate`.
4. Nothing direct → try one hop through EUR, then USD, then CHF.
5. Still nothing → **the amount is used as if it were already in the base currency**, and a
   warning is recorded.

That last case is the one to understand. The total is not blank; it is wrong by whatever
the real rate is. The app marks it: a small `unconverted` badge appears next to the figure,
and its tooltip names the missing pair, for example *"No exchange rate for USD to CHF.
Those amounts are shown unconverted."*

:::caution[The badge is per screen]
Only the pairs a particular calculation needed are listed. A screen that never converts
shows no badge even if other rates are missing. If a total looks off, open
**Settings → Exchange Rates** and check the pair yourself.
:::

## The six seeded pairs

A fresh database carries both directions of the three pairs, at rates that are examples,
not market data:

| Pair | Seeded | Pair | Seeded |
|---|---|---|---|
| EUR → USD | 1.1 | USD → EUR | 0.9091 |
| EUR → CHF | 0.95 | CHF → EUR | 1.0526 |
| USD → CHF | 0.86 | CHF → USD | 1.1628 |

Replace the examples with real numbers on day one.

Two of those pairs — CHF → USD and USD → CHF — are also **required placeholders**: when a
database has no row for one of them (an old install, or a partial import), the rate list
creates it at `0` so you can fill it in. It reads as `unset`, never as a rate of zero.

## Editing rates

**Settings → Exchange Rates → Edit Rates** gives one field per pair, six decimals.

- Every field is validated together; one bad value shows *"N rate(s) need attention"* and
  nothing is saved.
- A rate must be strictly positive (at least 0.000001).
- Saving is one transaction.

**There is no rate history.** One rate per pair, and editing it changes every conversion,
including the ones behind old snapshots and historical performance. If you compare last
year's performance before and after a rate update, the numbers can move even though no
snapshot changed. Note what you changed if you care about that comparison.

## Fetching from the European Central Bank

Off by default. Enable it with **Keep rates current from the European Central Bank** on the
Exchange Rates page.

What it does:

- Downloads one public file from `ecb.europa.eu` — the daily reference rates. Nothing about
  your data is sent.
- Publishes once per **working day**, around 16:00 CET, as units of each currency per euro.
  Weekends and holidays carry the previous working day.
- Derives the cross rates (USD↔CHF, EUR↔USD, EUR↔CHF) from the two euro rates.
- Runs **at most once per calendar day, when the app starts**. There is no background timer.
- Is silent: no toast on success or failure. A failure still counts as the day's attempt.

The page shows what happened: `Rates as of 2026-11-10 · checked today`.

Two controls:

| Control | Effect |
|---|---|
| **Fetch from the ECB** | Manual fetch, with a toast reporting what changed |
| **Also replace rates I set myself** | Off: a fetch only fills pairs with no usable rate. On: every pair is overwritten |

The manual button is disabled once the app has checked today, and says so in a tooltip:
the ECB publishes once a working day, so polling harder achieves nothing.

:::note[Reference rates, not tradeable rates]
ECB figures have no spread and no intraday movement. A broker's rate will differ. For
personal net worth the difference is small; for anything with a large foreign balance, set
the pair by hand to the rate you would actually get.
:::

## Practical order of operations

1. Set the base currency.
2. Replace the six seeded rates with real ones, or enable the ECB source and fetch once.
3. Check the dashboard for an `unconverted` badge.
4. Re-check after adding an asset in a currency you have not used before.
