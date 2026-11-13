"""Brave Search API client for the Discover homepage.

Backend-only: the subscription token never leaves this process. Response
shapes were verified live on 2026-09-25 against the Search plan:

- 200: /web/search, /news/search, /videos/search, /images/search,
  /local/place_search, /local/pois, /local/descriptions, /llm/context,
  /web/rich (two-step: ``enable_rich_callback=true`` -> ``rich.hint.callback_key``)
- 400 OPTION_NOT_IN_PLAN: /suggest/search, /spellcheck/search on the Search key.
  They are separate plans with their own tokens (``BRAVE_SUGGEST_API_KEY`` /
  ``BRAVE_SPELLCHECK_API_KEY``), verified 200 on 2026-10-07; policy ``100;w=1``.
- Answers plan (``BRAVE_ANSWERS_API_KEY``): ``POST /chat/completions``, an
  OpenAI-compatible SSE stream (``BraveAnswersClient``), policy ``2;w=1``.
- rate limit policy header: ``50;w=1, 0;w=2592000`` (50 req/s, no monthly cap)

Rich verticals seen live: weather (OpenWeatherMap, always metric regardless of
``units``), stocks (FMP), cryptocurrency (CoinGecko), currency (Fixer),
calculator, unitconversion (units only, no computed result), unixtimestamp,
definitions (Wordnik), sports (API-Sports; payload keyed by sport name).
``result_filter=web&count=1`` is the cheapest search that still yields a hint
(``result_filter=query`` suppresses it); callback keys are replayable.

Every call goes through one process-wide token bucket so concurrent Discover
sections cannot exceed the per-second quota, and 429s surface as a typed
``BraveSearchError`` carrying ``retry_after`` for the per-source UI state.
"""
from __future__ import annotations

import asyncio
import html
import re
import time
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, Field

from agent.api.core import config as app_config
from agent.api.core.config import (
    BRAVE_ANSWERS_API_KEY, BRAVE_ANSWERS_MODEL, BRAVE_ANSWERS_RPS, BRAVE_ANSWERS_TIMEOUT, BRAVE_ASSIST_RPS,
    BRAVE_SEARCH_API_KEY, BRAVE_SEARCH_BASE_URL, BRAVE_SEARCH_RPS, BRAVE_SPELLCHECK_API_KEY, BRAVE_SUGGEST_API_KEY,
)

ItemKind = Literal["article", "video", "image", "place", "discussion", "web", "rich"]
Freshness = Literal["pd", "pw", "pm", "py"]
SafeSearch = Literal["off", "moderate", "strict"]
MAX_POI_IDS = 20
SPARKLINE_POINTS = 60
#: Suggest and Spellcheck ``q`` limits from the API reference: 400 characters and 50 words.
ASSIST_MAX_CHARS = 400
ASSIST_MAX_WORDS = 50
#: ``/suggest/search`` ``count``: min 1, max 20, default 5.
SUGGEST_MAX_COUNT = 20


class BraveSearchError(Exception):
    """Typed failure for one Brave call. ``code`` is stable for the UI."""

    def __init__(self, code: str, message: str, *, status: int | None = None, retry_after: float | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.retry_after = retry_after


class RateLimiter:
    """Async token bucket: ``rate`` tokens per second, capacity ``burst``."""

    def __init__(self, rate: float, burst: int | None = None, clock=time.monotonic):
        if rate <= 0:
            raise ValueError("rate must be positive")
        self.rate = rate
        self.capacity = burst or max(1, int(rate))
        self._tokens = float(self.capacity)
        self._clock = clock
        self._updated = clock()
        self._lock = asyncio.Lock()

    async def acquire(self) -> float:
        """Wait for one token. Returns the seconds slept (0 when immediate)."""
        async with self._lock:
            now = self._clock()
            self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.rate)
            self._updated = now
            if self._tokens >= 1:
                self._tokens -= 1
                return 0.0
            wait = (1 - self._tokens) / self.rate
            self._tokens = 0.0
            self._updated = now + wait
        await asyncio.sleep(wait)
        return wait


class DiscoverItem(BaseModel):
    kind: ItemKind
    id: str
    title: str
    url: str
    source: str = ""
    description: str = ""
    thumbnail: str | None = None
    favicon: str | None = None
    published: str | None = None
    age: str | None = None
    video: dict[str, Any] | None = None
    image: dict[str, Any] | None = None
    place: dict[str, Any] | None = None
    discussion: dict[str, Any] | None = None
    rich: dict[str, Any] | None = None
    # Everything else Brave sends that a reader can use. ``None`` (not ``[]``/``False``) when absent, because
    # the agent search tools dump items with ``exclude_none``.
    snippets: list[str] | None = None  # ``extra_snippets`` as clean, de-duplicated fragments
    author: str | None = None  # ``article.author`` names
    paywalled: bool | None = None  # ``article.isAccessibleForFree`` is false
    language: str | None = None
    live: bool | None = None  # ``is_live``
    breaking: bool | None = None  # news ``breaking``
    original_thumbnail: str | None = None  # ``thumbnail.original``: full size where Brave proxies a 200px copy as ``src``
    answers: list[dict[str, str]] | None = None  # ``faq`` / ``qa``: [{question, answer}]


