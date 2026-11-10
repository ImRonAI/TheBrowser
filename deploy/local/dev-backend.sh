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
# Loopback by default, like electron:dev: /chat, /a2a, /build … run host shell tools.
export API_HOST="${API_HOST:-127.0.0.1}"
echo "Ron API listening on http://$API_HOST:$API_PORT" >&2
exec ./venv/bin/python agent/api/main.py