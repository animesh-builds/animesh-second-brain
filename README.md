# animesh-second-brain

A **single-user, citation-grounded knowledge assistant** you query over WhatsApp.
It ingests your own data (Gmail, Google Drive/Docs/Sheets, Notion), builds a
private local vector index, and answers questions **only** from that index — with
source citations and a hard "I don't have that" when the answer isn't there. No
hallucination, no live API calls at query time, no personal data leaving your
machine.

> Built on real upstream tooling — [`gbrain`](https://github.com/garrytan/gbrain)
> (retrieval brain) + [`OpenClaw`](https://github.com/openclaw/openclaw)
> (multi-channel agent gateway) + local [Ollama](https://ollama.com) embeddings.
> The net-new engineering is the **ingestion + safety pipeline** in `ingest/` and
> the **agent hardening** in `whatsapp/`.

---

## Why this is non-trivial

A "RAG over my email" demo is easy. Making one that is **private, grounded,
safe to share, and runs for free** is the hard part. This repo solves four
problems most demos skip:

1. **Grounding without hallucination** — the agent has *zero* internal knowledge;
   it must retrieve-then-answer, cite every claim, and explicitly refuse when the
   data isn't present.
2. **Capability containment** — the agent is locked to retrieval tools *only*. It
   physically cannot run a shell, write files, send email, or hit the web — so it
   can't "freelance" (a real failure we hit: a general agent tried to install a
   CLI email client to fetch live mail instead of using the brain).
3. **Privacy in depth** — read-only scopes, a local index, multi-layer PII
   redaction, a sensitivity classifier, and a content allowlist — so the corpus is
   safe to demo to a third party.
4. **Free + private inference** — local embeddings (no key, data never leaves the
   box) with a hosted chat model only for final synthesis.

## Architecture

```
 Gmail · Drive/Docs/Sheets · Notion
        │
        │  ingest/  — TWO backends (the net-new code):
        │    A) OAuth bridge (googleapis, read-only refresh token) — cron-friendly
        │    B) MCP connectors (agent-held Gmail/Drive/Notion) — zero OAuth setup
        ▼
   ┌─────────────────── content pipeline (per page) ───────────────────┐
   │ sanitize (strip control chars, cap size)                          │
   │ → PII redaction      (emails/phones/secrets/links → [REDACTED-*])  │
   │ → sensitivity filter (drop job-search / compensation / money)      │
   │ → newsletter filter  (NEWSLETTERS_ONLY: keep only newsletters)     │
   │ → idempotent markdown (front-matter: source/id/revision/date/url)  │
   └───────────────────────────────────────────────────────────────────┘
        │  one .md per item → sources/google/ (gitignored, local-only)
        ▼
   gbrain  →  PGLite (local)  +  Ollama nomic-embed-text (768-d, free, on-device)
        │  vector search + citations  (gbrain serve, MCP stdio)
        ▼
   OpenClaw gateway ── agent (Gemini 2.5 Flash via OpenRouter) ── WhatsApp (Baileys)
        ▲                    │
        └ gbrain MCP (3 tools: search/recall/get_page) — the ONLY tools it has
```

**Why this shape:** Google/Notion are read **once** per sync into a cited index;
queries hit the index, never the live APIs — so answers are fast, quota-free, and
verifiable. The agent is a thin, *capability-contained* shell over the brain.

## What's in here

| Path | What it is | Status |
|---|---|---|
| `ingest/` | **The net-new bridge.** OAuth + MCP backends, PII redaction, sensitivity + newsletter classifiers, idempotent markdown, gbrain sync. | ✅ built + tested |
| `ingest/sensitivity.ts` | `classifySensitivity()` (money/comp/job-search) + `isNewsletter()` content classifiers. | ✅ |
| `ingest/scrub.ts` | `pnpm scrub` — purge sensitive pages from an existing KB (reversible quarantine). | ✅ |
| `brain/` | gbrain setup: local PGLite + free Ollama embeddings (OpenAI optional). | ✅ |
| `whatsapp/` | OpenClaw wiring: gbrain-only tool lock, brain-only + humanizer persona, allowlist, model. | ✅ |
| `whatsapp/DEPLOY.md` | Always-up on a Mac (LaunchAgents) + the cloud path. | ✅ |
| `evals/` | Gold-set retrieval/citation eval. | ✅ |
| `scripts/` | 15-min cron + Ollama keep-warm. | ✅ |
| `sources/google/` | Ingested data — **local-only, gitignored, never pushed.** | runtime |

## The engineering, in detail

### Ingestion — two interchangeable backends
- **OAuth bridge** (`run-sync.ts`): read-only Google scopes, refresh-token flow,
  Gmail threads + Drive Docs/Sheets → markdown. Idempotent on `id + revision`
  (re-runs never duplicate). Cron-friendly.
- **MCP connectors** (`from-mcp.ts`): consumes data fetched through
  already-authenticated **Gmail/Drive/Notion MCP connectors** an agent holds — so
  there's **no Google Cloud project / OAuth to set up**. Same markdown,
  idempotency, and safety pipeline.

### Safety pipeline (applied to every page, both backends)
1. **Sanitize** — strip control chars (ASCII-built regex), cap body size.
2. **PII redaction** (`redactPII`) — emails, phone numbers (intl + India E.164),
   API keys/secrets (`sk-…`, `AIza…`, `GOCSPX-…`, refresh tokens, `AKIA…`, `ghp_…`),
   video-call links, IPs → typed `[REDACTED-*]` tags. Tracking params stripped
   from citation URLs.
3. **Sensitivity classifier** — drops job-search / compensation / money content.
4. **Newsletter allowlist** (`NEWSLETTERS_ONLY`) — restricts the KB to newsletter
   senders only (everything else dropped) for safe external demos.

### Agent hardening (the part that makes it trustworthy)
- **Capability lock** — `tools.profile=coding` (projects the gbrain MCP) but
  `tools.deny` removes the *entire* built-in tool set (`exec`, `write`, `edit`,
  `web_fetch`, …). The agent is left with **3 tools** (`search`/`recall`/`get_page`).
  It cannot run shell, write files, or browse — a *capability* guarantee, not a
  prompt request.
- **Brain-only grounding** — authoritative persona overrides OpenClaw's default
  "be resourceful" persona; zero internal knowledge; search-first on every turn;
  cite or say "I don't have that"; never echo channel metadata.
- **PII-output guard** — never emits names/emails/phones, and never prints the
  `[REDACTED-*]` tags either (phrases around them).
- **Humanizer voice** — the [humanizer](https://github.com/blader/humanizer)
  skill's anti-AI-writing rules baked into the reply style (one pass, no extra
  latency).
- **Access control** — OpenClaw's native allowlist (`dmPolicy=allowlist`);
  only approved E.164 numbers are answered; groups disabled.

### Reliability engineering
- **Keep-warm** — Ollama's embedder is pinned resident (`keep_alive=-1`) + a
  LaunchAgent, so query embedding never cold-starts.
- **Graceful degradation** — if retrieval errors/times out, the bot says
  "warming up, please resend" — *never* a false "I don't have that."
- **Model fallbacks + low temperature** for deterministic tool-calling.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Retrieval brain | gbrain (Bun) | sync → embed → cited retrieval out of the box |
| Vector store | PGLite (local) | zero-server, 2-second setup |
| Embeddings | Ollama `nomic-embed-text` (768-d) | **free, private, on-device** |
| Agent gateway | OpenClaw | multi-channel; WhatsApp via Baileys; MCP tools |
| WhatsApp | Baileys (QR-linked) | free, no Meta/Twilio account |
| Chat model | Gemini 2.5 Flash via OpenRouter | strong tool-calling, ~cents/query |
| Ingestion | Node/TS + googleapis / MCP | the one piece of custom code |

## Quick start

```bash
pnpm install
cp .env.example .env            # fill OpenRouter key; Google/MCP as needed

bash brain/setup.sh             # installs gbrain + Ollama, local embeddings
# Bootstrap data via MCP connectors (no OAuth) OR the OAuth bridge:
pnpm ingest:mcp <bundle.json>   # agent-fetched data  (NEWSLETTERS_ONLY honored)
#   or: pnpm auth && pnpm ingest:backfill

bash whatsapp/setup.sh          # OpenClaw + gbrain MCP + tool-lock + allowlist
openclaw channels login --channel whatsapp   # scan QR once
openclaw start
```

## Demo (live)

Message the bot from an allowlisted number:

- *"What are my newsletters about? Give me 3 highlights."*
  → cited highlights from your Substack/Lenny/a16z/etc. feeds.
- *"What's my salary / which companies am I interviewing with?"*
  → *"I don't share job-search, compensation, or financial details."*
- *"Who won the cricket world cup?"*
  → *"I only have your newsletter subscriptions in the knowledge base — nothing else."*

## Privacy & safety

- **Read-only** Google scopes only; data is read once into a **local** index.
- `sources/google/`, `.env`, secrets, and planning docs are gitignored; the public
  repo is leak-checked (`.gitleaks.toml`). No personal content is ever pushed.
- Local embeddings keep the *index* private; only redacted, non-sensitive,
  newsletter-scoped chunks reach the hosted chat model at query time.

## Commands

| Command | Does |
|---|---|
| `pnpm ingest` / `pnpm ingest:backfill` | OAuth backend sync / full backfill |
| `pnpm ingest:mcp <bundle.json>` | MCP-connector backend (no OAuth) |
| `pnpm scrub` | quarantine sensitive pages from the KB |
| `pnpm test` / `pnpm typecheck` | unit + idempotency tests / `tsc` |
| `pnpm eval` | gold-set retrieval/citation eval |

## Notes
- Local & not always-on by default (runs while the Mac is awake; see
  `whatsapp/DEPLOY.md` for the cloud path).
- `gbrain serve` uses single-process PGLite — don't run a second `gbrain` (e.g.
  `mcp probe`) against the live brain; it contends for the DB lock.
