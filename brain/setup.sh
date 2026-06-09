#!/usr/bin/env bash
# Brain setup — installs gbrain (Bun runtime), creates a local PGLite brain,
# and configures OpenAI embeddings. See architecture.md (D001, D005).
# Idempotent: safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${BRAIN_SOURCE_DIR:-$ROOT/sources/google}"

# Load .env if present (for OPENAI_API_KEY).
if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
fi

# 1. Install Bun + gbrain if missing.
if ! command -v bun >/dev/null 2>&1; then
  echo "[brain] installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if ! command -v gbrain >/dev/null 2>&1; then
  echo "[brain] installing gbrain..."
  bun install -g github:garrytan/gbrain
  export PATH="$HOME/.bun/bin:$PATH"
fi

gbrain --version

# 2. Embeddings provider. EMBEDDINGS=ollama (free, local, default) | openai | none.
#    The model must be chosen at init time (a deferred --no-embedding brain gets
#    stuck and can't be reconfigured without a reset). So init sizes the schema.
EMBEDDINGS="${EMBEDDINGS:-ollama}"

if [[ "$EMBEDDINGS" == "ollama" ]]; then
  # FREE local embeddings via Ollama + nomic-embed-text (768d). No key, no cost.
  # IMPORTANT: use the official Ollama app, NOT `brew install ollama` (the
  # Homebrew *formula* ships without the llama-server runner and cannot serve
  # models). Install the cask/app:  brew install --cask ollama
  if ! command -v ollama >/dev/null 2>&1; then
    echo "[brain] installing Ollama (official app)…"; brew install --cask ollama
  fi
  open -a Ollama 2>/dev/null || true
  for i in $(seq 1 15); do curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
  ollama pull nomic-embed-text
  export OLLAMA_BASE_URL="http://localhost:11434/v1" OLLAMA_API_KEY="ollama"
  gbrain init --pglite --embedding-model ollama:nomic-embed-text || \
    gbrain init --force --pglite --embedding-model ollama:nomic-embed-text
  echo "[brain] embeddings -> ollama:nomic-embed-text (768d, free/local)"
elif [[ "$EMBEDDINGS" == "openai" && -n "${OPENAI_API_KEY:-}" ]]; then
  gbrain init --pglite --embedding-model openai:text-embedding-3-small
  echo "[brain] embeddings -> openai:text-embedding-3-small"
else
  gbrain init --pglite --no-embedding
  echo "[brain] no embeddings — keyword (BM25) search only (still free + cited)."
fi

# 3. Import + embed of whatever the ingest bridge has written.
mkdir -p "$SOURCE_DIR"
gbrain import "$SOURCE_DIR" --no-embed || true
gbrain embed --stale || true

gbrain doctor --json || true
echo "[brain] setup complete. Source dir: $SOURCE_DIR"
echo "[brain] Serve over MCP for OpenClaw with:  gbrain serve"
