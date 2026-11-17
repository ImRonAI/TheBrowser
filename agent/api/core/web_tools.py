"""Web search and reading tools for every Ren agent, in the place of the Brave tools (``config.brave_tools_enabled``).

Tavily (``tavily_search``, ``tavily_extract``, ``tavily_crawl``, ``tavily_map``), Exa (``exa_search``,
``exa_get_contents``) and Bright Data (``bright_data``) are the tools strands_tools vends, which read their own keys.
Olostep has no Strands tool; its hosted MCP server (https://mcp.olostep.com/mcp, the API key as its bearer) is one
process-wide Strands ``MCPClient``, its tools prefixed ``olostep_`` (``olostep_answers``, ``olostep_scrape_website`` and
the rest). Each provider joins only where its key is set.
"""

from __future__ import annotations

import logging
import threading

from strands.tools.mcp import MCPClient
from strands.types.tools import AgentTool

from agent.api.core import config as app_config

logger = logging.getLogger(__name__)

#: The vended tools' names, and the prefix of Olostep's.
TAVILY_TOOL_NAMES: tuple[str, ...] = ("tavily_search", "tavily_extract", "tavily_crawl", "tavily_map")
EXA_TOOL_NAMES: tuple[str, ...] = ("exa_search", "exa_get_contents")
BRIGHT_DATA_TOOL_NAMES: tuple[str, ...] = ("bright_data",)
OLOSTEP_PREFIX = "olostep"

_olostep_lock = threading.Lock()
_olostep_client: MCPClient | None = None
_olostep_tools: list[AgentTool] = []


def is_web_tool(name: str) -> bool:
    """True for a tool ``web_tools()`` gives."""
    return (
        name in TAVILY_TOOL_NAMES or name in EXA_TOOL_NAMES or name in BRIGHT_DATA_TOOL_NAMES
        or name.startswith(f"{OLOSTEP_PREFIX}_")
    )


def configured_vended_names() -> tuple[str, ...]:
    """The names of the strands_tools web tools whose keys are set."""
    return (
        *(TAVILY_TOOL_NAMES if app_config.TAVILY_API_KEY else ()),
        *(EXA_TOOL_NAMES if app_config.EXA_API_KEY else ()),
        *(BRIGHT_DATA_TOOL_NAMES if app_config.BRIGHTDATA_API_KEY else ()),
    )


def olostep_tools() -> list[AgentTool]:
    """Olostep's MCP tools from the process-wide client, started on first use; none without ``OLOSTEP_API_KEY``.

    A server that can't be reached leaves Olostep out of this agent and is tried again for the next.
    """
    global _olostep_client, _olostep_tools
    if not app_config.OLOSTEP_API_KEY:
        return []
    with _olostep_lock:
        if _olostep_client is None:
            client = MCPClient(
                url=app_config.OLOSTEP_MCP_URL,
                headers={"Authorization": f"Bearer {app_config.OLOSTEP_API_KEY}"},
                prefix=OLOSTEP_PREFIX,
            )
            try:
                client.start()
                _olostep_tools = list(client.list_tools_sync())
            except Exception:
                logger.exception("Olostep's MCP server didn't start; its tools are left out")
                client.stop(None, None, None)
                return []
            _olostep_client = client
        return list(_olostep_tools)


def web_tools() -> list[AgentTool]:
    """Tavily, Exa, Bright Data and Olostep, each where its key is set."""
    tools: list[AgentTool] = []
    if app_config.TAVILY_API_KEY:
        from strands_tools import tavily

        tools.extend((tavily.tavily_search, tavily.tavily_extract, tavily.tavily_crawl, tavily.tavily_map))
    if app_config.EXA_API_KEY:
        from strands_tools import exa

        tools.extend((exa.exa_search, exa.exa_get_contents))
    if app_config.BRIGHTDATA_API_KEY:
        from strands_tools import bright_data

        tools.append(bright_data.bright_data)
    tools.extend(olostep_tools())
    return tools
