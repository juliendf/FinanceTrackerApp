# Changelog

Every version below is a local build, ad-hoc signed, never notarised and never
published. Version numbers are bumped in `package.json`, `src-tauri/Cargo.toml`
and `src-tauri/tauri.conf.json` together.

## Unreleased

- Streaming: multi-byte characters are no longer corrupted when a chunk boundary
  falls inside them (`é`, `’`, `€`, emoji showed as `��`). The parser buffers
  bytes and decodes whole lines; a final line without a newline is no longer
  dropped.

- Security: the webview can no longer read a provider key. Chat and the provider
  checks take a provider id; Rust reads the endpoint from SQLite and the key from
  the Keychain. `secret_get` is removed, and key writes are limited to
  `provider:<id>` accounts.

- Security: the webview can no longer run arbitrary SQL. `sql:allow-execute` is
  removed and every write goes through a guarded Rust command (`execute_write`
  for one statement with bound parameters, `run_transaction` for batches).

- Profile: **Date of Birth**, with the age derived from it (not stored, so it
  never goes stale). The assistant's profile section now starts with `age: N`.
- Profile: fixed a save that silently kept the old values — the form reseeded
  itself on every background refetch (React Query refetches on window focus), so
  text typed just before a refocus was replaced by the stored row.

- Toolbar: no navigation at all — it is the app name, the theme toggle and the
  window drag strip. Profile and Settings both live in the sidebar (under "You");
  About moved to the sidebar footer, on the version line.
- Profile: Financial goals now come before "What I know about you"; the memories
  panel explains that entries come from chat (after confirming a card) or by
  hand, shows each entry's source, and no longer asks for a key — it is derived
  from the text.
- Profile: the Timezone field is gone. It was never read: dates come from the
  Mac's clock, so the control promised something it did not do.

- The account menu is Profile + About only. Settings was duplicated there and in
  the sidebar; the sidebar wins.

- Profile: **Job Title** and **Other Aspirations** are back (migration 5). A v2
  backup carries both; the first schema dropped them, so imports lost them and
  the assistant never saw them. Both now feed the profile section of its prompt.

- The AI opt-in and the streaming switch moved from General settings to **LLM
  Providers**, above the provider list: they govern where chat sends data, so
  they belong with the endpoints.

## 0.3.0

- Provider form: the model is chosen from a list the endpoint advertises. **Load
  models** fills a checkbox group; only the enabled models appear in the chat's
  model picker, and one of them is the provider's default. The list is stored per
  provider (`provider_models`) and travels in backups.
- The form's actions stick to the bottom of the window, so Save is reachable
  without resizing.
- The provider type is gone: Gemini is detected from the URL, since the only
  difference was its OpenAI-compatible path.

## 0.2.8

- Chat session list rebuilt: a "Sessions" header with a new-session button, a
  search field, "This week" / "Earlier" groups, and a right-aligned timestamp
  (hour today, weekday this week, date beyond). The active session gets a left
  accent bar; the delete control appears on hover only.

## 0.2.7

- Sidebar order: Dashboard, Assets, Snapshots, Résumé.

## 0.2.6

- Asset list: a per-row camera icon records a snapshot for that asset
  (`/snapshots/new?asset_id=…`, preselected).

## 0.2.5

- Toasts moved from a banner in the page flow at the bottom to a fixed stack under
  the toolbar; they no longer cover the controls you just used.

## 0.2.4

- The chat spinner names the work ("Looking up your portfolio…") instead of
  saying "Generating…" for ten seconds.

## 0.2.3

- New setting `chat_streaming`: on (default) streams token by token; off shows a
  spinner and the whole reply at once.
- A tool round clears the preamble text, so the final answer no longer
  accumulates on top of "let me look that up…".

## 0.2.2

- Stop cancels the round actually in flight (the loop suffixes request ids per
  round, so the base id matched nothing in Rust).
- The chat page fills the window and only the transcript scrolls.
- Markdown tables render (`remark-gfm`) and are styled for a bubble.
- Conversation titles are left-aligned with a proper ellipsis.

## 0.2.1

- Data lives under Settings only: sidebar entry removed, page rendered inside the
  settings shell, `/data` redirects to `/settings/data`.
- KPI tiles use deterministic columns; no orphan tile at narrow widths.

## 0.2.0

- Desktop shell: sidebar navigation, overlay title bar with drag regions, no
  footer, full-height layout with a scrolling content area.
- Bootstrap `col-xl-*` breakpoints replaced with CSS grids; the dashboard stacks
  its two cards below a 1400 px window; the donut stacks its legend by width.
- Charts observe their container with a `ResizeObserver`.

## 0.1.5

- Chat shows no "thinking" placeholder and no tool chatter; the transcript is
  refetched before the streaming bubbles are dropped, so nothing flickers.
- Sending from a cold page falls back to the default provider instead of
  refusing.

## 0.1.4

- `window.confirm` replaced with in-app modals. Tauri routes it through the
  dialog plugin, whose permission this app does not grant, so deletes silently
  did nothing.

## 0.1.3

- Never send `extra_content: null` to Gemini; strip stored nulls from replayed
  history. (`400 Value is not a struct: null`.)

## 0.1.2

- Keep Gemini's streamed tool calls apart when it sends no `index`; drop corrupt
  tool rows from the history window. (`Unknown tool` names, then `400`.)

## 0.1.1

- Keep Gemini's `thought_signature` on tool calls; without it the next request is
  refused with `400 INVALID_ARGUMENT`.
- Data page no longer crashes on the asset count (its query key collided with the
  asset list); added an app-wide error boundary.

## 0.1.0

- Phase 8: icon set, About, signing setup, updater wiring, release workflow.
- Phases 0–7: spike, schema and shell, backup importer, reference data, assets,
  snapshots, dashboards, settings and data, AI assistant.
