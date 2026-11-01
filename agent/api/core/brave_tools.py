"""Native Strands ``@tool`` functions for the Brave Search API verticals.

Registered as core tools across all Ron agents (panel text agent, Live ``BidiAgent``,
specialist/harness children, issue agents) alongside ``brave_answer``. All six search
tools share the process-wide ``BraveClient`` from ``agent.api.endpoints.discover`` so
Discover, Browser Search, and agent tool calls draw from one ``RateLimiter(BRAVE_SEARCH_RPS)``.
"""

from __future__ import annotations

from typing import Any, Literal

from strands import tool

from agent.api.core.brave_answers_tool import brave_answer
from agent.api.core.brave_search import BraveClient, BraveSearchError
from agent.api.endpoints import discover as discover_module

_CLIENT: BraveClient | None = None


def search_client() -> BraveClient:
    """Process-wide ``BraveClient`` shared with ``agent.api.endpoints.discover``."""
    if _CLIENT is not None:
        return _CLIENT
    if discover_module._default_client is None:
        discover_module._default_client = BraveClient()
    return discover_module._default_client


def set_search_client(client: BraveClient | None) -> None:
    """Test seam."""
    global _CLIENT
    _CLIENT = client


@tool
async def brave_web_search(
    query: str,
    count: int = 10,
    freshness: Literal["pd", "pw", "pm", "py"] | None = None,
    country: str = "US",
    safesearch: Literal["off", "moderate", "strict"] = "moderate",
    extra_snippets: bool = True,
) -> dict[str, Any]:
    """Search the web and forum discussions via Brave Search.

    Returns normalized web results and forum discussion threads (Reddit, HN, StackOverflow, etc.)
    in a single call.

    Args:
        query: Search query string.
        count: Number of results to return (1-20, default 10).
        freshness: Optional recency filter: "pd" (past day), "pw" (past week), "pm" (past month), "py" (past year).
        country: 2-letter country code for regional results (default "US").
        safesearch: SafeSearch filter: "off" | "moderate" | "strict" (default "moderate").
        extra_snippets: Request extra text snippets per result (default True).
    """
    try:
        items = await search_client().web(
            query,
            count=max(1, min(count, 20)),
            freshness=freshness,
            country=country,
            safesearch=safesearch,
            extra_snippets=extra_snippets,
        )
    except BraveSearchError as error:
        return {"status": "error", "content": [{"text": f"brave_web_search {error.code}: {error}"}]}
    return {"query": query, "results": [item.model_dump(exclude_none=True) for item in items]}


@tool
async def brave_news_search(
    query: str,
    count: int = 10,
    freshness: Literal["pd", "pw", "pm", "py"] | None = None,
    country: str = "US",
    safesearch: Literal["off", "moderate", "strict"] = "moderate",
) -> dict[str, Any]:
    """Search breaking and recent news articles via Brave News Search.

    Args:
        query: News search query string.
        count: Number of articles to return (1-50, default 10).
        freshness: Optional recency filter: "pd" (past day), "pw" (past week), "pm" (past month), "py" (past year).
        country: 2-letter country code for regional news (default "US").
        safesearch: SafeSearch filter: "off" | "moderate" | "strict" (default "moderate").
    """
    try:
        items = await search_client().news(
            query,
            count=max(1, min(count, 50)),
            freshness=freshness,
            country=country,
            safesearch=safesearch,
        )
    except BraveSearchError as error:
        return {"status": "error", "content": [{"text": f"brave_news_search {error.code}: {error}"}]}
    return {"query": query, "results": [item.model_dump(exclude_none=True) for item in items]}


@tool
async def brave_image_search(
    query: str,
    count: int = 20,
    country: str = "US",
    safesearch: Literal["off", "moderate", "strict"] = "strict",
) -> dict[str, Any]:
    """Search images via Brave Image Search, returning image URLs, thumbnails, dimensions, and source pages.

    Args:
        query: Image search query string.
        count: Number of images to return (1-50, default 20).
        country: 2-letter country code (default "US").
        safesearch: SafeSearch filter: "off" | "moderate" | "strict" (default "strict").
    """
    try:
        items = await search_client().images(
            query,
            count=max(1, min(count, 50)),
            country=country,
            safesearch=safesearch,
        )
    except BraveSearchError as error:
        return {"status": "error", "content": [{"text": f"brave_image_search {error.code}: {error}"}]}
    return {"query": query, "results": [item.model_dump(exclude_none=True) for item in items]}


