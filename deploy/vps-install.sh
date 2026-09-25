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
# electron-playwright-mcp declares fastmcp>=3.2.0 with no upper bound; fastmcp 4.x pulls mcp 2.x,
# which breaks strands-agents' mcp<2.2 pin and removes fastmcp.tools.tool. Pin the versions the
# dev machine runs, then install the package itself without re-resolving its dependencies.
# The [apps] extra is required: server.py imports fastmcp.apps.approval, which needs prefab-ui
# (without it the stdio server dies at import and every browser tool load fails).
# It also declares requires-python <3.14; it runs on 3.14 (verified on the dev machine).
venv/bin/pip install -q 'fastmcp[apps]==3.4.0' 'mcp==1.26.0' 'pyyaml>=6.0.3' 'httpx>=0.28.1'
venv/bin/python -c 'import fastmcp.apps.approval' || { echo "fastmcp[apps] (prefab-ui) missing" >&2; exit 1; }
venv/bin/pip install -q --ignore-requires-python --no-deps -e "$MCP_ROOT"
venv/bin/pip check
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
