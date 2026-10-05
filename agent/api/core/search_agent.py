"""Perplexity Agent API client for the browser search feature.

Stateless single-shot search answers — this is NOT a Strands panel run, so it
posts to ``POST /v1/responses`` directly with httpx and parses the SSE body the
way ``core/perplexity_model.py`` documents it (that module's docstring is the
ground truth for the wire format):

- answer text:   ``response.output_text.delta``
- reasoning:     ``response.reasoning_text.delta`` / ``response.reasoning_summary_text.delta``
- citations:     ``response.output_text.annotation.added`` (``url_citation``)
- server-side tool payloads: complete items on ``response.output_item.done``
  (``search_results`` / ``image_search_results`` / ``fetch_url_results``)
- terminal:      ``response.completed`` / ``response.incomplete``;
  failures:      ``response.failed`` / ``error``

Search levels map 1:1 onto Agent API presets
(https://docs.perplexity.ai/docs/agent-api/presets). Any field sent alongside
``preset`` overrides that preset's default, so the mandated model rides on
every request. ``tools`` merge per-tool into a preset's set — listing
``web_search``/``image_search``/``fetch_url`` on the main request guarantees
they are on; the shopping request omits ``preset`` entirely so its tool set is
exactly the three allowed tools, with ``web_search`` domain-filtered to known
shopping sites.
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Literal

import httpx

from agent.api.core.config import (
    PERPLEXITY_API_KEY,
    PERPLEXITY_RESPONSES_URL,
    RON_SEARCH_AGENT_MODEL,
    RON_SEARCH_SHOPPING_DOMAINS,
    RON_SEARCH_SHOPPING_MODEL,
)

#: Search levels correlate 1:1 with Agent API presets.
SEARCH_LEVELS = ("fast", "low", "medium", "high", "xhigh")
SearchLevel = Literal["fast", "low", "medium", "high", "xhigh"]

AGENT_INSTRUCTIONS = (
    "You are the answer engine of the Ron web browser. Answer the query directly and "
    "completely, with inline citations for every sourced claim. Be concise but thorough; "
    "use short sections or bullets when that aids scanning. Never invent URLs."
)

SHOPPING_INSTRUCTIONS = (
    "You are the shopping assistant of the Ron web browser. Your web access is restricted "
    "to well-known retail and marketplace domains. Find concrete, buyable products matching "
    "the query: compare options and current prices, and name the retailer with a link for "
    "every product you recommend. Always use image_search to pull product photos for the "
    "products you recommend. Note when a price could not be verified. Never invent "
    "products, prices, or URLs."
)

#: Native output-item types that carry source material the results page renders.
SOURCES_ITEM_TYPES = frozenset({"search_results"})
IMAGES_ITEM_TYPES = frozenset({"image_search_results"})
FETCHED_ITEM_TYPES = frozenset({"fetch_url_results"})

#: Generous read budget: the high/xhigh presets run long research loops.
_STREAM_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=10.0)


class SearchAgentError(Exception):
    """Typed failure of one Agent API call. ``code`` is stable for the UI."""

    def __init__(self, code: str, message: str, *, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


def build_agent_request(q: str, level: str, *, model: str = RON_SEARCH_AGENT_MODEL) -> dict[str, Any]:
    """Main search answer: preset=<level> with the mandated model override.

    ``tools`` merge per-tool into the preset's set, so listing these three
    guarantees web/image/fetch are enabled without disturbing the preset's
    other configuration.
    """
    return {
        "model": model,
        "preset": level,
        "input": q,
        "instructions": AGENT_INSTRUCTIONS,
        "tools": [
            {"type": "web_search", "search_context_size": "high"},
            {"type": "image_search"},
            {"type": "fetch_url"},
        ],
        "stream": True,
    }


def build_shopping_request(
    q: str,
    *,
    model: str = RON_SEARCH_SHOPPING_MODEL,
    domains: list[str] | None = None,
) -> dict[str, Any]:
    """Shopping section: NO preset, so the tool set is exactly web_search
    (domain-filtered to shopping sites), fetch_url and image_search."""
    return {
        "model": model,
        "input": q,
        "instructions": SHOPPING_INSTRUCTIONS,
        "tools": [
            {
                "type": "web_search",
                "filters": {"search_domain_filter": list(domains if domains is not None else RON_SEARCH_SHOPPING_DOMAINS)},
                "search_context_size": "high",
            },
            {"type": "fetch_url"},
            {"type": "image_search"},
        ],
        "max_steps": 10,
        "stream": True,
    }


def _items(item: dict[str, Any]) -> list[dict[str, Any]]:
    """A native output item's result list, tolerant of the exact container key."""
    results = item.get("results") or item.get("items") or item.get("images") or []
    return [r for r in results if isinstance(r, dict)]


