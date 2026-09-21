# Repository Guidelines

## Commands and setup

- Use `venv/`, not `.venv/`; npm scripts and Pyright target it. Dependencies: `agent/api/requirements.txt`; `requirements-full.txt` is not an authoritative lock.
- `npm install` requires the sibling `../electron-playwright-mcp` package (`file:` dependency).

```bash
npm run electron:dev   # backend + Electron/renderer
npm run dev:vite       # Electron/renderer, NOT renderer-only; kills :3000/:8931/:9222
npm run dev:backend    # venv Python; kills :8765
npm run build          # dist/electron + dist/renderer
npm run typecheck
./venv/bin/python -m pytest agent/tests -q
./venv/bin/python -m pytest agent/tests/test_chat.py::test_health
```

- Manual Electron launches require `unset ELECTRON_RUN_AS_NODE`; npm handles this.
- `test_chat.py` covers guards/catalogue/effort caching; `test_panel_*.py` covers native runtime, storage, tools, composition and HTTP streaming. Renderer transport tests use `node --experimental-strip-types --test src/lib/panel-stream.test.ts`.

## Runtime boundaries

- Electron, React renderer, and FastAPI (`agent/api/main.py`, port `8765`) run separately. Ports `3000`/`8931`/`9222` serve Electron automation/Playwright MCP/CDP; the Vite renderer port can drift.
- In `electron/main.ts`, every tab must use `persist:default` to match MCP cookie/storage access. Preserve `setActiveWebContentsSupplier` for foreground-tab automation; keep automation out of the preload bridge.
- `PanelRuntimeManager` owns one live agent per user/session and server-owned invocations. Native `SnapshotSessionManager` pairs with an application run journal. Default storage is ephemeral; `PANEL_STORAGE=huggingface` enables Buckets. Run one writer process. Do not replace SDK execution or snapshot implementations.
- SSE uses versioned, session-sequenced application envelopes, not raw SDK or AI SDK UI streams. Keep `panel_runtime.py`, `src/lib/panel-stream.ts`, and `src/components/agent-panel/usePanelChat.ts` synchronized.
- Keep `agent/tools/strands_tools/` off `sys.path`: it shadows the installed `strands_tools` distribution. `tool_catalog` imports library files as `ron_vendored_tools.<category>.<module>` (synthetic package, relative imports resolve) and publishes them at the `AfterTools` boundary. Core tools (`mcp_client`, `editor`, `shell`, `environment`, `http_request`, `perplexity_search`, `tool_catalog`, `ask_user`) come from installed `strands_tools`/vendored `@tool` modules and run on the host; there is no shell sandbox or Shell MCP.
- `think` exists only for `provider=perplexity`: a child Agent with the parent's tools/model whose events stream under `node_path=[toolUseId]` and render as `ChainOfThought`. Browser context (`request_context`) and steering use Strands `InvokeModelStage.Input` as a separate ephemeral user message after tool results, never persisted to messages/journal. Do not fold text into tool-result messages with `ContextInjector(everyTurn)` or add provider ordering subclasses; see `docs/panel-runtime.md` for the pinned internal middleware boundary.
- Every chat pins one browser target (`ChatRequest.browser`: `user` | `cloud`, default `RON_BROWSER_DEFAULT`/`user`) into the immutable session selection. `agent/api/core/panel_browser.py` owns the targets: `create_panel_agent(browser=...)` configures ONLY that target's prefixed `electron-playwright-mcp` server (`user_browser` / `cloud_browser`, staged via `tool_catalog(action="load", name=...)`, elicitation accepted) and registers `BrowserAvailabilityHook`, whose native `BeforeToolCallEvent` interrupt (`browser_unavailable:<n>`, reply `continue`/`cancel`) is the only unavailability policy. Browser tools are parent-only; never auto-switch targets or replay a tool whose result was lost.
- `deploy/` holds the 24/7 VPS layout (bootstrap/sync/install scripts, systemd units for `ron-api` + headless `ron-browser`, Mac launchd SSH tunnel). On the server `main.run()` binds `API_HOST`/`API_PORT` = `127.0.0.1:8765`; only SSH is public. The Mac reaches the API through `-L 8765` and exposes its own Ron via `-R 13000/18931/19222`. Secrets live only in `/etc/ronbrowser/ron.env`; `deploy/ron.env.example` has placeholders. See `docs/deploy-vps.md`.

## Strands implementation direction

- Requested target: config-driven async streaming covering all SDK features/plugins, session/context/conversation management, retries, and callback handlers; providers: Perplexity Agent API, Gemini AI Studio, xAI, OpenAI, Anthropic. Enable each model's supported server-side tooling. Use parallel subagents for independent work.
- Ground implementation in `agent/docs/strands/` and the installed SDK. `strands.experimental.config_to_agent` accepts only `name`, `model`, `prompt`, and string `tools`; pass provider instances, managers, plugins, and callbacks through constructor overrides. A bare model string selects Bedrock.
- Preserve `stream_async`; the application composes native context management, retries, tools, memory, checkpoints, interrupt responses, steering injection, optional GoalLoop and background tasks. Background tasks wait for completion; callback transport filters foreground duplicates. See `docs/panel-runtime.md` for verified boundaries.
- Current chat uses `config_to_agent` with constructor overrides, pinned Strands 1.56.0, and native Perplexity/Mistral/xAI/Gemini/OpenAI/Anthropic integrations. Provider-prefixed Perplexity catalogue IDs are distinct from native provider integration. Provider-hosted tooling is adapter/model-dependent.
- Preserve `agent/api/core/perplexity_model.py`'s complete function-argument recovery. Server-side tools belong in provider configuration, distinct from `Agent.tools`; verify adapter support and event handling per provider.
- `/models/{model_id:path}/efforts` makes six live generation probes on cache misses; mock these in tests.

## Typechecking traps

Unused TypeScript symbols fail typecheck. Keep `@/*` and `@catalyst/*` aliases synchronized in `tsconfig.json` and `electron.vite.config.ts`; `src/components/ai-elements/theapp` is excluded from typechecking.
