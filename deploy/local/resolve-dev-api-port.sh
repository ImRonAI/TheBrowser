#!/usr/bin/env bash
# Pick a local API port for Ron dev: 8765 when free, else 8766 when 8765 is the VPS SSH tunnel.
set -euo pipefail

PRIMARY=8765
FALLBACK=8766

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

port_command() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1}'
}

if ! port_in_use "$PRIMARY"; then
  echo "$PRIMARY"
  exit 0
fi

owner="$(port_command "$PRIMARY")"
if [ "$owner" = "ssh" ]; then
  if port_in_use "$FALLBACK"; then
    echo "Port $FALLBACK is already in use. Stop the other listener (or an old npm run electron:dev) and retry." >&2
    exit 1
  fi
  echo "Ron dev: VPS tunnel keeps localhost:$PRIMARY; local API will use $FALLBACK (Electron follows automatically)." >&2
  echo "$FALLBACK"
  exit 0
fi

echo "Port $PRIMARY is in use by ${owner:-unknown} (not the VPS tunnel). Free $PRIMARY or set API_PORT explicitly." >&2
exit 1
