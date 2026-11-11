---
title: Why I built this
description: The spreadsheet this replaced, why snapshots are manual, why it is a desktop app, and why the AI is the part that made it interesting.
---

Initially, I built FinanceTracker for myself.

For years my net worth lived in a Google Sheet: one row per account, one column per
month, a chart I rebuilt every time something moved. The sheet was not the problem — the
process was. Every month I would open it, forget which formula was fragile, paste over a
cell, and spend the evening repairing the graph instead of reading it.

I tried the alternatives. Most of them wanted to be my budget: transactions, spending
categories, receipts, a connector to my bank. I did not want a budget. I wanted one
question answered honestly — **what is my wealth today, and how did that change since the
last time I looked?**

## Track assets, not habits

The app has no ledger: no transactions, no spending categories, no imported statements. It
has assets, and it has values of those assets on dates. The only income and expense figures
it knows are the ones you type into your profile — salary, monthly living expenses, savings
target — and they exist so the assistant can compute a savings rate or a runway. Everything
else you see is arithmetic on those values: a total, a split, a change over time. Nothing is
estimated, and nothing is filled in for you.

That constraint is why the numbers agree with each other. There is one source of truth and
one way to change it.

## Why snapshots are manual

This is the decision people ask about first.

An app that connects to your accounts has to cover every institution, every broker, every
pension fund, every crypto exchange, every banking app that redesigns its login twice a
year. That is not a feature, it is a permanent maintenance project — and even then it would
miss the assets that matter most to some people.

So the app does the opposite. You open the banking app, the broker, the pension statement,
the wallet; you read the number; you type it in. One snapshot per asset per date. Five to
ten minutes, once a month if that is your rhythm, or whenever you feel like it.

The trade-off is real and the app does not hide it: the value is not live, it is the value
you wrote down on the date you wrote it. The dashboard prints how many days have passed
since your last snapshot, and the asset list marks stale values instead of pretending they
are current.

## Why a desktop app, not a web app

A personal finance app on the web means somebody hosts a database of personal financial
data. Even with encryption and good intentions, that is a liability I did not want to
create — plus a server bill for an app that should not need a subscription to exist.

As a desktop app it is a file on your Mac: one SQLite database under
`~/Library/Application Support/`, no account, no server, nothing that has to stay online.
It also makes distribution the easy part: a DMG, not a deployment.

## Then the AI made it interesting

Once the numbers live in one place, a model can do more than read a chart. It can compare
the portfolio to the goals in your profile, run a stress test, explain what changed, or
work out how much you would need to save each month.

What matters to me is where that runs. The app speaks the OpenAI-compatible API that
Ollama, LM Studio, OpenAI and Gemini all expose, so you can point it at a model on the
same Mac and keep everything local. AI is off until you configure an endpoint, and the
app tells you plainly what leaves the machine.

It also remembers. Profile fields, structured goals and memories you confirm build a
picture of you over time, so the answers stop being generic after the first few
conversations. That is the part that turned a tracker into something closer to an advisor.

The other piece I wanted was currency handling that is not a guess: EUR, USD and CHF per
asset, converted with the European Central Bank's daily reference rates, fetched once a
day and replaced by your own numbers whenever you prefer them.

## What it is not

- Not a budget. No spending categories, no transaction ledger, no imported statements — the
  monthly totals in your profile are the only expenses it holds.
- Not a bank connector. No credentials, no scraping, no aggregator.
- Not a subscription, and not a web service.
- Not finished. It is pre-1.0, and I use it every month — which is the only reason it
  exists in this shape.

If that sounds like the tool you wanted and could not find,
[install it](/start/install/) and tell me what breaks.

— Julien
