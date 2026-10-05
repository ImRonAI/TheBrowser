"""Browser targets for the Agent Panel.

A chat picks exactly one browser up front:

* ``user``  – the user's own Ron window, reached from the server through the SSH
  reverse tunnel (Mac 3000/8931/9222 appear on the VPS loopback as 13000/18931/19222).
* ``cloud`` – the Ron instance running next to the API on the server (3000/8931/9222).

Both are served by the same ``electron-playwright-mcp`` stdio server; only the
``ELECTRON_PLAYWRIGHT_MCP_*_URL`` environment differs. This module owns those
definitions so the prompt, the catalog staging and the availability hook agree.
It never starts a client and never reads ``.env`` itself (config.py loads it).
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Final, Literal

import httpx
from strands.hooks import HookProvider, HookRegistry
from strands.hooks.events import BeforeToolCallEvent

if TYPE_CHECKING:
    from strands.tools.mcp import MCPClient
    from strands.tools.mcp.mcp_client import ToolFilters

BrowserName = Literal["user", "cloud"]
BROWSERS: Final[tuple[str, ...]] = ("user", "cloud")

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[3]

#: electron-playwright-mcp stdio entrypoint installed into the project venv.
ELECTRON_MCP_COMMAND: Final[str] = str(REPO_ROOT / "venv" / "bin" / "electron-playwright-mcp")

_SURFACES: Final[tuple[tuple[str, str], ...]] = (
    # (RON_<TARGET>_BROWSER_<SURFACE>_URL suffix, env name the MCP server reads)
    ("ELECTRON", "ELECTRON_PLAYWRIGHT_MCP_ELECTRON_URL"),
    ("PLAYWRIGHT", "ELECTRON_PLAYWRIGHT_MCP_PLAYWRIGHT_URL"),
    ("CDP", "ELECTRON_PLAYWRIGHT_MCP_CDP_URL"),
)

_DEFAULT_URLS: Final[dict[str, dict[str, str]]] = {
    "user": {
        "ELECTRON": "http://127.0.0.1:13000/electron",
        "PLAYWRIGHT": "http://127.0.0.1:18931/mcp",
        "CDP": "http://127.0.0.1:19222",
    },
    "cloud": {
        "ELECTRON": "http://127.0.0.1:3000/electron",
        "PLAYWRIGHT": "http://127.0.0.1:8931/mcp",
        "CDP": "http://127.0.0.1:9222",
    },
}


def _validate(browser: str) -> BrowserName:
    if browser == "user" or browser == "cloud":
        return browser
    raise ValueError(f"browser must be one of {BROWSERS!r}, got {browser!r}")


def server_name(browser: str) -> str:
    """MCP server name (and tool prefix) for a browser target, e.g. ``user_browser``."""
    return f"{_validate(browser)}_browser"


def _surface_url(browser: BrowserName, surface: str) -> str:
    override = os.environ.get(f"RON_{browser.upper()}_BROWSER_{surface}_URL")
    return override if override else _DEFAULT_URLS[browser][surface]


def browser_electron_url(browser: str) -> str:
    """The Electron HTTP surface URL for a target; probed by the availability hook."""
    return _surface_url(_validate(browser), "ELECTRON")


def browser_server_config(browser: str) -> dict[str, dict[str, object]]:
    """Strands MCP server config (stdio) holding ONLY the selected browser's server."""
    name = _validate(browser)
    env = {env_name: _surface_url(name, surface) for surface, env_name in _SURFACES}
    return {server_name(name): {"command": ELECTRON_MCP_COMMAND, "args": [], "env": env}}


def default_browser() -> str:
    """Browser used when a request omits ``browser``; ``RON_BROWSER_DEFAULT`` or ``user``."""
    return _validate(os.environ.get("RON_BROWSER_DEFAULT", "user"))


def is_browser_tool(name: str) -> bool:
    """``True`` for any tool staged from a browser server (``user_browser_*`` / ``cloud_browser_*``)."""
    return any(name.startswith(f"{server_name(browser)}_") for browser in BROWSERS)


