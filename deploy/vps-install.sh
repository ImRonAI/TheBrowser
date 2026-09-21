#!/usr/bin/env bash
# Install/refresh Ron on the VPS. Run as `ron` after deploy/sync-to-vps.sh.
# Builds the Python venv, installs the MCP package, builds both npm projects, and sets
# the Electron chrome-sandbox setuid bit via the two sudo commands allowed by
# /etc/sudoers.d/ron-sandbox (written by deploy/vps-bootstrap.sh). Chromium's sandbox stays enabled.
set -Eeuo pipefail

[ "$(id -u)" -ne 0 ] || { echo "run vps-install.sh as ron, not root" >&2; exit 2; }

log() { printf '[install] %s\n' "$*"; }

RON_ROOT=/opt/ron/RonBrowserRebuild
MCP_ROOT=/opt/ron/electron-playwright-mcp
cd "$RON_ROOT"

log "python venv"
[ -x venv/bin/python ] || python3 -m venv venv
venv/bin/pip install -q -U pip
venv/bin/pip install -q -r agent/api/requirements.txt
# The package declares requires-python <3.14; it runs on 3.14 (verified on the dev machine).
venv/bin/pip install -q --ignore-requires-python -e "$MCP_ROOT"
test -x venv/bin/electron-playwright-mcp

npm_install() {
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
}

log "electron-playwright-mcp npm build"
(cd "$MCP_ROOT" && npm_install && npm run build)

log "Ron npm build"
npm_install
npm run build

log "chrome-sandbox setuid"
SB="$RON_ROOT/node_modules/electron/dist/chrome-sandbox"
sudo /usr/bin/chown root:root "$SB"
sudo /usr/bin/chmod 4755 "$SB"
[ "$(stat -c '%U %a' "$SB")" = "root 4755" ] || { echo "chrome-sandbox is not root 4755" >&2; exit 1; }

echo "INSTALL OK"
