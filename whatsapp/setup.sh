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

# Normalize a phone number to E.164, defaulting to India (+91). Handles
# "+91-78220 34007", "REDACTED", "91REDACTED", "0REDACTED" -> "+91REDACTED".
normalize_phone() {
  local d; d="$(printf '%s' "$1" | tr -cd '0-9')"   # digits only
  d="${d#0}"                                          # drop domestic trunk 0
  if   [[ ${#d} -eq 10 ]];                 then printf '+91%s' "$d"   # bare 10-digit -> India
  elif [[ ${#d} -eq 12 && "$d" == 91* ]];  then printf '+%s'   "$d"   # 91 + 10 digits
  else                                          printf '+%s'   "$d"   # already has a country code
  fi
}

# 1. Install OpenClaw if missing.
if ! command -v openclaw >/dev/null 2>&1; then
  echo "[wa] installing openclaw..."
  npm install -g openclaw
fi
openclaw --version || true

# 2. Workspace + grounding persona (anti-hallucination contract).
#    AGENTS.md is authoritative; we ALSO overwrite the default SOUL/USER/TOOLS
#    templates so OpenClaw's "be resourceful / take action" default persona can't
#    fight the brain-only contract (root cause of the himalaya-freelance bug).
mkdir -p "$WORKSPACE"
cp "$ROOT/whatsapp/system-prompt.md" "$WORKSPACE/AGENTS.md"
for f in SOUL.md TOOLS.md USER.md; do
  [[ -f "$ROOT/whatsapp/persona/$f" ]] && cp "$ROOT/whatsapp/persona/$f" "$WORKSPACE/$f"
done
openclaw config set agents.defaults.workspace "$WORKSPACE"

# 3. Answer-writing model. Default: FREE local Ollama chat model (private).
AGENT_MODEL="${AGENT_MODEL:-ollama/llama3.2}"
if [[ "$AGENT_MODEL" == ollama/* ]]; then
  open -a Ollama 2>/dev/null || true
  for i in $(seq 1 15); do curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
  ollama pull "${AGENT_MODEL#ollama/}"   # e.g. llama3.2 (~2GB, free, local)
fi
openclaw config set agents.defaults.model.primary "$AGENT_MODEL" || \
  echo "[wa] set the model manually if the id differs: openclaw models"
echo "[wa] answer model -> $AGENT_MODEL"

# 3b. Lock the agent to BRAIN-ONLY. Keep the 'coding' profile (it projects the
#     gbrain MCP tools) but DENY the ENTIRE built-in tool set so the agent is
#     hard-locked to gbrain only. This is a CAPABILITY guardrail, not a prompt:
#     with no write/edit/exec/web tools, the agent physically cannot create
#     files or run shell (e.g. set up the himalaya email CLI) — it can only
#     search the knowledge base. ('minimal' profile would also drop gbrain, so
#     we keep 'coding' + deny instead.)
openclaw config set tools.profile "coding" || true
openclaw config set tools.deny '["apply_patch","create_goal","cron","edit","exec","gateway","get_goal","image","message","nodes","process","read","sessions_history","sessions_list","sessions_send","sessions_spawn","sessions_yield","skill_workshop","subagents","tts","update_goal","web_fetch","web_search","whatsapp_login","write","agents_list"]' --strict-json \
  || echo "[wa] could not set tools.deny — set it manually to hard-lock to gbrain only."

# 4. Register gbrain as an MCP server so the agent has brain tools. Correct
#    flag syntax (--command/--arg), with Ollama env so the brain can embed
#    queries at search time.
GB="$(command -v gbrain || echo gbrain)"
openclaw mcp add gbrain --command "$GB" --arg serve \
  --env OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434/v1}" \
  --env OLLAMA_API_KEY="${OLLAMA_API_KEY:-ollama}" --no-probe \
  || echo "[wa] gbrain MCP may already be registered (openclaw mcp list)."

# 5. WhatsApp channel: install plugin, set the ACCESS ALLOWLIST, then QR login.
#    Access control is enforced by OpenClaw's native gate (don't hand-roll auth):
#    only numbers in the allowlist can message the bot and get answers; everyone
#    else is ignored. WHATSAPP_ALLOW_FROM is a comma-separated list of E.164
#    numbers, e.g. "+919876543210,+919812345678".
openclaw plugins install clawhub:@openclaw/whatsapp 2>/dev/null || true
openclaw channels add --channel whatsapp || true
if [[ -n "${WHATSAPP_ALLOW_FROM:-}" ]]; then
  # Build a JSON array from the comma-separated list.
  json="["; first=1
  IFS=',' read -ra _nums <<< "$WHATSAPP_ALLOW_FROM"
  for n in "${_nums[@]}"; do
    [[ -z "$(printf '%s' "$n" | tr -cd '0-9')" ]] && continue
    n="$(normalize_phone "$n")"   # -> +91XXXXXXXXXX
    [[ $first -eq 0 ]] && json+=","; json+="\"$n\""; first=0
  done
  json+="]"
  openclaw config set channels.whatsapp.dmPolicy "allowlist"
  openclaw config set channels.whatsapp.allowFrom "$json" --strict-json
  # DMs only by default; lock groups down too (members-only, no open groups).
  openclaw config set channels.whatsapp.groupPolicy "disabled"
  echo "[wa] access allowlist -> $json (only these numbers get answers)"
else
  echo "[wa] No WHATSAPP_ALLOW_FROM set -> default dmPolicy=pairing:"
  echo "     unknown senders get a one-time pairing code and are ignored until"
  echo "     you approve them with:  openclaw pairing approve whatsapp <code>"
fi

echo ""
echo "[wa] Next steps (interactive):"
echo "  1. gbrain serve            # in another terminal (or it's spawned by MCP)"
echo "  2. openclaw channels login --channel whatsapp   # scan the QR with your phone"
echo "  3. openclaw start          # run the gateway"
echo "  4. Message your bot a question whose answer is in your data."
echo ""
echo "[wa] Verify wiring:  openclaw mcp probe gbrain   &&   openclaw doctor"
