#!/usr/bin/env bash
# Mac Ron desktop dev: clean stale listeners, start the local API on 8765 and Electron against it.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -f .env.development.local ] && grep -qE '^VITE_(API_BASE|LIVE_API|SEARCH_API)_URL=' .env.development.local 2>/dev/null; then
  echo "Ron dev: remove VITE_*_URL from .env.development.local — electron:dev sets the API origin." >&2
  exit 1
fi

bash deploy/local/kill-dev-listeners.sh

export RON_NGROK=0
export RON_DEV_SKIP_PORT_KILL=1
export API_HOST=127.0.0.1
export API_PORT=8765
export VITE_API_BASE_URL="http://127.0.0.1:$API_PORT"
export VITE_LIVE_API_BASE_URL="$VITE_API_BASE_URL"
unset VITE_SEARCH_API_URL

echo "Ron dev: local API and Electron → $VITE_API_BASE_URL" >&2
exec npx concurrently -n backend,electron -c blue,green \
  "bash deploy/local/dev-backend.sh" \
  "npm run dev:vite"
