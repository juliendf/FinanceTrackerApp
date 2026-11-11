/**
 * Post-build link check.
 *
 * Runs over the generated site, not the sources, because the failure this was
 * written for only exists after the build: a Markdown processor plugin that does
 * not run leaves every in-guide link unprefixed, and nothing in the source looks
 * wrong. Astro is happy, the tests are happy, GitHub Pages serves 404s.
 *
 * Checks, in one pass:
 *   - every internal href starts with the configured base path;
 *   - every internal href resolves to a file in dist;
 *   - every #fragment points at an id that exists in the target page.
 *
 * External links are not fetched: that belongs in a scheduled job, not in the
 * build that gates a deploy.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve(process.argv[2] ?? "dist");
const base = (process.env.SITE_BASE ?? "/FinanceTrackerApp").replace(/\/$/, "");

/** Every .html file, relative to dist. */
function pages(dir = dist, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pages(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

/** "…/assets/index.html" -> "/data/assets/" */
function routeOf(file) {
  return `/${file.slice(dist.length + 1).replace(/index\.html$/, "")}`;
}

const html = new Map(pages().map((file) => [file, readFileSync(file, "utf8")]));
const idsOf = (text) => new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

const ids = new Map([...html].map(([file, text]) => [file, idsOf(text)]));
const problems = [];

/** Resolve an internal path (already stripped of the base) to a file in dist. */
function target(path) {
  const clean = path.replace(/\/$/, "");
  const candidates = [
    resolve(dist, `.${clean}`),
    resolve(dist, `.${clean}/index.html`),
    resolve(dist, `.${clean}.html`),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

for (const [file, text] of html) {
  const from = routeOf(file);

  for (const match of text.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (/^(?:[a-z]+:|\/\/|#|mailto:)/i.test(href)) continue;
    if (!href.startsWith("/")) {
      problems.push(`${from}: relative href "${href}" cannot be base-checked`);
      continue;
    }
    if (base && href !== base && !href.startsWith(`${base}/`)) {
      problems.push(`${from}: "${href}" is missing the ${base} prefix`);
      continue;
    }

    const withoutBase = base ? href.slice(base.length) || "/" : href;
    const [path, fragment] = withoutBase.split("#");
    const file2 = target(path);
    if (!file2) {
      problems.push(`${from}: "${href}" does not resolve to a file`);
      continue;
    }
    if (fragment && file2.endsWith(".html")) {
      const fragmentIds = ids.get(file2) ?? new Set();
      if (!fragmentIds.has(decodeURIComponent(fragment))) {
        problems.push(`${from}: "${href}" points at a missing anchor`);
      }
    }
  }

  for (const match of text.matchAll(/src="([^"]+)"/g)) {
    const src = match[1];
    if (/^(?:[a-z]+:|\/\/|data:)/i.test(src)) continue;
    if (base && !src.startsWith(`${base}/`)) {
      problems.push(`${from}: asset "${src}" is missing the ${base} prefix`);
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} problem(s) in ${dist}:\n`);
  for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
  if (problems.length > 40) console.error(`  …and ${problems.length - 40} more`);
  process.exit(1);
}

console.log(`link check: ${html.size} pages, no problems (base "${base || "/"}")`);
