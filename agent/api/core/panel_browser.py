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
from pathlib import Path
from typing import Final, Literal

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