def _normalize_image(raw: dict[str, Any]) -> dict[str, Any]:
    """One image_search_results entry -> the stable shape the renderer relies on.

    Verified live 2026-10-05: the Agent API emits ``image_url`` + ``origin_url``
    (the page the image came from), not ``url``/``page_url``.
    """
    return {
        "url": raw.get("url") or raw.get("image_url") or raw.get("src") or raw.get("thumbnail") or "",
        "page_url": raw.get("page_url") or raw.get("origin_url") or raw.get("source") or "",
        "title": raw.get("title") or "",
        "width": raw.get("width"),
        "height": raw.get("height"),
    }


def _normalize_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    """One decoded SSE payload -> one normalized event, or None when irrelevant."""
    kind = payload.get("type")
    if kind == "response.output_text.delta":
        delta = payload.get("delta")
        return {"type": "delta", "text": delta} if isinstance(delta, str) and delta else None
    if kind in ("response.reasoning_text.delta", "response.reasoning_summary_text.delta"):
        delta = payload.get("delta")
        return {"type": "reasoning", "text": delta} if isinstance(delta, str) and delta else None
    if kind == "response.output_text.annotation.added":
        annotation = payload.get("annotation") or {}
        if annotation.get("type") == "url_citation" and annotation.get("url"):
            return {"type": "citation", "url": annotation["url"], "title": annotation.get("title") or ""}
        return None
    if kind == "response.output_item.done":
        item = payload.get("item") or {}
        item_type = item.get("type")
        if item_type in SOURCES_ITEM_TYPES:
            return {"type": "sources", "results": _items(item)}
        if item_type in IMAGES_ITEM_TYPES:
            images = [_normalize_image(r) for r in _items(item)]
            return {"type": "images", "results": [i for i in images if i["url"]]}
        if item_type in FETCHED_ITEM_TYPES:
            return {"type": "fetched", "results": _items(item)}
        return None
    if kind in ("response.completed", "response.incomplete"):
        response = payload.get("response") or {}
        return {"type": "done", "usage": response.get("usage"), "model": response.get("model"),
                "incomplete": kind == "response.incomplete"}
    if kind in ("response.failed", "error"):
        error = (payload.get("response") or {}).get("error") or payload
        raise SearchAgentError("upstream", error.get("message") or "Agent API stream failed")
    return None


async def stream_agent(
    request: dict[str, Any],
    *,
    api_key: str | None = PERPLEXITY_API_KEY,
    url: str = PERPLEXITY_RESPONSES_URL,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream one Agent API response as normalized events (see module docstring).

    Raises SearchAgentError for transport/HTTP/stream-level failures; callers
    turn that into a per-source error event so one failure never blanks a page.
    """
    if not api_key:
        raise SearchAgentError("not_configured", "PERPLEXITY_API_KEY is not set", status=503)
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "text/event-stream"}
    try:
        async with httpx.AsyncClient(transport=transport, timeout=_STREAM_TIMEOUT) as client:
            async with client.stream("POST", url, json=request, headers=headers) as response:
                if response.status_code != 200:
                    body = (await response.aread()).decode("utf-8", "replace")
                    raise _http_error(response.status_code, body)
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    try:
                        payload = json.loads(line[len("data:"):])
                    except ValueError:
                        continue
                    if isinstance(payload, dict) and (event := _normalize_event(payload)):
                        yield event
    except (httpx.TimeoutException, httpx.TransportError) as error:
        raise SearchAgentError("network", type(error).__name__) from error


def _http_error(status: int, body: str) -> SearchAgentError:
    message = body[:500] or f"HTTP {status}"
    try:
        detail = json.loads(body)
        message = (detail.get("error") or {}).get("message") or detail.get("message") or message
    except ValueError:
        pass
    if status in (401, 403):
        return SearchAgentError("unauthorized", message, status=status)
    if status in (400, 404, 422):
        return SearchAgentError("invalid_request", message, status=status)
    if status == 429:
        return SearchAgentError("rate_limited", message, status=status)
    return SearchAgentError("upstream", message, status=status)
