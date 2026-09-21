#!/usr/bin/env bash
# SSH tunnel from this Mac to the Ron VPS. Run by launchd (com.ronbrowser.tunnel) or by hand.
#   -L 8765  -> the VPS agent API appears on this Mac as http://localhost:8765 (the renderer URL is unchanged)
#   -R 13000/18931/19222 -> this Mac's Ron Electron (3000/8931/9222) appears on the VPS loopback
# Remote listeners stay on the VPS loopback (sshd default; nothing is bound publicly). While the tunnel is up the local
# backend must NOT run on 8765 (`npm run dev:backend` would collide with the -L forward).
set -Eeuo pipefail

if [ -z "${RON_VPS_HOST:-}" ]; then
  echo "usage: RON_VPS_HOST=<host> [RON_VPS_USER=ron] [RON_SSH_KEY=path] $0" >&2
  exit 2
fi
RON_SSH_KEY="${RON_SSH_KEY:-$HOME/.ssh/ronbrowser_upcloud_ed25519}"
RON_VPS_USER="${RON_VPS_USER:-ron}"

exec ssh -N -T -i "$RON_SSH_KEY" \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -L 8765:127.0.0.1:8765 \
  -R 13000:127.0.0.1:3000 \
  -R 18931:127.0.0.1:8931 \
  -R 19222:127.0.0.1:9222 \
  "$RON_VPS_USER@$RON_VPS_HOST"
