#!/usr/bin/env bash
# Keep the embedder hot so the bot never cold-starts. ONLY pings Ollama — it must
# NOT run `gbrain search`, because PGLite is single-process: a second gbrain
# process competing with the long-lived `gbrain serve` for the DB lock hangs the
# MCP server. `gbrain serve` (spawned by OpenClaw) stays warm on its own.
set -uo pipefail
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"

# Ensure the Ollama server is up (relaunch if it died).
curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || open -a Ollama 2>/dev/null || true
for i in $(seq 1 10); do curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done

# Pin the embedding model resident (load forever) so query embeds never cold-start.
curl -s http://localhost:11434/api/embed \
  -d '{"model":"nomic-embed-text","input":"warm","keep_alive":-1}' >/dev/null 2>&1
