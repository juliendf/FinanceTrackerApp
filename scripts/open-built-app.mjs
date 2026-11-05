/**
 * Open a freshly built bundle, replacing any copy that is already running.
 *
 * `open path/to/App.app` only *activates* an app that is already running: the
 * window keeps the previous build, and a rebuild looks like it did nothing. That
 * cost two review cycles on this project, so the local scripts quit first, wait
 * for the process to go, then open.
 *
 *   node scripts/open-built-app.mjs "FinanceTracker" "…/FinanceTracker.app"
 */

import { execFileSync } from "node:child_process";

const [appName, bundlePath] = process.argv.slice(2);
if (!appName || !bundlePath) {
  console.error("usage: open-built-app.mjs <app name> <bundle path>");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRunning = () => {
  try {
    // Exits non-zero when nothing matches, which is the signal we want.
    execFileSync("pgrep", ["-f", bundlePath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

if (isRunning()) {
  try {
    // A graceful quit, so an in-flight chat turn is cancelled by the app rather
    // than by the process disappearing.
    execFileSync("osascript", ["-e", `quit app "${appName}"`], { stdio: "ignore" });
  } catch {
    // Not scriptable, or already gone. The wait below handles both.
  }

  for (let attempt = 0; attempt < 50 && isRunning(); attempt += 1) {
    await sleep(100);
  }

  if (isRunning()) {
    console.warn(`${appName} did not quit; opening anyway. Quit it by hand if the window looks stale.`);
  }
}

execFileSync("open", [bundlePath]);
