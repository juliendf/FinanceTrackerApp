# Implementation prompt: financeTrackerApp (Tauri v2 port of FinanceTracker)

Give this whole file to the implementing agent as its task brief.

---

## Role and goal

You are implementing **financeTrackerApp**. It is a native macOS desktop app that reproduces the existing **FinanceTracker** web app feature for feature, using the same look. You work phase by phase. You stop at the end of each phase for review by Julien, the owner.

- **New project (write here):** `~/Documents/devops/perso/AI/financeTrackerApp/`
- **Source app (read only, never modify):** `~/Documents/devops/perso/AI/FinanceTracker/`
- **Analysis (read first):** `~/Documents/devops/perso/AI/financeTrackerApp/docs/ANALYSIS.md`

The source is a Flask SSR app built on Postgres (SQLite fallback), Jinja2, Bootstrap 5.3, Chart.js and a litellm-based chat. Its project notes are in `FinanceTracker/AGENTS.md`. Read them.

## Decisions already taken (do not re-open)

1. **Full rewrite, "thin Rust".**
   - React 19 + TypeScript + Vite own the UI and all business logic.
   - SQLite is accessed through `tauri-plugin-sql`.
   - Rust handles only three things: Keychain secrets, LLM HTTP calls and native file dialogs/IO.
2. **Single user, no login.** There is no `user_id` anywhere, no registration and no password.
3. **macOS only.** Do not add Windows or Linux code paths.
4. **The web app stays. There is no sync.** Data arrives only through a one-off import of the web app's JSON backup.
5. **LLM.** Use external OpenAI-compatible endpoints only, with a user-provided `base_url` and an optional API key. Do not bundle a model. The LLM is opt-in, and the UI shows the endpoint that will receive the data. All LLM HTTP calls go from Rust, never from the webview.
6. **Money uses exact decimals.**
   - Amounts are stored as INTEGER minor units (cents).
   - Rates are stored as TEXT decimal strings.
   - All arithmetic uses `decimal.js`.
   - Never use JS `number` for money math. Use `number` only at the final Chart.js boundary.
7. **Secrets.** LLM API keys live only in the macOS Keychain (`keyring` crate). SQLite stores only a key reference.

## Hard rules

- **Git: local history only.** The repo already exists on `main` with an `origin` remote (`git@github.com-personal:juliendf/FinanceTrackerApp.git`). Commit at the end of **every** phase so each phase has a revert point, and keep commits scoped to that phase.
  - Do not `git push`, open PRs, or run CI. Publishing is Julien's call, per phase.
  - Never commit runtime data or secrets: `*.db`, `*.dmg`, `.env`, signing material. `.gitignore` already covers these.
  - `.claude/worktrees/` must stay untracked; a worktree lives inside the repo.
  - Exception: phase 8 may *write* a GitHub Actions workflow file, but must not run it.
- **Never modify the source repo.** It is your read-only reference and oracle.
- **Stop at the end of every phase.**
  1. Run that phase's verification.
  2. Report what you did, the verification output, and any deviations from this brief.
  3. Wait for approval before you start the next phase.
- **Ask, don't guess, when a source behaviour is ambiguous.** Cite the file:line you found.
- **Parity is the spec.** For each screen, read the source template + route + JS before you build the React version. When you change a behaviour on purpose, list it in `docs/DEVIATIONS.md`.
- **Do not port these known bugs and dead code:**
  - `/charts/portfolio-evolution` renders a template that does not exist.
  - Dead templates: `dashboard/main.html`, `templates/forms/*`, `templates/lists/*`, `templates/test/*`, `index.html`.
  - `routes/test.py`.
  - The demo-user machinery.
- **Currency formatting:** the Python `currency` filter in `app/utils/filters.py` is canonical. The JS `FinanceTracker.formatCurrency` in `static/js/app.js` is not.
- **Pin dependency versions** in `package.json` and `Cargo.toml`. Do not use CDNs, because the app must work offline.
- **Keep the code style plain.** Use small modules and typed repository functions. Do not add an ORM.

## Target layout

