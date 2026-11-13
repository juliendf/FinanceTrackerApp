---
title: Updates
description: How the update check works, why nothing happens automatically, and what "no feed" means.
---

## Checking

**Settings → General → Updates → Check for updates**.

Three outcomes:

| Outcome | What you see |
|---|---|
| Already current | A toast: *"You're on the latest version (0.7.1)."* |
| Newer version exists | An inline card: *"Version 0.8.0 is available."* with **Install and restart** and **Later** |
| Cannot reach the feed | A warning: *"No update feed reachable (…)."* |

Installation downloads with a progress bar, verifies the signature against the app's own
public key, replaces the bundle and restarts. If the download or the signature check fails,
nothing is replaced.

**Nothing checks automatically** and nothing downloads or restarts unasked.

## Why "no feed" can be normal

The app reads `latest.json` from the project's newest **published** GitHub release. Two
situations look like an error but are not:

- No release has been published yet (a draft release is invisible to the updater).
- You are running a local development build whose version is newer than the latest release.

If it persists on a released build, take a backup and report the version from **About**.

## First install versus updates

The first install needs the Gatekeeper step because the build is not notarised. Updates are
signed separately with the app's own key, so macOS accepts them without repeating that
step — provided the signature verifies. A bad signature is refused rather than installed.

## Version numbers

The version is printed at the bottom of the sidebar. This project is pre-1.0: patch releases
carry fixes, minor releases carry features, and a release that changes the data format or the
bundle identifier is called out in the changelog because it needs a manual step.

Read the changelog before installing a minor release:
[CHANGELOG.md](https://github.com/juliendf/FinanceTrackerApp/blob/main/docs/CHANGELOG.md).
