# Deviations from FinanceTracker

Every deliberate behavioural difference between the desktop app and the Flask
source. Newest phase last. Anything not listed here is intended to match.

Format: **what** — **why** — **revisit in**.

## Phase 0 (spike)

### Scope omissions, by design

- **No filters on the assets list.** The brief limits the spike to "Asset list +
  create form … minus the filters". Filters land in Phase 3. — revisit Phase 3.
- **No Tags column in the assets table.** There is no `tags` table yet
  (`0001_init.sql` covers institutions, categories, assets, snapshots only), so
  the column would always be empty. — revisit Phase 2.
- **No cross-currency conversion in the portfolio chart.** `exchange_rates`
  does not exist yet, so the series sums raw minor units and the page says so
  ("totals sum raw amounts, no FX conversion yet"). The source converts via
  `utils/currency.py`. — revisit Phase 5.
- **Six of the seven LLM tools are missing.** Only `get_portfolio_summary` is
  wired up, which is what the spike needs to prove the tool round trip. —
  revisit Phase 7.
- **No chat persistence.** No conversations, messages or pending actions
  tables; the spike transcript is in memory. — revisit Phase 7.
- **Sample data instead of a `demo_data.py` port.** `src/dev/sampleData.ts`
  inserts 2 institutions, 2 categories, 3 assets and 36 snapshots. It is
  deterministic (seeded LCG) like the source, but it is not the demo user's
  dataset, and it has no reset command yet. — revisit Phase 1.

### Behavioural differences

- **Asset creation is not transactional.** `tauri-plugin-sql` exposes no
  transaction handle, so `createAsset()` inserts the asset, then the initial
  snapshot, and deletes the asset again if the snapshot insert fails. The source
  commits both or neither. A half-written asset is possible only if the process
  dies between the two statements. — revisit Phase 1 (single connection or an
  explicit transaction helper).
- **`PRAGMA foreign_keys` is per connection.** The plugin pools connections, so
  the pragma set in `db/client.ts` applies to one connection in the pool.
  `journal_mode=WAL` is persistent in the file header, so it does stick.
  Cascading deletes therefore depend on the connection that runs the DELETE. —
  revisit Phase 1.
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
- **The sidebar is built but not the default layout.** In the source,
  `components/sidebar.html` is included only by `layouts/main.html`, which no
  live page extends, and its links are `#` anchors. The component is ported
  (with collapse persisted in localStorage) and exposed as
  `AppShellWithSidebar`, but screens use the navbar-only shell that the app
  actually renders.
- **The `theme` setting is stored but does not drive the UI.** The source keeps
  `theme` in `DEFAULT_SETTINGS` *and* in localStorage, and only localStorage is
  read (`ThemeManager`). We seed the setting for parity and keep the UI on
  localStorage, so the two cannot disagree at runtime.
- **`percentage` and the table's `percentage` column differ, as in the source.**
  `filters.py:percentage_filter` multiplies by 100 and appends `%`; the
  `percentage` column type in `table.html` formats the raw value without
  scaling. Both are ported separately rather than unified.
- **Screens that are not built yet render a placeholder.** Every navbar route
  exists from Phase 1 so navigation never dead-ends; `PlaceholderPage` names the
  phase that replaces it. Rows live in `docs/PARITY_CHECKLIST.md`.
- **No real transaction boundary for multi-statement writes yet.** Same caveat
  as Phase 0: `tauri-plugin-sql` exposes no transaction handle, so the first-run
  seed and `setAssetTags` issue statements one by one. The seed is idempotent,
  which makes a partial run self-healing on the next launch. — revisit Phase 1b
  (the importer needs a hard guarantee).

## Open issues (observed, not yet explained)

These are not intentional differences. They are recorded so Phase 1 picks them
up rather than rediscovering them.

- **A `theme` value of `dark` appeared in the webview's localStorage during the
  spike, and the app then stayed dark while macOS was light.** Only
  `cycleTheme()` writes a literal `dark`, and no click was performed, so the
  writer is unidentified. Clearing the localStorage row and relaunching restored
  correct auto behaviour. Symptoms: app ignores the system appearance until the
  user cycles the toggle. — investigate in Phase 1 with devtools attached.

