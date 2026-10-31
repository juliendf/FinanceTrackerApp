# Parity checklist

One row per screen in the source app. Tick a row only when the screen matches
`http://localhost:3010` on the golden dataset in **both** themes, and when the
behaviours listed in its route are reproduced. Anything intentionally different
belongs in `docs/DEVIATIONS.md`, and the row says "deviation".

Status: `-` not started, `wip` in progress, `done` verified, `dev` done with a
recorded deviation, `drop` intentionally not ported.

Source: `FinanceTracker/app/templates/**` plus `app/routes/*.py`.

## Layout and shell

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Base layout (head, theme bootstrap, footer) | `base.html` | 1 | done | Pre-paint theme script ported verbatim |
| Navbar | `components/navbar.html` | 1 | done | User dropdown loses Login/Logout |
| Sidebar | `components/sidebar.html` | 1 | dev | Source sidebar is included only by `layouts/main.html`, which no live page extends; its links are `#` anchors. Component ported, collapse persisted, not used by default |
| Breadcrumbs | `components/breadcrumb.html` | 1 | done | |
| Flash messages → toasts | `components/flash_messages.html` | 1 | done | Same alert markup, 5 s auto-dismiss |
| Page header | `components/page_header.html` | 1 | done | |
| Form fields (8 variants) | `components/form_fields.html` | 1 | done | |
| Form card / form actions | `components/form_fields.html` | 1 | done | |
| Data table (sortable, 5 column types) | `components/table.html` | 1 | done | |
| Pagination + page size | `components/pagination.html` | 1 | done | |
| Search + filters | `components/search_filter.html` | 1 | done | |
| Export buttons | `components/search_filter.html` | 1 | done | |
| Delete confirm modal | `components/table.html` | 1 | done | |
| Tag badge | `components/tag_badges.html` | 1 | done | |
| Chart container | `components/chart_container.html` | 1 | done | |
| Info tooltip | `base.html` / app.js | 1 | done | |

## Dashboard and charts

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Home dashboard | `dashboard.html`, `static/js/dashboard.js` | 5 | dev | KPI tiles (count-up), pie with group selector and sortable legend, evolution line with range buttons and percent badge. Verified against the source's own output at four pinned dates. Carry-in fix, see DEVIATIONS |
| Dashboard → Assets | `dashboard/assets.html` | 5 | dev | Source is an empty shell; this draws the breakdown |
| Dashboard → Performance | `dashboard/performance.html` | 5 | dev | Honest stub |
| Résumé (French UI) | `dashboard/resume.html` | 5 | dev | All six periods, tooltips, breakdown; matches the source on every range |
| Dashboard → Main | `dashboard/main.html` | - | drop | Dead template (not routed) |
| Asset evolution chart | `charts/asset_evolution.html` | 5 | dev | Total portfolio or one asset; currency labelled correctly |
| Distribution chart | `charts/distribution.html` | 5 | dev | Four groupings |
| `GET /charts/portfolio-evolution` | `routes/charts.py` | - | drop | Renders a template that does not exist |

## Reference data

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Institutions list | `admin/institutions.html` | 2 | dev | List + create/edit/delete; forms are modals (see DEVIATIONS) |
| Institution form | `admin/institution_form.html` | 2 | dev | Fields and validators ported; rendered in a modal |
| Categories list | `admin/categories.html` | 2 | dev | Includes colour swatch and French system-role label |
| Category form | `admin/category_form.html` | 2 | dev | Includes `system_role` + colour; rendered in a modal |
| Admin dashboard ("Data") | `admin/dashboard.html` | 2 | dev | Import (v2 and v3), export at v3 with entity selection, typed-confirmation reset |
| Tags list | `tags/list.html` | 2 | dev | Badge rendering and usage counts |
| Tag form | `tags/form.html` | 2 | dev | Rendered in a modal |
| Quick-add modal | `components/quick_add_modal.html`, `static/js/admin.js` | 2 | done | Wired into the asset create form |

