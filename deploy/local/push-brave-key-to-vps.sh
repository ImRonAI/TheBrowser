#!/usr/bin/env bash
# Copy BRAVE_SEARCH_API_KEY from repo .env to /etc/ronbrowser/ron.env on the VPS (never prints the key).
set -euo pipefail
cd "$(dirname "$0")/../.."
RON_VPS_HOST="${RON_VPS_HOST:?set RON_VPS_HOST}"
RON_SSH_KEY="${RON_SSH_KEY:-$HOME/.ssh/ronbrowser_upcloud_ed25519}"
RON_VPS_USER="${RON_VPS_USER:-ron}"

line="$(grep -E '^BRAVE_SEARCH_API_KEY=' .env | head -1 || true)"
[ -n "$line" ] || { echo "BRAVE_SEARCH_API_KEY missing from .env" >&2; exit 1; }

tmp="$(mktemp)"
chmod 600 "$tmp"
printf '%s\n' "$line" > "$tmp"
trap 'rm -f "$tmp"' EXIT

scp -i "$RON_SSH_KEY" -o StrictHostKeyChecking=accept-new "$tmp" "$RON_VPS_USER@$RON_VPS_HOST:/tmp/ron-brave-line.env"

ssh -i "$RON_SSH_KEY" "$RON_VPS_USER@$RON_VPS_HOST" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
ENV=/etc/ronbrowser/ron.env
NEW=/tmp/ron.env.merged
sudo grep -v '^BRAVE_SEARCH_API_KEY=' "$ENV" > "$NEW"
cat /tmp/ron-brave-line.env >> "$NEW"
sudo install -m 600 -o root -g root "$NEW" "$ENV"
rm -f "$NEW" /tmp/ron-brave-line.env
REMOTE

echo "Updated BRAVE_SEARCH_API_KEY on VPS." >&2
ssh -i "$RON_SSH_KEY" "$RON_VPS_USER@$RON_VPS_HOST" 'sudo systemctl restart ron-api'
sleep 6
curl -sf "http://127.0.0.1:8765/search/status" | ./venv/bin/python3 -c "import sys,json; d=json.load(sys.stdin); print('brave configured:', d['configured']['brave'])"
