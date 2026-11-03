/**
 * Write an updater manifest pointing at a release asset.
 *
 * tauri-action writes `latest.json` with `api.github.com/repos/.../assets/<id>`
 * URLs, which are rate-limited to 60 requests per hour when unauthenticated: an
 * update then fails with `403 Forbidden`. GitHub's `releases/download/<tag>/<file>`
 * URLs are served by the release CDN and are not subject to that limit, so both
 * manifests are generated here instead.
 *
 *   node scripts/updater-manifest.mjs <sig> <url> <out> [notes]
 */

import { readFileSync, writeFileSync } from "node:fs";

const [sigPath, url, outPath, notes] = process.argv.slice(2);
if (!sigPath || !url || !outPath) {
  console.error("usage: updater-manifest.mjs <sig> <url> <out> [notes]");
  process.exit(1);
}

const version = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const signature = readFileSync(sigPath, "utf8").trim();
const platform = { signature, url };

const manifest = {
  version,
  notes: notes ?? `FinanceTracker ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": platform,
    "darwin-aarch64-app": platform,
  },
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
