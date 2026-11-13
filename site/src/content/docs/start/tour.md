---
title: A tour of the app
description: The sidebar, the header, the notifications, and where the settings hide.
---

## The sidebar

| Section | Screens | What lives there |
|---|---|---|
| **Portfolio** | Dashboard, Assets, Snapshots, Performance | The daily loop and the numbers |
| **Assistant** | Chat | The optional AI, with its session list |
| **Manage** | Institutions, Categories, Tags | The reference lists every asset points at |
| **You** | Profile, Settings | Context for the assistant, and configuration |

Collapse it with the chevron at the bottom when you want the width back.

## The header

Every page repeats the same pattern: an icon, a title, one line of context, the date,
and the actions that belong to that screen. The date is the app's local date — the same
one used for "days since update" and for period ranges.

## Bottom of the sidebar

- **Version x.y.z** opens **About**: the exact build, the Tauri version, and the full path
  of your database. That path is what a bug report needs.
- A small **theme** button in the page header toggles light and dark.

## Notifications

Actions report themselves with a toast in the bottom-right corner: green for success,
amber for warnings, red for errors. They disappear after five seconds and can be closed.
A duplicate message replaces the one already on screen instead of stacking.

Confirmations are in-app modals, never a browser dialog. If a dialog appears with the
macOS icon and a **Send data there** button, it is the app confirming an outbound AI
endpoint — read it before accepting.

## Lists and filters

The asset and snapshot lists keep their filters, sort and page in the URL, so a reload or
the back button returns you to the same rows. Every list has a **Clear filters** control
that resets all of them at once.

Pagination size comes from **Settings → Items Per Page** (default 20); the selector above
the table overrides it for that visit.

## The empty states are honest

An empty screen tells you which action fills it: *"No assets yet — start tracking your
finances by adding your first asset"*, *"No snapshots in this period"*, *"No provider
configured"*. If a screen shows zero where you expected a number, read the surrounding
text before assuming the data is wrong; most of the time the app is telling you which
input is missing.
