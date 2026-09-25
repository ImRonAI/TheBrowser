#!/usr/bin/env bash
# Never kill an SSH tunnel (or another API) to claim its port.
set -euo pipefail
cd "$(dirname "$0")/../.."
export API_PORT="${API_PORT:-8765}"
if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $API_PORT is already in use. Leave the VPS tunnel running; use API_PORT=8766 npm run dev:backend for a separate local API." >&2
  exit 1
fi
exec ./venv/bin/python agent/api/main.py