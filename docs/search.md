# Browser Search — contract

One query from the sidebar search bar (⌘K) becomes `ron://search?q=<query>&level=<level>`
(the tab URL is the source of truth) and the results page streams everything below from
`POST /search/stream` (`agent/api/endpoints/search.py`, fan-out helpers in
`agent/api/core/search_agent.py`).

## Sources per search

| Source | Detail |
|---|---|
| Brave `/web/search` | `count=20` (API page max), `result_filter=web,discussions` |
| Brave `/news/search` | `count=50` |
| Brave `/videos/search` | `count=50` |
| Brave `/images/search` | `count=50` |
| Brave `/local/place_search` | `count=20`; query plus optional profile `location` |
| Perplexity Agent API | `POST /v1/responses`, `preset=<level>`, `model` **always overridden** to `RON_SEARCH_AGENT_MODEL` (default `openai/gpt-6.1-sol`), tools listed (`web_search` high context, `image_search`, `fetch_url`) — they merge per-tool into the preset |
| Perplexity shopping agent | `model=RON_SEARCH_SHOPPING_MODEL` (default `openai/gpt-6-luna`), **no preset** so the tool set is exactly `web_search` (with `filters.search_domain_filter = RON_SEARCH_SHOPPING_DOMAINS`, ≤20 retail domains), `fetch_url`, `image_search`; `max_steps=10` |

Search levels correlate 1:1 with Agent API presets: `fast`, `low`, `medium`, `high`,
`xhigh` (`search_agent.SEARCH_LEVELS`; default `RON_SEARCH_DEFAULT_LEVEL` = `low`).
The level selector lives in the sidebar's search bar and persists in the
search store (`ron-search` localStorage, level only).

## HTTP surface

- `GET /search/status` → `{configured: {brave, perplexity}, levels, default_level, models: {agent, shopping}, shopping_domains}`.
- `POST /search/stream` — body `{q (1..400), level?, country?, location?: FeedLocation, shopping?}`.
  Invalid level → 422 `{code: "invalid_level"}`; neither key set → 503 `{code: "not_configured"}`.
  Otherwise an SSE stream framed exactly like the panel protocol: `event: <name>\ndata: <json>\n\n`.

## SSE events

| Event | Data | Meaning |
|---|---|---|
| `meta` | `{q, level, model, shopping_model, country}` | First frame; the run's provenance |
| `section` | `{kind: web\|news\|videos\|images\|places, q, status, items: DiscoverItem[], error?}` | One per Brave call as it completes; failures are isolated per section (`error` = `error_payload`) |
| `agent.delta` / `agent.reasoning` | `{text}` | Streamed answer / reasoning text |
| `agent.citation` | `{url, title}` | A `url_citation` annotation |
| `agent.sources` / `agent.images` / `agent.fetched` | `{results: [...]}` | Native `search_results` / `image_search_results` / `fetch_url_results` items |
| `agent.done` | `{usage, model, incomplete}` | Terminal for the main answer |
| `shopping.*` | same shapes as `agent.*` | The shopping agent's stream |
| `source_error` | `{source: agent\|shopping\|internal, code, message, status}` | One lane failed; the rest keep streaming |
| `done` | `{duration_ms}` | Always the last frame |

## Renderer

- `src/lib/search-api.ts` — pure SSE parser + `SearchRunState` reducer + tab projections
  (`mergedWebResults` = agent sources ∪ Brave web/discussions with
  `origin: agent|brave|both`; `mergedImages` likewise). Tested by
  `src/lib/search-api.test.ts` (`node --experimental-strip-types --test`).
- `src/stores/searchResultsStore.ts` — runs the stream (abort on new search/unmount).
- `src/pages/SearchResultsPage.tsx` + `src/components/search/` — the tabbed results site:
  AI Agent (streamed answer + citations), Web (Consensus → Agent picks → Across the
  web), Local, News, Images (agent + Brave masonry), Videos, Shopping (buying guide +
  per-merchant product cards).
- Result clicks open a NEW tab via `window.electron.tabs.create(url)`.

## Electron

- `browser:search` IPC (`electron/main.ts`) navigates the active tab to
  `ron://search?q=…&level=…`; `browser:navigate` accepts the same URL directly (what
  the drawer and URL bar use). `ron://search` is an internal page (no WebContentsView),
  titled "Search".

## Env

`RON_SEARCH_AGENT_MODEL`, `RON_SEARCH_SHOPPING_MODEL`, `RON_SEARCH_DEFAULT_LEVEL`,
`RON_SEARCH_SHOPPING_DOMAINS` (comma-separated, clamped to 20) — see
`agent/api/core/config.py`. `BRAVE_SEARCH_API_KEY` and `PERPLEXITY_API_KEY` stay
server-side; `/search/*` responses never carry them.

## Tests

`agent/tests/test_search.py` (offline; request builders, SSE parser, endpoint fan-out
and error isolation) — `./venv/bin/python -m pytest agent/tests/test_search.py -q`.
