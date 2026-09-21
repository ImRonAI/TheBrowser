#!/usr/bin/env bash
# Stop and remove the com.ronbrowser.tunnel launchd agent.
set -Eeuo pipefail
LABEL=com.ronbrowser.tunnel
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "TUNNEL REMOVED"
