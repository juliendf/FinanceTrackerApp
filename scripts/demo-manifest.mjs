/**
 * Write the updater manifest for the demo build.
 *
 * tauri-action generates `latest.json` for the normal app; the demo build is a
 * second bundle in the same release, so it needs its own manifest pointing at
 * the demo archive and carrying that archive's signature.
 *
 *   node scripts/demo-manifest.mjs <sig> <url> <out>
 */

import { readFileSync, writeFileSync } from "node:fs";

const [sigPath, url, outPath] = process.argv.slice(2);
if (!sigPath || !url || !outPath) {
  console.error("usage: demo-manifest.mjs <sig> <url> <out>");
  process.exit(1);
}

const version = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const signature = readFileSync(sigPath, "utf8").trim();
const platform = { signature, url };

const manifest = {
  version,
  notes: "FinanceTracker Demo",
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": platform,
    "darwin-aarch64-app": platform,
  },
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
