#!/usr/bin/env bash
# Start the local Ron API (8765). Never kills another process to claim its port.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -z "${API_PORT:-}" ]; then
  API_PORT="$(bash deploy/local/resolve-dev-api-port.sh)"
  export API_PORT
fi
if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $API_PORT is already in use. Stop the other process or run npm run electron:dev (it frees the dev ports first)." >&2
  exit 1
fi
echo "Ron API listening on http://127.0.0.1:$API_PORT" >&2
exec ./venv/bin/python agent/api/main.py