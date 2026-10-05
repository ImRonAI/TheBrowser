# Browser MCP agent experience

Ron uses the linked `electron-playwright-mcp` package (both the npm runtime and
the editable Python stdio server). Changes to that sibling package must be kept
and deployed alongside Ron; rebuilding Ron alone does not compile its TypeScript.
Build the dependency with `npm --prefix ../electron-playwright-mcp run build`,
then build/restart Ron and restart the backend. Start a new conversation to obtain
the updated system prompt and MCP tool schemas.

## Observable behavior

- The host tab controller remains authoritative. Full and same-document
  navigation update the tab strip. Returning to an internal Ron page destroys the
  old hidden website view; snapshots report an actionable internal-page error
  instead of returning a hidden site. Supplier errors never target the app shell.
- Foreground MCP requests are serialized. Clicks wait for loading with a bounded
  timeout; popup clicks snapshot the newly selected foreground tab. The wait ends
  when no main-frame navigation awaits its response and the main document's
  `readyState` is `complete`, so iframes that ads keep loading (e.g. yahoo.com)
  no longer produce `Navigation still loading`.
- Snapshots return tab identity, URL/title, up to 8,000 text characters and 60
  interactive elements. `selector` scopes the DOM and `offset`/`nextOffset` page
  through refs. No full HTML or full AX tree is included. A scoped snapshot or
  bounded JavaScript extraction is needed for text beyond the limit.
- Refs map to DOM elements, not their positions in a freshly enumerated list.
  Document navigation invalidates them. Actions scroll targets into view and
  reject hidden/obscured targets rather than claiming a successful click.
- The screenshot MCP tool returns a native PNG image block and text metadata.
  Base64 is never inserted into model-visible text. The underlying HTTP endpoint
  still supports path-only responses for non-MCP consumers.
- Screenshots require a visible page surface. On an internal Ron tab or a detached view the endpoint returns 400 with an actionable error (navigate first) instead of hanging; the capture itself is bounded by `screenshotTimeoutMs` / `ELECTRON_PLAYWRIGHT_MCP_SCREENSHOT_TIMEOUT_MS` (default 10 s) so the serialized queue never wedges. `GET /mcp/tabs` includes `visible` per tab. The MCP tool relays the host error text as a `ToolError`.
- The application facade reports repeated healthy connect/load operations as
  success. Load readiness is checked against the calling agent's registry, so
  children still load their own tools. Native Strands owns transport/execution.

The browsing prompt calls for a compact task ledger, successful-click counting,
source URLs, short status reports, serial browser actions, and screenshot checks.
These are agent instructions, not a guarantee that an arbitrary model will
complete every requested browsing sequence.

## Regression checks

Use Ron's `venv/bin/python -m pytest agent/tests -q` and its normal typecheck/build.
The sibling package has its own pytest environment (including pytest-asyncio).
Its `tests/runtime.cjs` is an Electron integration test using a local fixture and
isolated ports 19300/19301; it does not change the running user's Ron tabs.

Run with `ELECTRON_RUN_AS_NODE` unset. Set `RON_TEST_PYTHON` to Ron's absolute venv
Python path to test the complete native MCP -> Strands -> Responses image chain.
Set `RON_TEST_CDC=1` to additionally measure a live CDC snapshot and save a PNG.
The test covers bounded/paged output, DOM ref stability and invalidation, actual
click navigation, popup targeting, image delivery, fail-closed targeting, and
invisible-tab refusal and bounded capture on a detached WebContentsView.

Current limitations: snapshot discovery covers the main document, not iframe or
shadow-root internals. Loading completion cannot guarantee every delayed SPA
update has finished; inspect returned state/screenshots when a page updates later.
Image delivery is verified through the SDK formatter, not a paid live-model call.
## One package, two browser targets

The same `electron-playwright-mcp` stdio server now serves both the user's Ron
window and the server-side cloud Ron; only the `ELECTRON_PLAYWRIGHT_MCP_*_URL`
environment differs. `agent/api/core/panel_browser.py` defines the two configs
(`user_browser` → `127.0.0.1:13000/18931/19222`, the Mac's Ron over the SSH reverse
tunnel; `cloud_browser` → `127.0.0.1:3000/8931/9222`), `mcp.json` declares both for
external MCP clients, and the agent stages exactly one per chat with
`tool_catalog(action="load", name="<browser>_browser")`. Tool names carry the
server prefix (`user_browser_playwright_List_tabs`). See `docs/deploy-vps.md`.
