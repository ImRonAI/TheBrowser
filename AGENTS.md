# AGENTS.md — Ron Browser Rebuild

Guidance for AI coding agents working in this repository. Assume the reader knows nothing about the project.

## Project overview

**Ron Browser** is a local-first, agentic desktop browser. It combines:

- an **Electron** main process (`electron/`) that owns native browser tabs (`WebContentsView`) and embeds browser automation via the sibling package `electron-playwright-mcp` (a `file:../electron-playwright-mcp` dependency — `npm install` fails without that checkout);
- a **React 19 + TypeScript renderer** (`src/`) that acts as the browser chrome (tab bar, URL bar, agent panel, projects/issues boards, onboarding);
- a **Python FastAPI backend** (`agent/api/`, "Ron Browser API" v4.0.0) built on the **Strands Agents SDK 1.56.0**, which owns all agent sessions, tools, providers, and streaming.

The three processes run separately and communicate over localhost HTTP/SSE. There is also a 24/7 VPS deployment (`deploy/`) where the backend and a headless Electron "cloud browser" run under systemd and the Mac reaches them over an SSH tunnel.

### Ports

| Port | Process | Purpose |
|---|---|---|
| `8765` | FastAPI (`agent/api/main.py`) | Agent Panel chat, sessions, SSE, models, projects, articles |
| `3000` | Electron main | Electron control surface for `electron-playwright-mcp` |
| `8931` | Electron main | Playwright MCP HTTP surface |
| `9222` | Electron main | CDP (Chrome DevTools Protocol) |
| `13000`/`18931`/`19222` | SSH reverse tunnel | The Mac's Electron browser as seen from the VPS (`user` browser target) |

The Vite dev-server port can drift; CORS allows any `localhost`/`127.0.0.1` origin by regex.

## Repository layout

```
agent/                  Python backend and agent stack
  api/
    main.py             FastAPI app: lifespan, CORS, routers, /health, /config, run()
    endpoints/
      chat.py           Agent Panel HTTP surface (POST /chat, sessions, steer/cancel, /models, efforts)
      articles.py       POST /articles/extract (SSRF-guarded)
      discover.py       Discover homepage: /discover/status, /feed, /pois, /assist/* (Brave Search, key server-side)
      projects.py       Projects/issues CRUD + issue-agent routes
    core/
      panel_runtime.py  PanelRuntimeManager: server-owned sessions/runs, versioned SSE envelopes
      panel_agent.py    Composition root: create_panel_agent() via strands config_to_agent + overrides
      panel_browser.py  Browser targets (user/cloud), BrowserAvailabilityHook
      panel_tools.py    PanelToolCatalog, ManagedMCP, core tools, vendored tool loading, think tool
      panel_storage.py  Ephemeral vs HuggingFace Buckets storage, memory config
      perplexity_model.py  PerplexityResponsesModel (function-argument recovery)
      panel_a2a.py      Opt-in native Strands A2A server/client
      brave_search.py   BraveClient (shared token bucket, typed BraveSearchError), DiscoverItem normalizers, build_feed
      issue_agents.py   Durable per-issue agents (A2A + SnapshotSessionManager + GoalLoop)
      projects.py / guest_projects.py   Supabase RLS persistence / guest SQLite workspaces
      config.py         All env-driven config; loads .env from repo root
    configs/            Per-provider Strands Agent Config JSON (name/prompt/tools only)
    requirements.txt    Authoritative Python pins (requirements-full.txt is NOT)
  tools/strands_tools/  Vendored tool library (loaded via tool_catalog; keep OFF sys.path)
  tests/                pytest suite (see Testing)
  docs/                 panel-storage.md + vendored Strands SDK reference docs (ground truth)
  prompts/, sops/, templates/, docker/, MemoryOpenSource/   Supporting assets
electron/
  main.ts               Main process: TabsManager, WebContentsView tabs, MCP registration, IPC
  preload.ts            contextBridge window.electron API (no automation here by design)
  agent.md              Electron runbook (automation boundaries)
src/                    React renderer (browser chrome + agent panel)
  lib/panel-stream.ts   SSE protocol core (PanelEvent envelopes, parser, reducer, hydration)
  components/agent-panel/usePanelChat.ts   Panel chat client (hardcoded http://localhost:8765)
  api/, components/, context/, hooks/, layouts/, pages/, stores/, types/, utils/
data/                   Static JSON datasets used by the UI
deploy/                 VPS + local-tunnel deployment (see Deployment)
docs/                   panel-runtime.md (pinned runtime boundary doc), browser-mcp.md, deploy-vps.md, ...
supabase/migrations/    10 SQL migrations (projects, users, issues, issue agents)
tests/issue-ron/        Standalone harness for the issue-Ron feature (not part of node:test runs)
mcp.json                MCP server entries for electron-playwright-mcp / user_browser / cloud_browser
electron.vite.config.ts Three build targets (main, preload, renderer) + aliases
tsconfig.json           Strict TS; paths must mirror the vite aliases
pyrightconfig.json      Points at venv/ (Python 3.14 site-packages)
```

