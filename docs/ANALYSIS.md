# financeTrackerApp: analysis for a Tauri v2 port of FinanceTracker

## Context
FinanceTracker is a Flask SSR web app: Postgres, Jinja2, Bootstrap 5.3, Chart.js and a litellm chat.
Julien wants the same app as a native macOS desktop app, in a new sibling project `financeTrackerApp`.

Decisions taken:
- Full rewrite, "thin Rust". The UI and business logic are in React + TypeScript. SQLite is accessed through `tauri-plugin-sql`. Rust only handles secrets, LLM HTTP and the file system.
- Single user with no login. An optional app lock can come later.
- macOS only.
- The web app stays alive. There is no sync. Data is imported once from a backup.

Deliverable once this plan is approved: create the local folder `~/Documents/devops/perso/AI/financeTrackerApp/` (no git, nothing pushed) holding `docs/ANALYSIS.md`, which contains the content below. No app code until the spike is green-lit.

## 1. Scope inventory (what "exact same thing" means)

| Area | Source | Size | Difficulty |
|---|---|---|---|
| Data model | `app/models/core.py` | 15 tables, 16 Alembic migrations | Low. Already SQLite-compatible (batch_op; the partial index uses `sqlite_where`) |
| Screens | `app/templates/**` | ~45 screens, 12 Jinja macros | Medium. Mostly Bootstrap forms and tables |
| Complex screens | `snapshots/bulk.html`, `snapshots/list.html`, `assets/list.html`, `chat/index.html`, `auth/profile.html` | 5 | High |
| JS | `static/js/app.js` 39K, `chat.js` 35K, `admin.js` 15K, `dashboard.js` 13K, `charts.js` 7K | ~110K | Rewritten as React; `ChartUtils` theming ported nearly 1:1 |
| CSS | `static/css/custom.css` | 3,083 lines, ~398 vars | **Reused as-is.** Keep `data-theme` + `data-bs-theme` on `<html>` |
| Business logic | `utils/currency.py`, `services/dashboard_service.py`, `routes/api.py:74-157`, `utils/snapshot_helpers.py`, `utils/filters.py` | ~1.2K LOC | Medium. Logic is small, but it has **no tests today** |
| LLM/chat | `services/chat_service.py`, `chat_tools.py`, `tools.json`, `llm_client.py` | ~1.5K LOC | High. 5-round tool loop, PendingAction confirm flow, memories, style prompts |
| Backup | `services/data_export.py` (JSON v2) | 608 LOC | Medium. Needed for the import |
| REST API v1 + MCP | `routes/api_v1.py`, `mcp/mcp_server.py` (30 tools) | 936 + MCP | Out of scope for v1 (see section 5) |

**Dropped from the port:**
- auth, registration, password hashing, Flask-Session
- `user_id` on every table, and the ~48 isolation tests
- API-key auth, demo-user switching, `routes/test.py`, Adminer, Docker/CI deploy
- `demo_data.py` survives only as a dev "load sample data" command, which is useful for screenshots.

**Bugs to not port:**
- `/charts/portfolio-evolution` renders a template that does not exist.
- JS `formatCurrency` and the Python `currency` filter disagree. Make the Python filter canonical.
- Dead templates: `dashboard/main.html`, `forms/*`, `lists/*`.
- The performance dashboard is a stub. Port it as a stub or drop it.

## 2. Target architecture

```
financeTrackerApp/
  src/                      React 19 + TS + Vite
    db/                     schema migrations (SQL), repositories (typed SQL over tauri-plugin-sql)
    domain/                 currency.ts, portfolio.ts (evolution, résumé), snapshots.ts, format.ts  <- pure, unit-tested
    llm/                    chat loop, tools.ts (from tools.json), pendingActions.ts, prompts.ts
    ui/                     react-bootstrap components replicating Jinja macros; pages/ per screen
    styles/custom.css       copied verbatim
  src-tauri/
    src/commands/llm.rs     reqwest call to OpenAI-compatible /chat/completions + /models; key read from Keychain
    src/commands/secrets.rs keyring crate: set/get/delete provider API key
    src/commands/files.rs   save/open dialogs for CSV, backup export/import (tauri-plugin-dialog + fs)
```

