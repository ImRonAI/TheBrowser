"""Discover homepage HTTP surface backed by Brave Search (see core/brave_search.py).

The Brave subscription token stays server-side; the renderer only ever
receives normalized DiscoverItem records and per-section error states.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from agent.api.core.brave_search import (
    MAX_POI_IDS,
    RICH_VERTICALS,
    BraveClient,
    BraveSearchError,
    FeedRequest,
    build_feed,
    error_payload,
)

router = APIRouter()
_default_client: BraveClient | None = None


def get_client(request: Request) -> BraveClient:
    """Tests inject ``app.state.brave_client``; production shares one limiter."""
    global _default_client
    client = getattr(request.app.state, "brave_client", None)
    if client is not None:
        return client
    if _default_client is None:
        _default_client = BraveClient()
    return _default_client


class PoiRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=MAX_POI_IDS)


class AssistRequest(BaseModel):
    """Suggest / Spellcheck query per the API reference: q <= 400 chars (and <= 50 words, enforced in
    the client), lang (default en), country (default US); count 1-20 (default 5) and rich apply to
    suggest only."""
    q: str = Field(min_length=1, max_length=400)
    count: int = Field(default=5, ge=1, le=20)
    rich: bool = False
    country: str = Field(default="US", min_length=2, max_length=3)
    lang: str = Field(default="en", min_length=2, max_length=8)


class AnswerRequest(BaseModel):
    q: str = Field(min_length=1, max_length=400)
    country: str = Field(default="US", min_length=2, max_length=3)


def _raise(error: BraveSearchError) -> None:
    raise HTTPException(error.status if error.status and error.status >= 400 else 502, error_payload(error))


@router.get("/discover/status")
async def discover_status(request: Request):
    client = get_client(request)
    return {"configured": client.configured, "sources": ["news", "videos", "images", "web", "places", "pois", "rich"],
            "rich_verticals": sorted(RICH_VERTICALS), "assist": ["suggest", "spellcheck"],
            "assist_configured": client.assist_configured}


@router.post("/discover/answer")
async def discover_answer(body: AnswerRequest, request: Request):
    """Instant answer for the URL bar / homepage: ``answers`` is ``[]`` when Brave has no rich vertical for ``q``."""
    try:
        answers = await get_client(request).answer(body.q, country=body.country)
        return {"q": body.q, "answers": [a.model_dump() for a in answers]}
    except BraveSearchError as error:
        _raise(error)


@router.post("/discover/feed")
async def discover_feed(body: FeedRequest, request: Request):
    client = get_client(request)
    if not client.configured:
        raise HTTPException(503, {"code": "not_configured", "message": "BRAVE_SEARCH_API_KEY is not set"})
    sections = await build_feed(client, body)
    return {"sections": [s.model_dump() for s in sections]}


@router.post("/discover/pois")
async def discover_pois(body: PoiRequest, request: Request):
    try:
        return {"results": await get_client(request).poi_details(body.ids)}
    except BraveSearchError as error:
        _raise(error)


# Text assist for every free-text field in the renderer (search bar, URL bar, prompt inputs,
# issue titles/descriptions). `/assist/*` is the canonical path; `/discover/assist/*` stays as alias.
@router.post("/assist/suggest")
@router.post("/discover/assist/suggest")
async def assist_suggest(body: AssistRequest, request: Request):
    """``GET /suggest/search`` proxied: ``results`` exactly as Brave returns them (query, type, title, description, img)."""
    try:
        return {"query": body.q, "results": await get_client(request).suggest(
            body.q, count=body.count, rich=body.rich, country=body.country, lang=body.lang)}
    except BraveSearchError as error:
        _raise(error)


@router.post("/assist/spellcheck")
@router.post("/discover/assist/spellcheck")
async def assist_spellcheck(body: AssistRequest, request: Request):
    """``GET /spellcheck/search`` proxied: ``corrected`` is ``results[0].query`` or null when Brave has no correction."""
    try:
        return {"query": body.q, "corrected": await get_client(request).spellcheck(body.q, country=body.country, lang=body.lang)}
    except BraveSearchError as error:
        _raise(error)
