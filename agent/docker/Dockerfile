FROM debian:12-slim

ENV DEBIAN_FRONTEND=noninteractive

# System deps for virtual desktop
RUN apt-get update && apt-get -y install \
    xvfb xterm xdotool scrot imagemagick openbox x11vnc \
    python3 git \
    tesseract-ocr \
    firefox-esr chromium gedit pcmanfm \
    && rm -rf /var/lib/apt/lists/*

# noVNC for viewing the desktop
RUN git clone --branch v1.5.0 https://github.com/novnc/noVNC.git /opt/noVNC && \
    git clone --branch v0.12.0 https://github.com/novnc/websockify /opt/noVNC/utils/websockify && \
    ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

WORKDIR /app

RUN mkdir -p /workspace

# Display config
ENV DISPLAY_NUM=1
ENV WIDTH=1024
ENV HEIGHT=768
ENV DISPLAY=:1

EXPOSE 5900 6080

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
