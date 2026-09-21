#!/usr/bin/env bash
# Render com.ronbrowser.tunnel.plist for this machine and load it as a launchd user agent.
# Usage: RON_VPS_HOST=<host> deploy/local/install-tunnel.sh [--render-only <out.plist>]
set -Eeuo pipefail

if [ -z "${RON_VPS_HOST:-}" ]; then
  echo "usage: RON_VPS_HOST=<host> $0 [--render-only <out.plist>]" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=com.ronbrowser.tunnel
TEMPLATE="$REPO_ROOT/deploy/local/$LABEL.plist"

render() {
  sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
      -e "s|__RON_VPS_HOST__|$RON_VPS_HOST|g" \
      -e "s|__HOME__|$HOME|g" "$TEMPLATE" > "$1"
  plutil -lint "$1"
}

if [ "${1:-}" = "--render-only" ]; then
  [ -n "${2:-}" ] || { echo "--render-only needs an output path" >&2; exit 2; }
  render "$2"
  exit 0
fi

PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
render "$PLIST"

UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl kickstart -k "gui/$UID_NUM/$LABEL"
echo "TUNNEL INSTALLED"
launchctl print "gui/$UID_NUM/$LABEL" | head -20
