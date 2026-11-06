# Browser Search — contract

One query from the navigation-accordion search bar becomes `ron://search?q=<query>&level=<level>`
(the tab URL is the source of truth) and the results page streams everything below from
`POST /search/stream` (`agent/api/endpoints/search.py`, Strands Harness Search Agent and
Shopping Subagent in `agent/api/core/search_agent.py`).

## Sources per search

| Source | Detail |
|---|---|
| Brave `/web/search` | `count=20` (API page max), `result_filter=web,discussions` |
| Brave `/news/search` | `count=50` |
| Brave `/videos/search` | `count=50` |
| Brave `/images/search` | `count=50` |
| Brave `/local/place_search` | `count=20`; query plus optional profile `location` |
| Strands Harness Search Agent (`xai/grok-4.7`) | Built exclusively via the native `strands_harness` configuration system (`define_harness_agent_config` + `harness_agent_kwargs_from_config` -> `create_harness()`) from `agent/api/configs/search/{fast,low,medium,high,xhigh}.json`. Runs on `RonXAIModel` (`grok-4.7`) with progressive reasoning effort (`fast: low`, `low: low`, `medium: medium`, `high: high`, `xhigh: xhigh`), xAI hosted search tools (`web_search`, `x_search`, `code_execution`), Brave search tools (`brave_web_search`, `brave_news_search`, `brave_image_search`, `brave_video_search`, `brave_local_search`), `web_fetch`, and the `subagent` tool (`make_subagent` with `"shopping"` preset). Persisted per `session_id` via `create_harness(session={"id": session_id, "dir": SEARCH_SESSIONS_DIR})` + `XAIStatePruner` for multi-turn conversational follow-ups. |
| Strands Harness Shopping Subagent (`xai/grok-4.7`) | Configured in `agent/api/configs/search/shopping.json` and invoked as the Search Agent's native `subagent` tool (`preset="shopping"`, backed by `create_harness()`). Unrestricted across the web (`RON_SEARCH_SHOPPING_DOMAINS=[]` by default) so it discovers both **Online Retailers** (direct product pages, marketplaces, specialty stores) and **Brick-and-Mortar / Local Stores** (`brave_local_search` + store locator pages with street address, rating, hours, and phone). Its `ToolStreamEvent` chunks stream live into `shopping.*` SSE events. |

Search levels correlate 1:1 with the portable Strands Harness configs under
`agent/api/configs/search/`: `fast`, `low`, `medium`, `high`, `xhigh`
(`search_agent.SEARCH_LEVELS`; default `RON_SEARCH_DEFAULT_LEVEL` = `low`).
The level selector lives in the navigation accordion's search bar and persists in the
search store (`ron-search` localStorage, level only).

## HTTP surface

- `GET /search/status` → `{configured: {brave, xai, perplexity, agent}, provider, levels, level_efforts, default_level, models: {agent, shopping}, shopping_domains}`.
- `POST /search/stream` — body `{q (1..400), level?, country?, location?: FeedLocation, shopping?, session_id?, follow_up?}`.
  Invalid level → 422 `{code: "invalid_level"}`; no search/agent key set → 503 `{code: "not_configured"}`.
  When `follow_up: true` and `session_id` is supplied, static Brave section fan-out is skipped and the existing `create_harness` session continues conversationally with Grok 4.7.
  Otherwise an SSE stream framed `event: <name>\ndata: <json>\n\n`.

## SSE events

| Event | Data | Meaning |
|---|---|---|
| `meta` | `{q, level, model, provider, effort, shopping_model, country, session_id, follow_up}` | First frame; the run's provenance and session id |
| `section` | `{kind: web\|news\|videos\|images\|places, q, status, items: DiscoverItem[], error?}` | One per Brave call as it completes; failures are isolated per section (`error` = `error_payload`) |
| `agent.delta` / `agent.reasoning` | `{text}` | Streamed answer / reasoning text |
| `agent.citation` | `{url, title}` | Inline or markdown URL citation |
| `agent.sources` / `agent.images` / `agent.fetched` | `{results: [...]}` | Native xAI / Brave tool sources and images |
| `agent.done` | `{usage, model, incomplete}` | Terminal for the main answer turn |
| `shopping.*` | same shapes as `agent.*` (`shopping.sources` carry `kind: "online" \| "local"` plus optional `address`, `rating`, `review_count`, `price_range`, `hours`, `phone`, `distance`) | The Shopping Subagent's stream |
| `source_error` | `{source: agent\|shopping\|internal, code, message, status}` | One lane failed; the rest keep streaming |
| `done` | `{duration_ms}` | Always the last frame |

## Renderer

- `src/lib/search-api.ts` — pure SSE parser + `SearchRunState` reducer + `beginFollowUpState` + tab projections
  (`mergedWebResults` = agent sources ∪ Brave web/discussions with
  `origin: agent|brave|both`; `mergedImages` likewise). Tested by
  `src/lib/search-api.test.ts` (`node --experimental-strip-types --test`).
- `src/stores/searchResultsStore.ts` — runs the initial search stream (`start`) and multi-turn conversational follow-ups (`sendFollowUp`).
- `src/pages/SearchResultsPage.tsx` + `src/components/search/` — the tabbed results site:
  AI Agent (multi-turn conversation history + streamed answer + citations + `PromptInput` follow-up composer from `src/components/ai-elements/prompt-input.tsx`), Web (Consensus → Agent picks → Across the
  web), Local, News, Images (agent + Brave masonry), Videos, Shopping (buying guide +
  Brick-and-Mortar & Local Stores section + Online Retailers grouped by merchant).
- Result clicks open a NEW tab via `window.electron.tabs.create(url)`.

## Electron

- `browser:search` IPC (`electron/main.ts`) navigates the active tab to
  `ron://search?q=…&level=…`; `browser:navigate` accepts the same URL directly (what
  the drawer and URL bar use). `ron://search` is an internal page (no WebContentsView),
  titled "Search".

## Env

`RON_SEARCH_PROVIDER` (default `xai`), `RON_SEARCH_AGENT_MODEL` (default `grok-4.7`),
`RON_SEARCH_SHOPPING_MODEL` (default `grok-4.7`), `RON_SEARCH_DEFAULT_LEVEL` (default `low`),
`RON_SEARCH_SHOPPING_DOMAINS` (default `[]` — unrestricted across online and brick-and-mortar stores) — see
`agent/api/core/config.py`. `BRAVE_SEARCH_API_KEY`, `XAI_API_KEY`, and `PERPLEXITY_API_KEY` stay
server-side; `/search/*` responses never carry them.

## Tests

`agent/tests/test_search.py` (offline; Strands Harness config loading, `create_harness` instantiation,
progressive reasoning efforts, shopping `subagent` tool streaming, multi-turn conversational follow-up,
and endpoint fan-out/error isolation) — `./venv/bin/python -m pytest agent/tests/test_search.py -q`.
