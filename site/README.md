# The website and the user guide

Astro + Starlight. The landing page is `src/pages/index.astro`; the guide is markdown
under `src/content/docs/`, with the sidebar configured in `astro.config.mjs`.

```sh
cd site
npm install
npm run dev      # http://localhost:4321/FinanceTrackerApp/
npm run build    # static output in site/dist
npm run check:links
npm run preview
```

From the repository root, the same three are `npm run site:dev`, `npm run site:build` and
`npm run site:install`.

## Where it is published

GitHub Pages, built by `.github/workflows/site.yml` on every push to `main` that touches
`site/`. Default URL:

```
https://juliendf.github.io/FinanceTrackerApp/
```

That is a project site, so everything is served under `/FinanceTrackerApp`. The guide
writes internal links as root-absolute (`/data/assets/`) and `base-links.mjs` prefixes
them with the base path at build time. Do not hardcode the prefix in markdown.

`base-links.mjs` is a **Sätteri HAST plugin** (Astro 7's default Markdown processor), not
a rehype transformer: it exports a visitor object and mutates through `ctx.setProperty`.
Returning a `(tree) => {}` function from `hastPlugins` compiles without error and silently
never runs — every guide link then ships without the prefix and 404s on Pages.
`npm run check:links` is the guard for exactly that, and it runs in the deploy workflow.

## A custom domain

1. Add `site/public/CNAME` containing the domain, one line, no scheme.
2. Set the repository variables:

   ```sh
   gh variable set SITE_URL  --body "https://financetracker.example"
   gh variable set SITE_BASE --body "/"
   ```

3. Point a `CNAME` DNS record at `juliendf.github.io`, then enable **Enforce HTTPS** in
   Settings → Pages.

`SITE_BASE` empty or `/` means the site is served from the domain root; the base-path
rewrite then becomes a no-op.

## Screenshots

`public/shots/` holds the images the guide and the landing page use. They come from the
**demo build** with sample data, never from the real database, and they are always captured
in the app's **dark theme** — the site is dark, and a light window on it reads as a bright
rectangle pasted over the page.

```sh
npm run demo:local      # from the repository root
```

Load **Settings → Data & Backup → Load sample data**, then capture each screen at a
1280×860 window. On a Retina display `screencapture -l <window-id>` writes 2560×1720;
downsample so every file is the same size:

```sh
screencapture -x -o -l "$WINDOW_ID" /tmp/shot.png
sips --resampleWidth 1280 /tmp/shot.png --out site/public/shots/dashboard.png
```

**Set the theme before capturing, in two places.** The in-app toggle only writes
`localStorage`; `useStoredTheme` then applies the `theme` row from the database as soon as
settings load, so the database wins and a toggle can look like it did nothing. With the app
closed:

```sh
DB=~/Library/Application\ Support/app.financetracker.demo/financetracker.db
sqlite3 "$DB" "update settings set value='dark' where key='theme'"

LS=~/Library/WebKit/app.financetracker.demo/WebsiteData/Default/*/*/LocalStorage/localstorage.sqlite3
sqlite3 $LS "update ItemTable set value = X'6400610072006B00' where key='theme'"  # UTF-16LE "dark"
```

The first-run screenshot needs an empty database. Back the demo file up first, then delete
the rows and restore it afterwards:

```sh
cp "$DB" /tmp/demo-backup.db
sqlite3 "$DB" "delete from asset_tags; delete from asset_holdings; delete from snapshots;
               delete from assets; delete from tags; delete from categories; delete from institutions;"
# launch, capture the welcome screen, quit
cp /tmp/demo-backup.db "$DB"
```

`site/scripts/enrich-demo.py` fills a demo database with a year of snapshots, holdings,
goals and memories so the screenshots have something to show. It only ever touches
`app.financetracker.demo`:

```sh
pkill -f "FinanceTracker Demo"
python3 site/scripts/enrich-demo.py \
  ~/Library/Application\ Support/app.financetracker.demo/financetracker.db
```

## Adding a page

1. Create `src/content/docs/<section>/<page>.md` (or `.mdx` when it needs a component).
2. Give it `title` and `description` frontmatter.
3. Add it to the `sidebar` array in `astro.config.mjs`.
4. For a screenshot, use `.mdx` and `<Shot name="assets" alt="…" />`; the component
   resolves `public/shots/<name>.png` against the base path.

Two guards in `src/docs.test.ts` at the repository root keep the guide honest: every page
needs a title, every internal link must point at a page that exists, and every screenshot
must exist in `public/shots/`.

## Version

The landing page reads the version from the root `package.json` at build time. The release
workflow for the site also passes `APP_VERSION`, which overrides it. There is nothing to
keep in sync by hand.
