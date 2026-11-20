"""Web search and reading tools for every Ren agent, in the place of the Brave tools (``config.brave_tools_enabled``).

Tavily (``tavily_search``, ``tavily_extract``, ``tavily_crawl``, ``tavily_map``), Exa (``exa_search``,
``exa_get_contents``) and Bright Data (``bright_data``) are the tools strands_tools vends, which read their own keys.
``places_search`` finds places on Google Maps through Apify (``core/web_search.apify_places``, ``APIFY_TOKEN``), for
local stores and businesses. Olostep has no Strands tool; its hosted MCP server (https://mcp.olostep.com/mcp, the API key as its bearer) is one
process-wide Strands ``MCPClient``, its tools prefixed ``olostep_`` (``olostep_answers``, ``olostep_scrape_website`` and
the rest). ``olostep_api`` is a native ``@tool`` over the Olostep REST API (https://api.olostep.com, the key as its bearer)
for the endpoints that MCP server has no tool for (get by id, retrieve, files, schedules, batch metadata), restricted to
the documented endpoints in ``OLOSTEP_ENDPOINTS``. Apify's hosted MCP server (``APIFY_MCP_URL``, ``APIFY_TOKEN`` as its
bearer) is another process-wide ``MCPClient``, its tools prefixed ``apify_`` (``apify_search-actors``, ``apify_call-actor``,
one tool per Actor in the URL). Each provider joins only where its key is set.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal

import httpx
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
APIFY_PREFIX = "apify"

_olostep = HostedMCP(OLOSTEP_PREFIX)
_apify = HostedMCP(APIFY_PREFIX)

#: Olostep's documented REST endpoints (https://docs.olostep.com/llms.txt, API Reference): method, path, reference page.
OLOSTEP_ENDPOINTS: tuple[tuple[str, str, str], ...] = (
    ("POST", "/v1/scrapes", "scrapes/create"),
    ("GET", "/v1/scrapes/{scrape_id}", "scrapes/get"),
    ("POST", "/v1/answers", "answers/create"),
    ("GET", "/v1/answers/{answer_id}", "answers/get"),
    ("POST", "/v1/batches", "batches/create"),
    ("GET", "/v1/batches/{batch_id}", "batches/info"),
    ("GET", "/v1/batches/{batch_id}/items", "batches/items"),
    ("PATCH", "/v1/batches/{batch_id}", "batches/update"),
    ("POST", "/v1/crawls", "crawls/create"),
    ("GET", "/v1/crawls/{crawl_id}", "crawls/info"),
    ("GET", "/v1/crawls/{crawl_id}/pages", "crawls/pages"),
    ("POST", "/v1/maps", "maps/create"),
    ("GET", "/v1/maps/{map_id}", "maps/get"),
    ("POST", "/v1/searches", "searches/create"),
    ("GET", "/v1/searches/{search_id}", "searches/get"),
    ("GET", "/v1/retrieve", "retrieve"),
    ("POST", "/v1/files", "files/create"),
    ("POST", "/v1/files/{file_id}/complete", "files/complete"),
    ("GET", "/v1/files/{file_id}", "files/get"),
    ("GET", "/v1/files/{file_id}/content", "files/content"),
    ("GET", "/v1/files", "files/list"),
    ("DELETE", "/v1/files/{file_id}", "files/delete"),
    ("POST", "/v1/schedules", "schedules/create"),
    ("GET", "/v1/schedules", "schedules/list"),
    ("GET", "/v1/schedules/{schedule_id}", "schedules/get"),
    ("DELETE", "/v1/schedules/{schedule_id}", "schedules/delete"),
)
_OLOSTEP_ROUTES = [(m, re.compile("^" + re.sub(r"\{\w+\}", "[^/]+", p) + "$")) for m, p, _ in OLOSTEP_ENDPOINTS]


def is_web_tool(name: str) -> bool:
    """True for a tool ``web_tools()`` gives."""
    return (
        name in TAVILY_TOOL_NAMES or name in EXA_TOOL_NAMES or name in BRIGHT_DATA_TOOL_NAMES or name in APIFY_TOOL_NAMES
        or name.startswith((f"{OLOSTEP_PREFIX}_", f"{APIFY_PREFIX}_"))
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
    """Olostep's MCP tools from the process-wide client (``HostedMCP``) and ``olostep_api``; none without ``OLOSTEP_API_KEY``."""
    if not app_config.OLOSTEP_API_KEY:
        return []
    return [*_olostep.tools(app_config.OLOSTEP_MCP_URL, app_config.OLOSTEP_API_KEY), olostep_api]