## Commands and setup

- Use `venv/`, not `.venv/`; npm scripts and Pyright target it. Python dependencies come from `agent/api/requirements.txt`.
- `npm install` requires the sibling `../electron-playwright-mcp` package (`file:` dependency).

```bash
npm run electron:dev   # backend + Electron/renderer together
npm run dev:vite       # Electron/renderer, NOT renderer-only; kills :3000/:8931/:9222 first
npm run dev:backend    # venv Python via deploy/local/dev-backend.sh; refuses if :8765 is taken
npm run build          # dist/electron + dist/renderer
npm run start          # built Electron app
npm run typecheck      # tsc --noEmit
./venv/bin/python -m pytest agent/tests -q
./venv/bin/python -m pytest agent/tests/test_chat.py::test_health
node --experimental-strip-types --test src/lib/panel-stream.test.ts   # renderer tests
shellcheck deploy/*.sh deploy/local/*.sh
```

- Manual Electron launches require `unset ELECTRON_RUN_AS_NODE`; the npm scripts handle this.
- Pyright is not installed in `venv/`; use `npx -y pyright@latest <files>`. `panel_agent.py`, `panel_tools.py`, and `chat.py` carry pre-existing pyright errors — compare error sets against the previous commit rather than requiring zero.
- Fresh venvs must pin `fastmcp[apps]==3.4.0` (the `apps` extra brings `prefab-ui`, which `electron_playwright_mcp.server` imports via `fastmcp.apps.approval`; without it every browser-tool load fails with "unhandled errors in a TaskGroup") and `mcp==1.26.0` **before** `pip install --no-deps -e ../electron-playwright-mcp`: its unbounded `fastmcp>=3.2.0` resolves to fastmcp 4 / mcp 2.2, which violates Strands' `mcp<2.2` pin and removes `fastmcp.tools.tool`. `deploy/vps-install.sh` does this and runs `pip check`.
- Key Python pins: `strands-agents[a2a,mistral,openai,anthropic,gemini]==1.56.0`, `strands-xai==0.6.1`, `perplexityai==0.43.5`, `mcp==1.26.0`, `openai==2.50.0`, `anthropic==0.76.0`, `google-genai==2.24.0`, `pydantic==2.12.5`, `huggingface_hub==1.20.1`, `playwright==1.57.0`, `a2a-sdk==0.3.22`.

## Runtime architecture and boundaries

These boundaries are load-bearing; do not casually cross them. `docs/panel-runtime.md` is the pinned authoritative reference.