| Concern | Choice | Why |
|---|---|---|
| UI kit | `bootstrap@5.3` + `react-bootstrap` + `bootstrap-icons` (npm, no CDN) | Same classes, so `custom.css` applies unchanged; works offline |
| Routing | `react-router` (hash router) | Mirrors the URL structure |
| Data | TanStack Query over repository functions | Replaces the POST/redirect/flash flow; ~117 `flash()` calls become toasts |
| Forms | react-hook-form + zod | Replaces 8 WTForms modules and their validators |
| Charts | `chart.js` 4 + `react-chartjs-2` | Same chart types (pie, line, bar); `ChartUtils.mergeConfig` ported |
| Money | Snapshot/goal amounts as **INTEGER minor units**, rates as TEXT decimals, math in `decimal.js` | Today `Snapshot.amount`, `ExchangeRate.rate`, `cost_charges` and `interest_rate` are Float. Fix that now, not later |
| Schema | One fresh v1 schema without `user_id`; per-user uniques become global (`UNIQUE(name)`, `UNIQUE(asset_id,date)`, `UNIQUE(from,to)`) | No Alembic history to carry |
| Migrations | `tauri-plugin-sql` `Migration` list in Rust | Built-in, applied at startup |
| Secrets | LLM API keys only in macOS Keychain via `keyring`; the DB stores only a reference | Today they sit in plaintext in the DB and in backups |
| LLM | HTTP from Rust only, OpenAI-compatible + custom `base_url` (Ollama/LM Studio); opt-in; show the endpoint | Matches the earlier decision. litellm is replaced by plain OpenAI-schema calls. Gemini works through its OpenAI-compatible endpoint, which avoids the thought-signature special case |
| Chat jobs | Async Tauri command + `Channel` for progress/streaming; cancel via an abort flag | Replaces `threading.Thread` + 1.5 s polling of `ChatJob`. The `ChatJob` table goes away |
| Markdown | `react-markdown` + sanitize on the client | Replaces server-side `markdown` into `innerHTML`, which is safer |
| DB location | `~/Library/Application Support/<bundle-id>/financetracker.db` | Standard; Time Machine covers it |

## 3. Data migration (web to desktop, one time)
The backup format (`data_export.py`, JSON v2) is the right path, but it **drops data**:
- `Category.system_role` (needed by the Résumé view)
- memories, goals, conversations/messages, and the user profile fields
- it also exports LLM API keys in plaintext

**Feature: "Import from FinanceTracker" (one-off, first-class, built early in phase 1b)**
- Location: a first-run screen ("Start empty" or "Import from FinanceTracker") and Settings > Data.
- Input: the JSON file from the web app's existing **Settings > Data backup** export. **v2 works today with no web-app change.**
- Flow:
  1. Pick the file in a native dialog.
  2. Validate the version and show a preview of counts per entity (institutions, categories, tags, assets, snapshots, rates, settings, providers).
  3. Import in a single SQLite transaction. All or nothing.
  4. Show a report.
- Mapping:
  - drop `user_id`
  - remap old IDs (reuse the remap logic from `data_export.py`)
  - convert floats to minor units (half-even, 2 dp) and list any values that did not round cleanly in the report
  - move provider API keys into the Keychain, never into SQLite
- v2 gaps handled in the desktop app:
  - after import, show a "Map categories to roles" step to restore `system_role`, which the Résumé needs
  - memories, goals and profile are skipped, with a note in the report
- Only on an empty DB. Re-importing means "reset + import". No merge mode, which keeps the one-off case simple.
- Optional (0.5 d, web app): add `system_role`, memories, goals and profile to a **v3** export, plus an option to exclude API keys. The desktop app then imports these too, and the role-mapping step is skipped.
- Chat history is not imported. It is low value and its tool-call payloads are provider-specific.
- Bonus: real data from day 1 powers development and the Flask-vs-TS golden parity tests.

## 4. Phased plan and effort (one dev with AI assistance; rough)

