# Keeping the bot always-up

The stack is local (gbrain PGLite + Ollama embeddings + OpenClaw gateway +
WhatsApp via Baileys). Two ways to keep it answering 24/7.

## Option A — Always-up on this Mac (quick, free, set up now)
Three LaunchAgents keep it running as long as the Mac is powered on:

- **`ai.openclaw.gateway`** — the bot (auto-starts, auto-restarts).
- **`ai.secondbrain.keepwarm`** — runs `scripts/ollama-keepwarm.sh` every 3 min:
  ensures Ollama is up, pins the embedder resident (`keep_alive=-1`), warms
  gbrain. Kills the cold-start "warming up" message.
- **`ai.secondbrain.awake`** — `caffeinate -dimsu` so the Mac never sleeps.

Plists live in `~/Library/LaunchAgents/`. Load/reload:
```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.secondbrain.keepwarm.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.secondbrain.awake.plist
```
Caveat: only "up" while the Mac is on and plugged in. Good for a demo / personal use.

## Option B — Cloud (truly always-up; a real deploy, not a one-liner)
Run on a small persistent VM (Hetzner/Fly/Railway/Render with a disk). Steps:

1. Provision a Linux box (2 vCPU / 4 GB+). Install Bun, Node, gbrain, openclaw.
2. **Embeddings:** local Ollama is impractical on a small VM — switch gbrain to a
   hosted embedder (`gbrain init --force --embedding-model openai:text-embedding-3-small`,
   needs an OpenAI key) and re-embed. Removes the cold-start issue entirely.
3. **Brain data:** copy the PGLite store (`~/.gbrain/`) to the box, or re-run the
   MCP/OAuth ingestion there.
4. **WhatsApp:** copy `~/.openclaw/credentials/whatsapp/` (the linked session) to
   the box, or re-run `openclaw channels login` and scan the QR once.
5. Keep the same `openclaw.json` config (model, allowlist, tools.deny, persona).
6. Run the gateway as a systemd service; point WhatsApp + LLM (OpenRouter) at it.

> Why not Vercel/serverless: the gateway + brain need persistent disk and a
> long-running process — serverless can't host it (see `_planning` D006).
