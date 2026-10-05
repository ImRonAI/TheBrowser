"""Browser search HTTP surface: Brave fan-out + Perplexity Agent API streams.

One POST /search/stream runs one query against seven sources concurrently and
merges them onto a single SSE response:

- Brave web/news/videos/images/places at per-endpoint maximum counts, each
  isolated (one failing source never blanks the page — same rule as Discover);
- the Perplexity Agent API answer (preset=<level>, model always overridden to
  RON_SEARCH_AGENT_MODEL) streamed as agent.* events;
- the shopping agent (RON_SEARCH_SHOPPING_MODEL, no preset, tools restricted to
  domain-filtered web_search + fetch_url + image_search) as shopping.* events.

Both API keys stay server-side. SSE framing mirrors endpoints/chat.py
(``event: <name>\\ndata: <json>\\n\\n``).
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent.api.core.brave_search import (
    BraveSearchError,
    FeedLocation,
    SectionRequest,
    error_payload,
    run_section,
)
from agent.api.core.config import (
    PERPLEXITY_API_KEY,
    RON_SEARCH_AGENT_MODEL,
    RON_SEARCH_DEFAULT_LEVEL,
    RON_SEARCH_SHOPPING_DOMAINS,
    RON_SEARCH_SHOPPING_MODEL,
)
from agent.api.core.search_agent import (
    SEARCH_LEVELS,
    SearchAgentError,
    build_agent_request,
    build_shopping_request,
    stream_agent,
)
# Discover owns the process-wide BraveClient (one shared token bucket).
from agent.api.endpoints.discover import get_client as get_brave_client

router = APIRouter()

#: Per-kind Brave counts: web caps at 20 per page; news/images/videos at 50
#: (the SectionRequest ceiling); place_search at 20.
SECTION_COUNTS: dict[str, int] = {"web": 20, "news": 50, "videos": 50, "images": 50, "places": 20}


class SearchRequest(BaseModel):
    q: str = Field(min_length=1, max_length=400)
    level: str | None = Field(default=None, description="Agent API preset; default RON_SEARCH_DEFAULT_LEVEL")
    country: str = Field(default="US", min_length=2, max_length=3)
    location: FeedLocation | None = None
    shopping: bool = True


def _frame(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/search/status")
async def search_status(request: Request):
    return {
        "configured": {"brave": get_brave_client(request).configured, "perplexity": bool(PERPLEXITY_API_KEY)},
        "levels": list(SEARCH_LEVELS),
        "default_level": RON_SEARCH_DEFAULT_LEVEL,
        "models": {"agent": RON_SEARCH_AGENT_MODEL, "shopping": RON_SEARCH_SHOPPING_MODEL},
        "shopping_domains": RON_SEARCH_SHOPPING_DOMAINS,
    }


@router.post("/search/stream")
async def search_stream(body: SearchRequest, request: Request) -> StreamingResponse:
    level = body.level or RON_SEARCH_DEFAULT_LEVEL
    if level not in SEARCH_LEVELS:
        raise HTTPException(422, {"code": "invalid_level", "message": f"Unknown search level: {level}",
                                  "levels": list(SEARCH_LEVELS)})
    client = get_brave_client(request)
    if not client.configured and not PERPLEXITY_API_KEY:
        raise HTTPException(503, {"code": "not_configured",
                                  "message": "Neither BRAVE_SEARCH_API_KEY nor PERPLEXITY_API_KEY is set"})

    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
    started = time.monotonic()

    async def run_brave() -> None:
        if not client.configured:
            for kind in SECTION_COUNTS:
                await queue.put(("section", {"kind": kind, "q": body.q, "status": "error", "items": [],
                                             "error": {"code": "not_configured",
                                                       "message": "BRAVE_SEARCH_API_KEY is not set", "status": 503}}))
            return

        async def one(kind: str, count: int) -> None:
            section = await run_section(client, SectionRequest(kind=kind, q=body.q, count=count),
                                        body.location, body.country)
            await queue.put(("section", section.model_dump()))

        await asyncio.gather(*(one(kind, count) for kind, count in SECTION_COUNTS.items()))

    async def run_agent(prefix: str, request_payload: dict[str, Any]) -> None:
        try:
            async for event in stream_agent(request_payload):
                event_type = event.pop("type")
                await queue.put((f"{prefix}.{event_type}", event))
        except SearchAgentError as error:
            await queue.put(("source_error", {"source": prefix, "code": error.code,
                                              "message": str(error), "status": error.status}))

    async def run_all() -> None:
        tasks = [asyncio.create_task(run_brave()),
                 asyncio.create_task(run_agent("agent", build_agent_request(body.q, level)))]
        if body.shopping:
            tasks.append(asyncio.create_task(run_agent("shopping", build_shopping_request(body.q))))
        # return_exceptions: an unexpected failure in one producer must still let the
        # terminal None reach the queue so the stream always closes with `done`.
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                await queue.put(("source_error", {"source": "internal", "code": "internal",
                                                  "message": f"{type(result).__name__}: {result}", "status": None}))
        await queue.put(None)

    async def generate():
        yield _frame("meta", {"q": body.q, "level": level, "model": RON_SEARCH_AGENT_MODEL,
                              "shopping_model": RON_SEARCH_SHOPPING_MODEL if body.shopping else None,
                              "country": body.country})
        runner = asyncio.create_task(run_all())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield _frame(item[0], item[1])
        finally:
            if not runner.done():
                runner.cancel()
                await asyncio.gather(runner, return_exceptions=True)
        yield _frame("done", {"duration_ms": int((time.monotonic() - started) * 1000)})

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
