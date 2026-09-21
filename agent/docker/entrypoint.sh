#!/bin/bash
set -e

# Start virtual display
Xvfb :${DISPLAY_NUM} -screen 0 ${WIDTH}x${HEIGHT}x24 &
sleep 2

# Start window manager
DISPLAY=:${DISPLAY_NUM} openbox 2>/tmp/openbox.log &
sleep 1

# Start VNC server
x11vnc -display :${DISPLAY_NUM} -forever -shared -rfbport 5900 -nopw 2>/dev/null &

# Start noVNC web interface
/opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &

echo "Desktop sandbox ready"
echo "  VNC: http://localhost:6080/vnc.html"

mkdir -p /workspace

exec tail -f /dev/null