```
financeTrackerApp/
  docs/                     ANALYSIS.md, IMPLEMENTATION_PROMPT.md, DEVIATIONS.md, PARITY_CHECKLIST.md
  package.json, vite.config.ts, tsconfig.json, vitest.config.ts
  src/
    main.tsx, App.tsx, router.tsx
    styles/custom.css       copied verbatim from FinanceTracker/app/static/css/custom.css
    db/
      client.ts             tauri-plugin-sql connection (WAL, foreign_keys=ON)
      repositories/         one file per entity; typed SQL; no business logic
    domain/                 PURE functions, no Tauri imports, fully unit-tested
      money.ts              minor units <-> Decimal, rounding (half-even)
      currency.ts           conversion (port of app/utils/currency.py)
      portfolio.ts          latest-per-asset, evolution series, distribution, résumé
      snapshots.ts          validation, bulk helpers, CSV
      format.ts             port of app/utils/filters.py
    import/                 FinanceTracker backup importer (v2, v3)
    llm/                    chat loop, tools.ts, pendingActions.ts, prompts.ts
    ui/
      components/           React equivalents of Jinja macros
      layout/               navbar, sidebar, breadcrumb, toasts, theme
      pages/                one folder per area (dashboard, assets, snapshots, charts, chat, settings, tags, admin, profile)
  src-tauri/
    Cargo.toml, tauri.conf.json, capabilities/default.json
    migrations/             0001_init.sql, ...
    src/main.rs, src/lib.rs
    src/commands/secrets.rs keyring get/set/delete
    src/commands/llm.rs     chat_completion (Channel streaming + cancel), list_models, test_connection
    src/commands/files.rs   save/open dialogs, read/write file
  tests/golden/             parity fixtures produced from the Flask app
```

## Stack (pin current stable versions at install time)

| Concern | Choice |
|---|---|
| Shell | Tauri v2 (`create-tauri-app`, React + TS template) |
| UI | `bootstrap@5.3.x`, `react-bootstrap`, `bootstrap-icons`, Inter font bundled locally |
| Routing | `react-router` with a hash router |
| Server state | `@tanstack/react-query` wrapping repository calls |
| Forms | `react-hook-form` + `zod` |
| Charts | `chart.js@4` + `react-chartjs-2` |
| Money | `decimal.js` |
| Markdown (chat) | `react-markdown` + `rehype-sanitize` |
| Tests | `vitest` (domain, import, llm loop with mocked transport); `cargo test` for Rust |
| Tauri plugins | `tauri-plugin-sql` (sqlite), `tauri-plugin-dialog`, `tauri-plugin-fs`, later `tauri-plugin-updater` |
| Rust crates | `keyring`, `reqwest` (rustls, json, stream), `tokio`, `serde`, `serde_json` |

Docs:
- Tauri SQL plugin: https://v2.tauri.app/plugin/sql/
- Channels: https://v2.tauri.app/develop/calling-frontend/#channels
- Capabilities: https://v2.tauri.app/security/capabilities/
- macOS signing: https://v2.tauri.app/distribute/sign/macos/
- Updater: https://v2.tauri.app/plugin/updater/
- keyring: https://docs.rs/keyring

## Source map (read these before each related phase)

| Topic | Source file(s) in FinanceTracker |
|---|---|
| Data model | `app/models/core.py`, `app/models/base.py`, `app/utils/constants.py` (system roles) |
| Defaults / first-run seed | `app/services/user_defaults.py`, `app/utils/settings.py` (`DEFAULT_SETTINGS`) |
| Currency | `app/utils/currency.py` |
| Dashboard / Résumé | `app/services/dashboard_service.py`, `app/routes/dashboard.py`, `templates/dashboard/resume.html` (French UI, keep French) |
| Charts data | `app/routes/api.py` (evolution at ~74-157), `app/routes/charts.py`, `app/utils/chart_data.py`, `static/js/charts.js`, `static/js/dashboard.js` |
| Assets | `app/routes/assets.py`, `app/forms/asset_forms.py`, `templates/assets/*`, `app/utils/asset_helpers.py` |
| Snapshots | `app/routes/snapshots.py`, `app/forms/snapshot_forms.py`, `app/utils/snapshot_helpers.py`, `templates/snapshots/*` |
| Institutions / categories | `app/routes/admin.py`, `app/forms/admin_forms.py`, `templates/admin/*`, `static/js/admin.js`, `templates/components/quick_add_modal.html` |
| Tags | `app/routes/tags.py`, `app/forms/tag_forms.py`, `templates/tags/*` |
| Settings / rates / backup | `app/routes/settings.py`, `app/forms/settings_forms.py`, `app/forms/exchange_rate_forms.py`, `templates/settings/*`, `app/services/data_export.py` |
| LLM providers | `app/forms/llm_provider_forms.py`, `app/repositories/llm_provider_repository.py`, `app/services/llm_client.py` |
| Chat | `app/routes/chat.py`, `app/services/chat_service.py`, `app/services/chat_tools.py`, `app/services/tools.json`, `templates/chat/index.html`, `static/js/chat.js` |
| Profile / memories / goals | `app/routes/auth.py` (profile part only), `templates/auth/profile.html` |
| Layout / macros | `templates/base.html`, `templates/components/*`, `app/utils/filters.py`, `app/utils/pagination.py`, `app/utils/tables.py`, `static/js/app.js` |
| Sample data | `app/demo_data.py` (port as a dev-only "Load sample data" action) |
| LLM evals | `eval/` (promptfoo; reuse the prompts as test cases for the chat loop) |

