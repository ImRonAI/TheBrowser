#!/usr/bin/env bash
# Free Ron dev ports on this Mac: the local API (8765, plus the retired 8766 fallback) and Electron (3000/8931/9222).
set -euo pipefail

PORTS=(3000 8931 9222 8765 8766)

kill_listeners() {
  local port=$1
  local pid comm
  while read -r pid; do
    [ -z "$pid" ] && continue
    comm=$(ps -p "$pid" -o comm= 2>/dev/null | tr -d ' ' || true)
    echo "Ron dev: stopping ${comm:-process} on port $port (pid $pid)" >&2
    kill "$pid" 2>/dev/null || true
  done < <(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
}

for port in "${PORTS[@]}"; do
  kill_listeners "$port"
done

sleep 0.3
for port in "${PORTS[@]}"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Ron dev: force-killing remaining listeners on $port" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
done
