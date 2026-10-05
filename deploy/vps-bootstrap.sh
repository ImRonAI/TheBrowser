#!/usr/bin/env bash
# Idempotent root bootstrap for the Ron VPS (Ubuntu 26.04 LTS; also usable as UpCloud user-data).
# Every step is a no-op on re-run. Opens only SSH on the firewall. Contains no secrets:
# /etc/ronbrowser/ron.env is seeded from placeholder values identical to deploy/ron.env.example.
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { printf '[bootstrap] %s\n' "$*"; }

require_root() {
  [ "$(id -u)" -eq 0 ] || { echo "vps-bootstrap.sh must run as root" >&2; exit 2; }
}

install_apt_packages() {
  log "apt packages"
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    git curl rsync ca-certificates ufw xvfb dbus-x11 fonts-liberation ffmpeg \
    python3 python3-venv python3-pip \
    libgtk-3-0t64 libnss3 libnspr4 libasound2t64 libgbm1 libdrm2 libxss1 libxtst6 \
    libatspi2.0-0t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 libpango-1.0-0 libcairo2
}

install_node22() {
  if command -v node >/dev/null 2>&1 && node -v | grep -q '^v22'; then
    log "node $(node -v) already present"
    return
  fi
  local candidate
  candidate="$(apt-cache policy nodejs | awk '/Candidate/{print $2}')"
  if [[ "$candidate" == 22* ]]; then
    log "installing distro nodejs $candidate"
    apt-get install -y -qq nodejs npm
  else
    log "installing Node 22 from NodeSource"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  fi
  node -v | grep -q '^v22' || { echo "node 22 not installed" >&2; exit 1; }
  npm -v >/dev/null
}

create_ron_user() {
  id ron >/dev/null 2>&1 || useradd -m -s /bin/bash ron
  install -d -o ron -g ron /opt/ron
  log "user ron ready"
}

install_hf_cli() {
  if [ -x /home/ron/.local/bin/hf ]; then
    log "hf cli already present"
  else
    log "installing hf cli for ron"
    curl -LsSf https://hf.co/cli/install.sh | sudo -u ron bash
  fi
  # shellcheck disable=SC2016  # $HOME must stay literal so ron's shell expands it at login
  grep -q '.local/bin' /home/ron/.profile 2>/dev/null || \
    printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> /home/ron/.profile
  chown ron:ron /home/ron/.profile
}

configure_firewall() {
  ufw allow OpenSSH >/dev/null
  ufw status | grep -q 'Status: active' || ufw --force enable
  log "ufw: ssh only"
}

seed_env_file() {
  install -d -m 750 -o root -g ron /etc/ronbrowser
  if [ -f /etc/ronbrowser/ron.env ]; then
    log "/etc/ronbrowser/ron.env exists; leaving untouched"
    return
  fi
  [ -f /etc/ronbrowser/ron.env ] || cat > /etc/ronbrowser/ron.env <<'ENV'
# Seeded by deploy/vps-bootstrap.sh from deploy/ron.env.example. Fill in real values here only.
PANEL_STORAGE=huggingface
HF_BUCKET_ID=IAMRonHIT/RonBrowserRebuildBucket
HF_TOKEN=REPLACE_ME
PERPLEXITY_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
XAI_API_KEY=
MISTRAL_API_KEY=
API_HOST=127.0.0.1
API_PORT=8765
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
RON_BROWSER_DEFAULT=user
RON_USER_BROWSER_ELECTRON_URL=http://127.0.0.1:13000/electron
RON_USER_BROWSER_PLAYWRIGHT_URL=http://127.0.0.1:18931/mcp
RON_USER_BROWSER_CDP_URL=http://127.0.0.1:19222
RON_CLOUD_BROWSER_ELECTRON_URL=http://127.0.0.1:3000/electron
RON_CLOUD_BROWSER_PLAYWRIGHT_URL=http://127.0.0.1:8931/mcp
RON_CLOUD_BROWSER_CDP_URL=http://127.0.0.1:9222
ENV
  chown root:ron /etc/ronbrowser/ron.env
  chmod 640 /etc/ronbrowser/ron.env
  log "seeded /etc/ronbrowser/ron.env (placeholders)"
}

write_sudoers() {
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<'SUDO'
ron ALL=(root) NOPASSWD: /usr/bin/chown root\:root /opt/ron/RonBrowserRebuild/node_modules/electron/dist/chrome-sandbox, /usr/bin/chmod 4755 /opt/ron/RonBrowserRebuild/node_modules/electron/dist/chrome-sandbox
SUDO
  visudo -cf "$tmp" >/dev/null
  install -m 440 -o root -g root "$tmp" /etc/sudoers.d/ron-sandbox
  rm -f "$tmp"
  log "sudoers drop-in ron-sandbox ok"
}

configure_sshd_keepalive() {
  cat > /etc/ssh/sshd_config.d/60-ron-keepalive.conf <<'SSHD'
ClientAliveInterval 15
ClientAliveCountMax 3
SSHD
  sshd -t
  systemctl reload ssh
  log "sshd keepalive configured"
}

main() {
  require_root
  install_apt_packages
  install_node22
  create_ron_user
  install_hf_cli
  configure_firewall
  seed_env_file
  write_sudoers
  configure_sshd_keepalive
  printf 'BOOTSTRAP OK node=%s python=%s hf=%s\n' \
    "$(node -v)" "$(python3 --version | awk '{print $2}')" \
    "$(sudo -u ron /home/ron/.local/bin/hf version 2>/dev/null | head -1 || echo unknown)"
}

main "$@"