## Schema guidance

Port every entity in `app/models/core.py` **except** User auth fields and `ChatJob`. Apply these changes:

- Remove `user_id` from every table. Per-user uniques become global:
  - Institution `UNIQUE(name)`
  - Category `UNIQUE(name)`
  - Tag `UNIQUE(name)`
  - Settings `UNIQUE(key)`
  - ExchangeRate `UNIQUE(from_currency, to_currency)`
  - LLMProvider `UNIQUE(name)`
  - one default provider through a partial unique index `WHERE is_default = 1`
- Keep `Snapshot UNIQUE(asset_id, date)` and its indexes.
- Money columns:
  - `snapshots.amount_minor INTEGER NOT NULL`
  - `user_goals.target_amount_minor INTEGER`
  - profile `salary_minor`, `monthly_savings_target_minor`
- `exchange_rates.rate TEXT NOT NULL`. Also store `assets.cost_charges` and `assets.interest_rate` as TEXT decimals.
- Asset currency is limited to `CHECK (currency IN ('EUR','USD','CHF'))`, matching the source.
- Dates are ISO `TEXT` (`YYYY-MM-DD`). Timestamps are ISO UTC `TEXT`.
- JSON payloads (tool_calls, pending action payload) are `TEXT` holding JSON.
- The profile becomes a single-row `profile` table. It holds the former User profile fields: currency, timezone, date_format, salary, savings target, risk_profile, ai_tone/verbosity/expertise.
- `llm_providers.api_key` is replaced by `keychain_ref TEXT NULL`. The secret itself goes to the Keychain under service `ch.julien.financetrackerapp` (adjust to the final bundle id) with account `provider:<id>`.

---

## Phases

Every phase ends with **Verify** and **Stop & report**.

### Phase 0: Spike (go/no-go)

Goal: prove the stack end to end before the full build.

1. Scaffold Tauri v2 + React + TS. Set the bundle identifier and the product name "FinanceTracker".
2. Copy `custom.css`. Install Bootstrap, react-bootstrap and the icons locally. Apply the theme bootstrap from `templates/base.html`: the `data-theme` + `data-bs-theme` attributes, light/dark/auto, persisted in `localStorage`, applied before first paint.
3. Use `tauri-plugin-sql` with migration `0001_init.sql`, holding only the `institutions`, `categories`, `assets` and `snapshots` tables for now.
4. Build one screen: Asset list + create form, reproducing `templates/assets/list.html` minus the filters.
5. Build a portfolio line chart from snapshots, using a port of `ChartUtils.mergeConfig` from `static/js/charts.js`.
6. Rust `secrets.rs`: set/get/delete an API key in the Keychain.
7. Rust `llm.rs`: one `chat_completion` call with a single tool (`get_portfolio_summary` from `tools.json`) against a local Ollama (`http://localhost:11434/v1`). Stream tokens to the UI through a `Channel`.
8. Produce a `.dmg` with `npm run tauri build`. Sign it ad-hoc if no Developer ID is available, and say so.

**Verify:**
- Data survives an app restart.
- The chart renders correctly in light and dark.
- The tool call returns a portfolio summary computed from the DB.
- The key is visible in Keychain Access and absent from the SQLite file (check with `sqlite3 <db> .dump | grep -i key`).
- The `.dmg` installs and launches.

Also report bundle size and cold-start time.

### Phase 1: Foundation