- **Session ownership**: `PanelRuntimeManager` owns one live agent per user/session and server-owned invocations. Native `SnapshotSessionManager` pairs with an application run journal. Default storage is ephemeral; `PANEL_STORAGE=huggingface` enables HuggingFace Buckets. Run one writer process. Do not replace SDK execution or snapshot implementations.
- **SSE protocol**: the panel uses versioned, session-sequenced application envelopes (`{version: 1, sequence, session_id, run_id, type, node_path}`), not raw SDK or AI SDK UI streams. Keep `agent/api/core/panel_runtime.py`, `src/lib/panel-stream.ts`, and `src/components/agent-panel/usePanelChat.ts` synchronized. `POST /chat` returns the SSE stream directly; `GET /sessions/{id}` is the canonical snapshot; `GET /sessions/{id}/events?after=<seq>` replays; `/steer` and `/cancel` control runs.
- **Agent composition**: agents are built with `strands.experimental.config_to_agent` (accepts only `name`, `model`, `prompt`, string `tools`) plus constructor overrides for provider instances, managers, plugins, and callbacks. A bare model string selects Bedrock. Providers: Perplexity, Mistral, xAI, Gemini, OpenAI, Anthropic (`PROVIDERS` in `panel_agent.py`). Preserve `stream_async`. Preserve `perplexity_model.py`'s complete function-argument recovery. Server-side tools belong in provider configuration, distinct from `Agent.tools`.
- **Tools**: keep `agent/tools/strands_tools/` off `sys.path` (it shadows the installed `strands_tools` distribution). `tool_catalog` imports library files as `ron_vendored_tools.<category>.<module>` (synthetic package, so relative imports resolve) and publishes them at the `AfterTools` boundary. Core tools (`mcp_client`, `editor`, `shell`, `environment`, `http_request`, `perplexity_search`, `tool_catalog`, `ask_user`) come from installed `strands_tools`/vendored `@tool` modules and run on the host; there is no shell sandbox or Shell MCP.
- **`think` tool** exists only for `provider=perplexity`: a child Agent with the parent's tools/model whose events stream under `node_path=[toolUseId]` and render as `ChainOfThought`.
- **Context injection**: browser context (`request_context`) and steering use Strands `InvokeModelStage.Input` as a separate ephemeral user message after tool results, never persisted to messages/journal. Do not fold text into tool-result messages with `ContextInjector(everyTurn)` or add provider ordering subclasses.
- **Shared Memory Agent / journal / dreaming** (`agent/api/core/memory_agent.py`, `endpoints/memory.py`, `core/panel_storage.py`): one `MemoryAgent` per `user_id` (`memory_agent_for`) is a `strands_harness.create_harness()` agent over a native `ModelRouter(FallbackStrategy)` of fast Perplexity Agent API models (`RON_MEMORY_AGENT_MODELS`, default `google/gemini-3.5-flash-lite,openai/gpt-5.4-nano,perplexity/sonar,perplexity/nemotron-3-ultra-550b-a55b`; measured 2026-10-01 TTFT 1.0–1.9 s) with every harness built-in off and the user's **writable** `MemoryManager` over the same stores the panel uses. It serves two prompts: **recall** — `RecallPlugin` (`@hook` on `BeforeInvocation`/`MessageAdded`/`AfterToolCall`) pre-warms a recall per conversation state; its `init_agent` adds an `InvokeModelStage.Input` middleware that awaits `render()` (bounded by `RON_MEMORY_AGENT_TIMEOUT_S`, fail-open) and appends a separate ephemeral trailing user message `<recall source="memory">…</recall>`; the memory agent must finish with the `inject_memory` tool, and the literal `n/a` injects nothing. Register the **same** `RecallPlugin` instance on the panel agent and on the `think` child (`create_think_tool(plugins=[…])`). **Dreaming** — `POST /memory/dream` (loopback only; never in the ngrok allowlist) runs the dream prompt once `PanelRuntimeManager.idle_seconds(user)` ≥ `RON_MEMORY_IDLE_SECONDS` (300): the memory agent reads the vendored `journal` tool and `add_memory`s entries with 10–12 tags from `memory_agent.DEFAULT_TAGS`. Ticks: `deploy/systemd/ron-dreaming.timer` (VPS, every minute) or `deploy/local/install-dreaming.sh` (Mac launchd; macOS blocks non-interactive `crontab` behind TCC, so the vendored `cron` tool is the Linux path). Journal entries follow `MEMORY_JOURNAL_DIRECTIVE` in `panel_agent.py`: `<start_entry>…<end_entry/>`, `<topic_name>` ∈ `panel_storage.ENTRY_TOPICS`, `<subject>` 2–8 words, `<created_at>` to the second, `<tags>` only after dreaming. `SerializedFileMemoryStore.add` stores such entries as one file `<topic>/<YYYYMMDDTHHMMSS>-<subject>.md`; `search(query, {order: [...], since, until, tags, topic, subject})` applies the agent-chosen nested filter order (exposed as the `search_memories` tool beside native `search_memory`/`add_memory`). Tests: `agent/tests/test_memory_agent.py`, `test_memory_dream.py`, `test_panel_storage.py`.
- **Browser targets**: every chat pins one browser target (`ChatRequest.browser`: `user` | `cloud`, default `RON_BROWSER_DEFAULT`/`user`) into the immutable session selection. `panel_browser.py` configures ONLY that target's prefixed `electron-playwright-mcp` server (`user_browser` / `cloud_browser`, staged via `tool_catalog(action="load", name=...)`, elicitation accepted) and registers `BrowserAvailabilityHook`, whose native `BeforeToolCallEvent` interrupt (`browser_unavailable:<n>`, reply `continue`/`cancel`) is the only unavailability policy. Browser tools are parent-only; never auto-switch targets or replay a tool whose result was lost.
- **Electron tabs**: in `electron/main.ts`, every tab must use the `persist:default` session partition so MCP cookie/storage tools see the same store. Preserve `setActiveWebContentsSupplier` for foreground-tab automation; keep automation out of the preload bridge (preload exposes only UI/theme/tab/window IPC, guarded by `validateIpcSender`).
- **Automation probes**: real electron-playwright-mcp HTTP probes are `GET :3000/electron/app/isReady`, `GET :3000/electron/app/version`, `GET :8931/mcp/tabs`, `GET :9222/json/version`. There is no `/electron/tabs`. Under `xvfb-run`, `Failed to connect to the bus` and GPU-process errors in `journalctl -u ron-browser` are expected noise.
- **Browser-tool QA** must select a native provider (e.g. `"provider": "xai"`): the default Perplexity catalogue model `xai/grok-4.5` narrates but does not emit tool calls, so `browser_unavailable` never fires and runs sit in `running` until `POST /sessions/{id}/cancel`. A `ron-api` restart mid-run yields `recovery_required: true` by design; nothing is replayed.
- **Voice / Gemini Live** (`agent/api/core/bidi_agent.py`, `endpoints/bidi.py`): `WebSocket /bidi` hosts one Strands `BidiAgent` on `GoogleGeminiLiveModel`. Model query is `gemini-3.8-live-extended-thinking` (default) or `gemini-3.8-live`. Auth is `GOOGLE_API_KEY` (`GEMINI_API_KEY` falls back to it). The tool list is the panel catalog plus camera/screen switches; `think`, `ask_user`, and `BrowserAvailabilityHook` are not registered. `run_skill` is added when skill files load. Client frames are SDK `bidi_audio_input` / `bidi_image_input` dicts. Do not pass `enable_affective_dialog` or `proactivity`.
- **Discover / Brave Search** (`agent/api/core/brave_search.py`, `endpoints/discover.py`): `BRAVE_SEARCH_API_KEY` is backend-only — never mirror it as `VITE_*`; the renderer calls `POST /discover/feed` and receives normalized `DiscoverItem` records (`kind`: article/video/image/place/discussion/web/rich) plus per-section `{status, error}` so one failing source never blanks the page. Verified live 2026-09-25 on the Search plan: `/web/search`, `/news/search`, `/videos/search`, `/images/search`, `/local/place_search` (**not** `/places/search`, which 301s to marketing HTML), `/local/pois`, `/local/descriptions`, `/llm/context`, `/web/rich` return 200; `/suggest/search`, `/spellcheck/search` return `400 OPTION_NOT_IN_PLAN` (separate subscriptions) and surface as `code: not_in_plan`. **Rich Search** is a two-step flow implemented in `BraveClient.rich_hint` → `rich` (`answer` chains both): `GET /web/search?enable_rich_callback=true&result_filter=web&count=1` with `Cache-Control: no-cache` is the cheapest call that still yields `rich.hint.{vertical,callback_key}` (`result_filter=query` suppresses it); then `GET /web/rich?callback_key=` (keys replay; an unknown/expired key returns `200 {results: []}`, not an error). Live verticals: weather (OpenWeatherMap, metric regardless of `units`), stocks (FMP), cryptocurrency (CoinGecko), currency (Fixer), calculator, unitconversion (units only, no computed value), unixtimestamp, definitions (Wordnik), sports (API-Sports; payload keyed by sport name, e.g. `basketball`/`football`). `normalize_rich` returns `RichAnswer{vertical, subtype, provider, card, raw}` where `card` is a compact provider-agnostic contract (sparklines downsampled to `SPARKLINE_POINTS`=60) and unknown subtypes still ship `raw`. Surfaces: `POST /discover/answer {q}` → `{answers: RichAnswer[]}` (`[]` when no vertical), and `{kind: "rich", q}` feed sections → `DiscoverItem(kind="rich", rich=RichAnswer)`; `/discover/status.rich_verticals` lists the card builders. Plan policy header is `50;w=1, 0;w=2592000` (50 req/s, no monthly cap); `BRAVE_SEARCH_RPS` (default 10) caps the shared client-side bucket. Place browsing without `q` needs coordinates or `location` (else 422). Tests: `agent/tests/test_discover.py` (offline, `httpx.MockTransport`).
- **Onboarding → Discover profile** (`src/stores/onboardingStore.ts`, `src/lib/discover-profile.ts`, `src/stores/discoverProfileStore.ts`): onboarding is a typed interview only (the voice/`talk` mode, `VoiceOnboardingScene`, `useVoiceAgent` and the `voice-agent:*` IPC that spawned a non-existent `agents/voice_onboarding/agent.py` were removed; persist version 2 migrates old state). `INTERVIEW` is the typed script (`id`, `question`, `placeholder`); answers persist keyed by question text, so read them with `answerFor(answers, id)`, never by substring. `buildProfile()` parses free text into `DiscoverProfile{topics, location, country, teams, stocks, crypto, currencies, media}`; `buildFeedRequest()` turns it into the `POST /discover/feed` body (≤ `MAX_FEED_SECTIONS`=12); `interestSeeds()` seeds the Interests orb (`interestsStore.initializeFromOnboarding`). `useDiscoverProfile()`/`getDiscoverProfile()` layer persisted per-field `overrides` (`discover-profile-storage`) over the parsed answers. Onboarding shows automatically only for signed-in users without a completed run; guests (and anyone redoing it) reach it via `window.location.hash = '#onboarding'` (`App.tsx`; the Discover header's "Personalize / Redo interview" button does `resetOnboarding()` + that hash). On completion `OnboardingPage.applyOnboardingAnswers()` resets profile overrides, clears the cached feed, re-seeds the Interests orb (`resetInterests` + `initializeFromOnboarding`) and clears the hash, so the new answers take effect immediately. Pure lib files use relative `.ts` imports so `node --experimental-strip-types` can run them. Spec for the persistent interests agent behind the orb: `docs/interests-agent.md`.
- **Discover homepage feed** (`src/lib/discover-feed.ts`, `src/stores/discoverFeedStore.ts`, `src/components/home/RichAnswerCard.tsx`, `src/pages/HomePage.tsx`): `DiscoverContent` calls `useDiscoverFeedStore().load(profile)` on mount/profile change; the store posts `buildFeedRequest(profile)` to `POST /discover/feed`, caches `sections` in localStorage (`discover-feed-storage`) keyed by the exact request body, and reuses them for `FEED_TTL_MS` (30 min) — "Refresh" forces. Errors are kept beside the last good feed (`error.code`: `not_configured` → key missing on backend, `unreachable` → API down, else Brave codes such as `not_in_plan`/`rate_limited`) and shown as a status line; the bundled `data/*.json` datasets (`FALLBACK_GROUPS`) render while loading or when nothing live is available. `sectionsToStoryGroups` maps ok news/web/videos sections to `Story[]` groups (URL-deduped, Brave `<strong>`/entities stripped by `stripMarkup`); rich sections become `RichAnswerCard`s (weather, stocks, cryptocurrency, currency, sports; unknown subtypes get a key/value card, never a blank). Opening a story calls `interestsStore.recordInteraction(topic, 0.05)`. Tests: `src/lib/discover-feed.test.ts` (fetch error mapping, TTL/key cache, story/rich mapping).

- **Public ngrok endpoint** (`agent/api/core/public_tunnel.py`): off unless `RON_NGROK=1`; opened/closed in the FastAPI lifespan per ngrok's FastAPI guide, forwards `localhost:$API_PORT`, optional `NGROK_URL` domain (else the account dev domain). A Traffic Policy denies (404 at ngrok's edge) every path except `RON_NGROK_ALLOW_PATHS` (default `/telnyx/webhook`). ngrok's `verify-webhook` has no Telnyx provider, so each allowed route must verify Telnyx Ed25519 signatures itself. `ngrok` is not in `requirements.txt`. Never widen the allowlist to `/chat` or `/sessions`: those run host shell tools.

