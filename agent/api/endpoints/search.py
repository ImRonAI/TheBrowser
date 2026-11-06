"""Browser search HTTP surface: Brave fan-out + Strands Harness xAI Search Agent & Shopping Subagent.

One ``POST /search/stream`` runs one query against Brave verticals and the Strands Harness
Search Agent (``xai/grok-4.7``) concurrently and merges them onto a single SSE response:

- Brave ``web``/``news``/``videos``/``images``/``places`` at per-endpoint maximum counts, each
  isolated (one failing source never blanks the page — same rule as Discover);
- the Strands Harness Search Agent (built from ``agent/api/configs/search/<level>.json`` via
  ``create_harness()`` on ``RonXAIModel("grok-4.7")`` with progressive reasoning effort) streamed
  as ``agent.*`` events;
- the Shopping Specialist subagent (built from ``agent/api/configs/search/shopping.json`` via
  ``create_harness()`` and exposed as the Search Agent's ``subagent`` tool) streamed as
  ``shopping.*`` events with both online retailer and local brick-and-mortar store links.
- Multi-turn conversational follow-up (``follow_up=True``, ``session_id=<id>``) streams directly
  from the persisted Search Agent session without re-running the static Brave sections.
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent.api.core.brave_search import (
    FeedLocation,
    SectionRequest,
    run_section,
)
from agent.api.core.config import (
    PERPLEXITY_API_KEY,
    RON_SEARCH_AGENT_MODEL,
    RON_SEARCH_DEFAULT_LEVEL,
    RON_SEARCH_PROVIDER,
    RON_SEARCH_SHOPPING_DOMAINS,
    RON_SEARCH_SHOPPING_MODEL,
    XAI_API_KEY,
    perplexity_agent_api_enabled,
)
from agent.api.core.search_agent import (
    LEVEL_REASONING_EFFORT,
    SEARCH_LEVELS,
    SearchAgentError,
    SearchLevel,
    build_agent_request,
    build_shopping_request,
    search_provider_configured,
    stream_agent,
    stream_search_session,
)
from agent.api. core import search_agent as _sa_module

# Discover owns the process-wide BraveClient (one shared token bucket).
from agent.api.endpoints.discover import get_client as get_brave_client

router = APIRouter()

#: Per-kind Brave counts: web caps at 20 per page; news/images/videos at 50
#: (the SectionRequest ceiling); place_search at 20.
SECTION_COUNTS: dict[str, int] = {"web": 20, "news": 50, "videos": 50, "images": 50, "places": 20}


class SearchRequest(BaseModel):
    q: str = Field(min_length=1, max_length=400)
    level: str | None = Field(default=None, description="Research level (fast, low, medium, high, xhigh); default RON_SEARCH_DEFAULT_LEVEL")
    country: str = Field(default="US", min_length=2, max_length=3)
    location: FeedLocation | None = None
    shopping: bool = True
    session_id: str | None = Field(default=None, max_length=128)
    follow_up: bool = False


def _frame(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _xai_configured() -> bool:
    import os

    if os.getenv("RON_SEARCH_AGENT", "1") == "0":
        return False
    return bool(XAI_API_KEY)


def _perplexity_configured() -> bool:
    if not perplexity_agent_api_enabled():
        return False
    return bool(PERPLEXITY_API_KEY)


def _agent_configured() -> bool:
    if stream_agent is not _sa_module.stream_agent:
        return _perplexity_configured()
    return _xai_configured() or _perplexity_configured()


@router.get("/search/status")
async def search_status(request: Request):
    return {
        "configured": {
            "brave": get_brave_client(request).configured,
            "xai": _xai_configured(),
            "perplexity": _perplexity_configured(),
        },
        "provider": RON_SEARCH_PROVIDER,
        "levels": list(SEARCH_LEVELS),
        "reasoning_efforts": dict(LEVEL_REASONING_EFFORT),
        "default_level": RON_SEARCH_DEFAULT_LEVEL,
        "models": {"agent": RON_SEARCH_AGENT_MODEL, "shopping": RON_SEARCH_SHOPPING_MODEL},
        "shopping_domains": RON_SEARCH_SHOPPING_DOMAINS,
    }


@router.post("/search/stream")
async def search_stream(body: SearchRequest, request: Request) -> StreamingResponse:
    level: SearchLevel = (body.level or RON_SEARCH_DEFAULT_LEVEL)  # type: ignore[assignment]
    if level not in SEARCH_LEVELS:
        raise HTTPException(
            422,
            {
                "code": "invalid_level",
                "message": f"Unknown search level: {level}",
                "levels": list(SEARCH_LEVELS),
            },
        )
    client = get_brave_client(request)
    if not client.configured and not _agent_configured():
        raise HTTPException(
            503,
            {
                "code": "not_configured",
                "message": "Neither BRAVE_SEARCH_API_KEY nor the search model provider API key (XAI_API_KEY) is set",
            },
        )

    session_id = (body.session_id or "").strip() or uuid.uuid4().hex
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
    started = time.monotonic()

    async def run_brave() -> None:
        if not client.configured:
            for kind in SECTION_COUNTS:
                await queue.put((
                    "section",
                    {
                        "kind": kind,
                        "q": body.q,
                        "status": "error",
                        "items": [],
                        "error": {
                            "code": "not_configured",
                            "message": "BRAVE_SEARCH_API_KEY is not set",
                            "status": 503,
                        },
                    },
                ))
            return

        async def one(kind: str, count: int) -> None:
            section = await run_section(
                client,
                SectionRequest(kind=kind, q=body.q, count=count),
                body.location,
                body.country,
            )
            await queue.put(("section", section.model_dump()))

        await asyncio.gather(*(one(kind, count) for kind, count in SECTION_COUNTS.items()))

    async def run_legacy_agent(prefix: str, request_payload: dict[str, Any]) -> None:
        try:
            async for event in stream_agent(request_payload):
                event_type = event.pop("type")
                await queue.put((f"{prefix}.{event_type}", event))
        except SearchAgentError as error:
            await queue.put((
                "source_error",
                {"source": prefix, "code": error.code, "message": str(error), "status": error.status},
            ))

    async def run_harness_session() -> None:
        try:
            async for ev_name, payload in stream_search_session(
                body.q,
                level,
                session_id=session_id,
                follow_up=body.follow_up,
                shopping=body.shopping,
                country=body.country,
                location=body.location,
            ):
                await queue.put((ev_name, payload))
        except SearchAgentError as error:
            await queue.put((
                "source_error",
                {"source": "agent", "code": error.code, "message": str(error), "status": error.status},
            ))

    async def emit_disabled(prefix: str) -> None:
        await queue.put((
            "source_error",
            {
                "source": prefix,
                "code": "disabled",
                "message": "Search Agent is temporarily disabled",
                "status": None,
            },
        ))

    async def run_all() -> None:
        tasks: list[asyncio.Task[Any]] = []
        if not body.follow_up:
            tasks.append(asyncio.create_task(run_brave()))
        if _agent_configured():
            if stream_agent is not _sa_module.stream_agent:
                tasks.append(asyncio.create_task(run_legacy_agent("agent", build_agent_request(body.q, level))))
                if body.shopping and not body.follow_up:
                    tasks.append(asyncio.create_task(run_legacy_agent("shopping", build_shopping_request(body.q))))
            else:
                tasks.append(asyncio.create_task(run_harness_session()))
        else:
            tasks.append(asyncio.create_task(emit_disabled("agent")))
            if body.shopping and not body.follow_up:
                tasks.append(asyncio.create_task(emit_disabled("shopping")))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                await queue.put((
                    "source_error",
                    {
                        "source": "internal",
                        "code": "internal",
                        "message": f"{type(result).__name__}: {result}",
                        "status": None,
                    },
                ))
        await queue.put(None)

    async def generate():
        yield _frame(
            "meta",
            {
                "q": body.q,
                "level": level,
                "provider": RON_SEARCH_PROVIDER,
                "effort": LEVEL_REASONING_EFFORT.get(level, "medium"),
                "model": RON_SEARCH_AGENT_MODEL,
                "shopping_model": RON_SEARCH_SHOPPING_MODEL if body.shopping else None,
                "country": body.country,
                "session_id": session_id,
                "follow_up": body.follow_up,
            },
        )
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

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
