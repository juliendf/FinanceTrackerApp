# Deviations from FinanceTracker

Every deliberate behavioural difference between the desktop app and the Flask
source. Anything not listed here is intended to match.

Most entries are a decision, not a wish: they say what the app does now and why.
Where a difference was later closed (mostly the Phase 0 spike notes), the entry
says so rather than being deleted, so the record stays honest.

## Contents

- [Phase 0 (spike)](#phase-0-spike)
- [Phase 1 (foundation)](#phase-1-foundation)
- [Phase 1b (import from FinanceTracker)](#phase-1b-import-from-financetracker)
- [Phase 2 (reference data)](#phase-2-reference-data)
- [Phase 3 (assets)](#phase-3-assets)
- [Phase 4: snapshots](#phase-4-snapshots)
- [Resolved: the theme that stayed dark](#resolved-the-theme-that-stayed-dark)
- [Phase 5: dashboards](#phase-5-dashboards)
- [Phase 6: settings and data](#phase-6-settings-and-data)
- [Phase 7: AI](#phase-7-ai)
- [Phase 8: packaging](#phase-8-packaging)
- [Security hardening (after Phase 4)](#security-hardening-after-phase-4)

## Phase 0 (spike)

Kept as the record of what the spike left out. Each item now states its current
status, because all of them were closed by later phases.

### Scope omissions at the time

- **No filters on the assets list.** Closed: the list has search, institution,
  category, currency and tag filters, checked against an oracle.
- **No Tags column in the assets table.** Closed: tags are a table, are
  editable per asset, and show in the list.
- **No cross-currency conversion in the portfolio chart.** Closed: every
  dashboard converts through `CurrencyConverter`, and an unconverted amount is
  badged rather than hidden.
- **Six of the seven LLM tools are missing.** Closed: all seven are ported, and
  the write tools stage a pending action instead of writing.
- **No chat persistence.** Closed: conversations, messages and pending actions
  are tables, and the transcript survives a restart.
- **Sample data instead of a `demo_data.py` port.** `src/dev/sampleData.ts`
  inserts 2 institutions, 2 categories, 3 assets and 36 snapshots. It is
  deterministic (seeded LCG) like the source, but it is not the demo user's
  dataset. Both load and reset exist behind the Data screen in development builds.

### Behavioural differences

- **Asset creation is transactional.** `createAsset` runs the asset, its tags
  and its first snapshot through `run_transaction`, as the source commits both or
  neither. (This was the spike's compensating-delete workaround; it is gone.)
- **`PRAGMA foreign_keys` is per connection.** The plugin pools connections, so
  the pragma set in `db/client.ts` applies to one connection in the pool.
  `journal_mode=WAL` is persistent in the file header, so it does stick.
  Cascading deletes therefore depend on the connection that runs the DELETE, so
  `reset.ts` deletes children explicitly before parents rather than relying on
  `ON DELETE CASCADE`.
- **The asset tiles show the real snapshot range, not the source's derived
  one.** `app/routes/assets.py:137` takes `min`/`max` over each asset's *latest*
  snapshot date, so every asset updated on the same day collapses the tile to
  "2026-10-01 – 2026-10-01". We show the first and last snapshot date across the
  portfolio (`snapshotDateRange`) instead, which is what the tile claims to
  show. Deliberate fix, agreed with Julien.
- **Chart re-theming goes through React state, not a live mutation.** The source
  keeps a `Set` of chart instances and mutates them in `retheme()`. Here the
  chart config is rebuilt on a `themechange` event and the Chart.js instance is
  remounted via `key={theme}`. Same pixels, no instance registry. —
  `src/ui/charts/chartTheme.ts`.

### Implementation notes (not behaviour)

- **`mergeConfig` deep-copies with `structuredClone`** instead of
  `JSON.parse(JSON.stringify(...))`. Same isolation guarantee, no
  serialisation round trip.
- **`keyring` is pinned to 3.6, not 4.x.** v4 splits the platform store into a
  separate `keyring-core` registration step that adds nothing for a single
  store; v3.6 has the simple `Entry::new` API the brief describes.
- **The LLM path is split into `stream_completion` (testable, takes an emit
  callback) and `chat_completion` (the IPC command that owns the `Channel`).**
  The split exists so `src-tauri/tests/live.rs` can prove streaming, tool calls
  and cancellation against a real endpoint without a webview.
- **SQL placeholders use `?`**, the native SQLite form. The plugin's doc
  comment shows `$1` for "sqlite & postgres", which is a copy-paste from the
  Postgres example.
- **Default spike model is `qwen3.5:4b`, not the smallest local model.**
  Verified against Ollama: `qwen3.5:4b` and `qwen3.6:35b-a3b` emit real
  `tool_calls`; `ministral-3:3b` and `qwen2.5-coder:14b` answer in prose and
  silently skip the tool round. Phase 7 should validate tool support rather than
  assume it, because a non-tool model degrades to "I can't access your data".
- **`npm create tauri-app` output is kept**, including its `tsconfig.node.json`
  split and its `src-tauri/.gitignore`. Versions at scaffold time: Tauri 2.12,
  React 19.3, Vite 8, TypeScript 6, Rust edition 2024.

### Known gaps left from the source, on purpose

Nothing yet. The source bugs listed in `docs/ANALYSIS.md` section 1 (dead
`/charts/portfolio-evolution` template, JS `formatCurrency` divergence, dead
templates, stub performance dashboard) have not been ported, because the
screens that hit them do not exist yet.

## Phase 1 (foundation)

- **Flash messages become a toast queue.** The web app flashes a message and
  redirects, so it survives exactly one request. There is no request boundary
  here, so `ToastProvider` keeps the same alert markup and the source's 5 s
  auto-dismiss. Call sites that used `flash()` now push a toast.
- **The sidebar is the primary navigation.** In the source,
  `components/sidebar.html` is included only by `layouts/main.html`, which no
  live page extends, and its links are `#` anchors. Here it carries the whole
  app: the top navbar became a thin toolbar, the footer is gone, and the sidebar
  collapses (state remembered across launches). Changed in 0.2.0; the rest of
  this log's shell notes describe the current layout.
- **The `theme` setting and the toggle are kept in step.** The source keeps
  `theme` in `DEFAULT_SETTINGS` *and* in localStorage, and only localStorage is
  read (`ThemeManager`). Here localStorage paints the first frame before any
  database call, and once the settings table has loaded a stored `theme` row is
  applied through `applyTheme` (`src/lib/useStoredTheme.ts`), so what you see in
  Settings is what the app uses.
- **`percentage` and the table's `percentage` column differ, as in the source.**
  `filters.py:percentage_filter` multiplies by 100 and appends `%`; the
  `percentage` column type in `table.html` formats the raw value without
  scaling. Both are ported separately rather than unified.
- **Every route is real.** The phase placeholders are gone; `PlaceholderPage` is
  used only by the catch-all 404. Rows live in `docs/PARITY_CHECKLIST.md`.
- **Multi-statement writes go through Rust.** `tauri-plugin-sql` exposes no
  transaction handle, so `run_transaction` opens its own connection and runs the
  batch atomically (see ARCHITECTURE.md). Nothing writes statement-by-statement
  any more.

## Phase 1b (import from FinanceTracker)

- **A real transaction primitive lives in Rust.** `tauri-plugin-sql` executes
  one prepared statement per call on a pool of up to ten connections, so a
  `BEGIN … COMMIT` split across calls can land on different connections, and a
  single string holding several statements only runs the first one (sqlite3
  prepares one statement and discards the tail). Both would have broken
  "all or nothing". `src-tauri/src/commands/db.rs` therefore exposes
  `run_transaction(statements)`, which runs a list inside one sqlx transaction
  with foreign keys enforced. SQL is still generated in TypeScript; Rust only
  executes it. This is the one place where Rust holds a storage concern, and it
  is deliberate.
- **Row ids from the file are preserved, not remapped.** The brief asked for the
  remap logic from `data_export.py`. Preserving ids is simpler and safer here
  because the import only runs on an empty database, so nothing can collide, and
  `asset_tags` / `snapshots` foreign keys stay correct without an id map.
- **The import replaces, it does not merge.** Only an empty database is
  imported into; anything else requires "Reset and import" behind a typed
  confirmation. Same rule as the brief, but stated here because it means the
  wizard is destructive: it resets before writing.
- **v2 carries a `profile` object**, contrary to the brief and to
  `docs/ANALYSIS.md`, which both say v2 has no profile. A real export proves
  otherwise, so profile fields are imported. `docs/IMPORT_FORMAT.md` records the
  verified shape.
- **Four profile fields are dropped:** `job_title`, `username`, `email` and the
  free-text `financial_goals`. There is no account any more, no job-title
  column, and goals are a table rather than a note. All four are listed in the
  import report rather than silently lost.
- **Provider API keys go to the Keychain during the import**, before any SQL
  runs, so a plaintext secret never exists in the database. If the import then
  fails, the Keychain items are deleted again.
- **Category system roles are mapped after the import**, not during it: v2 has
  no `system_role`, and the Résumé view needs it. The step can be skipped and
  reopened later from Categories.
- **Settings are imported verbatim**, including keys this app has no default
  for (`default_chart_type`, `number_format`, `show_tooltips`, `auto_backup`,
  `backup_frequency`, `default_date_range`). They are inert until a screen reads
  them, which is also how the source behaves.
- **The first-run screen exists only in the desktop app.** The source registered
  a user and dropped them on an empty dashboard, so there was no decision point.

## Phase 2 (reference data)

- **Create and edit use modals rather than full pages.** The source has
  dedicated routes for the forms (`/admin/institutions/new`,
  `/admin/categories/<id>/edit`, `/tags/<id>/edit`) because a browser needs a
  URL per form. The desktop app has no such need, so the same fields, validators
  and markup live in a modal owned by the list screen. Field-level errors behave
  identically. Say the word if you would rather have the pages.
- **Deleting a referenced institution or category is refused, deleting a tag is
  allowed.** This matches the source exactly (`delete_institution` and
  `delete_category` check the asset count and flash an error, `tag_delete`
  removes the associations and deletes). The database's `ON DELETE RESTRICT` /
  cascade is the backstop.
- **The quick-add category uses `#6c757d`, not `#007bff`.** The AJAX endpoint in
  `routes/admin.py` calls `Category(name=...)`, so the colour comes from the
  *model* default (`core.py:96`), not from `CategoryForm`, whose default is
  `#007bff`. Both defaults are kept, in `DEFAULT_CATEGORY_COLOR` and
  `QUICK_ADD_CATEGORY_COLOR`.
- **Uniqueness stays case-sensitive.** The source validates with
  `filter_by(name=...)`, an exact match on a case-sensitive column, so "ubs" and
  "UBS" are both allowed. Kept for parity even though a case-insensitive check
  would be friendlier.
- **Colour validation differs per entity, as in the source.** Categories require
  exactly six hex digits (`^#[0-9A-Fa-f]{6}$`); tags accept three or six
  (`^#(?:[0-9a-fA-F]{3}){1,2}$`).

## Phase 3 (assets)

- **Product suggestions by institution are not built, because they do not
  exist.** The brief asks for "dependent product suggestions by institution
  (`/assets/api/products/<inst>`)". No such route exists in `routes/*.py`, and
  `static/js/admin.js` only references a `product_id` select that the form does
  not have: the `Product` entity was removed on purpose (`AGENTS.md`), and
  `product_name` is a free-text field. Nothing was ported, nothing invented.
- **Three display bugs in `detail.html` are fixed, not ported.**
  1. *Cost/Charges* is a percentage on the form but was rendered through the
     `currency` filter, so 0.85 % printed as a money amount. It now prints
     `0.85%`.
  2. *Interest Rate* went through the `percentage` filter, which multiplies by
     100, so a stored 1.25 printed as `125.00%`. It now prints `1.25%`
     (`formatPercentValue`, distinct from the scaling `formatPercentage`).
  3. The snapshot *% Change* column computed `(Δ / previous) * 100` and then
     applied the same scaling filter, so +5 % showed as `+500.0%`. The fraction
     is now handed to the filter once.
- **Filtering, sorting and pagination run in memory, not in SQL.** The source
  builds a SQL query; the desktop dataset is a few hundred rows at most, so the
  whole set is loaded and `filterAssets` / `paginate` are pure functions. That
  keeps them unit-testable and independent of the database. Semantics are the
  source's: `ilike` over institution, product, category and code/NIN; exact
  match on currency, category *name*, institution *name* and tag *name*.
- **The pager marks gaps with an ellipsis.** `PaginationHelper.iter_pages` only
  yields page numbers, so the source's pager prints `1 2 8 9 10 11 12 19 20`
  with nothing showing the jumps, although its template already has an
  ellipsis branch (`{% else %}…`) that never fires. `assetPageNumbers` returns
  `null` for a gap so it does. The window itself is identical (verified against
  the real helper).
- **Currency conversion was pulled forward from Phase 5.** The list's combined
  "Total Value" tile needs it. `domain/currency.ts` ports `convert_amount` (direct
  or inverse, otherwise an error, which hides the tile) and
  `CurrencyConverter` (direct, then a hop through EUR/USD/CHF, then the
  unconverted amount with a recorded warning). The dashboards still arrive in
  Phase 5; the golden parity tests for them do too.
- **The "Total Assets" tile shows the real snapshot range for the filtered
  assets.** Same fix as Phase 0, now applied to the filtered set.
- **Changing an asset's currency asks through a modal**, not `window.confirm`.
  The source warns that existing snapshots are not converted; a native
  `confirm()` is unreliable in a Tauri webview, and a modal matches every other
  confirmation here.
- **Deleting from the detail page uses the same modal as the list.** The source
  uses a bare `confirm()` there and a bootstrap modal on the list.
- **Asset writes are atomic now.** Create, update and delete go through
  `run_transaction`. Creation allocates the id inside the transaction
  (`nextId` / `justInserted` against `sqlite_sequence`), so a failing first
  snapshot rolls back the asset and its tags instead of leaving them behind.
  Delete removes tag links and snapshots explicitly, because the plugin's
  pooled connections do not all enforce `ON DELETE CASCADE`.
- **The Value Evolution chart follows the theme.** The source builds it inline
  with fixed teal colours and ignores dark mode; this one uses the shared
  `ChartUtils` port like every other chart.
- **The first snapshot defaults to the local calendar date.** The form's default
  is `date.today` on the server; the desktop app has no server clock, so the
  user's own date is the right one.
- **"Load sample data" moved to the Data screen and only exists in development
  builds**, as `docs/ANALYSIS.md` intended (a dev command for screenshots). It
  no longer appears on the empty asset list.
## Phase 4: snapshots

- **Snapshot links on the asset detail page are live.** The Phase 3 placeholder
  note no longer applies; the history table now has a per-row delete (modal).
- **List pager uses Flask-SQLAlchemy `iter_pages`** (page-2 to page+4 window), as
  the source does. An out-of-range `page` is clamped; the source returns an
  empty page.
- **Edit validates the duplicate date up front**, excluding the snapshot itself.
  The source surfaces a raw IntegrityError naming a misleading date.
- **Bulk edit is all-or-nothing.** The source commits the valid rows and flashes
  the rest.
- **Bulk entry flags a zero or negative amount on its row.** The source silently
  drops it. The 1e9 cap applies to bulk too.
- **"Apply same amount" and "Copy previous" are wired.** The source has the
  `/bulk/apply-amount` and `/bulk/copy-previous` endpoints but its template never
  calls them; the brief requires them. Copy previous uses the latest snapshot
  strictly before the chosen date.
- **Amount 0 reads "Amount must be greater than 0"**, not the source's "Please
  enter an amount" (a falsy-Decimal quirk of `DataRequired`).
- **"Save & Back to Asset" shows whenever an asset is selected.**
- **CSV tie order is defined**: date descending, then id ascending. The source
  leaves it to the database. Output is byte-identical to Python's `csv.writer`
  on the real backup (`tests/oracle/snapshots_csv.py`).
- **Sort by asset follows PostgreSQL NULL ordering** on the custom-name column
  (last ascending, first descending), with a deterministic tie-break.
- **Detail "View All Snapshots" filters the list by the asset's product name.**
  The source passes `asset_id`, which the list route ignores, so it shows every
  snapshot.
- **Export CSV opens a native save dialog** instead of a browser download.

## Resolved: the theme that stayed dark

Recorded in Phase 0 and closed in Phase 6. The stored `theme` setting is now
authoritative once the database has loaded (`src/lib/useStoredTheme.ts`), so a
stale localStorage value can no longer override it. If the system appearance and
the app disagree, the `theme` row in Settings is the reason, and it is visible
and changeable there.

## Phase 5: dashboards

- **Portfolio evolution carries assets in from before the cut-off.** The source
  reads only snapshots on or after the range cut-off, so an asset last updated
  before it disappears from the whole series and short ranges start absurdly
  low. On the real data its 1Y chart reads +736.9%. The endpoint's own docstring
  says it carries each asset's latest snapshot forward, so each asset now starts
  from its last value before the cut-off. `portfolioEvolution(..., { carryIn:
  false })` reproduces the source exactly and is what the golden test uses, so
  parity is proven and the fix is explicit. `ALL` is unaffected.
- **Unconverted amounts are badged.** With no direct, inverse or EUR/USD/CHF
  bridge rate the source silently uses the amount as is. Same fallback here,
  plus an "unconverted" badge naming the pair.
- **Currencies tile shows the real list.** The source template falls back to a
  hard-coded "EUR, CHF, USD" because the service never supplies the list.
- **KPI count-up runs.** The source's script targets `.stat-number span`, which
  the template never renders, so it never animated. It runs here only when the
  `enable_animations` setting is on and the OS does not ask for reduced motion.
- **Asset Breakdown page draws its chart.** The source page is an empty shell
  (its script is a comment).
- **Performance Analytics is an honest stub.** The source charts three
  hard-coded numbers unrelated to your data. The stub points to the Résumé.
- **Asset Evolution titles the real currency.** The source says "in {base
  currency}" but the per-asset endpoint returns the asset's own currency.
- **Category evolution is not ported.** Nothing in the UI uses
  `/api/charts/category-evolution/<id>`, and it sums native amounts across
  currencies without converting.
- **Distribution slice order is by first appearance**, not the SQL's arbitrary
  order; the legend sorts by amount or name. Colours cycle through the theme
  palette instead of the source's five fixed ones.
- **The Résumé is `/resume`** (the source serves `/dashboard/resume`, kept as
  an alias). "Invested capital" is still the portfolio value at the start
  date, not money paid in, so deposits during the period count as performance.
  This is the source's definition, kept on purpose.

## Phase 6: settings and data

- **No API key section.** The source's Settings page generates and revokes a
  REST API key; this build has no REST API, so the section and its routes are
  gone. `X-API-Key` auth has no equivalent.
- **Backups are version 3 and carry no keys.** The source writes `api_key` in
  plaintext into the export. This app's export sets `api_key: null` and omits
  `keychain_ref`, so a backup can be shared without leaking a provider key.
- **Category roles go into the export.** v2 has no `system_role`, which is why
  importing a web backup asks the user to map roles. This export includes it, so
  a round-trip keeps the Résumé and Cash/Emergency figures intact.
- **Backup entity selection covers memories and goals too**, which the source's
  exporter does not have.
- **Exchange-rate edit keeps full precision.** The source's `DecimalField`
  round-trips through 6 decimal places, so saving the form unchanged silently
  shortens `1.0730765` to `1.073077`. The grid here shows the stored text.
- **Unset rates are badged.** The source creates CHF<->USD placeholder rows at
  rate 0 and shows `0`; here they read `unset`, and `RateTable` already treats a
  non-positive rate as "no rate".
- **Settings import/export stay JSON**, as in the source, but the file is written
  through a native save dialog instead of `?format=json` downloads.
- **The `theme` setting wins over the toggle.** The theme toggle still writes
  localStorage so the first paint is right; once the database is read, a stored
  `theme` row is applied to both.

## Phase 7: AI

- **AI is off until you switch it on.** `ai_enabled` is a new setting (default
  false) on the Settings page. Chat, the prompt rail and memory extraction stay
  disabled until then, because using them sends your questions and portfolio
  facts to a provider. The source has no such switch.
- **Gemini uses its OpenAI-compatible surface.** The app speaks the OpenAI
  schema everywhere, so `gemini` providers are pointed at
  `.../v1beta/openai` and migration 3 rewrites imported rows.
- **Gemini's thought signature is carried, not dropped.** The brief said not to
  port litellm's special case unless a test proved it necessary. It is: Gemini 3
  returns `extra_content.google.thought_signature` inside each streamed tool
  call and answers `400 INVALID_ARGUMENT` ("Function call is missing a
  thought_signature") when the assistant turn is echoed without it. Rust keeps
  the value, the loop puts it back on the tool-call turn, and it is persisted
  with the message so a replayed history still has it.
  `tests/live.rs::gemini_keeps_the_thought_signature_across_a_tool_round`
  asserts both the failure without it and the success with it.
- **Streamed tool calls are keyed by id when there is no index.** OpenAI puts an
  `index` on every tool-call fragment; Gemini does not, and sends one delta per
  call with only an `id`. Keying on index alone merged all calls into the first
  slot, producing names like `get_allocationget_allocationlist_assets`, which the
  tool executor rejected and the provider then refused on the next request.
  `tests/live.rs::gemini_streams_two_tool_calls_kept_apart` covers it.
- **An absent `extra_content` is omitted, never sent as `null`.** Serde
  serialized the option as `null`, the webview forwarded it, and Gemini answers
  `400 Value is not a struct: null`. Rust skips the field when absent, the loop
  treats `null` as absent, and replayed rows have a stored `null` stripped.
- **Corrupt tool rows are dropped from the history window.** Rows written by
  those merged calls carry names no longer in `tools.json`; replaying them makes
  every later turn fail, so `buildHistoryMessages` drops them (and their
  orphaned results) instead of sending an invalid turn.
- **Reasoning models get `max_tokens` 4096**, computed in Rust from the model
  name (`qwen3*`, `deepseek-r1`, `deepseek-v3`), as `llm_client.py` does.
- **No `ChatJob` table.** Streaming is a Tauri channel and cancellation an
  atomic flag, so there is nothing to poll and no job rows.
- **Memory extraction stages cards, it does not save.** Each proposal becomes a
  `pending_actions` row, exactly like a proposed snapshot.
- **"No write without confirmation" is structural.** `propose_snapshot` and
  `remember_fact` only insert pending actions; `confirmAction` is the sole path
  to `snapshots` / `user_memories`. The service tests assert the negative.
- **Tool look-back windows use real days.** The source computes
  `today.replace(day=max(1, today.day - days))`, which shifts the day inside the
  current month only: on the 31st, "90 days of history" means "since the 1st".
  `get_asset_history` and the 30/90-day change in `get_asset_details` subtract
  real days instead.
- **The spinner names the work.** While a tool runs, the status line reads
  "Looking up your portfolio…" and so on (`toolStatusLabel`), rather than a bare
  "Generating…" for ten seconds. The transcript itself stays free of tool chatter.
- **Streaming is a choice.** `chat_streaming` (default on) decides whether the
  answer is written out as it arrives or held back behind a spinner and shown
  whole. Either way a tool round clears the preamble text, so the final answer
  no longer accumulates on top of "let me look that up…".
- **The asset list has a per-row "record a snapshot" shortcut** (camera icon, and
  an entry in the narrow-width actions menu). It links to
  `/snapshots/new?asset_id=…`, which the snapshot form already preselects.
- **Toasts are a fixed stack under the toolbar.** They used to render in page
  flow at the bottom, so "Settings saved" sat on the form's own buttons and
  scrolled away with it.
- **Chat is a fixed frame.** The transcript scrolls inside the window; the page
  no longer grows with the answer. Stop cancels the round actually in flight
  (the loop suffixes request ids per round, so cancelling the base id matched
  nothing in Rust). Tables use `remark-gfm` and are styled for a bubble.
- **No `window.confirm` / `alert`.** Tauri routes them through the dialog plugin,
  whose permission this app does not grant, so they reject silently and the
  delete never runs. Every confirmation is an in-app modal
  (`DeleteConfirmModal`), and `src/ui/no-browser-confirm.test.ts` enforces it.
- **Markdown is sanitised.** The source trusted its own converter; here
  `react-markdown` + `rehype-sanitize` strip anything executable.
- **The profile has no account fields.** Email, phone and password are gone;
  `job_title` and `financial_goals` have no column in this schema, so they are
  dropped (see IMPORT_FORMAT.md).
- **Per-provider model choice is remembered** in localStorage, so switching back
  to a provider restores the model you last used with it.

## Phase 8: packaging

- **The shell is a sidebar app, not a web page.** Navigation moved from the top
  navbar into a collapsible sidebar, the footer is gone, the window is full
  height and only the content scrolls. The window uses an overlay title bar, so
  the toolbar and the sidebar top strip are drag regions
  (`core:window:allow-start-dragging`). Bootstrap's `col-xl-*` breakpoints were
  replaced with CSS grids (`auto-fit`) because they snapped at exactly 1200px
  inside a resizable window, and the charts observe their container with a
  `ResizeObserver` so a card changing width does not leave a stale canvas.
- **Data lives under Settings only.** It was reachable from the sidebar *and*
  from the settings nav; the sidebar entry is gone, the page renders inside the
  settings shell, and `/data` redirects to `/settings/data` so old links work.
- **The icon is drawn from code.** `scripts/make-icon.py` renders a 1024 px
  master with signed-distance shapes (no image library, no binary blob to
  review), and `npx tauri icon` derives every size plus `.icns`/`.ico`. The
  Android/iOS/Windows Store outputs that command also writes were removed: this
  is a macOS-only app.
- **Ad-hoc signing for now.** There is no Developer ID certificate on this
  machine, so the bundle is signed with `--sign -` after the build. The config
  already sets the hardened runtime and the entitlements a signed build needs;
  docs/RELEASE.md has the steps for the real certificate.
- **The updater checks, it does not install.** `tauri-plugin-updater` is wired
  to a GitHub Releases `latest.json`, and the Data page has a "Check for
  updates" card. Downloading and restarting the app silently is not offered.
- **The DMG is repacked after signing.** `tauri build` writes the disk image
  before the ad-hoc signature is applied by hand, and the signature inside that
  image fails `codesign --verify --strict`. `docs/RELEASE.md` has the repack
  recipe; a Developer ID build signs before bundling and needs none.
- **The release workflow has never run.** The repository has no remote. It is
  written to be read, not assumed working (docs/RELEASE.md).
- **An About modal sits in the "You" menu** next to the macOS default About
  panel; it shows the bundle version and the database path.
- **Update artifacts are opt-in** through `src-tauri/tauri.release.conf.json`,
  so a plain `npm run tauri build` works without the updater private key.

## Security hardening (after Phase 4)

- **File dialogs live in Rust.** The brief lists `tauri-plugin-fs`; it is removed. The webview never passes a path, so a compromised webview cannot read or write arbitrary files. The dialog plugin stays, Rust-side only.
