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

# Mac-side pre-flight: 8765 is this tunnel's port by policy. If a local Ron dev API grabbed it while the tunnel was
# down (2026-10-21: `npm run dev` during a network blip), `-L 8765` would fail on 127.0.0.1 and ssh would bind only
# [::1], splitting localhost:8765 across two backends. Evict our own dev API (agent/api/main.py from this repo);
# refuse to start over anything else so we never kill a stranger's process.
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"  # -P: lsof reports the physical cwd (e.g. /private/tmp, not /tmp)
for pid in $(lsof -nP -tiTCP:8765 -sTCP:LISTEN 2>/dev/null | sort -u); do
  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1)"
  case "$cmd" in
    ssh\ *) continue ;;  # a previous tunnel instance; launchd restarts us after it exits
  esac
  if [[ "$cmd" == *agent/api/main.py* && "$cwd" == "$REPO_DIR" ]]; then
    kill "$pid" 2>/dev/null && echo "[tunnel] evicted local Ron dev API $pid from 8765 (use npm run electron:dev; it picks 8766)" >&2
  else
    echo "[tunnel] 8765 is held by pid $pid ($cmd); not touching it. Free the port and the tunnel will retry." >&2
    exit 1
  fi
done

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
