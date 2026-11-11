---
title: FAQ
description: Short answers to the questions the README does not cover.
---

**Is it free?**

Yes. MIT licence, no account, no paid tier. There is nothing to subscribe to.

**Does it connect to my bank?**

No. You enter values by hand. That is a limitation and the reason there are no credentials
to leak.

**Can I use it on Windows or Linux?**

No. It is a macOS app: the Keychain, the window chrome and the build target are all Mac.
The UI is web technology, so a port is possible, not planned.

**Can I sync between two Macs?**

Not built in. Export on one, import on the other. Import replaces, so decide which database
wins before you do it.

**Multiple portfolios or people?**

One database, one profile. Use institutions or tags to separate accounts by purpose; use
separate installs or the demo build for a second person.

**Do I have to use the AI?**

No. It is off until you enable it, and the app is complete without it.

**What happens to my data if I uninstall?**

It stays in `~/Library/Application Support/app.financetracker/` until you delete it. Use
**Reset the database** first if you also want the Keychain keys removed.

**Can I get the data into Excel?**

**Snapshots → Export CSV** writes the filtered set with dates, amounts and currencies.
Assets, institutions and categories are not in that file; use the JSON backup for a full
picture.

**Why is my total different from my bank's?**

Three usual causes: a missing exchange rate (`unconverted` badge), a snapshot that predates
the last transaction, or a fund whose value you update monthly while the bank updates daily.

**Why is performance not my return?**

Because deposits inside the period count as growth — the baseline is a value, not a list of
contributions. See [Performance](/numbers/performance/).

**How often should I record snapshots?**

Monthly is the sweet spot: enough history for a chart, little enough work to keep doing it.
Record on the same day each month.

**Is my data encrypted?**

The database is a normal SQLite file, protected by the disk encryption you already use (FileVault)
and by macOS file permissions. The app does not add a password of its own. An exported
backup is plain JSON.

**Can I contribute?**

Yes — bugs, docs and code, in English. Start with
[CONTRIBUTING.md](https://github.com/juliendf/FinanceTrackerApp/blob/main/CONTRIBUTING.md),
then the issue tracker. The project is small and opinionated; a short discussion before a
large pull request saves both sides time.
