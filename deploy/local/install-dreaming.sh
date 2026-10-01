#!/usr/bin/env bash
# Install the dreaming tick on this Mac: every minute POST /memory/dream (idle-gated server-side).
# macOS blocks non-interactive `crontab` edits behind a TCC prompt, so the vendored strands_tools
# `cron` tool is the Linux/VPS path; this launchd agent is the Mac equivalent of that crontab line.
# Usage: deploy/local/install-dreaming.sh [--uninstall]
set -Eeuo pipefail

LABEL=com.ronbrowser.dreaming
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "DREAMING UNINSTALLED"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s|__HOME__|$HOME|g" "$REPO_ROOT/deploy/local/$LABEL.plist" > "$PLIST"
plutil -lint "$PLIST"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl kickstart -k "gui/$UID_NUM/$LABEL"
echo "DREAMING INSTALLED"
launchctl print "gui/$UID_NUM/$LABEL" | grep -E "state|interval|program" | head -5