@tool
async def olostep_api(
    method: Literal["GET", "POST", "PATCH", "DELETE"],
    path: str,
    body: dict[str, Any] | None = None,
    query: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Call an Olostep REST endpoint (https://api.olostep.com) and return its JSON response.

    Endpoints (each one's request and response is documented at https://docs.olostep.com/api-reference/<page>.md;
    read the page with http_request before a call you have not made before):
    POST /v1/scrapes, GET /v1/scrapes/{scrape_id}; POST /v1/answers, GET /v1/answers/{answer_id};
    POST /v1/batches, GET /v1/batches/{batch_id}, GET /v1/batches/{batch_id}/items, PATCH /v1/batches/{batch_id};
    POST /v1/crawls, GET /v1/crawls/{crawl_id}, GET /v1/crawls/{crawl_id}/pages; POST /v1/maps, GET /v1/maps/{map_id};
    POST /v1/searches, GET /v1/searches/{search_id}; GET /v1/retrieve (query retrieve_id, formats);
    POST /v1/files, POST /v1/files/{file_id}/complete, GET /v1/files/{file_id}, GET /v1/files/{file_id}/content,
    GET /v1/files, DELETE /v1/files/{file_id}; POST /v1/schedules, GET /v1/schedules, GET /v1/schedules/{schedule_id},
    DELETE /v1/schedules/{schedule_id}.

    Scrapes, searches, answers and maps answer at once; batches and crawls are asynchronous: create, poll the info
    endpoint until completed, list the items or pages, then GET /v1/retrieve with each ``retrieve_id``. An answer of
    "NOT_FOUND" is a valid outcome. When ``size_exceeded`` is true, read the hosted URLs instead of the inline content.

    Args:
        method: The HTTP method of the endpoint.
        path: The endpoint path with its ids filled in, e.g. "/v1/scrapes" or "/v1/batches/batch_123/items".
        body: The JSON request body, for POST and PATCH.
        query: Query parameters, e.g. {"retrieve_id": "...", "formats": ["markdown"]} or a list's cursor and limit.
    """
    if not any(m == method and route.match(path) for m, route in _OLOSTEP_ROUTES):
        return {"status": "error", "content": [{"text": f"olostep_api: {method} {path} is not a documented Olostep endpoint"}]}
    async with httpx.AsyncClient(base_url=app_config.OLOSTEP_API_URL, timeout=180) as client:
        response = await client.request(
            method, path, json=body, params=query, headers={"Authorization": f"Bearer {app_config.OLOSTEP_API_KEY}"}
        )
    if response.is_error:
        return {"status": "error", "content": [{"text": f"olostep_api {response.status_code}: {response.text[:2000]}"}]}
    data = response.json()
    # ``json_content`` is stringified JSON (Integration rule 4); hand the agent the parsed value.
    result = data.get("result") if isinstance(data, dict) else None
    if isinstance(result, dict) and isinstance(result.get("json_content"), str):
        try:
            result["json_content"] = json.loads(result["json_content"])
        except ValueError:
            pass
    return data


def web_tools() -> list[AgentTool]:
    """Tavily, Exa, Bright Data, Apify (``places_search`` and its MCP server) and Olostep, each where its key is set."""
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
        if app_config.APIFY_MCP_URL:
            tools.extend(_apify.tools(app_config.APIFY_MCP_URL, app_config.APIFY_TOKEN))
    tools.extend(olostep_tools())
    return tools
