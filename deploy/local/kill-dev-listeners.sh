#!/usr/bin/env bash
# Free Ron dev ports on this Mac. Never kills the VPS SSH tunnel on 8765.
set -euo pipefail

port_command() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1}'
}

kill_listeners() {
  local port=$1
  local skip_comm=${2:-}
  local pid comm
  while read -r pid; do
    [ -z "$pid" ] && continue
    comm=$(ps -p "$pid" -o comm= 2>/dev/null | tr -d ' ' || true)
    if [ -n "$skip_comm" ] && [ "$comm" = "$skip_comm" ]; then
      continue
    fi
    echo "Ron dev: stopping ${comm:-process} on port $port (pid $pid)" >&2
    kill "$pid" 2>/dev/null || true
  done < <(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
}

for port in 3000 8931 9222 8766; do
  kill_listeners "$port"
done

# 8765: local API or stray listeners only — keep ssh (VPS tunnel).
kill_listeners 8765 ssh

sleep 0.3
for port in 3000 8931 9222 8766; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Ron dev: force-killing remaining listeners on $port" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
done

if [ "$(port_command 8765)" != "ssh" ] && lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Ron dev: force-killing remaining listeners on 8765 (not the tunnel)" >&2
  kill_listeners 8765 ssh
  lsof -nP -iTCP:8765 -sTCP:LISTEN -t 2>/dev/null | while read -r pid; do
    [ "$(ps -p "$pid" -o comm= 2>/dev/null | tr -d ' ')" = "ssh" ] && continue
    kill -9 "$pid" 2>/dev/null || true
  done
fi
