#!/usr/bin/env bash
# Mac Ron desktop dev: clean stale listeners, route the UI from one probe of localhost:8765 (VPS tunnel or local API).
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -f .env.development.local ] && grep -qE '^VITE_(API_BASE|LIVE_API|SEARCH_API)_URL=' .env.development.local 2>/dev/null; then
  echo "Ron dev: remove VITE_*_URL from .env.development.local — electron:dev sets API ports (see comment in that file)." >&2
  exit 1
fi

bash deploy/local/kill-dev-listeners.sh

port_command() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1}'
}

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

route_ok() {
  curl -sf -o /dev/null -w '' --max-time 3 "http://127.0.0.1:$1$2"
}

export RON_NGROK=0
export RON_DEV_SKIP_PORT_KILL=1

LOCAL_BACKEND_PORT=""
LOCAL_ORIGIN="http://localhost:8766"
AGENT_ORIGIN="http://localhost:8765"
LIVE_ORIGIN="$AGENT_ORIGIN"
SEARCH_ORIGIN="$AGENT_ORIGIN"

if [ "$(port_command 8765)" = "ssh" ]; then
  if ! route_ok 8765 /health; then
    echo "Ron dev: SSH holds localhost:8765 but the VPS API is not responding." >&2
    exit 1
  fi
  echo "Ron dev: localhost:8765 = VPS (SSH tunnel)" >&2
  route_ok 8765 /bidi/settings || { LOCAL_BACKEND_PORT=8766; LIVE_ORIGIN="$LOCAL_ORIGIN"; }
  route_ok 8765 /search/status || { LOCAL_BACKEND_PORT=8766; SEARCH_ORIGIN="$LOCAL_ORIGIN"; }
elif ! port_in_use 8765; then
  LOCAL_BACKEND_PORT=8765
  AGENT_ORIGIN="http://127.0.0.1:8765"
  LIVE_ORIGIN="$AGENT_ORIGIN"
  SEARCH_ORIGIN="$AGENT_ORIGIN"
  echo "Ron dev: no tunnel — one local API on 8765" >&2
else
  echo "Ron dev: port 8765 is held by $(port_command 8765), not the VPS tunnel." >&2
  exit 1
fi

export VITE_API_BASE_URL="$AGENT_ORIGIN"
export VITE_LIVE_API_BASE_URL="$LIVE_ORIGIN"
unset VITE_SEARCH_API_URL
if [ "$SEARCH_ORIGIN" != "$AGENT_ORIGIN" ]; then
  export VITE_SEARCH_API_URL="$SEARCH_ORIGIN"
fi

echo "Ron dev: panel/chat/discover/projects → $VITE_API_BASE_URL" >&2
echo "Ron dev: live/teaching → $VITE_LIVE_API_BASE_URL" >&2
echo "Ron dev: search → ${VITE_SEARCH_API_URL:-$VITE_API_BASE_URL}" >&2

if [ -n "$LOCAL_BACKEND_PORT" ]; then
  export API_HOST=127.0.0.1
  export API_PORT="$LOCAL_BACKEND_PORT"
  echo "Ron dev: local Python on $LOCAL_BACKEND_PORT (only for routes missing on 8765)" >&2
  exec npx concurrently -n backend,electron -c blue,green \
    "bash deploy/local/dev-backend.sh" \
    "npm run dev:vite"
fi

echo "Ron dev: no local Python — Electron only (8765 serves everything reachable)" >&2
exec npm run dev:vite
