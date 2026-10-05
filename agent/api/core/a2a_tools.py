"""Native A2A client tools for EVERY Ron agent.

One place decides which A2A endpoints Ron's agents can reach and hands each agent the installed
``strands_tools`` ``A2AClientToolProvider`` tools (``a2a_discover_agent``,
``a2a_list_discovered_agents``, ``a2a_send_message``). The endpoints are:

- Ron's own native ``A2AServer`` (``panel_a2a``), mounted by ``main.py`` at ``PANEL_A2A_URL``
  (default ``http://localhost:<API_PORT>/a2a``) unless ``PANEL_A2A_ENABLED=0``;
- any extra agents in ``RON_A2A_AGENTS`` (comma list of absolute HTTP(S) URLs).

Call sites: the panel text agent (``panel_agent``), the Live ``BidiAgent`` (``live_tools``), the
``recall`` child (``memory_agent``), the tool fixer (``tool_repair``), issue agents
(``issue_agents``) and the teaching skill children (``teaching``). Each call builds a fresh provider
so one agent's discovered-agent cache is never shared with another's.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Sequence
from typing import Any
from urllib.parse import urlsplit

from strands.types.tools import AgentTool

logger = logging.getLogger(__name__)

A2A_TOOL_NAMES = ("a2a_discover_agent", "a2a_list_discovered_agents", "a2a_send_message")


def a2a_enabled() -> bool:
    """A2A is on by default; ``PANEL_A2A_ENABLED=0`` turns both the server mount and the tools off."""
    return os.getenv("PANEL_A2A_ENABLED", "1").strip().lower() not in {"0", "false", "no", ""}


def panel_a2a_url() -> str:
    """Where Ron's own A2A server is mounted (``PANEL_A2A_URL``; default this API's ``/a2a``)."""
    from agent.api.core import config

    return os.getenv("PANEL_A2A_URL", f"http://127.0.0.1:{config.API_PORT}/a2a").rstrip("/")


def _valid(url: str) -> bool:
    parsed = urlsplit(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc) and not parsed.query and not parsed.fragment


def a2a_agent_urls(extra: Sequence[str] | None = None) -> list[str]:
    """Ron's A2A endpoints: the panel server (when enabled) plus ``RON_A2A_AGENTS`` and ``extra``."""
    if not a2a_enabled():
        return []
    urls: list[str] = [panel_a2a_url()]
    configured = os.getenv("RON_A2A_AGENTS", "")
    for raw in [*configured.split(","), *(extra or [])]:
        url = raw.strip().rstrip("/")
        if url and _valid(url) and url not in urls:
            urls.append(url)
    return urls


def a2a_tools(*, extra_agents: Sequence[str] | None = None, timeout: int = 300) -> list[AgentTool]:
    """The native A2A client tools for one agent, or ``[]`` when A2A is disabled.

    Discovery is lazy (the provider fetches agent cards on first use), so building these tools
    never performs network I/O and never fails construction when a peer is down.
    """
    urls = a2a_agent_urls(extra_agents)
    if not urls:
        return []
    from strands_tools.a2a_client import A2AClientToolProvider

    return list(A2AClientToolProvider(known_agent_urls=urls, timeout=timeout).tools)


def is_a2a_tool(name: str) -> bool:
    return name in A2A_TOOL_NAMES


def a2a_tool_names(tools: Sequence[Any]) -> list[str]:
    return [tool.tool_name for tool in tools if is_a2a_tool(getattr(tool, "tool_name", ""))]


__all__ = ["A2A_TOOL_NAMES", "a2a_agent_urls", "a2a_enabled", "a2a_tool_names", "a2a_tools", "is_a2a_tool", "panel_a2a_url"]
