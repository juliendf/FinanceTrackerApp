# Changelog

Every version below is a local build, ad-hoc signed, never notarised and never
published. Version numbers are bumped in `package.json`, `src-tauri/Cargo.toml`
and `src-tauri/tauri.conf.json` together.

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
