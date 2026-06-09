#!/usr/bin/env bash
# 15-minute incremental sync (D003/D006). Pulls recent Google data into the
# brain source dir and triggers gbrain sync. Logs counts only (no content).
#
# Crontab entry (every 15 min):
#   */15 * * * * /path/to/animesh-second-brain/scripts/cron.sh >> /tmp/sb-ingest.log 2>&1
#
# Or run continuously:  watch -n 900 scripts/cron.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Ensure Bun/gbrain are on PATH under cron's minimal environment.
export PATH="$HOME/.bun/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "[cron] $(date -u +%FT%TZ) starting incremental sync"
pnpm ingest
echo "[cron] $(date -u +%FT%TZ) done"
