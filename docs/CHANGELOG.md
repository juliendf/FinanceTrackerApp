# Changelog

Every build is ad-hoc signed and not notarised. Version numbers are bumped in
`package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`
together.

## Unreleased

**Removed**
- **The snapshot CSV export is gone.** The Snapshots screen offered a button that
  wrote the currently filtered rows to a spreadsheet. It was a one-way format that
  could not be imported back, so it duplicated the backup's reason to exist and
  added a second format to keep correct. The JSON backup in **Settings → Data &
  Backup** is now the only way out of the app, and the only one that can come back.

## 0.7.1

0.7.0 was never released, so this entry covers both what it added and the fixes
from a full review of the codebase.

**Holdings**
- **An asset lists what it is made of.** Add lines of ISIN, quantity and an
  optional name and price, and the asset page reads as a composition: each line's
  share of the value, not just the total. The list shows the ISINs.
- A line's share comes from the snapshot when there is one, so the composition
  agrees with the asset's value instead of drifting from it.
- Switching an asset to a category that cannot hold instruments clears the lines
  and says so, once.

**Backups**
- **Backups carry the chat history**, and a backup from a newer version is refused
  with a message rather than half-imported.
- **Restoring asks before data leaves.** Every remote endpoint a backup names is
  confirmed once, natively, before anything is written; declining restores
  nothing. Loopback endpoints such as Ollama are not asked.
- The restore runs under its own SQLite authorizer, so a crafted backup cannot
  touch the migration bookkeeping or any table outside the app's data.

**Amounts**
- Amounts you type are limited to 10,000,000 in either direction and to two
  decimal places. A larger or more precise amount is refused with a message
  naming the field, not rounded.
- An amount too large to store exactly is refused instead of silently losing
  cents.
- A holding with a very small quantity (below 0.0000001) saves: quantities and
  prices are stored in plain digits, never exponent notation.

**Assistant**
- **Imported text is data.** Notes, descriptions, labels and saved memories reach
  the model inside `<data>` markers, and it is told that such text is not an
  instruction. A sentence hidden in a note no longer reads as a rule.
- **Remembered facts are bounded:** 200 characters for the label, 500 for the
  text, and one fact per memory. Memory extraction keeps the same limits, so the
  prompt every chat carries stays a known size.
- **Provider endpoints must use https** unless they are on this machine. A remote
  `http://` endpoint is refused, so a key is never sent in cleartext. An existing
  provider on a remote `http://` URL must be edited to `https://` before its key
  is used again.

**Sessions and layout**
- Renaming, pinning or deleting a session reports a failure and leaves the list
  as it was, instead of looking saved.
- The performance screen owns the chart, and the update check lives in General
  settings.
- Long messages wrap inside a toast, and row actions stay reachable on a wide
  table.

## 0.6.1

- **Fixed:** a question broad enough to need several tool calls could end with
  *"I stopped after 5 tool rounds without a final answer"* instead of an answer.
  When the round cap is reached the assistant now answers from what the tools
  already returned. Reported with a local model on the portfolio review.

## 0.6.0

The biggest release so far: the assistant gained editing, summaries, exports and
exact arithmetic, the summary screen now speaks English, and exchange rates can
come from the European Central Bank.

**Chat**
- **Edit a sent message** and the answer is regenerated from there. Everything
  after it is discarded, and the editor says so before you save.
- **Answers keep arriving when you leave the page.** When one lands while you are
  elsewhere, a notice appears with a link back to the conversation.
- **Pin a conversation** to keep it at the top of the session list.
- **Summarise** a long conversation, and keep the summary in it.
- **Export** a conversation as Markdown.
- **Standing instructions** (Settings → LLM Providers): text added to every
  conversation, after your profile and before what the assistant remembers.
- Two more suggested questions: **Retirement plan** and **Succession**.
- The assistant declines questions unrelated to your finances, in one line.
- **It no longer does arithmetic itself.** Percentages, projections, runway and
  goal gaps go through a calculator that returns exact figures.
- Runway uses a defined liquid figure — cash and the emergency fund, not the
  whole portfolio — and says so when nothing is classified rather than reporting
  zero.
- The session list shows elapsed time (`now`, `3h`, `Yesterday`) instead of a
  clock time that read as a duration.

