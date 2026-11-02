# Ron repair replica: the isolated environment one tool-repair investigation runs in.
#
# One image, built once per (Ron commit, electron-playwright-mcp commit), reused by every
# investigation (`RON_TOOL_REPAIR_SANDBOX_IMAGE`). It contains the Ron build, both halves of
# electron-playwright-mcp (Python server package + Electron automation), Electron, Xvfb, Python
# and Node dependencies, so the fixer's `shell` can run the recorded tool implementation and the
# built Electron shell headlessly. Nothing from a Mac `node_modules`/`venv` is copied: everything is
# resolved for Linux inside the build. The container never gets the host network, the Docker socket,
# the live profile or the live automation ports (tool_repair.sandbox_run_args).
#
# Build:  bash deploy/repair-replica/build.sh            (tags ron-repair-replica:<ron-sha>-<mcp-sha>)
# Base:   ubuntu:24.04 reproduces the current VPS (Ubuntu 24.04 / Python 3.12); pass
#         --build-arg BASE_IMAGE=ubuntu:26.04 for the recommended baseline of new images.
ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=22
ARG RON_SHA=unknown
ARG MCP_SHA=unknown
LABEL org.opencontainers.image.title="ron-repair-replica" \
      ron.replica.ron_sha="${RON_SHA}" ron.replica.mcp_sha="${MCP_SHA}"

# Same system dependency set as deploy/vps-bootstrap.sh (Chromium runtime + Xvfb + ffmpeg).
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      git curl rsync ca-certificates xvfb dbus-x11 fonts-liberation ffmpeg \
      python3 python3-venv python3-pip \
      libgtk-3-0t64 libnss3 libnspr4 libasound2t64 libgbm1 libdrm2 libxss1 libxtst6 \
      libatspi2.0-0t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 libpango-1.0-0 libcairo2 \
    && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y -qq nodejs \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged user; Chromium's own sandbox stays enabled (setuid chrome-sandbox, as on the VPS).
RUN useradd -m -s /bin/bash ron && install -d -o ron -g ron /opt/ron /workspace
WORKDIR /opt/ron

# Sources are copied from the build context prepared by build.sh (git archives, no node_modules/venv).
COPY --chown=ron:ron RonBrowserRebuild /opt/ron/RonBrowserRebuild
COPY --chown=ron:ron electron-playwright-mcp /opt/ron/electron-playwright-mcp

USER ron
WORKDIR /opt/ron/RonBrowserRebuild
ENV PATH="/opt/ron/RonBrowserRebuild/venv/bin:${PATH}" \
    ELECTRON_RUN_AS_NODE= \
    ELECTRON_PLAYWRIGHT_MCP_USER_DATA_PATH=/workspace/profile \
    DISPLAY=:99

# Python: pinned Strands source + requirements + the MCP server package, exactly like vps-install.sh.
RUN bash deploy/prepare-strands.sh \
    && python3 -m venv venv \
    && venv/bin/pip install -q -U pip \
    && venv/bin/pip install -q -r agent/api/requirements.txt \
    && venv/bin/pip install -q 'fastmcp[apps]==3.4.0' 'mcp==1.26.0' 'pyyaml>=6.0.3' 'httpx>=0.28.1' pytest \
    && venv/bin/pip install -q --ignore-requires-python --no-deps -e /opt/ron/electron-playwright-mcp \
    && venv/bin/pip check

# Node: both npm projects, built for Linux inside the image.
RUN (cd /opt/ron/electron-playwright-mcp && npm ci --no-audit --no-fund && npm run build) \
    && npm ci --no-audit --no-fund \
    && npm run build

USER root
# Chromium sandbox helper must be root-owned setuid (same two steps as vps-install.sh).
RUN SB=/opt/ron/RonBrowserRebuild/node_modules/electron/dist/chrome-sandbox \
    && chown root:root "$SB" && chmod 4755 "$SB"
USER ron

WORKDIR /workspace
# The fixer's shell issues commands; `sleep infinity` keeps the container alive for them.
CMD ["sleep", "infinity"]
