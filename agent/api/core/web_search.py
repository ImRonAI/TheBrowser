"""Ren's search engine without Brave: the Search page's and Discover's sections, and the Search page's answer.

While ``config.brave_tools_enabled()`` is off (the default; ``RON_BRAVE_TOOLS=1`` turns Brave back on), sections come
from here instead of ``BraveClient``, in the same ``FeedSection`` / ``DiscoverItem`` shapes:

- ``web``: Tavily ``POST /search`` (up to 20 results, with favicons);
- ``news``: Tavily ``POST /search`` with ``topic: "news"`` (published dates);
- ``images``: Tavily's query images with their descriptions (``include_images``, ``include_image_descriptions``);
- ``videos``: Exa ``POST /search`` on YouTube and Vimeo (``includeDomains``);
- ``places``: Apify's Google Maps Scraper (``compass~crawler-google-places``) through
  ``run-sync-get-dataset-items``, without reviews, images or detail pages, its cost capped by ``maxTotalChargeUsd``;
- the answer: Exa ``POST /answer`` with ``stream: true``, its text deltas and then its citations.

A provider is used only where its key is set (``TAVILY_API_KEY``, ``EXA_API_KEY``, ``APIFY_TOKEN``); a section whose
provider has no key reports ``not_configured``, as Brave's do without ``BRAVE_SEARCH_API_KEY``. Brave's ``rich``
vertical has no counterpart here.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from collections.abc import AsyncIterator
from typing import Any

import httpx

from agent.api.core import config as app_config
from agent.api.core.brave_search import (
    BraveClient,
    DiscoverItem,
    ItemKind,
    FeedLocation,
    FeedRequest,
    FeedSection,
    SectionRequest,
    hostname,
    run_section,
)

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
EXA_SEARCH_URL = "https://api.exa.ai/search"
EXA_ANSWER_URL = "https://api.exa.ai/answer"
APIFY_RUN_SYNC_URL = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items"
#: Tavily's ``max_results`` range is 0-20; Exa's ``numResults`` is 1-100.
TAVILY_MAX_RESULTS = 20
EXA_MAX_RESULTS = 100
VIDEO_DOMAINS = ("youtube.com", "vimeo.com")
#: Apify's run timeout (seconds) and the most one Places run may cost (USD).
APIFY_RUN_TIMEOUT = 90
APIFY_PLACES_MAX_CHARGE_USD = 0.25
APIFY_PLACE_FIELDS = (
    "title,address,totalScore,reviewsCount,phone,website,url,categoryName,categories,location,imageUrl,placeId,"
    "price,openingHours,permanentlyClosed,temporarilyClosed"
)
_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)


class WebSearchError(Exception):
    """One provider call failed; ``code`` and ``status`` follow ``BraveSearchError``'s per-source error payload."""

    def __init__(self, code: str, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def section_provider(kind: str) -> tuple[str, str | None]:
    """The provider of a section kind and its key."""
    if kind == "videos":
        return "Exa", app_config.EXA_API_KEY
    if kind == "places":
        return "Apify", app_config.APIFY_TOKEN
    return "Tavily", app_config.TAVILY_API_KEY


def configured() -> bool:
    """Any of the providers is set."""
    return bool(app_config.TAVILY_API_KEY or app_config.EXA_API_KEY or app_config.APIFY_TOKEN)


async def _post(url: str, headers: dict[str, str], body: dict[str, Any], params: dict[str, str] | None = None) -> Any:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            response = await client.post(url, headers=headers, json=body, params=params)
        except httpx.HTTPError as error:
            raise WebSearchError("upstream", f"{hostname(url)}: {error}", status=502) from error
    if response.status_code >= 400:
        code = "rate_limited" if response.status_code == 429 else "upstream"
        raise WebSearchError(code, f"{hostname(url)} answered {response.status_code}: {response.text[:300]}",
                             status=response.status_code)
    return response.json()


async def _tavily(q: str, **options: Any) -> dict[str, Any]:
    body = {"query": q, "max_results": TAVILY_MAX_RESULTS, "include_favicon": True, **options}
    return await _post(TAVILY_SEARCH_URL, {"Authorization": f"Bearer {app_config.TAVILY_API_KEY}"}, body)


def _tavily_item(kind: ItemKind, prefix: str, raw: dict[str, Any]) -> DiscoverItem:
    url = str(raw.get("url") or "")
    return DiscoverItem(
        kind=kind, id=f"{prefix}:{url}", title=str(raw.get("title") or url), url=url, source=hostname(url),
        description=str(raw.get("content") or ""), favicon=raw.get("favicon") or None,
        published=raw.get("published_date") or None,
    )


async def tavily_web(q: str, count: int) -> list[DiscoverItem]:
    data = await _tavily(q, max_results=min(count, TAVILY_MAX_RESULTS))
    return [_tavily_item("web", "web", r) for r in data.get("results") or [] if isinstance(r, dict)]


async def tavily_news(q: str, count: int) -> list[DiscoverItem]:
    data = await _tavily(q, topic="news", max_results=min(count, TAVILY_MAX_RESULTS))
    return [_tavily_item("article", "news", r) for r in data.get("results") or [] if isinstance(r, dict)]


async def tavily_images(q: str, count: int) -> list[DiscoverItem]:
    data = await _tavily(q, include_images=True, include_image_descriptions=True)
    items: list[DiscoverItem] = []
    for raw in data.get("images") or []:
        image = raw if isinstance(raw, dict) else {"url": raw}
        url = str(image.get("url") or "")
        if not url:
            continue
        items.append(DiscoverItem(
            kind="image", id=f"image:{url}", title=str(image.get("description") or q), url=url,
            source=hostname(url), description=str(image.get("description") or ""), thumbnail=url,
            original_thumbnail=url, image={"url": url},
        ))
    return items[:count]


async def exa_videos(q: str, count: int, country: str) -> list[DiscoverItem]:
    body = {"query": q, "numResults": min(count, EXA_MAX_RESULTS), "includeDomains": list(VIDEO_DOMAINS),
            "userLocation": country}
    data = await _post(EXA_SEARCH_URL, {"x-api-key": str(app_config.EXA_API_KEY)}, body)
    items: list[DiscoverItem] = []
    for raw in data.get("results") or []:
        if not isinstance(raw, dict):
            continue
        url = str(raw.get("url") or "")
        items.append(DiscoverItem(
            kind="video", id=f"video:{raw.get('id') or url}", title=str(raw.get("title") or url), url=url,
            source=hostname(url), thumbnail=raw.get("image") or None, favicon=raw.get("favicon") or None,
            published=raw.get("publishedDate") or None, author=raw.get("author") or None,
            video={"creator": raw.get("author") or None, "publisher": hostname(url),
                   "original_thumbnail": raw.get("image") or None},
        ))
    return items


def _hours(entry: dict[str, Any]) -> dict[str, str]:
    """One ``openingHours`` day (``{"day": "Monday", "hours": "7 AM to 10 PM"}``) as Brave's ``current_day`` entry."""
    day = str(entry.get("day") or "")
    opens, _, closes = str(entry.get("hours") or "").partition(" to ")
    return {"abbr_name": day[:3], "full_name": day, "opens": opens, "closes": closes}


def _place_item(raw: dict[str, Any]) -> DiscoverItem:
    location = raw.get("location") or {}
    url = str(raw.get("website") or raw.get("url") or "")
    place_id = raw.get("placeId") or url
    today = datetime.now().strftime("%A")
    hours = [_hours(h) for h in raw.get("openingHours") or [] if isinstance(h, dict) and h.get("day") == today]
    return DiscoverItem(
        kind="place", id=f"place:{place_id}", title=str(raw.get("title") or ""), url=url, source=hostname(url),
        description=str(raw.get("categoryName") or ""), thumbnail=raw.get("imageUrl") or None,
        place={
            "place_id": place_id,
            "address": raw.get("address"),
            "latitude": location.get("lat"),
            "longitude": location.get("lng"),
            "phone": raw.get("phone"),
            "rating": raw.get("totalScore"),
            "review_count": raw.get("reviewsCount"),
            "price_range": raw.get("price"),
            "categories": raw.get("categories") or [],
            "hours_today": [h for h in hours if h["closes"]],
            "maps_url": raw.get("url"),
            "closed": bool(raw.get("permanentlyClosed") or raw.get("temporarilyClosed")),
            "pictures": [raw["imageUrl"]] if raw.get("imageUrl") else [],
        },
    )


async def apify_places(q: str, count: int, location: FeedLocation | None) -> list[DiscoverItem]:
    """Google Maps places for ``q`` near ``location`` (coordinates, or a place name) through Apify."""
    run_input: dict[str, Any] = {
        "searchStringsArray": [q], "maxCrawledPlacesPerSearch": count, "language": "en",
        "scrapePlaceDetailPage": False, "maxImages": 0, "maxReviews": 0,
    }
    loc = location or FeedLocation()
    if loc.latitude is not None and loc.longitude is not None:
        run_input["customGeolocation"] = {"type": "Point", "coordinates": [loc.longitude, loc.latitude],
                                          "radiusKm": (loc.radius_m or 5000) / 1000}
    elif loc.location:
        run_input["locationQuery"] = loc.location
    params = {"timeout": str(APIFY_RUN_TIMEOUT), "maxTotalChargeUsd": str(APIFY_PLACES_MAX_CHARGE_USD),
              "fields": APIFY_PLACE_FIELDS, "clean": "true"}
    url = APIFY_RUN_SYNC_URL.format(actor=app_config.APIFY_PLACES_ACTOR)
    data = await _post(url, {"Authorization": f"Bearer {app_config.APIFY_TOKEN}"}, run_input, params)
    return [_place_item(raw) for raw in data if isinstance(raw, dict)][:count] if isinstance(data, list) else []


async def run_web_section(section: SectionRequest, location: FeedLocation | None, country: str) -> FeedSection:
    """One section from Tavily, Exa or Apify; a failure is that section's error, never the page's."""
    try:
        if section.kind == "rich":
            raise WebSearchError("unsupported", "Instant answers come from Brave, which is off", status=501)
        if not section.q:
            raise WebSearchError("invalid_request", f"{section.kind} needs a query", status=422)
        name, key = section_provider(section.kind)
        if not key:
            raise WebSearchError("not_configured", f"{name} is not set up for {section.kind}", status=503)
        if section.kind == "web":
            items = await tavily_web(section.q, section.count)
        elif section.kind == "news":
            items = await tavily_news(section.q, section.count)
        elif section.kind == "images":
            items = await tavily_images(section.q, section.count)
        elif section.kind == "videos":
            items = await exa_videos(section.q, section.count, country)
        else:
            items = await apify_places(section.q, section.count, location)
        return FeedSection(kind=section.kind, q=section.q, status="ok", items=items)
    except WebSearchError as error:
        return FeedSection(kind=section.kind, q=section.q, status="error",
                           error={"code": error.code, "message": str(error), "status": error.status,
                                  "retry_after": None})


async def run_feed_section(client: BraveClient, section: SectionRequest, location: FeedLocation | None,
                           country: str) -> FeedSection:
    """Brave while ``RON_BRAVE_TOOLS=1``; Tavily, Exa and Apify otherwise."""
    if app_config.brave_tools_enabled():
        return await run_section(client, section, location, country)
    return await run_web_section(section, location, country)


async def build_feed(client: BraveClient, request: FeedRequest) -> list[FeedSection]:
    return list(await asyncio.gather(*(run_feed_section(client, s, request.location, request.country)
                                       for s in request.sections)))


async def exa_answer(q: str, country: str) -> AsyncIterator[tuple[str, Any]]:
    """Exa's streamed answer: ``("text", str)`` deltas, ``("citations", list[dict])`` and ``("cost", dict)``."""
    body = {"query": q, "stream": True, "userLocation": country}
    headers = {"x-api-key": str(app_config.EXA_API_KEY), "Accept": "text/event-stream"}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            async with client.stream("POST", EXA_ANSWER_URL, headers=headers, json=body) as response:
                if response.status_code >= 400:
                    text = (await response.aread()).decode(errors="replace")
                    raise WebSearchError("rate_limited" if response.status_code == 429 else "upstream",
                                         f"api.exa.ai answered {response.status_code}: {text[:300]}",
                                         status=response.status_code)
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    chunk = json.loads(data)
                    if not isinstance(chunk, dict):
                        continue
                    if "tag" in chunk and "payload" in chunk:
                        raise WebSearchError("upstream", f"Exa: {chunk['tag']}: {chunk['payload']}", status=502)
                    for choice in chunk.get("choices") or []:
                        content = ((choice or {}).get("delta") or {}).get("content")
                        if content:
                            yield "text", content
                    citations = chunk.get("citations")
                    if isinstance(citations, list) and citations:
                        yield "citations", [c for c in citations if isinstance(c, dict)]
                    if "costDollars" in chunk:
                        yield "cost", {"costDollars": chunk["costDollars"], "requestId": chunk.get("requestId")}
        except httpx.HTTPError as error:
            raise WebSearchError("upstream", f"api.exa.ai: {error}", status=502) from error