**Lists and assets**
- **Items per page** from Settings finally applies to the asset and snapshot lists.
- **Filters apply as you change them**; the Search button is gone.
- The **asset page leads with the value, then the trend and the history**; the
  reference details moved to a footnote.
- The asset list says when a category in use has no system role, because three
  figures read zero until it does.

**Exchange rates**
- **Optional:** keep rates current from the European Central Bank. Off by default;
  when on, one request a day at startup. `SECURITY.md` lists the endpoint.
- Rates show the day they were published, and a rate you typed by hand is only
  replaced when you ask for it.

**Profile**
- Marital status, matrimonial regime and whether you have a will — what
  succession advice needs and the portfolio cannot imply.

**Language**
- The summary screen and the system roles are in English. "Résumé" is now
  "Summary"; the route is unchanged.

**For existing installs**
- Two migrations run on first launch (`0009`, `0010`). Both are additive, but a
  build older than this one will refuse to start against the migrated database.
- The three profile fields are optional and simply absent from older backups.

**Fixed**
- A stored timestamp showed as "Invalid date" in the exchange-rate history.
- Repeating the same message no longer stacks identical toasts.

## 0.5.4

- **Fixed:** an update could fail with `Download request failed with status: 403
  Forbidden`. The manifest pointed at GitHub's API asset URLs, limited to 60
  anonymous requests per hour; both manifests now point at the release's own
  download URLs.

## 0.5.3

- **Fixed:** the portfolio chart on a short range (1W, 1M) showed a single dot
  and no percent change when the range held one snapshot. The line now opens on
  the cut-off date with the portfolio value carried in from the previous
  snapshots, and runs flat to today when the range holds no snapshot at all.

## 0.5.2

- Every release now publishes the demo build and its own update feed
  (`latest-demo.json`), so the demo updates itself from **Check for updates**
  instead of being rebuilt by hand.

## 0.5.1

- Toasts are opaque and sit at the bottom right: the theme tints are
  translucent, so a toast over content was unreadable and covered the page
  header's actions.
- The toolbar no longer lets content show through while scrolling.
- The provider form's Save bar is a normal footer instead of a sticky bar that
  floated over the model list; the header's Save stays reachable.

## 0.5.0

- **Identity change.** The bundle identifier is `app.financetracker` instead of
  one carrying a personal name, so the data directory and the Keychain service
  move with it. An existing install must copy its database once and re-enter
  provider keys; until then it starts empty.
- The demo build keeps sharing the Keychain with the normal app on purpose, as
  before: same providers, separate financial data.

## 0.4.3

- Validation release for the in-app updater: an installed 0.4.2 can fetch this
  one from **Check for updates**, watch the progress and restart on its own. No
  other change.

## 0.4.2

- **Check for updates** now installs: it shows the new version, downloads it with
  progress when you ask, verifies the signature, replaces the bundle and restarts
  the app. Before, it only linked to the releases page.

## 0.4.1

- The app and its documentation no longer present it as a port: the About screen
  does not name another project, the import and export cards talk about a
  backup, and the internal porting notes are gone. No behaviour change.

## 0.4.0 — first public release

- "Extract memories" no longer proposes what the app already knows: the request
  carries the profile, the assets, the goals and the existing memories, the prompt
  says not to repeat them, and a deterministic filter drops any proposal that
  matches an existing memory. It is also told which provider model it runs on —
  the one selected in the chat header, or that provider's default.

- **Fixed:** a wide markdown table in a chat answer scrolled the whole conversation
  sideways. Tables now scroll inside their own bubble, columns keep their natural
  width, and long unbroken values wrap. The streaming answer also keeps its line
  breaks instead of arriving as one block.

- **Fixed:** "Extract memories" sent its prompt as a single system message, which
  Gemini answers with `500 no user query found in messages`. The instruction is now
  the system turn and the conversation is the user turn, which every provider
  accepts.

- **Fixed:** a running answer no longer follows you into another conversation.
  Opening or switching to a chat during a generation showed the spinner, the Stop
  button and then the old answer's text in the new chat. The turn now belongs to
  the conversation it started in: switching cancels it, and late chunks are
  ignored.

- The profile gains three optional **planning facts**: monthly living expenses,
  dependants (count, optionally their ages) and employment status. The assistant
  uses them for savings rates, runway, affordability and emergency-buffer sizing,
  and leaves them out of its context when they are unset. Backups carry them.