class RichAnswer(BaseModel):
    """One real-time answer from ``/web/rich``. ``card`` is the stable UI contract; ``raw`` is the vertical payload."""

    vertical: str
    subtype: str
    provider: dict[str, Any]
    card: dict[str, Any]
    raw: dict[str, Any]


def hostname(url: str) -> str:
    host = urlsplit(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


def _thumb(raw: dict[str, Any]) -> str | None:
    thumbnail = raw.get("thumbnail") or {}
    return thumbnail.get("src") or thumbnail.get("original") or None


def _favicon(raw: dict[str, Any]) -> str | None:
    return (raw.get("meta_url") or {}).get("favicon") or (raw.get("profile") or {}).get("img") or None


_TAGS = re.compile(r"<[^>]+>")
_C1 = re.compile(r"[\x80-\x9f]")
_ELLIPSIS_JOIN = re.compile(r"\s+\.\.\.\s+")
MAX_SNIPPETS = 6
MAX_SNIPPET_CHARS = 600


def clean_text(value: Any) -> str:
    """Plain text from Brave's markup-bearing strings: tags dropped, entities decoded, whitespace collapsed, and
    stray C1 control characters (Windows-1252 bytes mis-decoded as Latin-1, e.g. U+0097 where a dash belongs) repaired."""
    if not isinstance(value, str):
        return ""
    text = html.unescape(_TAGS.sub("", value))
    text = _C1.sub(lambda m: bytes([ord(m.group(0))]).decode("cp1252", errors="ignore"), text)
    return " ".join(text.split())


def _fold(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


def clean_snippets(raw: dict[str, Any]) -> list[str]:
    """``extra_snippets`` as separate fragments. Brave joins several page excerpts into one string with `` ... ``;
    each fragment is kept once, and anything already said by the description or an earlier fragment is dropped."""
    known = [_fold(clean_text(raw.get("description")))]
    out: list[str] = []
    for snippet in raw.get("extra_snippets") or []:
        for fragment in _ELLIPSIS_JOIN.split(clean_text(snippet)):
            fragment = fragment.strip(" .")[:MAX_SNIPPET_CHARS].strip()
            folded = _fold(fragment)
            if len(folded) < 20 or any(folded in other or other in folded for other in known if other):
                continue
            known.append(folded)
            out.append(fragment)
            if len(out) == MAX_SNIPPETS:
                return out
    return out


def _answers(raw: dict[str, Any]) -> list[dict[str, str]]:
    """FAQ items (``faq.items``) and the community answer (``qa``) as clean question/answer pairs."""
    pairs: list[dict[str, str]] = []
    for item in (raw.get("faq") or {}).get("items") or []:
        question, answer = clean_text(item.get("question")), clean_text(item.get("answer"))
        if question and answer:
            pairs.append({"question": question, "answer": answer})
    qa = raw.get("qa") or {}
    question, answer = clean_text(qa.get("question")), clean_text((qa.get("answer") or {}).get("text"))
    if question and answer:
        pairs.append({"question": question, "answer": answer})
    return pairs[:4]


def _base(kind: ItemKind, raw: dict[str, Any], prefix: str) -> dict[str, Any]:
    url = raw.get("url") or ""
    article = raw.get("article") or {}
    authors = [a.get("name") for a in article.get("author") or [] if isinstance(a, dict) and a.get("name")]
    return {
        "kind": kind,
        "id": f"{prefix}:{raw.get('id') or url}",
        "title": raw.get("title") or "",
        "url": url,
        "source": (raw.get("profile") or {}).get("name") or hostname(url),
        "description": raw.get("description") or "",
        "thumbnail": _thumb(raw),
        "favicon": _favicon(raw),
        "published": raw.get("page_age"),
        "age": raw.get("age"),
        "snippets": clean_snippets(raw) or None,
        "author": ", ".join(clean_text(name) for name in authors) or None,
        "paywalled": True if article.get("isAccessibleForFree") is False else None,
        "language": raw.get("language") or None,
        "live": True if raw.get("is_live") else None,
        "breaking": True if raw.get("breaking") else None,
        "original_thumbnail": (raw.get("thumbnail") or {}).get("original") or None,
        "answers": _answers(raw) or None,
    }


def normalize_news(raw: dict[str, Any]) -> DiscoverItem:
    return DiscoverItem(**_base("article", raw, "news"))


def normalize_web(raw: dict[str, Any]) -> DiscoverItem:
    return DiscoverItem(**_base("web", raw, "web"))


def normalize_video(raw: dict[str, Any]) -> DiscoverItem:
    video = raw.get("video") or {}
    return DiscoverItem(**_base("video", raw, "video"), video={
        "duration": video.get("duration"),
        "creator": video.get("creator") or (video.get("author") or {}).get("name"),
        "publisher": video.get("publisher"),
        "views": video.get("views"),
        "original_thumbnail": (raw.get("thumbnail") or {}).get("original"),
    })


def normalize_image(raw: dict[str, Any]) -> DiscoverItem:
    properties = raw.get("properties") or {}
    thumbnail = raw.get("thumbnail") or {}
    base = _base("image", raw, "image")
    base["source"] = raw.get("source") or base["source"]
    base["published"] = raw.get("page_fetched")
    return DiscoverItem(**base, image={
        "url": properties.get("url"),
        "width": properties.get("width"),
        "height": properties.get("height"),
        "thumbnail_width": thumbnail.get("width"),
        "thumbnail_height": thumbnail.get("height"),
        "confidence": raw.get("confidence"),
    })


def normalize_discussion(raw: dict[str, Any]) -> DiscoverItem:
    data = raw.get("data") or {}
    return DiscoverItem(**_base("discussion", raw, "discussion"), discussion={
        "forum": data.get("forum_name"),
        "answers": data.get("num_answers"),
        "score": data.get("score"),
        "question": clean_text(data.get("question")) or None,
        "top_comment": clean_text(data.get("top_comment")) or None,
    })


def normalize_place(raw: dict[str, Any]) -> DiscoverItem:
    coordinates = raw.get("coordinates") or []
    hours = raw.get("opening_hours") or {}
    rating = raw.get("rating") or {}
    base = _base("place", raw, "place")
    base["id"] = f"place:{raw.get('id')}"
    base["source"] = hostname(raw.get("url") or raw.get("provider_url") or "")
    return DiscoverItem(**base, place={
        "place_id": raw.get("id"),
        "address": (raw.get("postal_address") or {}).get("displayAddress"),
        "latitude": coordinates[0] if len(coordinates) > 0 else None,
        "longitude": coordinates[1] if len(coordinates) > 1 else None,
        "distance": raw.get("distance"),
        "phone": (raw.get("contact") or {}).get("telephone"),
        "rating": rating.get("ratingValue"),
        "review_count": rating.get("reviewCount"),
        "price_range": raw.get("price_range"),
        "categories": raw.get("categories") or [],
        "cuisine": raw.get("serves_cuisine") or [],
        "hours_today": hours.get("current_day") or [],
        "pictures": [p.get("src") for p in (raw.get("pictures") or {}).get("results", []) if p.get("src")][:6],
    })


def _downsample(points: list[Any], limit: int = SPARKLINE_POINTS) -> list[Any]:
    if len(points) <= limit:
        return points
    step = len(points) / limit
    return [points[int(i * step)] for i in range(limit)]


def _rich_weather(w: dict[str, Any]) -> dict[str, Any]:
    location, current = w.get("location") or {}, w.get("current_weather") or {}
    return {
        "location": ", ".join(p for p in (location.get("name"), location.get("state"), location.get("country")) if p),
        "temp_c": current.get("temp"), "feels_like_c": current.get("feels_like"), "humidity": current.get("humidity"),
        "wind_mps": (current.get("wind") or {}).get("speed"), "condition": (current.get("weather") or {}).get("description"),
        "icon": (current.get("weather") or {}).get("icon"), "observed_ts": current.get("ts"), "local_time": w.get("current_time_iso"),
        "daily": [{"ts": d.get("ts"), "label": d.get("date_i18n"), "min_c": (d.get("temperature") or {}).get("min"),
                   "max_c": (d.get("temperature") or {}).get("max"), "condition": (d.get("weather") or {}).get("description"),
                   "icon": (d.get("weather") or {}).get("icon"), "precip_prob": d.get("pop")} for d in (w.get("daily") or [])[:7]],
        "alerts": w.get("alerts") or [],
    }


def _rich_stock(s: dict[str, Any]) -> dict[str, Any]:
    info, quote, series = s.get("asset_info") or {}, s.get("quote") or {}, (s.get("timeseries") or {}).get("timeseries") or []
    return {
        "symbol": quote.get("symbol") or info.get("symbol"), "name": quote.get("company_name") or info.get("name"),
        "exchange": quote.get("primary_exchange") or info.get("exchange"), "currency": quote.get("currency") or info.get("currency"),
        "price": quote.get("latest_price"), "change": quote.get("change"), "change_percent": quote.get("change_percent"),
        "open": quote.get("open"), "high": quote.get("high"), "low": quote.get("low"), "previous_close": quote.get("close"),
        "market_cap": quote.get("market_cap"), "pe_ratio": quote.get("pe_ratio"), "volume": quote.get("volume"),
        "week_52_high": quote.get("week_52_high"), "week_52_low": quote.get("week_52_low"), "updated_ms": quote.get("latest_update"),
        "time_range": s.get("time_range"), "sparkline": _downsample([[p.get("timestamp"), p.get("close")] for p in series]),
        "exchange_hours": s.get("exchange_info"),
    }


def _rich_crypto(c: dict[str, Any]) -> dict[str, Any]:
    quote, series = c.get("quote") or {}, (c.get("timeseries") or {}).get("ts_price") or []
    return {
        "symbol": (quote.get("symbol") or "").upper(), "name": quote.get("name"), "image": quote.get("image"),
        "vs_currency": (c.get("vs_currency") or "").upper(), "price": quote.get("current_price"),
        "change_24h": quote.get("price_change_24h"), "change_percent_24h": quote.get("price_change_percentage_24h"),
        "high_24h": quote.get("high_24h"), "low_24h": quote.get("low_24h"), "market_cap": quote.get("market_cap"),
        "market_cap_rank": quote.get("market_cap_rank"), "volume_24h": quote.get("total_volume"), "ath": quote.get("ath"),
        "updated": quote.get("last_updated"), "time_range": (c.get("timeseries") or {}).get("time_range"),
        "sparkline": _downsample(series),
    }


def _rich_currency(c: dict[str, Any]) -> dict[str, Any]:
    conversion, query = c.get("conversion") or {}, (c.get("conversion") or {}).get("query") or {}
    return {
        "from": (query.get("from_currency") or {}).get("code"), "from_name": (query.get("from_currency") or {}).get("full_name"),
        "to": (query.get("to_currency") or {}).get("code"), "to_name": (query.get("to_currency") or {}).get("full_name"),
        "amount": conversion.get("amount"), "result": conversion.get("result"), "rate": (conversion.get("info") or {}).get("rate"),
        "date": conversion.get("date"), "time_range": (c.get("timeseries") or {}).get("time_range"),
        "sparkline": _downsample((c.get("timeseries") or {}).get("ts_exchange_rate") or []),
    }


def _rich_definitions(d: dict[str, Any]) -> dict[str, Any]:
    senses = [{"part_of_speech": g.get("part_of_speech"),
               "definitions": [x.get("text") for x in g.get("definitions") or [] if x.get("text")][:4]}
              for g in d.get("definitions") or []]
    return {"word": d.get("word"), "language": d.get("language"), "pronunciation": d.get("pronounciation") or d.get("pronunciation"),
            "senses": senses, "attribution": d.get("attribution_text"), "attribution_url": d.get("attribution_url")}


def _rich_sports(result: dict[str, Any], now: float | None = None) -> dict[str, Any]:
    """Sports payloads are keyed by sport name (``basketball``/``football``/...); find the one carrying ``sport``."""
    sport_key = next((k for k, v in result.items() if isinstance(v, dict) and v.get("sport")), None)
    payload: dict[str, Any] = result.get(sport_key) or {} if sport_key else {}
    content = payload.get("content") or {}
    games = []
    for g in content.get("games") or []:
        teams, score, status = g.get("teams") or {}, g.get("score") or {}, g.get("status") or {}
        games.append({"id": g.get("id"), "start_ts": g.get("start_time"), "status": status.get("code"),
                      "home": {"name": (teams.get("home") or {}).get("name"), "logo": (teams.get("home") or {}).get("logo"), "score": score.get("home")},
                      "away": {"name": (teams.get("away") or {}).get("name"), "logo": (teams.get("away") or {}).get("logo"), "score": score.get("away")}})
    cutoff = time.time() if now is None else now
    recent = [g for g in games if g["start_ts"] and g["start_ts"] <= cutoff][-3:]
    upcoming = [g for g in games if g["start_ts"] and g["start_ts"] > cutoff][:3]
    league, team = content.get("league") or {}, content.get("team") or {}
    return {"sport": payload.get("sport"), "entity_type": payload.get("type"), "view": payload.get("view"),
            "league": {"name": league.get("name"), "logo": league.get("logo"), "season": league.get("season")},
            "team": {"name": team.get("name"), "logo": team.get("logo")}, "recent": recent, "upcoming": upcoming, "game_count": len(games)}


_RICH_CARDS = {
    "weather": lambda r: _rich_weather(r.get("weather") or {}),
    "stocks": lambda r: _rich_stock(r.get("stock") or {}),
    "cryptocurrency": lambda r: _rich_crypto(r.get("cryptocurrency") or {}),
    "currency": lambda r: _rich_currency(r.get("currency") or {}),
    "calculator": lambda r: {"expression": (r.get("calculator") or {}).get("expression"), "answer": (r.get("calculator") or {}).get("answer")},
    "unitconversion": lambda r: dict(r.get("unitconversion") or {}),
    "unixtimestamp": lambda r: dict((r.get("unixtimestamp") or {}).get("conversion") or {}),
    "definitions": lambda r: _rich_definitions(r.get("definitions") or {}),
    "sports": _rich_sports,
}


RICH_VERTICALS = frozenset(_RICH_CARDS)


def normalize_rich(result: dict[str, Any], vertical: str) -> RichAnswer:
    """``card`` is a compact, provider-agnostic view; unknown subtypes still ship ``raw`` so the UI can degrade."""
    subtype = result.get("subtype") or vertical
    builder = _RICH_CARDS.get(subtype)
    raw = {k: v for k, v in result.items() if k not in ("type", "subtype", "provider")}
    return RichAnswer(vertical=vertical, subtype=subtype, provider=result.get("provider") or {},
                      card=builder(result) if builder else {}, raw=raw)



_UNSET: Any = object()


class BraveClient:
    def __init__(
        self,
        api_key: str | None = _UNSET,
        *,
        base_url: str = BRAVE_SEARCH_BASE_URL,
        limiter: RateLimiter | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 15.0,
        suggest_api_key: str | None = _UNSET,
        spellcheck_api_key: str | None = _UNSET,
        assist_limiter: RateLimiter | None = None,
    ):
        self.api_key = app_config.BRAVE_SEARCH_API_KEY if api_key is _UNSET else api_key
        self.base_url = base_url.rstrip("/")
        self.limiter = limiter or RateLimiter(app_config.BRAVE_SEARCH_RPS)
        self._transport = transport
        self._timeout = timeout
        # Suggest / Spellcheck are separate Brave plans with their own tokens and a 100 req/s policy;
        # they share one bucket because both back the same keystroke-driven text assist.
        self.suggest_api_key = (
            app_config.BRAVE_SUGGEST_API_KEY if suggest_api_key is _UNSET else suggest_api_key
        )
        self.spellcheck_api_key = (
            app_config.BRAVE_SPELLCHECK_API_KEY if spellcheck_api_key is _UNSET else spellcheck_api_key
        )
        self.assist_limiter = assist_limiter or RateLimiter(app_config.BRAVE_ASSIST_RPS)

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    @property
    def assist_configured(self) -> dict[str, bool]:
        return {"suggest": bool(self.suggest_api_key), "spellcheck": bool(self.spellcheck_api_key)}

    async def get(self, path: str, params: dict[str, Any], *, headers: dict[str, str] | None = None,
                  api_key: str | None = _UNSET, key_name: str = "BRAVE_SEARCH_API_KEY",
                  limiter: RateLimiter | None = None) -> dict[str, Any]:
        key = self.api_key if api_key is _UNSET else api_key
        if not key:
            raise BraveSearchError("not_configured", f"{key_name} is not set", status=503)
        clean = {k: (str(v).lower() if isinstance(v, bool) else v) for k, v in params.items() if v is not None}
        headers = {"Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": key, **(headers or {})}
        await (limiter or self.limiter).acquire()
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as client:
                response = await client.get(f"{self.base_url}{path}", params=clean, headers=headers)
        except httpx.HTTPError as error:
            raise BraveSearchError("network", type(error).__name__) from error
        if response.status_code == 200:
            return response.json()
        detail: dict[str, Any] = {}
        try:
            detail = response.json().get("error") or {}
        except ValueError:
            pass
        message = detail.get("detail") or response.reason_phrase or "Brave Search request failed"
        if response.status_code == 429:
            retry = response.headers.get("retry-after") or (response.headers.get("x-ratelimit-reset") or "").split(",")[0].strip()
            raise BraveSearchError("rate_limited", message, status=429, retry_after=float(retry) if retry.replace(".", "", 1).isdigit() else None)
        if detail.get("code") == "OPTION_NOT_IN_PLAN":
            raise BraveSearchError("not_in_plan", message, status=response.status_code)
        # Brave returns 422 SUBSCRIPTION_TOKEN_INVALID for a revoked/wrong key (seen live 2026-10-07).
        if response.status_code in (401, 403) or detail.get("code") == "SUBSCRIPTION_TOKEN_INVALID":
            raise BraveSearchError("unauthorized", message, status=response.status_code)
        if response.status_code == 422:
            raise BraveSearchError("invalid_request", message, status=422)
        raise BraveSearchError("upstream", message, status=response.status_code)

    async def news(self, q: str, *, count: int = 10, freshness: Freshness | None = None, country: str = "US",
                   safesearch: SafeSearch = "moderate", extra_snippets: bool = True) -> list[DiscoverItem]:
        body = await self.get("/news/search", {"q": q, "count": count, "freshness": freshness, "country": country,
                                               "safesearch": safesearch, "extra_snippets": extra_snippets,
                                               "spellcheck": False})
        return [normalize_news(r) for r in body.get("results", [])]

    async def videos(self, q: str, *, count: int = 10, freshness: Freshness | None = None, country: str = "US",
                     safesearch: SafeSearch = "moderate") -> list[DiscoverItem]:
        body = await self.get("/videos/search", {"q": q, "count": count, "freshness": freshness, "country": country,
                                                 "safesearch": safesearch, "spellcheck": False})
        return [normalize_video(r) for r in body.get("results", [])]

    async def images(self, q: str, *, count: int = 20, country: str = "US", safesearch: SafeSearch = "strict") -> list[DiscoverItem]:
        body = await self.get("/images/search", {"q": q, "count": count, "country": country, "safesearch": safesearch,
                                                 "spellcheck": False})
        return [normalize_image(r) for r in body.get("results", [])]

    async def web(self, q: str, *, count: int = 10, freshness: Freshness | None = None, country: str = "US",
                  safesearch: SafeSearch = "moderate", extra_snippets: bool = False) -> list[DiscoverItem]:
        """Web + discussions in one call; buckets are flattened web-first."""
        body = await self.get("/web/search", {"q": q, "count": count, "freshness": freshness, "country": country,
                                              "safesearch": safesearch, "result_filter": "web,discussions",
                                              "extra_snippets": extra_snippets, "spellcheck": False})
        items = [normalize_web(r) for r in (body.get("web") or {}).get("results", [])]
        items += [normalize_discussion(r) for r in (body.get("discussions") or {}).get("results", [])]
        return items

    async def places(self, q: str | None, *, latitude: float | None = None, longitude: float | None = None,
                     location: str | None = None, count: int = 10, radius: float | None = None,
                     units: Literal["metric", "imperial"] = "imperial") -> list[DiscoverItem]:
        """``q`` may be omitted to browse an area; then coordinates or ``location`` are required (else 422)."""
        params: dict[str, Any] = {"q": q, "count": count, "radius": radius, "units": units, "location": location}
        if latitude is not None and longitude is not None:
            params.update(latitude=latitude, longitude=longitude, geoloc=f"{latitude}x{longitude}")
        body = await self.get("/local/place_search", params)
        return [normalize_place(r) for r in body.get("results", [])]

    async def poi_details(self, ids: list[str]) -> list[dict[str, Any]]:
        if not 0 < len(ids) <= MAX_POI_IDS:
            raise BraveSearchError("invalid_request", f"1..{MAX_POI_IDS} place ids required", status=422)
        pois, descriptions = await asyncio.gather(
            self.get("/local/pois", {"ids": ids}), self.get("/local/descriptions", {"ids": ids}))
        text = {d.get("id"): d.get("description") for d in descriptions.get("results", [])}
        merged = []
        for raw in pois.get("results", []):
            item = normalize_place(raw).model_dump()
            item["ai_description"] = text.get(raw.get("id"))
            merged.append(item)
        return merged

    async def rich_hint(self, q: str, *, country: str = "US", search_lang: str | None = None) -> dict[str, str] | None:
        """Step 1 of Rich Search. Returns ``{vertical, callback_key}`` or ``None`` when Brave has no live answer.

        ``result_filter=web&count=1`` is the smallest response that still carries the hint
        (``result_filter=query`` drops it); ``no-cache`` keeps stock/weather data current.
        """
        body = await self.get("/web/search", {"q": q, "enable_rich_callback": True, "count": 1, "country": country,
                                              "search_lang": search_lang, "result_filter": "web", "spellcheck": False},
                              headers={"Cache-Control": "no-cache"})
        hint = (body.get("rich") or {}).get("hint") or {}
        return {"vertical": hint["vertical"], "callback_key": hint["callback_key"]} if hint.get("callback_key") else None

    async def rich(self, callback_key: str, *, vertical: str | None = None) -> list[RichAnswer]:
        """Step 2: fetch the real-time payload. Keys are replayable; an empty ``results`` list means it expired."""
        body = await self.get("/web/rich", {"callback_key": callback_key}, headers={"Cache-Control": "no-cache"})
        info = body.get("response_callback_info") or {}
        kind = vertical or info.get("vertical") or "unknown"
        return [normalize_rich(r, kind) for r in body.get("results", []) if isinstance(r, dict)]

    async def answer(self, q: str, *, country: str = "US") -> list[RichAnswer]:
        """Hint + callback in one call; ``[]`` when the query has no rich vertical."""
        hint = await self.rich_hint(q, country=country)
        return await self.rich(hint["callback_key"], vertical=hint["vertical"]) if hint else []

    async def suggest(self, q: str, *, count: int = 5, rich: bool = False, country: str = "US",
                      lang: str = "en") -> list[dict[str, Any]]:
        """``GET /suggest/search`` (Autosuggest plan). Params per the reference: ``q`` (<=400 chars,
        <=50 words), ``lang`` (default en), ``country`` (default US), ``count`` (1-20, default 5),
        ``rich`` (paid autosuggest only). Returns the ``results`` list: ``{query, type?, title?,
        description?, img?}`` where ``type`` is ``query`` | ``entity`` | ``calculator`` (unknown
        values are plain query suggestions)."""
        if not 1 <= count <= SUGGEST_MAX_COUNT:
            raise BraveSearchError("invalid_request", f"count must be between 1 and {SUGGEST_MAX_COUNT}", status=422)
        body = await self.get("/suggest/search", {"q": assist_query(q), "lang": lang, "country": country, "count": count, "rich": rich},
                              api_key=self.suggest_api_key, key_name="BRAVE_SUGGEST_API_KEY", limiter=self.assist_limiter)
        return body.get("results", [])

    async def spellcheck(self, q: str, *, country: str = "US", lang: str = "en") -> str | None:
        """``GET /spellcheck/search`` (Spellcheck plan). Params per the reference: ``q`` (<=400 chars,
        <=50 words), ``lang`` (default en), ``country`` (default US). Returns ``results[0].query``,
        the corrected phrase, or ``None`` when Brave offers no correction."""
        body = await self.get("/spellcheck/search", {"q": assist_query(q), "lang": lang, "country": country},
                              api_key=self.spellcheck_api_key, key_name="BRAVE_SPELLCHECK_API_KEY", limiter=self.assist_limiter)
        results = body.get("results") or []
        return results[0].get("query") if results else None


def assist_query(q: str) -> str:
    """Enforce the Suggest/Spellcheck ``q`` contract: non-empty, <=400 characters, <=50 words."""
    text = (q or "").strip()
    if not text:
        raise BraveSearchError("invalid_request", "q must not be empty", status=422)
    if len(text) > ASSIST_MAX_CHARS or len(text.split()) > ASSIST_MAX_WORDS:
        raise BraveSearchError("invalid_request", f"q is limited to {ASSIST_MAX_CHARS} characters and {ASSIST_MAX_WORDS} words", status=422)
    return text


AnswersModel = Literal["brave", "brave-pro"]
SearchContextSize = Literal["low", "medium", "high"]
#: Research-mode bounds from the API reference (min, max, default).
RESEARCH_LIMITS: dict[str, tuple[int, int, int]] = {
    "research_maximum_number_of_tokens_per_query": (1024, 16384, 8192),
    "research_maximum_number_of_queries": (1, 50, 20),
    "research_maximum_number_of_iterations": (1, 5, 4),
    "research_maximum_number_of_seconds": (1, 300, 180),
    "research_maximum_number_of_results_per_query": (1, 60, 30),
}


class AnswerCitation(BaseModel):
    """One ``<citation>`` tag from the Answers stream (fields as documented)."""
    number: int
    url: str
    start_index: int | None = None
    end_index: int | None = None
    favicon: str | None = None
    snippet: str | None = None


class Answer(BaseModel):
    """A complete Brave Answers reply: the text with ``<citation>``/``<usage>`` tags removed, the
    parsed citations, the ``<usage>`` metadata, and the chunk ``model``/``finish_reason``."""
    text: str
    citations: list[AnswerCitation] = Field(default_factory=list)
    usage: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None
    finish_reason: str | None = None


def parse_answer_delta(delta: str) -> tuple[str, dict[str, Any] | None]:
    """Classify one ``choices[0].delta.content`` per the documented stream format.

    Returns ``("citation", obj)`` / ``("usage", obj)`` for a whole ``<citation>…</citation>`` or
    ``<usage>…</usage>`` delta, else ``("text", None)``. Mirrors the reference's
    ``delta.startswith(tag) and delta.endswith(close)`` check exactly.
    """
    import json

    for tag in ("citation", "usage"):
        open_, close = f"<{tag}>", f"</{tag}>"
        if delta.startswith(open_) and delta.endswith(close):
            try:
                return tag, json.loads(delta.removeprefix(open_).removesuffix(close))
            except ValueError:
                return "text", None
    return "text", None


class BraveAnswersClient:
    """Brave Answers (``POST /chat/completions``), the OpenAI-compatible endpoint documented at
    api-dashboard.search.brave.com/documentation/services/answers.

    Request body is exactly the reference schema: ``messages`` (exactly one user message), ``model``
    (``brave`` | ``brave-pro``), ``stream`` (citations/entities/research require ``true``),
    ``country``, ``language``, ``safesearch``, ``enable_citations``, ``enable_research`` and the
    bounded ``research_*`` knobs, ``web_search_options.search_context_size``. The response is an SSE
    stream of ``chat.completion.chunk`` objects whose ``delta.content`` is text or a whole
    ``<citation>{json}</citation>`` / ``<usage>{json}</usage>`` tag.
    """

    def __init__(self, api_key: str | None = BRAVE_ANSWERS_API_KEY, *, base_url: str = BRAVE_SEARCH_BASE_URL,
                 limiter: RateLimiter | None = None, transport: httpx.AsyncBaseTransport | None = None,
                 timeout: float = BRAVE_ANSWERS_TIMEOUT, model: AnswersModel = BRAVE_ANSWERS_MODEL):  # type: ignore[assignment]
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.limiter = limiter or RateLimiter(BRAVE_ANSWERS_RPS)
        self._transport = transport
        self._timeout = timeout
        self.model = model

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def body(self, question: str, *, model: AnswersModel | None = None, country: str = "us", language: str = "en",
             safesearch: SafeSearch = "moderate", enable_citations: bool = True, enable_research: bool = False,
             search_context_size: SearchContextSize | None = None, **research: int) -> dict[str, Any]:
        """The documented request body. ``research_*`` kwargs are clamped to the reference bounds."""
        text = (question or "").strip()
        if not text:
            raise BraveSearchError("invalid_request", "question must not be empty", status=422)
        payload: dict[str, Any] = {
            "messages": [{"role": "user", "content": text}],
            "model": model or self.model,
            "stream": True,
            "country": country,
            "language": language,
            "safesearch": safesearch,
            "enable_citations": enable_citations and not enable_research,
            "enable_research": enable_research,
        }
        if search_context_size is not None:
            payload["web_search_options"] = {"search_context_size": search_context_size}
        for key, value in research.items():
            if key not in RESEARCH_LIMITS:
                raise BraveSearchError("invalid_request", f"unknown research option {key}", status=422)
            low, high, _ = RESEARCH_LIMITS[key]
            payload[key] = max(low, min(high, int(value)))
        return payload

    async def stream(self, question: str, **options: Any):
        """Yield ``(kind, payload)``: ``("text", str)``, ``("citation", AnswerCitation)``,
        ``("usage", dict)``, ``("done", {"model", "finish_reason"})``."""
        import json

        if not self.api_key:
            raise BraveSearchError("not_configured", "BRAVE_ANSWERS_API_KEY is not set", status=503)
        payload = self.body(question, **options)
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream", "x-subscription-token": self.api_key}
        await self.limiter.acquire()
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as client:
                async with client.stream("POST", f"{self.base_url}/chat/completions", json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        await response.aread()
                        raise self._error(response)
                    model: str | None = None
                    finish: str | None = None
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        chunk = json.loads(data)
                        model = chunk.get("model") or model
                        for choice in chunk.get("choices") or []:
                            finish = choice.get("finish_reason") or finish
                            delta = (choice.get("delta") or {}).get("content")
                            if not delta:
                                continue
                            kind, obj = parse_answer_delta(delta)
                            if kind == "citation" and obj is not None:
                                yield "citation", AnswerCitation.model_validate(obj)
                            elif kind == "usage" and obj is not None:
                                yield "usage", obj
                            else:
                                yield "text", delta
                    yield "done", {"model": model, "finish_reason": finish}
        except httpx.HTTPError as error:
            raise BraveSearchError("network", type(error).__name__) from error

    async def answer(self, question: str, **options: Any) -> Answer:
        """Collect a full stream into one ``Answer``."""
        text: list[str] = []
        citations: list[AnswerCitation] = []
        usage: dict[str, Any] = {}
        meta: dict[str, Any] = {}
        async for kind, payload in self.stream(question, **options):
            if kind == "text" and isinstance(payload, str):
                text.append(payload)
            elif kind == "citation" and isinstance(payload, AnswerCitation):
                citations.append(payload)
            elif kind == "usage" and isinstance(payload, dict):
                usage = payload
            elif kind == "done" and isinstance(payload, dict):
                meta = payload
        return Answer(text="".join(text), citations=citations, usage=usage, model=meta.get("model"), finish_reason=meta.get("finish_reason"))

    @staticmethod
    def _error(response: httpx.Response) -> BraveSearchError:
        detail: dict[str, Any] = {}
        try:
            detail = response.json().get("error") or {}
        except ValueError:
            pass
        message = detail.get("detail") or response.reason_phrase or "Brave Answers request failed"
        if response.status_code == 429:
            retry = response.headers.get("retry-after") or (response.headers.get("x-ratelimit-reset") or "").split(",")[0].strip()
            return BraveSearchError("rate_limited", message, status=429, retry_after=float(retry) if retry.replace(".", "", 1).isdigit() else None)
        if detail.get("code") == "OPTION_NOT_IN_PLAN":
            return BraveSearchError("not_in_plan", message, status=response.status_code)
        if response.status_code == 402:
            return BraveSearchError("payment_required", message, status=402)
        if response.status_code in (401, 403, 422) and detail.get("code") == "SUBSCRIPTION_TOKEN_INVALID":
            return BraveSearchError("unauthorized", message, status=response.status_code)
        if response.status_code in (401, 403):
            return BraveSearchError("unauthorized", message, status=response.status_code)
        if response.status_code in (400, 422):
            return BraveSearchError("invalid_request", message, status=response.status_code)
        return BraveSearchError("upstream", message, status=response.status_code)


class SectionRequest(BaseModel):
    kind: Literal["news", "videos", "images", "web", "places", "rich"]
    q: str | None = Field(default=None, max_length=400)
    count: int = Field(default=10, ge=1, le=50)
    freshness: Freshness | None = None
    safesearch: SafeSearch | None = None


class FeedLocation(BaseModel):
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location: str | None = Field(default=None, max_length=200)
    radius_m: float | None = Field(default=None, gt=0)


class FeedRequest(BaseModel):
    sections: list[SectionRequest] = Field(min_length=1, max_length=14)
    location: FeedLocation | None = None
    country: str = Field(default="US", min_length=2, max_length=3)


class FeedSection(BaseModel):
    kind: str
    q: str | None
    status: Literal["ok", "error"]
    items: list[DiscoverItem] = []
    error: dict[str, Any] | None = None


def error_payload(error: BraveSearchError) -> dict[str, Any]:
    return {"code": error.code, "message": str(error), "status": error.status, "retry_after": error.retry_after}


async def run_section(client: BraveClient, section: SectionRequest, location: FeedLocation | None, country: str) -> FeedSection:
    try:
        if section.kind == "places":
            loc = location or FeedLocation()
            if not section.q and loc.latitude is None and not loc.location:
                raise BraveSearchError("invalid_request", "places needs a query, coordinates, or location", status=422)
            items = await client.places(section.q, latitude=loc.latitude, longitude=loc.longitude, location=loc.location,
                                        count=section.count, radius=loc.radius_m)
        elif section.kind == "rich":
            if not section.q:
                raise BraveSearchError("invalid_request", "rich needs a query", status=422)
            items = [DiscoverItem(kind="rich", id=f"rich:{a.vertical}:{section.q}", title=section.q, url="",
                                  source=a.provider.get("name") or "Brave", rich=a.model_dump())
                     for a in await client.answer(section.q, country=country)]
        else:
            if not section.q:
                raise BraveSearchError("invalid_request", f"{section.kind} needs a query", status=422)
            kwargs: dict[str, Any] = {"count": section.count, "country": country}
            if section.safesearch:
                kwargs["safesearch"] = section.safesearch
            if section.kind != "images":
                kwargs["freshness"] = section.freshness
            if section.kind == "web":
                kwargs["extra_snippets"] = True
            items = await getattr(client, section.kind)(section.q, **kwargs)
        return FeedSection(kind=section.kind, q=section.q, status="ok", items=items)
    except BraveSearchError as error:
        return FeedSection(kind=section.kind, q=section.q, status="error", error=error_payload(error))


async def build_feed(client: BraveClient, request: FeedRequest) -> list[FeedSection]:
    return list(await asyncio.gather(*(run_section(client, s, request.location, request.country) for s in request.sections)))
