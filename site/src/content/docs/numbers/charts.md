---
title: Charts
description: The two charts that ship in this build, and what each axis is really showing.
---

There are two charts in the app, and they answer different questions.

## Portfolio breakdown

On **Dashboard**, the donut shows the latest value of each asset grouped by category,
currency, institution or product. The legend is the chart: amounts, shares and a
Highest/Name sort.

Percentages are computed on the sum of the slices. That is only meaningful for the
converted groupings (category, institution, product). In **Currency** the slices are native
balances, so ignore the percentages and read the amounts.

## Value evolution of one asset

On an **asset page**, below the summary and above the snapshot history, a line chart plots
every snapshot of that asset.

- The Y axis is the asset's **own currency**, never converted.
- The series is labelled **Asset Value** in the tooltip; the axis title is `Amount (CHF)`,
  `Amount (EUR)` and so on.
- The line does not start at zero by default — a fund that moved from 60,000 to 66,000 shows
  the shape of the movement, not the distance from zero.
- No range selector: it is the whole history of the asset.
- If the asset has no snapshot, the card appears only when there is something to draw; an
  asset with no snapshots has no chart.

## Why there is no per-asset performance percentage here

Comparing two snapshots of one asset is simple, but a meaningful return also needs to know
about deposits into that asset — and the app does not track contributions. The asset page
therefore shows the deltas between consecutive snapshots in the **Snapshot History** table
(`Change` and `% Change` columns), which is honest about what it measures, and leaves the
period-level performance to the Performance screen.

## Getting a number out of the app

There is no chart export and no spreadsheet export. A number you want in a document is
read off the screen, and the whole dataset leaves the app only through the JSON backup in
[Settings](/reference/settings/).