## Assets

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Assets list | `assets/list.html` | 3 | dev | KPI tiles (combined total, per-currency), 5 filters in the URL, chips, tags column, pager, page size, delete modal. Filter results verified against an independent oracle on the real backup. Deviations: pager ellipsis, real snapshot range |
| Asset detail | `assets/detail.html` | 3 | dev | Info, current value, statistics, themed chart, history. Three source display bugs fixed (see DEVIATIONS); row delete arrives with Phase 4 |
| New asset | `assets/new.html` | 3 | dev | Full form incl. tags, three quick-adds, initial snapshot; atomic. Product suggestions do not exist in the source |
| Edit asset | `assets/edit.html` | 3 | dev | Pre-filled, current-values card, currency-change confirmation (modal), delete |

## Snapshots

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Snapshots list | `snapshots/list.html` | 4 | dev | Filters in URL, sort, per-page, bulk bar, summary tile, pager, CSV via save dialog (byte-identical to oracle). See Phase 4 deviations |
| New snapshot | `snapshots/new.html` | 4 | dev | Previous-value callout, three submit modes, `?asset_id` preselect, validation and duplicate messages |
| Snapshot detail | `snapshots/detail.html` | 4 | dev | Info cards, timeline, quick stats, delete modal |
| Edit snapshot | `snapshots/edit.html` | 4 | dev | Pending-changes preview, header delete, up-front duplicate check |
| Bulk entry grid | `snapshots/bulk.html` | 4 | dev | Filters in URL, apply same amount, copy previous, per-row errors, atomic write |
| Bulk edit | `snapshots/bulk_edit.html` | 4 | dev | `?ids=`, clear changes, atomic update |

## Settings and data

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Settings index | `settings/index.html` | 6 | dev | Six fields, save, export/import links; API key section dropped (no REST API) |
| Settings layout | `settings/_layout.html` | 6 | dev | Shared nav: General, Exchange Rates, Data & Backup |
| Exchange rates | `settings/exchange_rates.html` | 6 | dev | List + history, unset rows badged |
| Exchange rate edit | `settings/exchange_rates_edit.html` | 6 | dev | Bulk edit, validation, one transaction; full precision kept |
| LLM providers | `settings/llm_providers.html` | 7 | - | |
| LLM provider form | `settings/llm_provider_form.html` | 7 | - | Endpoint shown prominently; key → Keychain |
| Data backup | `settings/data_backup.html` | 6 | dev | Export at v3 with entity selection (no API keys), import of v2/v3, typed-confirmation reset |
| Settings export | `settings/export.html` | 6 | dev | JSON on screen, saved through a native dialog |
| Settings import | `settings/import.html` | 6 | dev | Paste or open a file; unknown keys ignored and reported |
| Reset | `settings/reset.html` | 6 | dev | Checkbox confirmation; deletes the settings rows only |
| Import from FinanceTracker (wizard) | `services/data_export.py` (v2/v3) | 1b | done | Pick → preview → import → role mapping → report. Verified against a real 18-asset backup |

## Chat and profile

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Chat | `chat/index.html`, `static/js/chat.js` | 7 | wip | Phase 0 spike proves streaming + one tool; conversation sidebar, pending actions, memories, markdown and stop/confirm cards still missing |
| Profile | `auth/profile.html` | 7 | - | Minus password/account parts |

## Auth and errors — not ported

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Login | `auth/login.html` | - | drop | Single user, no login |
| Register | `auth/register.html` | - | drop | |
| Error 403 | `errors/403.html` | - | drop | No permissions in a single-user app |
| Error 404 | `errors/404.html` | 1 | done | Catch-all route with a placeholder page |
| Error 500 | `errors/500.html` | - | drop | No server; errors surface as toasts |

## Dead templates — not ported

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Root index | `index.html` | - | drop | Superseded by `dashboard.html` |
| Forms barrel | `forms/add_asset.html`, `forms/add_institution.html` | - | drop | Dead |
| Lists barrel | `lists/asset_list.html`, `lists/snapshot_list.html` | - | drop | Dead |
| Test tables | `test/table_error.html`, `test/table_loading.html` | - | drop | `routes/test.py` is dev-only |
