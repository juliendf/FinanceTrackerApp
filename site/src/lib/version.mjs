/**
 * The latest *published* release, for the version badges in the landing nav
 * and the docs header. The source of truth is the GitHub release that the
 * updater already points at, not package.json — on main the package version
 * is the next unreleased one for most of a cycle.
 *
 * Fallbacks: APP_VERSION (set by CI or a local override), then package.json.
 * A network failure or a repo with no releases must never fail a build.
 */

import pkg from "../../../package.json";

const RELEASES_URL =
  "https://api.github.com/repos/juliendf/FinanceTrackerApp/releases/latest";

let cached;

async function fetchLatestRelease() {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { accept: "application/vnd.github+json" },
      // Unauthenticated GitHub API; never hold a build hostage to it.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const tag = (await res.json())?.tag_name;
    // Tags are `v<x.y.z>`; the badge already adds the v.
    return tag ? tag.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}

export async function appVersion() {
  cached ??=
    (await fetchLatestRelease()) ?? process.env.APP_VERSION ?? pkg.version;
  return cached;
}
