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
| Home dashboard | `dashboard.html`, `static/js/dashboard.js` | 5 | - | KPI count-up, pie, evolution line, range selector |
| Dashboard → Assets | `dashboard/assets.html` | 5 | - | |
| Dashboard → Performance | `dashboard/performance.html` | 5 | - | A stub in the source; port as a stub |
| Résumé (French UI) | `dashboard/resume.html` | 5 | - | Requires `Category.system_role` |
| Dashboard → Main | `dashboard/main.html` | - | drop | Dead template (not routed) |
| Asset evolution chart | `charts/asset_evolution.html` | 5 | - | |
| Distribution chart | `charts/distribution.html` | 5 | - | |
| `GET /charts/portfolio-evolution` | `routes/charts.py` | - | drop | Renders a template that does not exist |

## Reference data

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Institutions list | `admin/institutions.html` | 2 | - | |
| Institution form | `admin/institution_form.html` | 2 | - | |
| Categories list | `admin/categories.html` | 2 | - | |
| Category form | `admin/category_form.html` | 2 | - | Includes `system_role` + colour |
| Admin dashboard ("Data") | `admin/dashboard.html` | 2 | - | |
| Tags list | `tags/list.html` | 2 | - | |
| Tag form | `tags/form.html` | 2 | - | |
| Quick-add modal | `components/quick_add_modal.html`, `static/js/admin.js` | 2 | - | Used from asset forms |

## Assets

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Assets list | `assets/list.html` | 3 | wip | Phase 0 spike covers KPI tiles, table, delete; filters, chips, pagination and the Tags column still missing |
| Asset detail | `assets/detail.html` | 3 | - | Info, line chart, snapshot history |
| New asset | `assets/new.html` | 3 | wip | Form fields ported; product suggestions by institution and tag multi-select missing |
| Edit asset | `assets/edit.html` | 3 | - | |

## Snapshots

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Snapshots list | `snapshots/list.html` | 4 | - | Filters, sorting, bulk delete, summary stats |
| New snapshot | `snapshots/new.html` | 4 | - | Previous-value lookup, amount > 0, no future dates |
| Snapshot detail | `snapshots/detail.html` | 4 | - | |
| Edit snapshot | `snapshots/edit.html` | 4 | - | |
| Bulk entry grid | `snapshots/bulk.html` | 4 | - | Apply same amount, copy previous, all-or-nothing write |
| Bulk edit | `snapshots/bulk_edit.html` | 4 | - | |

## Settings and data

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Settings index | `settings/index.html` | 6 | - | API key generate/revoke section dropped (no REST API) |
| Settings layout | `settings/_layout.html` | 6 | - | |
| Exchange rates | `settings/exchange_rates.html` | 6 | - | |
| Exchange rate edit | `settings/exchange_rates_edit.html` | 6 | - | Bulk edit + history |
| LLM providers | `settings/llm_providers.html` | 7 | - | |
| LLM provider form | `settings/llm_provider_form.html` | 7 | - | Endpoint shown prominently; key → Keychain |
| Data backup | `settings/data_backup.html` | 6 | - | Desktop export/import at v3, no API keys |
| Settings export | `settings/export.html` | 6 | - | |
| Settings import | `settings/import.html` | 6 | - | |
| Reset | `settings/reset.html` | 6 | - | Typed confirmation |
| Import from FinanceTracker (wizard) | `services/data_export.py` (v2/v3) | 1b | - | First-run screen + Settings > Data |

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
| Error 404 | `errors/404.html` | 1 | wip | A catch-all route exists; styled page pending |
| Error 500 | `errors/500.html` | - | drop | No server; errors surface as toasts |

## Dead templates — not ported

| Screen | Source | Phase | Status | Notes |
|---|---|---|---|---|
| Root index | `index.html` | - | drop | Superseded by `dashboard.html` |
| Forms barrel | `forms/add_asset.html`, `forms/add_institution.html` | - | drop | Dead |
| Lists barrel | `lists/asset_list.html`, `lists/snapshot_list.html` | - | drop | Dead |
| Test tables | `test/table_error.html`, `test/table_loading.html` | - | drop | `routes/test.py` is dev-only |
