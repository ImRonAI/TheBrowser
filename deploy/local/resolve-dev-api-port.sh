#!/usr/bin/env bash
# Pick the local API port for Ron dev: 8765, the only backend (the VPS is retired).
set -euo pipefail

PRIMARY=8765

port_command() {
  # lsof exits 1 when nothing listens (the free-port case); under pipefail that must not abort the script.
  { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; } | awk 'NR==2 {print $1}'
}

owner="$(port_command "$PRIMARY")"
if [ -n "$owner" ]; then
  echo "Port $PRIMARY is in use by $owner. Free $PRIMARY or set API_PORT explicitly." >&2
  exit 1
fi
echo "$PRIMARY"