## Testing

- **Python**: `./venv/bin/python -m pytest agent/tests -q`. Suite map:
  - `test_chat.py` — guards, model catalogue, effort caching (mock the six live generation probes from `/models/{model_id:path}/efforts`).
  - `test_panel_runtime.py` — native runtime integration: sessions, SSE envelopes, replay, steering, interrupts, snapshots.
  - `test_panel_tools.py` — tool catalog, vendored imports, MCP management.
  - `test_panel_composition.py` / `test_panel_api.py` / `test_panel_end_to_end.py` — composition root and HTTP→Strands→SSE integration, fully offline.
  - `test_panel_browser.py` — browser targets, `BrowserAvailabilityHook`, `mcp.json` parity.
  - `test_panel_prompt.py` — per-browser system-prompt composition.
  - `test_discover.py` — Brave-backed Discover feed: normalizers, per-section error isolation, rate limiter, plan-entitlement mapping, HTTP surface (`httpx.MockTransport`, no network).
  - `test_perplexity_model.py`, `test_panel_providers.py`, `test_mistral_model.py`, `test_panel_storage.py`, `test_issue_agents.py`, `test_guest_projects.py`, `test_projects_api.py`, `test_articles.py`, `test_browser_mcp_experience.py`.
  - Tests run offline against the real installed Strands SDK; mock provider clients and network I/O.
