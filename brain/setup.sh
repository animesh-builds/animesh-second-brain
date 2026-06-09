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

# 2. Local PGLite brain (no server, 2s) — gbrain's recommended default.
gbrain init --pglite || echo "[brain] already initialized."

# 3. Embeddings: OpenAI (cheap, one key). Requires OPENAI_API_KEY in env/.env.
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  gbrain config set embedding_model "openai:text-embedding-3-small"
  echo "[brain] embedding model -> openai:text-embedding-3-small"
else
  echo "[brain] WARNING: OPENAI_API_KEY not set. Keyword search will work;"
  echo "         set the key and re-run for vector embeddings."
fi

# 4. First import + embed of whatever the ingest bridge has written.
mkdir -p "$SOURCE_DIR"
gbrain import "$SOURCE_DIR" --no-embed || true
gbrain embed --stale || true

gbrain doctor --json || true
echo "[brain] setup complete. Source dir: $SOURCE_DIR"
echo "[brain] Serve over MCP for OpenClaw with:  gbrain serve"
