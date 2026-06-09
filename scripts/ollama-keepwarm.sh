#!/usr/bin/env bash
# Keep the gbrain embedding model resident so query-time search never cold-starts.
# Run every ~3 min (cron/launchd/`loop`): */3 * * * * /ABS/scripts/ollama-keepwarm.sh
curl -s http://localhost:11434/api/embed \
  -d '{"model":"nomic-embed-text","input":"warm","keep_alive":-1}' >/dev/null 2>&1
