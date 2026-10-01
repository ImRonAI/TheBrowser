# Deploying Ron's agent backend to a VPS (24/7) with dual browser targets

Ron's FastAPI agent runs around the clock on a small Ubuntu server and keeps its
sessions, memory and working files in a private Hugging Face bucket. Every chat
picks one browser up front:

| Target | What the agent drives | Reached how |
| --- | --- | --- |
| `user` (**Your browser**, default) | Your real Ron window on your Mac, with your tabs, cookies and logins | SSH reverse tunnel from your Mac to the server loopback |
| `cloud` (**Cloud browser**) | A headless Ron instance running next to the API on the server; its own cookies and logins, keeps working while your Mac is offline | Server loopback |

Nothing but SSH (port 22) is exposed on the server. The Mac reaches the API through
an SSH `-L` forward, so the renderer's `http://localhost:8765` is unchanged.

## Prerequisites

* An Ubuntu LTS server (verified on 26.04 with Python 3.14, and on 24.04 with Python 3.12
  — the GCP `strands` VM; the scripts use the distro `python3` and distro or NodeSource
  Node 22) with root login by SSH key. On GCP (no root SSH) log in as a `google-sudoers`
  user and run the bootstrap with `ssh ron@$RON_VPS_HOST 'sudo bash -s' < deploy/vps-bootstrap.sh`.
  Other workloads that bind only loopback ports other than 3000/8931/9222/8765/13000/18931/19222
  (e.g. OpenClaw's docker on 18789/18790) can coexist; note the bootstrap enables `ufw`.
* The Mac key at `~/.ssh/ronbrowser_upcloud_ed25519` (override with `RON_SSH_KEY`).
* The sibling `../electron-playwright-mcp` checkout next to this repo (it is rsynced too).
* A Hugging Face account/org that can own a private bucket, and a write token.
* Provider API keys you want the server to use (Perplexity, xAI, Mistral, OpenAI, Anthropic, Gemini).
* Locally: `shellcheck` (`brew install shellcheck`) if you edit the scripts.

Everything below takes the server address from the environment (`RON_VPS_HOST`);
no IP or token is committed anywhere in this repository.

## Order of operations

1. **Bootstrap (root, idempotent)** — installs apt packages, Node 22, the `ron`
   user, the `hf` CLI for `ron`, enables `ufw` (SSH only), seeds
   `/etc/ronbrowser/ron.env` with placeholders, writes the two-command sudoers
   drop-in for the Electron sandbox, and sets sshd keepalives.
   ```bash
   ssh -i ~/.ssh/ronbrowser_upcloud_ed25519 root@$RON_VPS_HOST 'bash -s' < deploy/vps-bootstrap.sh
   # run it twice: the second run must print BOOTSTRAP OK with no apt changes
   ssh root@$RON_VPS_HOST 'install -d -m700 -o ron -g ron /home/ron/.ssh && cp /root/.ssh/authorized_keys /home/ron/.ssh/ && chown ron:ron /home/ron/.ssh/authorized_keys && chmod 600 /home/ron/.ssh/authorized_keys'
   ```
2. **Sync** the source of Ron and `electron-playwright-mcp` (never `.env`, `node_modules`, `venv`, `dist`, `.omo`, local runtime dirs):
   ```bash
   RON_VPS_HOST=<host> bash deploy/sync-to-vps.sh          # prints SYNC OK
   ```
3. **Install** as `ron` — venv, requirements, the MCP package (with pinned
   `fastmcp==3.4.0` / `mcp==1.26.0` so Strands' `mcp<2.2` bound holds), both npm
   builds, and the `chrome-sandbox` setuid bit (Chromium's sandbox stays on):
   ```bash
   ssh ron@$RON_VPS_HOST 'bash /opt/ron/RonBrowserRebuild/deploy/vps-install.sh'   # INSTALL OK
   ```
4. **Env file** — fill `/etc/ronbrowser/ron.env` (`root:ron`, mode `640`) from
   `deploy/ron.env.example`: `HF_TOKEN`, `HF_BUCKET_ID`, provider keys. Build it in a
   temp file on your Mac, `scp` it, then delete the temp file. Create the bucket once:
   ```bash
   ssh ron@$RON_VPS_HOST 'set -a; . /etc/ronbrowser/ron.env; set +a; ~/.local/bin/hf buckets create "$HF_BUCKET_ID" --private --exist-ok && ~/.local/bin/hf buckets info "$HF_BUCKET_ID"'
   ```
5. **Units** — install and start the two services:
   ```bash
   ssh root@$RON_VPS_HOST 'install -m644 /opt/ron/RonBrowserRebuild/deploy/systemd/*.service /opt/ron/RonBrowserRebuild/deploy/systemd/*.timer /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now ron-api ron-browser ron-dreaming.timer'
   ```
6. **Tunnel** (Mac) — renders and loads a `launchd` agent that keeps the SSH tunnel up:
   ```bash
   RON_VPS_HOST=<host> bash deploy/local/install-tunnel.sh   # TUNNEL INSTALLED
   bash deploy/local/uninstall-tunnel.sh                     # to remove it
   ```
   While the tunnel is up, do **not** run the local backend (`npm run dev:backend`)
   — it would collide with the `-L 8765` forward.
7. **Smoke**:
   ```bash
   curl -s http://127.0.0.1:8765/health        # {"status":"healthy",...} from the VPS
   curl -s http://127.0.0.1:8765/config | jq .providers
   ```

Redeploy = steps 2, 3, then `systemctl restart ron-api ron-browser`.

## Environment file keys

See [`deploy/ron.env.example`](../deploy/ron.env.example) for the full, commented
list. Highlights: `PANEL_STORAGE=huggingface`, `HF_BUCKET_ID`, `HF_TOKEN`, the six
provider keys, `API_HOST=127.0.0.1`/`API_PORT=8765`, `RON_BROWSER_DEFAULT`
(`user`|`cloud`), and the six `RON_{USER,CLOUD}_BROWSER_{ELECTRON,PLAYWRIGHT,CDP}_URL`
values. The systemd unit pins `API_HOST`/`API_PORT` via `Environment=` so the API
stays on loopback even if the file is edited.

## Ports (all loopback on the VPS)

| Port | Role |
| --- | --- |
| 8765 | Ron agent API (`ron-api.service`), reached from the Mac via `-L 8765`. `ron-dreaming.timer` POSTs `/memory/dream` on loopback every minute; the endpoint consolidates the journal into memory only after `RON_MEMORY_IDLE_SECONDS` (300) of panel idleness. On a Mac, `deploy/local/install-dreaming.sh` installs the launchd equivalent (macOS blocks non-interactive `crontab` behind TCC). |
| 3000 / 8931 / 9222 | Cloud Ron: Electron surface / Playwright MCP surface / CDP (`ron-browser.service`, under `xvfb-run`) |
| 13000 / 18931 / 19222 | The Mac's Ron (3000 / 8931 / 9222) via `-R` reverse forwards |
| 22 | SSH — the only port open in `ufw` |

Health probes that actually exist: `GET :3000/electron/app/isReady` →
`{"ready":true}`, `GET :8931/mcp/tabs` → `{"tabs":[...]}`, `GET :9222/json/version`.

## The browser model

* `POST /chat` accepts `browser: "user" | "cloud"`. Omitted → `RON_BROWSER_DEFAULT`
  (default `user`). The value is pinned into the immutable session selection on the
  first turn; a later turn with a different value is `409`, an invalid value is `422`.
  The renderer shows a **Your browser / Cloud browser** selector that locks after the
  first message ("start a new chat to switch").
* Exactly one MCP server is configured per agent — `user_browser` or `cloud_browser`
  (same `electron-playwright-mcp` binary, different `ELECTRON_PLAYWRIGHT_MCP_*_URL`).
  The agent stages it with `tool_catalog(action="load", name="<browser>_browser")`;
  its tools are prefixed (`user_browser_playwright_List_tabs`, …). Browser tools are
  parent-only: `think` children and formations never inherit them.
* **Unavailability** — before every `<browser>_browser_*` call a native
  `BeforeToolCallEvent` hook probes that target's Electron URL (2 s). If it is down the
  run pauses with interrupt `browser_unavailable:<attempt>` and
  `reason = {browser, tool, url, question}`. Reply `continue` to re-probe and re-attempt
  the same call, or `cancel` to drop that one action (error tool result:
  *Browser unavailable; user cancelled this action.*). Nothing is switched or replayed
  automatically. In the renderer this shows **Continue** / **Cancel action** buttons.
  For `user`, "down" includes your Mac being off or the tunnel being dropped; sshd
  keepalives (15 s × 3) release dead reverse listeners so the tunnel can rebind.
* The cloud browser has its own cookies and logins; nothing is copied from your Mac.
  There is no remote viewer for it.

## Storage

`PANEL_STORAGE=huggingface` stores session snapshots, run journals and memory under
`panel/users/<user-hash>/…` in the bucket. Sessions survive `ron-api` restarts. The
agent is also told to keep durable working files under `workspace/` in the same
bucket via `hf buckets cp|sync` (the token comes from the process env; it never
prints it). Run one writer process only.

## Operations

```bash
ssh root@$RON_VPS_HOST 'systemctl status ron-api ron-browser'
ssh root@$RON_VPS_HOST 'journalctl -u ron-api -f'          # API log
ssh root@$RON_VPS_HOST 'journalctl -u ron-browser -n 100'  # Electron; dbus/GPU errors under xvfb are expected noise
ssh root@$RON_VPS_HOST 'systemctl restart ron-api ron-browser'
launchctl kickstart -k gui/$(id -u)/com.ronbrowser.tunnel  # restart the Mac tunnel
```

If `ron-api` restarts **while a run is executing**, that session comes back with
`recovery_required: true` and error code `recovery_required` ("restored last committed
snapshot; execution was not repeated"). This is deliberate: nothing is replayed. Start
a new chat. Idle sessions restore fully.

## Secrets

Real tokens live **only** in `/etc/ronbrowser/ron.env` on the server (`root:ron`, `640`).
Never commit `.env`, `ron.env`, or anything containing a Hugging Face or UpCloud token
prefix; run the repo's secret scan from todo 30 / `docs/panel-runtime.md` (a `git grep`
for those two prefixes) and require an empty result before every commit. If a token was
ever pasted into a chat, terminal log or ticket, rotate it.