- The profile gains a **country of tax residence** (ISO code, picked from a list).
  It is given to the assistant as context, so answers about tax-advantaged
  accounts, contribution limits and country-specific products can take the
  jurisdiction into account. Backups carry it as `profile.tax_residence`.

- Chat tools now carry a `*_display` string for every money field (for example
  `1,475.00 CHF`), and the system prompt tells the model to copy those verbatim
  instead of formatting amounts itself — one answer came back as `₫ 578’865` for a
  portfolio in CHF, with a symbol and a digit grouping the app never produces.

- **Fixed:** the profile query did not read `job_title`, `financial_goals` or
  `birth_date`, although the form writes them. The fields therefore looked empty
  after saving, and the next save overwrote them with NULL. The assistant's prompt
  was missing them as well, since it reads the profile through the same query.

- Chat streaming no longer re-renders and re-parses the whole transcript for every
  token: text is batched at ~16 fps, the streaming bubble is plain text, and saved
  messages are memoised. Long conversations stay responsive while an answer streams.

- **Security:** a provider pointed at a new remote endpoint, or a keyless one made
  the default, now asks for confirmation in a native dialog raised by Rust. A
  compromised webview can trigger the prompt but cannot answer it. Local endpoints
  (`localhost`, `127.0.0.1`) never ask.

- **Fixed:** importing a backup is one transaction. It used to be four separate
  commits, so a failure in the last one left the portfolio imported and every
  provider and API key gone. The wipe, the rows, the providers and their keys now
  land together or not at all.

- **Fixed:** the database is created and migrated by Rust before the window opens.
  The SQL plugin used to do it, but only for a database the webview opened, and the
  webview no longer can — a fresh install would have started with no schema at all.
- **Fixed:** creating or editing a provider no longer fails with
  `missing field 'baseUrl'`, and a restored backup accepts its `0`/`1` flags.
- **Fixed:** the first-run seed creates its default provider through the provider
  command, which the authorizer allows, instead of the generic write it refuses.
- **Security:** all SQL now goes through Rust. The SQL plugin's `select` executed
  the whole string on its own pool (`SELECT 1; DROP TABLE snapshots` worked, past
  the guard and the authorizer), so **no `sql:*` permission is granted any more**.
  Reads go through a new `db_select` command on a read-only connection with a
  read-only authorizer; the plugin is kept only to own the migrations.
- **Security:** SQL writes are now enforced by a SQLite authorizer, not only by a
  text filter. The filter was bypassable (a quote inside a double-quoted identifier
  hid a second statement, which sqlx then ran). `PRAGMA`, `ATTACH`, `DETACH`,
  `CREATE`, `DROP`, `ALTER`, `VACUUM` and writes to the provider tables are
  refused by the engine on every write connection.
- **Security:** a stored API key is bound to the endpoint it was entered for, and
  is never sent to a different scheme, host or port. Changing a provider's base URL
  drops its key. ***A key saved before this version must be entered again once.***
- **Security:** provider rows can only be written by the named commands
  (`provider_save`, `provider_delete`, `provider_set_default`, `providers_reset`,
  `import_all`); `secret_set` and `secret_delete` are no longer exposed to the
  webview at all.
- **Security:** the window refuses to navigate anywhere but the app itself, via
  `on_navigation`. Links, including Cmd- and Shift-clicks, open in the default
  browser.
- The first snapshot of a new asset is dated on the local calendar day, not in
  UTC (an asset created before 01:00 in Zurich was dated to the previous day).
- The "a snapshot already exists on that date" warning shows the value on that
  date rather than the asset's latest value, and impossible dates such as
  `2026-02-31` are refused.
- Deleting a provider removes its rows before its Keychain item, so a failed
  delete leaves a provider that can be retried rather than one without a key.
- `createAsset` reads the new asset id inside its own transaction instead of
  from a separate pooled connection.
- Chat tools: a fall to zero is reported as `-100 %` instead of "no change", and a
  window that starts at zero reports no change instead of dividing by it.
- Chat tools: `list_assets` sorts before it caps at 50, so a named asset is no
  longer hidden behind an arbitrary slice.
- Confirming a card claims it atomically: a double click can no longer create the
  same memory or snapshot twice, and the buttons lock while it runs.
- Stop now works while a provider is silent: the request waits on a cancellation
  poll as well as on the network, both before the first byte and mid-stream.
  Previously a model that was loading, or thinking, ignored Stop until the
  timeout.

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