- **Renderer**: colocated `node:test` files with TS type stripping, e.g. `node --experimental-strip-types --test src/lib/panel-stream.test.ts` (also `src/lib/articles.test.ts`, `src/lib/discover-profile.test.ts`, `src/lib/discover-feed.test.ts`, `project-*.test.ts`, `src/stores/*.test.ts`). `tests/issue-ron/` is a separate standalone harness.
- **Shell**: `shellcheck deploy/*.sh deploy/local/*.sh`.
- Live Supabase RLS and VPS behavior need separate acceptance tests; unit tests use SQLite/in-memory doubles.

## Code style and conventions

- **TypeScript**: strict mode; `noUnusedLocals`/`noUnusedParameters` — unused symbols fail `npm run typecheck`. Keep `@/*` and `@catalyst/*` aliases synchronized in `tsconfig.json` and `electron.vite.config.ts`. `src/components/ai-elements/theapp` is excluded from typechecking.
- **Renderer state**: Zustand 5 stores in `src/stores/` (many persisted to localStorage). UI kit: Tailwind 3 + shadcn (`components.json`) + Radix/Headless UI + the Catalyst kit (`@catalyst`).
- **Python**: follow the existing module style in `agent/api/`; env-driven config lives in `agent/api/core/config.py` (loads `.env` from the repo root). Ground Strands work in `agent/docs/strands/` and the installed SDK, not assumptions.
- Make minimal changes; don't refactor adjacent code. Update this file and `docs/` when you change commands, ports, boundaries, or deployment.