1. Full schema in migrations, following the schema guidance above. Enable WAL and `foreign_keys`. Put the DB under `~/Library/Application Support/<bundle-id>/financetracker.db`.
2. Repository layer for every entity: typed inputs/outputs and no business logic.
3. `domain/money.ts`: parse/format, minor-unit conversion, half-even rounding. Write exhaustive unit tests.
4. `domain/format.ts`: port `app/utils/filters.py` exactly (`currency`, `relative_date`, `days_since`, `format_date`, `percentage`). Write unit tests, including the edge cases: `None` gives "N/A"/"Never", negative days clamp to 0, the symbol goes before the amount for USD/EUR/GBP/CAD/AUD and after it otherwise.
5. First-run seed, ported from `user_defaults.py` + `DEFAULT_SETTINGS`: the six EUR/USD/CHF rate pairs, the default settings, one key-less default LLM provider. Run it once, on an empty DB.
6. Settings service: read/write with fallback to `DEFAULT_SETTINGS`.
7. Layout shell, reproducing `base.html`, `components/navbar`, `sidebar` (collapse saved in `localStorage`), `breadcrumb` and theme toggle. Flash messages become a toast system.
8. Component library mirroring the Jinja macros in `templates/components/`:
   - `FormField` variants (text, email, number, currency, select, textarea, checkbox, date)
   - `FormCard`, `FormActions`
   - `DataTable` (sortable)
   - `Pagination` + `PageSizeSelector`
   - `SearchFilter`, `ExportButtons`
   - `DeleteConfirmModal`, `PageHeader`, `TagBadge`, `InfoTooltip`, `ChartContainer`
9. Create `docs/PARITY_CHECKLIST.md` with one row per screen from ANALYSIS.md section 1, and keep it updated in every later phase.

**Verify:** `vitest` is green; a fresh launch seeds exactly once (relaunch and check the row counts); the shell matches the web app side by side at `http://localhost:3010` in light and dark (take screenshots).

### Phase 1b: Import from FinanceTracker

1. Parse the backup JSON produced by `app/services/data_export.py`. Read that file fully first: the envelope is `{version, exported_at, data}`, and it supports versions 2 and 3. Reject unknown or newer versions with a clear message.
2. The wizard is available from the first-run screen ("Start empty" / "Import from FinanceTracker") and from Settings > Data. The steps:
   1. Native open dialog.
   2. Preview of counts per entity plus warnings.
   3. Confirm.
   4. Import inside **one SQLite transaction**, so it is all or nothing.
   5. Show a report.
3. Map the data as follows:
   - Drop `user_id` and remap old IDs to new ones, following the remap approach in `data_export.py`.
   - Convert float amounts and rates to minor units / decimal strings with half-even rounding to 2 dp for amounts. Keep rates at full precision as strings.
   - List every value whose float was not already exact at 2 dp in the report.
   - Move LLM provider API keys into the Keychain. Never write them to SQLite. If the key is missing, the provider is imported without a key.
4. v2 gaps:
   - v2 lacks `Category.system_role`. Add a "Map categories to roles" step after import, using the role list in `app/utils/constants.py`. The step can be skipped and reopened later from the Categories screen.
   - v2 also lacks memories, goals and profile. Note them as "not included in this backup" in the report.
5. v3 (if present) adds `system_role`, memories, goals and profile. Import them, and skip the mapping step. Do **not** implement the v3 export in the source repo. That is Julien's call. Document the expected v3 fields in `docs/IMPORT_FORMAT.md` so the web-app change can follow.
6. Allow the import only on an empty DB. Otherwise, offer "Reset and import" behind a typed confirmation. There is no merge mode.
7. Golden fixtures. Ask Julien for a real backup file, or generate one from the source app's dev instance with the demo data (`docker-compose exec web flask demo-reset`, then export as the `demo` user). Store the fixture plus the expected counts in `tests/golden/`.

**Verify:** the importer unit tests pass (v2 fixture, malformed file, newer version, rounding report); importing the golden backup gives counts identical to the source; a failed import leaves the DB empty.

### Phase 2: Reference data

Build Institutions, Categories (with color + system_role) and Tags. Each gets list/create/edit/delete, with per-name uniqueness errors shown on the field. Build the quick-add modals used from the asset forms (`admin.js`, `quick_add_modal.html`). Deleting a row that is still referenced must be blocked or confirmed, matching the source behaviour. Read the routes to find out which.

**Verify:** you can CRUD each entity; duplicate names show field errors; the parity checklist rows are ticked.