| # | Phase | Content | Est. |
|---|---|---|---|
| 0 | **Spike** | Tauri shell + custom.css + Asset CRUD on SQLite + portfolio line chart + one tool call to Ollama via Rust + Keychain round-trip + signed `.dmg` | 2-3 d |
| 1 | Foundation | Schema v1, repo layer, settings, first-run seed (from `user_defaults.py`: 6 rates, settings, one key-less provider), layout shell (navbar, sidebar, breadcrumbs, theme toggle), macro components | 4-5 d |
| 1b | **Import from FinanceTracker** | v2 (and v3) JSON import wizard, preview, transactional import, report, category-to-role mapping, keys into Keychain | 2-3 d |
| 2 | Reference data | Institutions, categories (system_role), tags, quick-add modals | 2-3 d |
| 3 | Assets | List (search + 4 filters + chips + pagination), detail with chart, new/edit | 3-4 d |
| 4 | Snapshots | List (filters, sort, pagination, bulk delete), single entry + previous value, edit, **bulk grid** (apply amount, copy previous), bulk edit, CSV export | 5-6 d |
| 5 | Domain + dashboards | Port currency (direct, inverse, EUR/USD/CHF hop, fallback), latest-per-asset, evolution (rewrite the O(dates x assets x snapshots) loop), Résumé (annualized perf), distribution charts, KPI tiles. **Write the unit tests missing today**, using the Flask app as the oracle on the same backup | 5-6 d |
| 6 | Settings + data | General settings, exchange rates (bulk edit, history), desktop's own backup export/import, reset | 2-3 d |
| 7 | AI | Provider CRUD (test connection, fetch models), Keychain, chat UI (conversations, rename, delete, provider switch), 7 tools, PendingAction confirm/reject, memories, goals, profile + style prompts, extract memories | 7-9 d |
| 8 | Ship | Icons, Developer ID signing + notarization, `tauri-plugin-updater` via GitHub Releases, GitHub Actions macOS build | 2-3 d |
| | **Total** | | **~34-45 dev days** |

Option for later: MCP. Expose the 30 MCP tools from the desktop app through a stdio MCP binary that opens the SQLite file read-mostly. The alternative is a localhost axum server with a token. Estimate 3-4 d.

## 5. Risks and challenges
- **"Exact same" is not free.** About 40% of the effort is re-creating server-rendered flows in React (filters through the query string, flash, validation). Pixel parity is realistic because the CSS is reused. Behavioural parity needs a screen-by-screen checklist from the inventory above.
- **No tests on the money logic today.** Parity of the Résumé and evolution numbers is the main correctness risk. Mitigation: golden-file tests that run the same backup through Flask (`/api/charts/*`, `/api/charts/resume`) and through the TS domain, and diff the outputs.
- **Two apps drift.** With both kept and no sync, every new feature costs twice. Expect the web app to freeze in practice. Decide that consciously.
- **MCP loss.** Today OpenCode/Claude Code query the data over MCP. The desktop v1 loses that unless the optional MCP phase is done.
- **Apple signing.** Distribution to other people needs an Apple Developer account ($99/yr) and notarization. Without it, users get Gatekeeper warnings.
- **SQLite concurrency.** Not an issue for a single user. Enable WAL anyway.

## 6. Verification (for the analysis and later phases)
- Analysis: every row in section 1 traces back to a file in the current repo. Re-check with `ls app/templates/**` and `app/routes/*.py` before phase planning.
- Spike exit criteria:
  - `npm run tauri build` produces a notarized `.dmg`
  - CRUD works across app restarts
  - the chart renders in light and dark
  - a tool call to local Ollama returns
  - the key is visible in Keychain Access and absent from the DB
- Later phases: `vitest` for `domain/`, golden diff against Flask on a real backup, and a manual checklist per screen against `http://localhost:3010`.

## References
- Tauri v2 SQL plugin: https://v2.tauri.app/plugin/sql/
- Channels (streaming to the frontend): https://v2.tauri.app/develop/calling-frontend/#channels
- macOS signing/notarization: https://v2.tauri.app/distribute/sign/macos/
- Updater: https://v2.tauri.app/plugin/updater/
- keyring crate: https://docs.rs/keyring
- react-bootstrap: https://react-bootstrap.github.io/
