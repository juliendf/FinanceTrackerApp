---
title: Setting it up
description: Providers, keys, models and the two switches that must be on before chat works.
---

The assistant is **off by default**. Nothing is sent anywhere until you enable it and give
it an endpoint.

## What enabling means

When it is on, a message sends your text, the system prompt (profile, goals, style,
standing instructions, the ten most important memories), the last 60 messages of the
conversation, and whatever the model asks the app to look up. That goes to the endpoint you
configure and nowhere else: a local provider keeps it on the Mac, a hosted one does not.
The full inventory is in [where your data lives](/data/privacy/#the-complete-list-of-outbound-requests).

## Step 1: add a provider

**Settings → LLM Providers → New Provider**.

| Field | Notes |
|---|---|
| **Base URL** | The OpenAI-compatible endpoint, including `/v1` |
| **Name** | Up to 50 characters; shown in the chat header |
| **API Key** | Goes to the macOS Keychain. Leave empty if the endpoint needs none |
| Models | **Load models** queries `<base URL>/models`; tick the ones chat may use |
| **Default model** | What a new conversation starts on |
| **Set as default provider** | New conversations use it |
| **Active** | Inactive providers are hidden from chat |

Common endpoints:

| Provider | Base URL |
|---|---|
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |

If **Load models** returns nothing, type the model id by hand — some proxies do not
advertise a list. **Test connection** reports whether the endpoint answers and how many
models it offers, with hints for the usual HTTP failures (`401` → check the key, `404` →
check the URL and model, `429` → rate limited).

## Step 2: turn AI on

Back on **LLM Providers**, tick **Enable AI features** and press **Save AI settings**.

Two more options live there:

- **Stream answers as they arrive** (on): the reply appears token by token. Off, a spinner
  shows and the whole answer lands at once.
- **Standing instructions** (1,000 characters): appended to every conversation, after your
  profile and before memories. Use it for house rules — *"always show amounts in CHF"*,
  *"no product recommendations"*.

## About keys and endpoints

The Keychain and the endpoint binding are explained in
[where your data lives](/data/privacy/#api-keys). What that means when you edit a provider:

- Editing the **path** of a base URL keeps the key.
- Changing the **scheme, host or port** drops it. You will be told: *"the saved API key
  belongs to https://api.openai.com, but this provider now points at https://example.com.
  Enter the key again."*
- Plain `http` is only accepted for `localhost`, `127.0.0.1` and `[::1]`.

A native confirmation appears when a provider's endpoint changes, or when a brand-new
non-local endpoint is added. It states the origin and warns that your questions and the
figures the assistant looks up are sent there. Loopback addresses never ask.

## Choosing a local model

Tool calling is the requirement: the model must emit structured calls, not just prose. Any
model that does so through an OpenAI-compatible endpoint works — ask it one question about
your data and watch whether a tool row appears. At the time of writing, `qwen3.5:4b` and
`ministral-3:8b` do; `qwen2.5-coder:14b` does not.

Practical notes:

- A 4B–8B model is enough for lookups and arithmetic; larger models write better prose.
- The request timeout card accepts 5–600 seconds. This build keeps a fixed 300-second
  ceiling on the HTTP client, so very slow local models can still be cut off.
- Model choice is remembered per provider, but each conversation stores its own, so
  switching in one chat does not move another.

## Troubleshooting the first message

| Symptom | Cause |
|---|---|
| Chat says **AI is off** | The toggle above is still off |
| **No provider configured** | No provider is active |
| **Choose a provider first** | A conversation exists but has no provider attached |
| The model answers in prose, never reads your data | The model does not support tool calls |
| `cannot reach <url> — is the provider running?` | The local server is not up, or the port is wrong |

After that, see [chatting](/assistant/chat/).