### Phase 3: Assets

1. List page, reproducing `templates/assets/list.html` and the route logic in `app/routes/assets.py`:
   - KPI tiles
   - search, plus currency/category/institution/tag filters
   - active-filter chips, result count, pagination
   - filter state kept in the URL query (hash router)
2. Detail page: info, line chart, snapshot history.
3. New/edit forms with every field and validator from `asset_forms.py`. Includes the dependent product suggestions by institution (`/assets/api/products/<inst>`). Tags are multi-select. `display_name` is computed exactly as in `core.py`.
4. Delete with confirmation, cascading to snapshots as the source does.

**Verify:** filter combinations match the source on the golden data (same result counts for 5 representative filter sets, listed in the report).

### Phase 4: Snapshots

1. List page:
   - filters: date range, institution, currency, min/max amount, search, page size
   - sorting, pagination, summary stats
   - bulk delete with checkboxes
   - CSV export through a native save dialog, with the same columns and format as `snapshots.py` (~244)
2. Single entry: the date defaults to today, and the "previous value" lookup is shown. Validation follows `snapshot_helpers.py`: amount > 0, no future dates, unique (asset, date). Edit and delete.
3. **Bulk entry grid** (`templates/snapshots/bulk.html`, routes ~656-820): one amount input per asset for a chosen date, plus "apply same amount" and "copy previous". Validate every row, then write all rows in one transaction. Partial failures are shown per row and nothing is written.
4. Bulk edit (`bulk_edit.html`).

**Verify:** the CSV is byte-for-byte identical to the source export on the golden data (ignore line endings only if the source differs by platform); the bulk grid handles 50+ assets without lag.

### Phase 5: Domain + dashboards (highest correctness risk)

1. `domain/currency.ts`: port `app/utils/currency.py` exactly.
   - Lookup order: direct, then inverse, then a hop through EUR/USD/CHF.
   - If no rate exists, return the **unconverted** amount and emit a warning (keep the source behaviour, and surface it in the UI as a small "unconverted" badge).
   - The base currency comes from the `base_currency` setting.
   - Use a per-render cache instead of `flask.g`.
2. `domain/portfolio.ts`:
   - latest snapshot per asset (MAX(date))
   - first snapshot per asset
   - holdings as of a date
   - distribution by institution/category/currency/product
   - portfolio evolution over 1W, 1M, 3M, 6M, 1Y, YTD, ALL with last-value carry-forward. **Re-implement efficiently**: sort once and sweep, instead of the source's O(dates × assets × snapshots) loop. Keep identical output, including the rule that forces the last point to equal the summary value.
   - Résumé (`dashboard_service.py` ~232): total value, "invested capital" (= value at the start date, as in the source), absolute and % performance, annualized `((end/start)^(1/years) - 1)` with 365.25-day years, breakdowns by system_role (cash, emergency fund, ...).
3. Golden parity tests. Run the source app (dev Docker) loaded with the golden backup and capture the JSON from the following endpoints into `tests/golden/*.json`:
   - `/api/charts/portfolio-evolution?range=...` for every range
   - `/api/charts/distribution/by-*`
   - `/api/charts/asset-evolution/<id>`
   - `/api/charts/category-evolution/<id>`
   - `/api/charts/resume`
   - the index summary values

   The TS domain must reproduce them within 0.01 (minor-unit rounding). Pin "today" in both systems when capturing.
4. Screens:
   - home dashboard (`dashboard.html` + `dashboard.js`: KPI tiles with count-up, pie, evolution line with range selector)
   - `dashboard/assets.html`
   - `dashboard/performance.html` (the source is a stub; port it as a stub)
   - `dashboard/resume.html` (**French UI**, period buttons)
   - `charts/asset_evolution.html`, `charts/distribution.html`
   - asset detail chart wired to the domain

**Verify:** every golden test is green; side-by-side screenshots of each dashboard match on the golden data. Report any number that differs and why.

### Phase 6: Settings + data

1. General settings: every setting in `settings_forms.py`, including the reset-to-defaults confirmation. Drop the API key generate/revoke section. There is no REST API in v1; note this in DEVIATIONS.
2. Exchange rates: list, edit, bulk edit, history (`exchange_rates*.html`).
3. The desktop app's own backup export/import uses the same envelope at version 3 (see `IMPORT_FORMAT.md`), so the Phase 1b importer reads it. **Exclude API keys** from exports.
4. Settings JSON export/import, as in the source.
5. Data reset behind a typed confirmation.

