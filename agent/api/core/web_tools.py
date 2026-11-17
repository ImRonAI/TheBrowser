"""Web search and reading tools for every Ren agent, in the place of the Brave tools (``config.brave_tools_enabled``).

Tavily (``tavily_search``, ``tavily_extract``, ``tavily_crawl``, ``tavily_map``), Exa (``exa_search``,
``exa_get_contents``) and Bright Data (``bright_data``) are the tools strands_tools vends, which read their own keys.
``places_search`` finds places on Google Maps through Apify (``core/web_search.apify_places``, ``APIFY_TOKEN``), for
local stores and businesses. Olostep has no Strands tool; its hosted MCP server (https://mcp.olostep.com/mcp, the API key as its bearer) is one
process-wide Strands ``MCPClient``, its tools prefixed ``olostep_`` (``olostep_answers``, ``olostep_scrape_website`` and
the rest). Each provider joins only where its key is set.
"""

from __future__ import annotations

from typing import Any

from strands import tool
from strands.types.tools import AgentTool

from agent.api.core import config as app_config
from agent.api.core.hosted_mcp import HostedMCP
from agent.api.core.brave_search import FeedLocation
from agent.api.core.web_search import WebSearchError, apify_places

#: The vended tools' names, and the prefix of Olostep's.
TAVILY_TOOL_NAMES: tuple[str, ...] = ("tavily_search", "tavily_extract", "tavily_crawl", "tavily_map")
EXA_TOOL_NAMES: tuple[str, ...] = ("exa_search", "exa_get_contents")
BRIGHT_DATA_TOOL_NAMES: tuple[str, ...] = ("bright_data",)
APIFY_TOOL_NAMES: tuple[str, ...] = ("places_search",)
OLOSTEP_PREFIX = "olostep"

_olostep = HostedMCP(OLOSTEP_PREFIX)


def is_web_tool(name: str) -> bool:
    """True for a tool ``web_tools()`` gives."""
    return (
        name in TAVILY_TOOL_NAMES or name in EXA_TOOL_NAMES or name in BRIGHT_DATA_TOOL_NAMES or name in APIFY_TOOL_NAMES
        or name.startswith(f"{OLOSTEP_PREFIX}_")
    )


def configured_vended_names() -> tuple[str, ...]:
    """The names of the strands_tools web tools whose keys are set."""
    return (
        *(TAVILY_TOOL_NAMES if app_config.TAVILY_API_KEY else ()),
        *(EXA_TOOL_NAMES if app_config.EXA_API_KEY else ()),
        *(BRIGHT_DATA_TOOL_NAMES if app_config.BRIGHTDATA_API_KEY else ()),
        *(APIFY_TOOL_NAMES if app_config.APIFY_TOKEN else ()),
    )


@tool
async def places_search(
    query: str,
    location: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    radius_km: float = 5.0,
    count: int = 10,
) -> dict[str, Any]:
    """Find places on Google Maps (stores, restaurants, services, businesses) with their address, rating, review
    count, phone, website, price level and today's hours, through Apify's Google Maps Scraper.

    Args:
        query: What to look for, as typed in Google Maps (e.g. "bike shop", "Trek dealer").
        location: Optional place name to search in (e.g. "Austin, Texas"); city and country work best.
        latitude: Optional latitude to search around (with ``longitude``), in place of ``location``.
        longitude: Optional longitude to search around (with ``latitude``).
        radius_km: Radius around the coordinates, in kilometres (default 5).
        count: Number of places to return (1-20, default 10).
    """
    near = FeedLocation(latitude=latitude, longitude=longitude, location=location, radius_m=radius_km * 1000)
    try:
        places = await apify_places(query, max(1, min(count, 20)), near)
    except WebSearchError as error:
        return {"status": "error", "content": [{"text": f"places_search {error.code}: {error}"}]}
    return {"query": query, "results": [item.model_dump(exclude_none=True) for item in places]}


def olostep_tools() -> list[AgentTool]:
    """Olostep's MCP tools from the process-wide client (``HostedMCP``); none without ``OLOSTEP_API_KEY``."""
    if not app_config.OLOSTEP_API_KEY:
        return []
    return _olostep.tools(app_config.OLOSTEP_MCP_URL, app_config.OLOSTEP_API_KEY)


def web_tools() -> list[AgentTool]:
    """Tavily, Exa, Bright Data, Apify's ``places_search`` and Olostep, each where its key is set."""
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
    if app_config.APIFY_TOKEN:
        tools.append(places_search)
    tools.extend(olostep_tools())
    return tools