def browser_client_factory(browser: str, *, tool_filters: ToolFilters | None = None,
                           extra_env: Mapping[str, str] | Callable[[], Mapping[str, str]] | None = None) -> Callable[[], MCPClient]:
    """Factory for an UNSTARTED, prefixed ``MCPClient`` with the no-approval elicitation policy.

    ``extra_env`` (mapping or zero-arg callable evaluated on every call of the factory) is merged
    into the server process environment; the tool fixer uses it to put a user's repaired
    ``electron_playwright_mcp`` package first on that user's server ``PYTHONPATH``
    (``tool_repair.browser_server_env``), so one user's server repair never affects another's and a
    restarted server picks up the revision active at restart time.

    electron-playwright-mcp's ApprovalRequiredMiddleware elicits on every mutating tool
    regardless of Electron's own ``requireApproval`` flag; ``MCPClient.load_servers`` builds
    clients without an elicitation callback, so the mcp default would answer "Elicitation
    not supported". The catalog calls this factory when the server is loaded by name.
    ``tool_filters`` is the client's native filter, matched against unprefixed MCP tool names.
    """
    from mcp import StdioServerParameters, stdio_client
    from strands.tools.mcp import MCPClient

    from agent.api.core.panel_tools import accept_browser_elicitation

    name = server_name(browser)

    def factory() -> MCPClient:
        config = browser_server_config(browser)[name]
        extra = extra_env() if callable(extra_env) else (extra_env or {})
        env = {**dict(config["env"]), **dict(extra)}  # type: ignore[arg-type]
        params = StdioServerParameters(command=str(config["command"]), args=list(config["args"]), env=env)  # type: ignore[arg-type]
        return MCPClient(
            lambda: stdio_client(params), prefix=name, elicitation_callback=accept_browser_elicitation,
            tool_filters=tool_filters,
        )

    return factory


# --- availability policy --------------------------------------------------------------------

#: agent.state key prefix; the suffix is the toolUseId being gated.
ATTEMPTS_STATE_PREFIX: Final[str] = "panel.browser.unavailable_attempts:"
CANCEL_MESSAGE: Final[str] = "Browser unavailable; user cancelled this action."
PROBE_TIMEOUT_SECONDS: Final[float] = 2.0

_QUESTIONS: Final[dict[str, str]] = {
    "user": "Your browser is offline. Reconnect the tunnel and reply 'continue', or reply 'cancel'.",
    "cloud": "The cloud browser is not responding. Reply 'continue' to retry once it is back, or reply 'cancel'.",
}

Probe = Callable[[str], Awaitable[bool]]


def _transport_factory() -> httpx.AsyncBaseTransport | None:
    """Indirection so tests can swap in ``httpx.MockTransport``; ``None`` = default transport."""
    return None


async def default_probe(url: str) -> bool:
    """``True`` when the Electron surface answers with *any* HTTP response.

    Any transport failure — refused connection, EOF behind a live SSH listener whose
    Mac-side channel is gone (``RemoteProtocolError``), or a timeout on a dead listener —
    counts as unavailable. Async so the single-worker event loop never blocks.
    """
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS, transport=_transport_factory()) as client:
            await client.get(url)
    except httpx.HTTPError:
        return False
    return True


class BrowserAvailabilityHook(HookProvider):
    """Pause the run with a native interrupt when the selected browser is unreachable.

    Applies to tools prefixed ``<browser>_browser_`` only. Before such a tool runs the
    Electron URL is probed; if it is down the hook raises ``browser_unavailable:<attempt>``
    through ``BeforeToolCallEvent.interrupt``. On resume, ``cancel`` sets ``cancel_tool``
    (Strands turns that into an error tool result); any other reply re-probes and either
    proceeds or interrupts again with the next attempt number. The tool itself is never
    retried or replayed by this hook.
    """

    def __init__(self, browser: str, *, probe: Probe | None = None) -> None:
        self.browser: BrowserName = _validate(browser)
        self.prefix = f"{server_name(self.browser)}_"
        self._probe: Probe = probe or default_probe

    def register_hooks(self, registry: HookRegistry, **kwargs: object) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before_tool_call)

    async def before_tool_call(self, event: BeforeToolCallEvent) -> None:
        name = event.tool_use.get("name", "")
        if not name.startswith(self.prefix):
            return
        tool_use_id = str(event.tool_use["toolUseId"])
        state_key = f"{ATTEMPTS_STATE_PREFIX}{tool_use_id}"
        url = browser_electron_url(self.browser)
        attempt = int(event.agent.state.get(state_key) or 0)
        while True:
            if attempt:
                # A prior interrupt exists for this attempt; interrupt() returns its response
                # when the user has answered and raises again when it is still pending.
                response = event.interrupt(f"browser_unavailable:{attempt}")
                if isinstance(response, str) and response.strip().lower() == "cancel":
                    event.cancel_tool = CANCEL_MESSAGE
                    return
            if await self._probe(url):
                return
            attempt += 1
            event.agent.state.set(state_key, attempt)
            event.interrupt(
                f"browser_unavailable:{attempt}",
                reason={
                    "browser": self.browser,
                    "tool": name,
                    "url": url,
                    "question": _QUESTIONS[self.browser],
                },
            )
