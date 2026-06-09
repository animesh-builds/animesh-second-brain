# animesh-second-brain

A single-user **second brain** you query over **WhatsApp**, with **cited**
answers and no hallucination. It ingests Gmail + Drive/Docs/Sheets **+ Notion**
into a local, embedded knowledge store and answers questions from that index —
never by re-reading the raw sources per query. Cross-source: one query returns
cited results spanning email, docs, and Notion.

```
Gmail / Drive / Docs / Sheets   (read-only OAuth)
          │  ingest/ — every 15 min (cron)
          ▼
   sources/google/  ──▶  gbrain (PGLite + OpenAI embeddings)  ──▶  cited retrieval
          (markdown)                                                    │
                                                                        ▼
                              WhatsApp  ◀──  OpenClaw  ◀── gbrain MCP (search / think)
```

## What's in this repo

| Path | What it is | Build status |
|---|---|---|
| `ingest/` | **The custom bridge.** Read-only Google → idempotent, **PII-redacted** markdown → triggers gbrain sync. Two backends (below). | ✅ built + tested |
| `brain/` | Setup for [gbrain](https://github.com/garrytan/gbrain) (the brain runtime): local PGLite + **free local embeddings** (Ollama `nomic-embed-text`) by default; OpenAI optional. | ✅ install script |
| `whatsapp/` | Wires [OpenClaw](https://github.com/openclaw/openclaw) (WhatsApp via Baileys) to gbrain over MCP, model = Gemini Flash. | ✅ config + script |
| `evals/` | Gold-set retrieval/citation eval against gbrain. | ✅ runner + sample |
| `scripts/` | 15-min cron wrapper. | ✅ |
| `sources/google/` | Ingested personal data. **Local-only, gitignored, never pushed.** | runtime |

The brain and WhatsApp layers are **real upstream tools** (gbrain, OpenClaw)
installed and configured by the scripts here — the only net-new code is the
`ingest/` bridge.

## Two ingestion backends

Both write the same idempotent, PII-redacted markdown into `sources/google/`:

1. **OAuth bridge** (`pnpm ingest`) — standalone, calls the Google APIs with a
   refresh token. Needs a one-time Google Cloud OAuth setup (`pnpm auth`). Best
   for the **unattended 15-min cron**.
2. **MCP connectors** (`pnpm ingest:mcp <bundle.json>`) — consumes data fetched
   through already-authenticated **MCP connectors** (**Gmail, Drive, Notion**)
   held by an agent (Claude Code / OpenClaw). **No OAuth setup.** Best for
   **agent-driven** bootstrapping. See [ingest/mcp-bundle.schema.md](ingest/mcp-bundle.schema.md).
   (MCP connectors live in the agent session, so for an unattended cron use
   backend 1, or run `ingest:mcp` from a scheduled headless agent.)

## Cost: $0

Runs fully free: **local embeddings** via Ollama `nomic-embed-text` (768d, no
key), local PGLite store, MCP connectors for data. `bash brain/setup.sh` uses
this by default (`EMBEDDINGS=ollama`). Set `EMBEDDINGS=openai` (with
`OPENAI_API_KEY`) or `EMBEDDINGS=none` (keyword/BM25 only) to switch.

> **Ollama gotcha:** use the official app (`brew install --cask ollama`), **not**
> `brew install ollama` — the Homebrew *formula* ships without the `llama-server`
> runner and cannot serve models. The setup script uses the cask.

Note: a Claude.ai *Pro subscription* is not an API key and can't be wired into
gbrain/OpenClaw; the free path above needs no Anthropic/OpenAI key at all.

## PII redaction

Ingested content is scrubbed before it reaches disk / the index / the LLM
(`redactPII` in [ingest/markdown.ts](ingest/markdown.ts)): emails, phone numbers,
API keys/secrets, video-call links, and IPs → typed `[REDACTED-…]` tags, plus a
name blocklist (`REDACT_NAMES`) for the specific people in your data. Every page
carries a "PII redacted per privacy policy" notice. Review pages before sharing —
free-text names not in the blocklist may remain.

## Quick start

```bash
pnpm install
cp .env.example .env          # fill in Google + OpenAI + Gemini keys

# 1. One-time Google auth (read-only) → prints a refresh token for .env
pnpm auth

# 2. Stand up the brain (installs gbrain, local PGLite, OpenAI embeddings)
bash brain/setup.sh

# 3. Backfill ~90 days of Google data, write markdown, embed
pnpm ingest:backfill

# 4. Wire WhatsApp (installs OpenClaw, registers gbrain MCP, Gemini model)
bash whatsapp/setup.sh
openclaw channels login --channel whatsapp   # scan QR
openclaw start

# 5. Keep it fresh (every 15 min)
#   */15 * * * * /ABS/PATH/scripts/cron.sh >> /tmp/sb-ingest.log 2>&1
```

Then message your bot a question whose answer is in your data — expect a cited
reply, or *"I don't have that in your knowledge base."*

## Commands

| Command | Does |
|---|---|
| `pnpm auth` | One-time Google read-only OAuth; prints the refresh token. |
| `pnpm ingest` | OAuth backend: incremental sync (since last run) → markdown → gbrain. |
| `pnpm ingest:backfill` | OAuth backend: full ~90-day backfill. |
| `pnpm ingest:mcp <bundle.json>` | MCP backend: render agent-fetched Google data (no OAuth setup). |
| `pnpm test` | Unit + idempotency tests (no network). |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm eval` | Gold-set retrieval/citation eval (needs gbrain populated). |

## Privacy & safety (read this)

- **Read-only Google scopes only** (`gmail/drive/spreadsheets/documents.readonly`).
- **Personal data never leaves your machine in git.** `sources/google/`, `.env`,
  and the planning docs are gitignored; a `.gitleaks.toml` + the
  `gitignore-guidance.md` rules guard the public repo.
- **D007 (open):** the agent LLM is Gemini Flash's free tier, which may train on
  prompts. **Use test data until you switch to a paid/local model.** Local
  embeddings keep the *index* private; the *LLM prompt* is the exposed surface.

## Decisions vs. the original plan

Two plan assumptions changed once the upstream repos were inspected:
- gbrain's real default is **PGLite + OpenAI/ZeroEntropy embeddings**, not
  Supabase + local bge-small. We use PGLite + OpenAI (simpler, local, matches
  the demo). Supabase remains the path for a future persistent deploy.
- `clawinbox` is an empty scaffold; **OpenClaw** is the actual gateway, and its
  WhatsApp channel already uses Baileys. We wire OpenClaw + gbrain MCP instead
  of hand-rolling a transport.