**Verify:** an export followed by an import into a fresh DB round-trips identically (row-level diff).

### Phase 7: AI (providers, chat, profile)

1. LLM providers: CRUD, set default, test connection and fetch models (Rust `test_connection`, `list_models` calling `GET {base_url}/models`). Keys go to the Keychain only. The form shows the endpoint URL prominently. Chat is disabled until the user explicitly enables AI in Settings (opt-in).
2. Rust `chat_completion`:
   - OpenAI chat-completions schema with tools, streaming through a `Channel`, cancellation through an abort handle.
   - Timeouts, and clear error mapping (unreachable, 401, model not found).
   - Reasoning models get `max_tokens` 4096, as in `llm_client.py`.
   - Gemini is reached through its OpenAI-compatible endpoint. Do not port the litellm thought-signature special case unless a test proves it is needed.
3. Chat loop in `src/llm/`, a port of `chat_service.py`:
   - up to 5 tool rounds and 60 messages of history
   - the system prompt is built from profile + AI style (tone/verbosity/expertise) + memories, ported verbatim from the source prompt text
   - the loop's transport is injectable, so tests can mock it
4. Tools: port the 7 tools in `tools.json` (get_portfolio_summary, list_assets, get_asset_details, get_asset_history, get_allocation, propose_snapshot, remember_fact) over the domain layer.
   - **Write tools never execute directly.** They create a `PendingAction` that the user confirms or rejects in the UI. On confirmation, the code upserts the snapshot or creates the memory, then adds the narration message, as `confirm_action` does in `chat_service.py` (~616).
5. Chat UI, reproducing `chat/index.html` + `chat.js` with streaming instead of polling:
   - conversation sidebar with inline rename (double-click) and delete
   - provider and model switch
   - prompt suggestion buttons
   - stop/cancel
   - confirm/reject cards
   - per-message delete
   - "extract memories"
   - assistant Markdown rendered client-side through `react-markdown` + `rehype-sanitize`
6. Profile screen: profile fields, memories CRUD, goals CRUD (`auth/profile.html` minus the password/account parts).
7. Tests:
   - loop unit tests with a mocked transport (tool round-trips, the 5-round cap, cancellation, pending-action flow)
   - the red-team cases from `eval/promptfooconfig.redteam.yaml`, run as tests that assert no write happens without confirmation

**Verify:**
- a manual session against local Ollama covers each tool once, confirms one proposed snapshot and rejects another
- the cancel button stops the stream within 1 s
- `sqlite3 <db> .dump` shows no API key

### Phase 8: Ship

1. App icon set and the About window (version).
2. Signing + notarization config, following https://v2.tauri.app/distribute/sign/macos/. Use env vars for credentials and never commit them. If Julien has no Developer ID yet, document the steps and produce an ad-hoc signed build.
3. `tauri-plugin-updater` configured for GitHub Releases. Write the config and docs only, without publishing anything.
4. Write `.github/workflows/release.yml` for a macOS build. Do not run it; there is no git yet.
5. `README.md`: install, dev (`npm install`, `npm run tauri dev`), test (`npm test`, `cargo test`), build (`npm run tauri build`), data location, backup/restore, importing from the web app.
6. Final pass: every row of `PARITY_CHECKLIST.md` is ticked or explained in `DEVIATIONS.md`.

**Verify:** a clean build from scratch (`rm -rf node_modules src-tauri/target && npm install && npm run tauri build`) succeeds; the installed app launches; importing the golden backup gives the golden dashboard numbers.

### Optional phase 9: MCP (only if Julien asks)

Expose the source's MCP tool set (`FinanceTracker/mcp/mcp_server.py`, 30 tools) as a stdio MCP server binary bundled as a Tauri sidecar. It opens the SQLite file directly, read-mostly. Any writes go through the same validation as the app. The fallback is a localhost-only axum server with a random token stored in the Keychain.

---

## Reporting format at each stop

```
Phase N — <name>: DONE | BLOCKED
Built: <bullets>
Verification: <commands run + key output>
Parity: <checklist rows ticked / remaining>
Deviations: <new entries in DEVIATIONS.md>
Questions for Julien: <numbered, each with the source file:line that raised it>
Next: Phase N+1 — <one line>
```
