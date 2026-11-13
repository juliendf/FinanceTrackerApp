/**
 * Documentation guards.
 *
 * Docs drift silently: prose statements had gone stale before anyone noticed.
 * These checks are cheap and only cover what can be verified mechanically —
 * version consistency and links that resolve. Prose accuracy still needs a
 * human.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
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
    "AGENTS.md",
    "CONTRIBUTING.md",
    "ARCHITECTURE.md",
    "SECURITY.md",
    "docs/MAINTAINING.md",
    "docs/TROUBLESHOOTING.md",
    "docs/RELEASE.md",
    "docs/CHANGELOG.md",
    "docs/IMPORT_FORMAT.md",
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
      "AGENTS.md",
      "docs/MAINTAINING.md",
      "docs/TROUBLESHOOTING.md",
      "docs/RELEASE.md",
      "docs/CHANGELOG.md",
      "docs/IMPORT_FORMAT.md",
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

/**
 * The user guide is a second documentation surface with its own links, images and
 * sidebar. It drifts the same way the markdown docs did: a page gets renamed and
 * the sidebar keeps pointing at the old slug, or a screenshot is deleted and the
 * figure renders as a broken box. These checks are cheap and catch both.
 */
describe("site guide", () => {
  const siteRoot = resolve(root, "site");
  const guideDir = resolve(siteRoot, "src/content/docs");
  const config = readFileSync(resolve(siteRoot, "astro.config.mjs"), "utf8");

  function pages(dir = guideDir, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) pages(full, found);
      else if (/\.mdx?$/.test(entry.name)) found.push(full);
    }
    return found;
  }

  const guidePages = pages();
  const slugOf = (file: string) =>
    file.slice(guideDir.length + 1).replace(/\.mdx?$/, "").replace(/\/index$/, "");

  it("has pages", () => {
    expect(guidePages.length).toBeGreaterThan(10);
  });

  it("gives every page a title and a description", () => {
    const missing: string[] = [];
    for (const page of guidePages) {
      const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(page, "utf8"))?.[1] ?? "";
      if (!/^title:\s*\S/m.test(front)) missing.push(`${slugOf(page)}: title`);
      if (!/^description:\s*\S/m.test(front)) missing.push(`${slugOf(page)}: description`);
    }
    expect(missing).toEqual([]);
  });

  it("lists every page in the sidebar", () => {
    const unlisted = guidePages.map(slugOf).filter((slug) => !config.includes(`slug: "${slug}"`));
    expect(unlisted).toEqual([]);
  });

  it("has no sidebar entry without a page", () => {
    const slugs = [...config.matchAll(/slug: "([^"]+)"/g)].map((m) => m[1]);
    const orphan = slugs.filter(
      (slug) => !existsSync(resolve(guideDir, `${slug}.md`)) && !existsSync(resolve(guideDir, `${slug}.mdx`)),
    );
    expect(orphan).toEqual([]);
  });

  it("every internal link resolves to a page", () => {
    const broken: string[] = [];
    for (const page of guidePages) {
      for (const match of readFileSync(page, "utf8").matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const [path] = match[1].split("#");
        const slug = path.replace(/^\/|\/$/g, "");
        if (!slug) continue; // "/" is the landing page
        const candidates = [`${slug}.md`, `${slug}.mdx`, `${slug}/index.md`, `${slug}/index.mdx`];
        if (!candidates.some((candidate) => existsSync(resolve(guideDir, candidate)))) {
          broken.push(`${slugOf(page)} -> ${match[1]}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("every referenced screenshot exists", () => {
    const broken: string[] = [];
    for (const page of guidePages) {
      const text = readFileSync(page, "utf8");
      for (const match of text.matchAll(/<Shot\s+name="([^"]+)"/g)) {
        if (!existsSync(resolve(siteRoot, "public/shots", `${match[1]}.png`))) {
          broken.push(`${slugOf(page)} -> shots/${match[1]}.png`);
        }
      }
      for (const match of text.matchAll(/!\[[^\]]*\]\(\/shots\/([^)\s]+)\)/g)) {
        if (!existsSync(resolve(siteRoot, "public/shots", match[1]))) {
          broken.push(`${slugOf(page)} -> shots/${match[1]}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
