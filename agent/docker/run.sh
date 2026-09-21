#!/bin/bash
# Run the virtual desktop container
# Desktop view: http://localhost:6080/vnc.html

docker run -d \
    --name ron-sandbox \
    -p 6080:6080 \
    ronbrowser-sandbox

echo "Virtual desktop running:"
echo "  Desktop: http://localhost:6080/vnc.html"
