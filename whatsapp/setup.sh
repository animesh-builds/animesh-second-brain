#!/usr/bin/env bash
# WhatsApp setup — wires OpenClaw (gateway + WhatsApp channel) to the gbrain
# brain over MCP, with Gemini Flash as the agent model. See D002/D005/D007.
#
# Prereqs: gbrain installed (run brain/setup.sh first), GEMINI_API_KEY in .env.
# OpenClaw's config is schema-validated, so we drive it via CLI one-liners
# rather than hand-writing ~/.openclaw/openclaw.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/second-brain}"

if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
fi

# 1. Install OpenClaw if missing.
if ! command -v openclaw >/dev/null 2>&1; then
  echo "[wa] installing openclaw..."
  npm install -g openclaw
fi
openclaw --version || true

# 2. Workspace + grounding persona (anti-hallucination contract).
mkdir -p "$WORKSPACE"
cp "$ROOT/whatsapp/system-prompt.md" "$WORKSPACE/AGENTS.md"
openclaw config set agents.defaults.workspace "$WORKSPACE"

# 3. Model: Gemini Flash (free tier). Verify the exact id with `openclaw models`.
#    Provide the key during onboarding or export GEMINI_API_KEY beforehand.
openclaw config set agents.defaults.model.primary "google/gemini-2.0-flash" || \
  echo "[wa] set the model manually if the id differs: openclaw models"

# 4. Register gbrain as an MCP server so the agent has brain tools.
openclaw mcp add gbrain -- gbrain serve || \
  echo "[wa] gbrain MCP may already be registered (openclaw mcp list)."

# 5. WhatsApp channel: install plugin, set allowlist, then QR login.
openclaw channels add --channel whatsapp || true
if [[ -n "${WHATSAPP_ALLOW_FROM:-}" ]]; then
  openclaw config set channels.whatsapp.dmPolicy "allowlist"
  openclaw config set channels.whatsapp.allowFrom "[\"$WHATSAPP_ALLOW_FROM\"]" --strict-json
fi

echo ""
echo "[wa] Next steps (interactive):"
echo "  1. gbrain serve            # in another terminal (or it's spawned by MCP)"
echo "  2. openclaw channels login --channel whatsapp   # scan the QR with your phone"
echo "  3. openclaw start          # run the gateway"
echo "  4. Message your bot a question whose answer is in your data."
echo ""
echo "[wa] Verify wiring:  openclaw mcp probe gbrain   &&   openclaw doctor"