@tool
async def brave_video_search(
    query: str,
    count: int = 10,
    freshness: Literal["pd", "pw", "pm", "py"] | None = None,
    country: str = "US",
    safesearch: Literal["off", "moderate", "strict"] = "moderate",
) -> dict[str, Any]:
    """Search videos via Brave Video Search, returning video URLs, duration, creator, publisher, views, and thumbnails.

    Args:
        query: Video search query string.
        count: Number of videos to return (1-50, default 10).
        freshness: Optional recency filter: "pd" (past day), "pw" (past week), "pm" (past month), "py" (past year).
        country: 2-letter country code (default "US").
        safesearch: SafeSearch filter: "off" | "moderate" | "strict" (default "moderate").
    """
    try:
        items = await search_client().videos(
            query,
            count=max(1, min(count, 50)),
            freshness=freshness,
            country=country,
            safesearch=safesearch,
        )
    except BraveSearchError as error:
        return {"status": "error", "content": [{"text": f"brave_video_search {error.code}: {error}"}]}
    return {"query": query, "results": [item.model_dump(exclude_none=True) for item in items]}


@tool
async def brave_local_search(
    query: str | None = None,
    location: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    count: int = 10,
    units: Literal["metric", "imperial"] = "imperial",
    include_details: bool = True,
) -> dict[str, Any]:
    """Search local places and points of interest (POIs) via Brave Local Search.

    Can search by query (e.g., "coffee shops in SoMa") or browse an area when ``location`` or
    ``latitude``/``longitude`` are provided. When ``include_details`` is True, enriches places
    with ``/local/pois`` and ``/local/descriptions`` (hours, phone, ratings, pictures, AI descriptions).

    Args:
        query: Optional place search query (if omitted, ``location`` or coordinates are required).
        location: Optional textual location anchor (e.g., "San Francisco, CA").
        latitude: Optional latitude coordinate (-90 to 90).
        longitude: Optional longitude coordinate (-180 to 180).
        count: Number of places to return (1-20, default 10).
        units: Distance units: "imperial" | "metric" (default "imperial").
        include_details: Enrich results with POI details and AI descriptions (default True).
    """
    client = search_client()
    try:
        places = await client.places(
            query,
            latitude=latitude,
            longitude=longitude,
            location=location,
            count=max(1, min(count, 20)),
            units=units,
        )
    except BraveSearchError as error:
        return {"status": "error", "content": [{"text": f"brave_local_search {error.code}: {error}"}]}
    results: list[dict[str, Any]] = [item.model_dump(exclude_none=True) for item in places]
    if include_details:
        place_ids = [p.id for p in places if p.id][:20]
        if place_ids:
            try:
                results = await client.poi_details(place_ids)
            except BraveSearchError:
                pass
    return {"query": query, "results": results}


@tool
async def brave_rich_answer(
    query: str,
    country: str = "US",
) -> dict[str, Any]:
    """Fetch structured real-time Rich Search data from Brave (weather, stocks, crypto, currency
    conversion, calculator, unit conversion, unix timestamps, sports scores/schedules, word definitions).

    Executes the two-step Rich Search flow (hint -> ``/web/rich`` callback) and returns normalized
    cards plus raw vertical payloads. Returns ``answers: []`` when the query has no rich vertical.

    Args:
        query: Query triggering a rich vertical (e.g., "weather in Tokyo", "AAPL stock", "100 USD to EUR").
        country: 2-letter country code (default "US").
    """
    try:
        answers = await search_client().answer(query, country=country)
    except BraveSearchError as error:
        return {"status": "error", "content": [{"text": f"brave_rich_answer {error.code}: {error}"}]}
    return {"query": query, "answers": [a.model_dump(exclude_none=True) for a in answers]}


BRAVE_TOOL_NAMES: tuple[str, ...] = (
    "brave_answer",
    "brave_web_search",
    "brave_news_search",
    "brave_image_search",
    "brave_video_search",
    "brave_local_search",
    "brave_rich_answer",
)


def brave_tools() -> list[Any]:
    return [
        brave_answer,
        brave_web_search,
        brave_news_search,
        brave_image_search,
        brave_video_search,
        brave_local_search,
        brave_rich_answer,
    ]