## Security considerations

- Secrets (provider API keys, Supabase, AWS) live only in `.env` locally and `/etc/ronbrowser/ron.env` on the VPS; `deploy/ron.env.example` has placeholders. Never sync `.env` (`deploy/sync-to-vps.sh` excludes it).
- `endpoints/articles.py` is SSRF-guarded: public HTTPS only, `MAX_BYTES = 2_000_000`, extracted content prefixed as untrusted.
- Projects API uses Supabase RLS with bearer tokens; guest workspaces use an `x-ron-workspace` 64-hex header hashed (sha256 → uuid5) into an identity, persisted in local SQLite (`guest_projects.py`).
- Electron IPC handlers validate the sender origin (`validateIpcSender`); the renderer window is sandboxed and automation is reachable only via localhost MCP servers.
- Core agent tools (`shell`, `editor`, `http_request`) execute on the host with no sandbox — treat agent output as trusted code execution.
- On the VPS only SSH is public; the API binds `127.0.0.1:8765` and tunnel listeners stay on loopback. Chromium's sandbox stays enabled on the server (setuid chrome-sandbox via the two sudoers rules written by `vps-bootstrap.sh`).

## Deployment

`deploy/` holds the 24/7 VPS layout; see `docs/deploy-vps.md`.

```bash
RON_VPS_HOST=<host> bash deploy/sync-to-vps.sh            # rsync repo + ../electron-playwright-mcp to /opt/ron (never .env)
ssh ron@<host> bash /opt/ron/RonBrowserRebuild/deploy/vps-install.sh   # venv, pins, npm builds, chrome-sandbox bit
RON_VPS_HOST=<host> bash deploy/local/install-tunnel.sh    # launchd SSH tunnel on this Mac
```

- `deploy/vps-bootstrap.sh` — idempotent root bootstrap (Ubuntu; firewall opens only SSH; seeds placeholder env).
- systemd units (`deploy/systemd/`): `ron-api.service` (FastAPI on `127.0.0.1:8765` via `API_HOST`/`API_PORT`) and `ron-browser.service` (headless Electron under `xvfb-run`).
- The Mac tunnel (`deploy/local/tunnel.sh`): `-L 8765` brings the VPS API to `localhost:8765` (renderer URL unchanged); `-R 13000/18931/19222` exposes this Mac's Electron to the VPS as the `user` browser target. Do not run `dev:backend` while the tunnel is up — `dev-backend.sh` refuses to take a busy port; use `API_PORT=8766` for a separate local API.
