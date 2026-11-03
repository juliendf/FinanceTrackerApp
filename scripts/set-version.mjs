/**
 * Set the version in the four places that must agree.
 *
 *   node scripts/set-version.mjs 0.5.5
 *
 * package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, the README
 * line, and src-tauri/Cargo.lock (via cargo metadata). The tag must match
 * afterwards: `git tag v<version>`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: set-version.mjs <major.minor.patch>");
  process.exit(1);
}

const replaceIn = (file, pattern) => {
  const before = readFileSync(file, "utf8");
  const after = before.replace(pattern, (match) => match.replace(/\d+\.\d+\.\d+/, version));
  if (after === before) throw new Error(`no version found in ${file}`);
  writeFileSync(file, after);
};

replaceIn("package.json", /"version": "\d+\.\d+\.\d+"/);
replaceIn("src-tauri/tauri.conf.json", /"version": "\d+\.\d+\.\d+"/);
replaceIn("src-tauri/Cargo.toml", /^version = "\d+\.\d+\.\d+"/m);
replaceIn("README.md", /Version \d+\.\d+\.\d+/);

// Refresh the lockfile entry for the package itself.
execFileSync("cargo", ["metadata", "--format-version", "1"], {
  cwd: "src-tauri",
  stdio: "ignore",
});

console.log(`version set to ${version}`);
console.log("next: add the changelog entry, commit, then `git tag v" + version + "`");
