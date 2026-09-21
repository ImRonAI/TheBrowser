#!/usr/bin/env bash
# Rsync Ron and the sibling electron-playwright-mcp package to the VPS.
# Usage: RON_VPS_HOST=<ip-or-host> [RON_VPS_USER=ron] [RON_SSH_KEY=...] deploy/sync-to-vps.sh [extra rsync args]
# Never syncs .env files; the server env lives in /etc/ronbrowser/ron.env.
set -Eeuo pipefail

if [ -z "${RON_VPS_HOST:-}" ]; then
  echo "usage: RON_VPS_HOST=<host> [RON_VPS_USER=ron] [RON_SSH_KEY=path] $0 [--dry-run -v ...]" >&2
  exit 2
fi
RON_VPS_USER="${RON_VPS_USER:-ron}"
RON_SSH_KEY="${RON_SSH_KEY:-$HOME/.ssh/ronbrowser_upcloud_ed25519}"

cd "$(dirname "$0")/.."

[ -f ../electron-playwright-mcp/pyproject.toml ] || {
  echo "../electron-playwright-mcp/pyproject.toml not found; the sibling package must sit next to this repo" >&2
  exit 1
}

SSH_CMD="ssh -i $RON_SSH_KEY -o StrictHostKeyChecking=accept-new"
DEST="$RON_VPS_USER@$RON_VPS_HOST"

# Mirrors .gitignore's dependency/secret/cache/local-runtime groups so only source reaches the server.
RON_EXCLUDES=(
  --exclude node_modules --exclude venv --exclude .venv --exclude dist
  --exclude .env --exclude '.env.*' --exclude .omo --exclude .codegraph --exclude .kilo
  --exclude .sessions --exclude .tmp --exclude .sandbox-scratch --exclude .screen_monitor
  --exclude repl_state --exclude slack_events --exclude __pycache__ --exclude .pytest_cache
  --exclude .mypy_cache --exclude .ruff_cache --exclude .git --exclude .vscode --exclude .DS_Store
)
MCP_EXCLUDES=(
  --exclude node_modules --exclude dist --exclude .venv --exclude venv
  --exclude __pycache__ --exclude .pytest_cache --exclude .git
)

echo "[sync] Ron -> $DEST:/opt/ron/RonBrowserRebuild/"
rsync -az --delete -e "$SSH_CMD" "${RON_EXCLUDES[@]}" "$@" ./ "$DEST:/opt/ron/RonBrowserRebuild/"

echo "[sync] electron-playwright-mcp -> $DEST:/opt/ron/electron-playwright-mcp/"
rsync -az --delete -e "$SSH_CMD" "${MCP_EXCLUDES[@]}" "$@" ../electron-playwright-mcp/ "$DEST:/opt/ron/electron-playwright-mcp/"

echo "SYNC OK"
