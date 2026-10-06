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
SSH_OPTS=(-i "$RON_SSH_KEY" -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)

# When this Mac's side of a previous tunnel dies without a FIN (sleep, Wi-Fi change, kill -9), the VPS
# sshd keeps that session -- and its -R listeners on 13000/18931/19222 -- alive until ClientAlive gives
# up (~6 min). With ExitOnForwardFailure the new tunnel then fails on "remote port forwarding failed",
# launchd retries every ThrottleInterval, and the app has no 8765 until the orphan times out. Free the
# ports first so a reconnect is immediate and every launchd retry is a clean attempt.
# (sshd owns the listeners, so `ss -p` needs sudo; `ron` has passwordless sudo on the VPS.)
ssh "${SSH_OPTS[@]}" "$RON_VPS_USER@$RON_VPS_HOST" '
  for pid in $(sudo ss -tlnpH "( sport = :13000 or sport = :18931 or sport = :19222 )" 2>/dev/null \
      | grep -o "pid=[0-9]*" | cut -d= -f2 | sort -u); do
    sudo kill "$pid" 2>/dev/null && echo "[tunnel] freed stale reverse-forward session $pid"
  done; true' || echo "[tunnel] pre-flight skipped (ssh unreachable); attempting the tunnel anyway" >&2

exec ssh -N -T "${SSH_OPTS[@]}" \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -L 8765:127.0.0.1:8765 \
  -R 13000:127.0.0.1:3000 \
  -R 18931:127.0.0.1:8931 \
  -R 19222:127.0.0.1:9222 \
  "$RON_VPS_USER@$RON_VPS_HOST"
