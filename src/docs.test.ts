/**
 * Documentation guards.
 *
 * Docs drift silently: four statements in DEVIATIONS.md and SECURITY.md had gone
 * stale before anyone noticed. These checks are cheap and only cover what can be
 * verified mechanically — version consistency and links that resolve. Prose
 * accuracy still needs a human.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const read = (file: string) => readFileSync(resolve(root, file), "utf8");

function cargoVersion(): string {
  const match = /^version = "([^"]+)"/m.exec(read("src-tauri/Cargo.toml"));
  if (!match) throw new Error("no version in Cargo.toml");
  return match[1];
}

describe("versions", () => {
  it("agree across package.json, tauri.conf.json and Cargo.toml", () => {
    const npm = JSON.parse(read("package.json")).version as string;
    const tauri = JSON.parse(read("src-tauri/tauri.conf.json")).version as string;
    expect(tauri).toBe(npm);
    expect(cargoVersion()).toBe(npm);
  });

  it("is the version the README advertises", () => {
    const npm = JSON.parse(read("package.json")).version as string;
    expect(read("README.md")).toContain(`Version ${npm}`);
  });
});

describe("documents", () => {
  const required = [
    "README.md",
    "CONTRIBUTING.md",
    "ARCHITECTURE.md",
    "SECURITY.md",
    "docs/TROUBLESHOOTING.md",
    "docs/RELEASE.md",
    "docs/CHANGELOG.md",
    "docs/DEVIATIONS.md",
    "docs/PARITY_CHECKLIST.md",
    "docs/IMPORT_FORMAT.md",
    "docs/code-review-fixes-2026-11-01.md",
  ];

  it("all exist", () => {
    expect(required.filter((file) => !existsSync(resolve(root, file)))).toEqual([]);
  });

  it("README links to contributing, troubleshooting and the changelog", () => {
    const readme = read("README.md");
    for (const target of ["CONTRIBUTING.md", "docs/TROUBLESHOOTING.md", "docs/CHANGELOG.md"]) {
      expect(readme, target).toContain(target);
    }
  });
});

describe("links", () => {
  const sources = ["README.md", "CONTRIBUTING.md", "ARCHITECTURE.md", "SECURITY.md", ...requiredDocs()];

  function requiredDocs(): string[] {
    return [
      "docs/TROUBLESHOOTING.md",
      "docs/RELEASE.md",
      "docs/CHANGELOG.md",
      "docs/DEVIATIONS.md",
      "docs/PARITY_CHECKLIST.md",
      "docs/IMPORT_FORMAT.md",
      "docs/code-review-fixes-2026-11-01.md",
    ];
  }

  it("every relative link resolves", () => {
    const broken: string[] = [];
    for (const file of sources) {
      const base = dirname(resolve(root, file));
      for (const match of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1];
        if (target.startsWith("#") || /^[a-z]+:\/\//i.test(target)) continue;
        const [path] = target.split("#");
        if (!path) continue;
        if (!existsSync(resolve(base, decodeURIComponent(path)))) broken.push(`${file} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
