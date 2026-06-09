#!/usr/bin/env bash
# Keep the bot hot so it never cold-starts (the cause of the intermittent
# "warming up / I don't have that"). Ensures Ollama is up, pins the embedder
# resident (keep_alive=-1), and warms gbrain retrieval. Run every ~3 min.
set -uo pipefail
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"

# 1. Make sure the Ollama server is running (relaunch if it died).
curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || open -a Ollama 2>/dev/null || true
for i in $(seq 1 10); do curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done

# 2. Pin the embedder resident (load forever).
curl -s http://localhost:11434/api/embed \
  -d '{"model":"nomic-embed-text","input":"warm","keep_alive":-1}' >/dev/null 2>&1

# 3. Warm gbrain retrieval (exercises the query-embed path the bot uses).
OLLAMA_BASE_URL=http://localhost:11434/v1 OLLAMA_API_KEY=ollama \
  gbrain search "warm" >/dev/null 2>&1 || true
