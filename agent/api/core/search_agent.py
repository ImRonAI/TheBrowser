"""Strands Harness Search Agent & Shopping Subagent for Ron Browser Search.

Built exclusively on the native ``strands_harness`` configuration system:
- Per-level portable harness configs live in ``agent/api/configs/search/{fast,low,medium,high,xhigh}.json``
  and the shopping specialist config lives in ``agent/api/configs/search/shopping.json``.
- Every config is normalized with ``define_harness_agent_config``, converted to factory arguments
  with ``harness_agent_kwargs_from_config(config, base_dir=REPO_ROOT)``, and instantiated via
  ``create_harness()``.
- The first answer to a query is Brave Answers itself (``BraveAnswersClient.stream``), forwarded as
  ``agent.*`` events with its citations; no model of Ron's is involved.
- The Search Agent (follow-up conversation) and the Shopping agent default to GLM-5.3-Flash on
  NVIDIA NIM (``nim/z-ai/glm-5.3-flash``) with Brave tools only, and progressive reasoning effort
  per research level mapped onto the efforts the model accepts (``resolve_search_effort``).
- The Search Agent delegates shopping and store discovery to its native ``subagent`` tool
  (``strands_harness.tools.subagent.make_subagent`` with the ``"shopping"`` ``Preset``), whose
  builder calls ``create_harness()`` to find both online retailer product links and local
  brick-and-mortar store links.
- Multi-turn conversational follow-up is backed by ``create_harness(session={"id": ..., "dir": ...})``
  (``SnapshotSessionManager`` + ``ContextOffloader``) and ``XAIStatePruner`` so Grok's encrypted
  protobuf conversation state (``<!--XAI_STATE:...-->``) carries seamlessly across turns.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import OrderedDict
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote_plus, urlsplit

import httpx
from strands import Agent
from strands.types.tools import AgentTool
from strands_harness import (
    HARNESS_CONTRACT,
    build_system_prompt,
    create_harness,
    define_harness_agent_config,
    harness_agent_kwargs_from_config,
)
from strands_harness.tools.subagent import AgentSpec, Choice, Fixed, Preset, make_subagent

from agent.api.core import config as app_config
from agent.api.core.brave_answers_tool import answers_client
from agent.api.core.brave_search import BraveSearchError
from agent.api.core.panel_agent import (
    NIM_REASONING_EFFORTS_BY_MODEL, PROVIDERS, build_model, gemini_thinking_levels, mistral_reasoning_efforts,
    provider_api_key, xai_reasoning_efforts,
)
from agent.api.core.xai_model import XAIStatePruner

REPO_ROOT = app_config.REPO_ROOT
RON_SEARCH_PROVIDER = app_config.RON_SEARCH_PROVIDER
RON_SEARCH_AGENT_MODEL = app_config.RON_SEARCH_AGENT_MODEL
RON_SEARCH_SHOPPING_MODEL = app_config.RON_SEARCH_SHOPPING_MODEL
RON_SEARCH_DEFAULT_LEVEL = app_config.RON_SEARCH_DEFAULT_LEVEL
RON_SEARCH_SHOPPING_DOMAINS = app_config.RON_SEARCH_SHOPPING_DOMAINS
DEFAULT_SHOPPING_DOMAINS = getattr(app_config, "_DEFAULT_SHOPPING_DOMAINS", ())
_UNSET = object()

logger = logging.getLogger(__name__)

#: Search levels supported by Ron Browser Search.
SEARCH_LEVELS = ("fast", "low", "medium", "high", "xhigh")
SearchLevel = Literal["fast", "low", "medium", "high", "xhigh"]

#: Progressive reasoning effort wanted at each search level; ``resolve_search_effort`` maps it onto
#: the efforts the configured model accepts (GLM-5.3-Flash: "low", "high", "max").
LEVEL_REASONING_EFFORT: dict[SearchLevel, str] = {
    "fast": "low",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "xhigh": "xhigh",
}

SEARCH_CONFIGS_DIR: Path = Path(__file__).resolve().parent.parent / "configs" / "search"
MAX_SEARCH_SESSIONS = 64

#: Native output-item types that carry source material the results page renders.
SOURCES_ITEM_TYPES = frozenset({"search_results", "x_search_results"})
IMAGES_ITEM_TYPES = frozenset({"image_search_results"})
FETCHED_ITEM_TYPES = frozenset({"fetch_url_results"})

_MARKDOWN_LINK_RE = re.compile(r"\[([^\[\]\n]{2,160})\]\(\s*(https?://[^\s)]+)\s*\)")
_PRICE_RE = re.compile(r"\$\d[\d,]*(?:\.\d{2})?(?:\s*[–-]\s*\$\d[\d,]*(?:\.\d{2})?)?")
_RATING_RE = re.compile(r"(\d\.\d)\s*(?:/\s*5|\★|stars?)", re.IGNORECASE)
_PHONE_RE = re.compile(r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}")

_STREAM_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=10.0)


class SearchAgentError(Exception):
    """Typed failure of one Search Agent run. ``code`` is stable for the UI."""

    def __init__(self, code: str, message: str, *, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


def _hostname(url: str) -> str:
    try:
        host = urlsplit(url).hostname or ""
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def search_provider_configured(provider: str | None = None) -> bool:
    """True when the configured search model provider has credentials."""
    target = (provider or app_config.RON_SEARCH_PROVIDER).strip().lower()
    if target in PROVIDERS:
        return bool(provider_api_key(target))  # type: ignore[arg-type]
    return bool(app_config.XAI_API_KEY)


def search_config_path(name: str) -> Path:
    """Path to a native Strands Harness JSON config under ``agent/api/configs/search/``."""
    clean = name.strip().lower()
    path = SEARCH_CONFIGS_DIR / f"{clean}.json"
    if not path.is_file():
        raise ValueError(f"Unknown search harness config {name!r}; expected {path}")
    return path


def load_search_harness_config(name: str) -> dict[str, Any]:
    """Load and normalize a portable Strands Harness config from ``agent/api/configs/search/{name}.json``."""
    raw = json.loads(search_config_path(name).read_text(encoding="utf-8"))
    return define_harness_agent_config(raw)


def resolve_search_effort(
    provider: str,
    model_id: str,
    level: str,
    config_effort: str | None = None,
) -> str | None:
    """Resolve the reasoning effort for ``(provider, model_id, level)``.

    Maps ``fast -> low``, ``low -> low``, ``medium -> medium``, ``high -> high``, ``xhigh -> xhigh``,
    and validates against ``panel_agent.model_efforts(provider, model_id)``.
    """
    desired = LEVEL_REASONING_EFFORT.get(level, config_effort or "medium")  # type: ignore[arg-type]
    if desired in ("auto", "off", "none", ""):
        desired = LEVEL_REASONING_EFFORT.get(level, "low")  # type: ignore[arg-type]
    supported = {
        "xai": xai_reasoning_efforts, "mistral": mistral_reasoning_efforts, "gemini": gemini_thinking_levels,
        "nim": lambda model: NIM_REASONING_EFFORTS_BY_MODEL.get(model, ()),
    }.get(provider, lambda model: ())(model_id)
    if not supported:
        return desired if provider not in PROVIDERS else None
    # The nearest effort the model accepts, at or above the one wanted.
    order = ("low", "medium", "high", "xhigh", "max")
    for candidate in order[order.index(desired):] if desired in order else ():
        if candidate in supported:
            return candidate
    return next((candidate for candidate in reversed(order) if candidate in supported), supported[0])


def build_harness_from_config(
    config: Mapping[str, Any],
    *,
    provider: str | None = None,
    model_id: str | None = None,
    effort_override: str | None = None,
    extra_tools: Sequence[Any] = (),
    session_override: bool | dict[str, Any] | None = None,
    instructions_suffix: str | None = None,
) -> Agent:
    """Construct a ``strands.Agent`` from a portable Strands Harness config via ``create_harness()``.

    Follows the Strands Harness Configuration Reference:
    1. ``define_harness_agent_config`` validates and merges harness defaults.
    2. ``harness_agent_kwargs_from_config`` resolves module-referenced tools and converts camelCase
       options to ``create_harness`` snake_case keyword arguments.
    3. Models under Ron's providers (e.g. ``xai/grok-4.7``) are built via ``panel_agent.build_model``
       into a ``RonXAIModel`` instance with the level's ``reasoning_effort`` applied on the instance
       and ``effort="auto"`` passed to ``create_harness`` (since ``create_harness`` ignores ``effort``
       on pre-built ``Model`` instances).
    """
    merged = dict(config)
    if instructions_suffix:
        base_inst = str(merged.get("instructions") or "").rstrip()
        merged["instructions"] = f"{base_inst}\n\n{instructions_suffix.strip()}" if base_inst else instructions_suffix.strip()
    if session_override is not None:
        merged["session"] = session_override

    normalized = define_harness_agent_config(merged)
    kwargs = harness_agent_kwargs_from_config(normalized, base_dir=REPO_ROOT)

    cfg_provider, sep, cfg_model = str(normalized["model"]).partition("/")
    resolved_provider = (provider or (cfg_provider if sep else app_config.RON_SEARCH_PROVIDER)).strip().lower()
    raw_model = model_id or (cfg_model if sep else str(normalized["model"]))
    if "/" in raw_model:
        p_prefix, _, m_rest = raw_model.partition("/")
        if p_prefix.lower() in PROVIDERS:
            resolved_provider = p_prefix.lower()
            raw_model = m_rest

    configured_effort = effort_override or str(kwargs.pop("effort", "auto"))
    if resolved_provider in PROVIDERS:
        effort = resolve_search_effort(resolved_provider, raw_model, configured_effort, configured_effort)
        kwargs["model"] = build_model(resolved_provider, raw_model, reasoning_effort=effort)
        kwargs["effort"] = "auto"
    else:
        kwargs["model"] = f"{resolved_provider}/{raw_model}"
        kwargs["effort"] = configured_effort

    if extra_tools:
        existing = list(kwargs.get("tools", []))
        seen = {getattr(t, "tool_name", None) for t in existing if getattr(t, "tool_name", None)}
        kwargs["tools"] = [*existing, *(t for t in extra_tools if getattr(t, "tool_name", None) not in seen)]

    hooks = [XAIStatePruner()] if resolved_provider == "xai" else []
    return create_harness(callback_handler=None, hooks=hooks, **kwargs)


def _location_context_note(location: Any | None, country: str = "US") -> str:
    """Format optional geographic context for local brick-and-mortar store discovery."""
    parts: list[str] = []
    if location is not None:
        loc_str = getattr(location, "location", None) if not isinstance(location, Mapping) else location.get("location")
        lat = getattr(location, "latitude", None) if not isinstance(location, Mapping) else location.get("latitude")
        lon = getattr(location, "longitude", None) if not isinstance(location, Mapping) else location.get("longitude")
        if loc_str:
            parts.append(f"User location: {loc_str}")
        if lat is not None and lon is not None:
            parts.append(f"Coordinates: ({lat}, {lon})")
    if country:
        parts.append(f"Country: {country}")
    if not parts:
        return ""
    return (
        "## User Geographic Context\n"
        + " | ".join(parts)
        + "\nUse this location when calling `brave_local_search` or searching for nearby brick-and-mortar stores."
    )


def build_shopping_harness(
    spec: AgentSpec | None = None,
    *,
    provider: str | None = None,
    model_id: str | None = None,
    location: Any | None = None,
    country: str = "US",
) -> Agent:
    """Build the Shopping Specialist child agent via ``create_harness()`` from ``shopping.json``."""
    config = load_search_harness_config("shopping")
    if spec is not None and spec.instructions:
        config["instructions"] = spec.instructions
    loc_note = _location_context_note(location, country)
    return build_harness_from_config(
        config,
        provider=provider or app_config.RON_SEARCH_PROVIDER,
        model_id=model_id or app_config.RON_SEARCH_SHOPPING_MODEL,
        effort_override=str(config.get("effort") or "medium"),
        session_override=False,
        instructions_suffix=loc_note or None,
    )


def build_shopping_subagent_tool(
    *,
    provider: str | None = None,
    model_id: str | None = None,
    location: Any | None = None,
    country: str = "US",
    builder_override: Callable[[AgentSpec], Agent] | None = None,
    on_invoked: Callable[[], None] | None = None,
) -> AgentTool:
    """Build the native ``subagent`` tool (``make_subagent``) backed by ``create_harness()``."""
    shopping_cfg = load_search_harness_config("shopping")
    instructions = str(shopping_cfg["instructions"])
    description = str(shopping_cfg["description"])

    def _builder(spec: AgentSpec) -> Agent:
        if on_invoked is not None:
            on_invoked()
        if builder_override is not None:
            return builder_override(spec)
        return build_shopping_harness(
            spec,
            provider=provider,
            model_id=model_id,
            location=location,
            country=country,
        )

    return make_subagent(
        builder=_builder,
        presets={
            "shopping": Preset(
                instructions=instructions,
                description=description,
                context="none",
            )
        },
        default_preset="shopping",
        instructions=Fixed(instructions),
        tools=Fixed(None),
        mcp_servers=Fixed(None),
        model=Fixed(None),
        context=Choice(["none", "no_tools"]),
    )


def create_search_agent(
    level: SearchLevel = "medium",
    *,
    session_id: str | None = None,
    session_dir: Path | str | None = None,
    provider: str | None = None,
    model_id: str | None = None,
    shopping_model_id: str | None = None,
    location: Any | None = None,
    country: str = "US",
    shopping_builder: Callable[[AgentSpec], Agent] | None = None,
    on_shopping_invoked: Callable[[], None] | None = None,
) -> Agent:
    """Build a level-configured Search Agent via ``create_harness()`` from ``configs/search/{level}.json``."""
    if level not in SEARCH_LEVELS:
        raise ValueError(f"Unknown search level {level!r}; expected one of {SEARCH_LEVELS}")
    config = load_search_harness_config(level)
    resolved_provider = (provider or app_config.RON_SEARCH_PROVIDER).strip().lower()
    resolved_model_id = model_id or app_config.RON_SEARCH_AGENT_MODEL
    effort = resolve_search_effort(resolved_provider, resolved_model_id, level, str(config.get("effort") or "low"))

    shopping_tool = build_shopping_subagent_tool(
        provider=resolved_provider,
        model_id=shopping_model_id or app_config.RON_SEARCH_SHOPPING_MODEL,
        location=location,
        country=country,
        builder_override=shopping_builder,
        on_invoked=on_shopping_invoked,
    )

    session_opt: bool | dict[str, Any] = (
        {"id": session_id, "dir": str(session_dir or app_config.SEARCH_SESSIONS_DIR)}
        if session_id
        else False
    )
    loc_note = _location_context_note(location, country)
    return build_harness_from_config(
        config,
        provider=resolved_provider,
        model_id=resolved_model_id,
        effort_override=effort,
        extra_tools=[shopping_tool],
        session_override=session_opt,
        instructions_suffix=loc_note or None,
    )


class _SearchSessionEntry:
    __slots__ = ("agent", "level", "updated_at", "shopping_invoked")

    def __init__(self, agent: Agent, level: SearchLevel) -> None:
        self.agent = agent
        self.level = level
        self.updated_at = time.monotonic()
        self.shopping_invoked = False


_SEARCH_SESSIONS: OrderedDict[str, _SearchSessionEntry] = OrderedDict()
#: The Brave Answers turn of each session (question + answer), which the Search Agent starts from
#: when the user asks a follow-up.
_ANSWER_TURNS: OrderedDict[str, list[dict[str, Any]]] = OrderedDict()


def clear_search_sessions() -> None:
    """Clear in-memory search sessions (used by tests)."""
    _SEARCH_SESSIONS.clear()
    _ANSWER_TURNS.clear()


def get_search_session(session_id: str) -> Agent | None:
    """Return an existing in-memory Search Agent for ``session_id`` if present."""
    entry = _SEARCH_SESSIONS.get(session_id)
    if entry is not None:
        _SEARCH_SESSIONS.move_to_end(session_id)
        entry.updated_at = time.monotonic()
        return entry.agent
    return None


def get_or_create_search_session(
    session_id: str,
    level: SearchLevel = "medium",
    *,
    provider: str | None = None,
    model_id: str | None = None,
    shopping_model_id: str | None = None,
    location: Any | None = None,
    country: str = "US",
    shopping_builder: Callable[[AgentSpec], Agent] | None = None,
) -> tuple[Agent, _SearchSessionEntry]:
    """Retrieve or construct a stateful Search Agent session for multi-turn conversation."""
    resolved_provider = (provider or app_config.RON_SEARCH_PROVIDER).strip().lower()
    resolved_model_id = model_id or app_config.RON_SEARCH_AGENT_MODEL

    existing = _SEARCH_SESSIONS.get(session_id)
    if existing is not None:
        _SEARCH_SESSIONS.move_to_end(session_id)
        existing.updated_at = time.monotonic()
        existing.shopping_invoked = False
        if existing.level != level:
            cfg = load_search_harness_config(level)
            effort = resolve_search_effort(resolved_provider, resolved_model_id, level, str(cfg.get("effort") or "low"))
            if resolved_provider in PROVIDERS:
                existing.agent.model = build_model(resolved_provider, resolved_model_id, reasoning_effort=effort)
            loc_note = _location_context_note(location, country)
            instructions = str(cfg.get("instructions") or "")
            if loc_note:
                instructions = f"{instructions}\n\n{loc_note}"
            existing.agent.system_prompt = build_system_prompt(instructions)
            existing.level = level
        return existing.agent, existing

    holder: dict[str, _SearchSessionEntry] = {}

    def _mark_shopping() -> None:
        if "entry" in holder:
            holder["entry"].shopping_invoked = True

    agent = create_search_agent(
        level,
        session_id=session_id,
        provider=resolved_provider,
        model_id=resolved_model_id,
        shopping_model_id=shopping_model_id,
        location=location,
        country=country,
        shopping_builder=shopping_builder,
        on_shopping_invoked=_mark_shopping,
    )
    entry = _SearchSessionEntry(agent, level)
    holder["entry"] = entry
    _SEARCH_SESSIONS[session_id] = entry
    while len(_SEARCH_SESSIONS) > MAX_SEARCH_SESSIONS:
        _SEARCH_SESSIONS.popitem(last=False)
    return agent, entry


# --- Event & Tool Output Normalization ---------------------------------------


def _items(item: dict[str, Any]) -> list[dict[str, Any]]:
    """A native output item's result list, tolerant of the exact container key."""
    results = item.get("results") or item.get("items") or item.get("images") or []
    return [r for r in results if isinstance(r, dict)]


def _normalize_image(raw: dict[str, Any]) -> dict[str, Any]:
    """One image_search_results or brave_image_search entry -> stable renderer shape."""
    img_nested = raw.get("image") if isinstance(raw.get("image"), dict) else {}
    return {
        "url": (
            raw.get("url")
            or raw.get("image_url")
            or img_nested.get("url")
            or raw.get("src")
            or raw.get("thumbnail")
            or ""
        ),
        "page_url": raw.get("page_url") or raw.get("origin_url") or raw.get("source") or raw.get("url") or "",
        "title": raw.get("title") or "",
        "width": raw.get("width") if raw.get("width") is not None else img_nested.get("width"),
        "height": raw.get("height") if raw.get("height") is not None else img_nested.get("height"),
    }


def _normalize_source_item(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Convert a Brave or xAI search result dict into the ``AgentSearchResult`` contract."""
    kind = raw.get("kind")
    place = raw.get("place") if isinstance(raw.get("place"), dict) else None
    title = str(raw.get("title") or "").strip()
    url = str(raw.get("url") or "").strip()

    if kind == "place" or place is not None:
        place_data = place or {}
        address = place_data.get("address") or raw.get("address")
        if not url and (title or address):
            query_str = ", ".join(p for p in (title, address) if p)
            url = f"https://www.google.com/maps/search/?api=1&query={quote_plus(query_str)}"
        if not url:
            return None
        hours_raw = place_data.get("hours_today") or raw.get("hours")
        hours = (
            ", ".join(str(h) for h in hours_raw if h)
            if isinstance(hours_raw, list)
            else str(hours_raw)
            if hours_raw
            else None
        )
        snippet = (
            str(raw.get("ai_description") or raw.get("description") or raw.get("snippet") or "").strip()
            or (str(address) if address else "")
        )
        return {
            "title": title or _hostname(url) or "Local Store",
            "url": url,
            "snippet": snippet,
            "source": str(raw.get("source") or _hostname(url) or "Local Store"),
            "kind": "local",
            "address": address,
            "rating": place_data.get("rating") if place_data.get("rating") is not None else raw.get("rating"),
            "review_count": place_data.get("review_count") if place_data.get("review_count") is not None else raw.get("review_count"),
            "price_range": place_data.get("price_range") or raw.get("price_range"),
            "hours": hours,
            "phone": place_data.get("phone") or raw.get("phone"),
            "distance": place_data.get("distance") if place_data.get("distance") is not None else raw.get("distance"),
        }

    if not url or not url.startswith(("http://", "https://")):
        return None
    return {
        "title": title or _hostname(url) or url,
        "url": url,
        "snippet": str(raw.get("snippet") or raw.get("description") or "").strip(),
        "date": raw.get("date") or raw.get("age") or raw.get("published"),
        "source": str(raw.get("source") or _hostname(url)),
        "kind": raw.get("kind") if raw.get("kind") in ("online", "local") else "online",
    }


def extract_markdown_sources(text: str, *, default_kind: Literal["online", "local"] = "online") -> list[dict[str, Any]]:
    """Extract inline Markdown links ``[Title](https://...)`` from agent/shopping text into ``AgentSearchResult`` items."""
    if not text:
        return []
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    current_kind: Literal["online", "local"] = default_kind

    for line in text.splitlines():
        lower = line.strip().lower()
        if lower.startswith("#"):
            if any(k in lower for k in ("brick-and-mortar", "brick and mortar", "local store", "in-store", "physical store")):
                current_kind = "local"
            elif any(k in lower for k in ("online", "retailer", "product link", "e-commerce")):
                current_kind = "online"

        for match in _MARKDOWN_LINK_RE.finditer(line):
            label, url = match.group(1).strip(), match.group(2).strip()
            if not url or url in seen:
                continue
            seen.add(url)
            price_match = _PRICE_RE.search(line)
            rating_match = _RATING_RE.search(line)
            phone_match = _PHONE_RE.search(line)
            cleaned_line = _MARKDOWN_LINK_RE.sub(r"\1", line).strip().lstrip("-*•0123456789. ").strip()
            entry: dict[str, Any] = {
                "title": label or _hostname(url) or url,
                "url": url,
                "snippet": cleaned_line,
                "source": _hostname(url),
                "kind": current_kind,
            }
            if price_match:
                entry["price_range"] = price_match.group(0)
            if rating_match:
                try:
                    entry["rating"] = float(rating_match.group(1))
                except ValueError:
                    pass
            if phone_match:
                entry["phone"] = phone_match.group(0)
            results.append(entry)
    return results


def _extract_tool_result_events(tool_result: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Extract normalized ``sources`` / ``images`` events from a Strands ``toolResult`` block."""
    if tool_result.get("status") == "error":
        return []
    payloads: list[dict[str, Any]] = []
    for content_block in tool_result.get("content") or []:
        if not isinstance(content_block, Mapping):
            continue
        if isinstance(content_block.get("json"), Mapping):
            payloads.append(dict(content_block["json"]))
        elif isinstance(content_block.get("text"), str):
            text = content_block["text"].strip()
            if text.startswith("{") and text.endswith("}"):
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict):
                        payloads.append(parsed)
                except ValueError:
                    pass

    out: list[dict[str, Any]] = []
    for data in payloads:
        raw_results = data.get("results")
        if not isinstance(raw_results, list) or not raw_results:
            continue
        first = raw_results[0] if isinstance(raw_results[0], Mapping) else {}
        if first.get("kind") == "image" or "image" in first:
            images = [_normalize_image(r) for r in raw_results if isinstance(r, dict)]
            valid_images = [i for i in images if i.get("url")]
            if valid_images:
                out.append({"type": "images", "results": valid_images})
            continue

        sources: list[dict[str, Any]] = []
        place_images: list[dict[str, Any]] = []
        for r in raw_results:
            if not isinstance(r, dict):
                continue
            normalized = _normalize_source_item(r)
            if normalized is not None:
                sources.append(normalized)
            place = r.get("place") if isinstance(r.get("place"), dict) else {}
            for pic in (place.get("pictures") or [])[:2]:
                if isinstance(pic, str) and pic.startswith(("http://", "https://")):
                    place_images.append({
                        "url": pic,
                        "page_url": normalized["url"] if normalized else (r.get("url") or ""),
                        "title": r.get("title") or "",
                        "width": None,
                        "height": None,
                    })
            thumb = r.get("thumbnail")
            if isinstance(thumb, str) and thumb.startswith(("http://", "https://")) and r.get("kind") == "place":
                place_images.append({
                    "url": thumb,
                    "page_url": normalized["url"] if normalized else (r.get("url") or ""),
                    "title": r.get("title") or "",
                    "width": None,
                    "height": None,
                })
        if sources:
            out.append({"type": "sources", "results": sources})
        if place_images:
            out.append({"type": "images", "results": place_images})
    return out


def normalize_strands_chunk(chunk: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Convert one Strands ``Agent.stream_async`` event chunk into normalized search events."""
    events: list[dict[str, Any]] = []

    # 1. xAI native server-side tool event: top-level {"xai": ...} or ModelStreamChunkEvent {"event": {"xai": ...}}
    inner_event = chunk.get("event") if isinstance(chunk.get("event"), Mapping) else None
    xai_payload = chunk.get("xai") or (inner_event.get("xai") if inner_event else None)
    if isinstance(xai_payload, Mapping):
        ev = _normalize_event(dict(xai_payload))
        if ev is not None:
            events.append(ev)
        return events

    # 2. Strands TextStreamEvent / ReasoningTextStreamEvent / CitationStreamEvent
    data_text = chunk.get("data")
    if isinstance(data_text, str) and data_text:
        events.append({"type": "delta", "text": data_text})
    r_text_top = chunk.get("reasoningText")
    if isinstance(r_text_top, str) and r_text_top:
        events.append({"type": "reasoning", "text": r_text_top})
    top_citation = chunk.get("citation")
    if isinstance(top_citation, Mapping) and top_citation.get("url"):
        events.append({
            "type": "citation",
            "url": str(top_citation["url"]),
            "title": str(top_citation.get("title") or _hostname(str(top_citation["url"]))),
        })
    if events:
        return events

    # 3. Raw ContentBlockDelta (when streaming directly from a model without Agent wrapper)
    cbd = chunk.get("contentBlockDelta")
    if isinstance(cbd, Mapping):
        delta = cbd.get("delta")
        if isinstance(delta, Mapping):
            text = delta.get("text")
            if isinstance(text, str) and text:
                events.append({"type": "delta", "text": text})
            reasoning = delta.get("reasoningContent")
            if isinstance(reasoning, Mapping):
                r_text = reasoning.get("text")
                if isinstance(r_text, str) and r_text:
                    events.append({"type": "reasoning", "text": r_text})
            citation = delta.get("citation")
            if isinstance(citation, Mapping) and citation.get("url"):
                events.append({
                    "type": "citation",
                    "url": str(citation["url"]),
                    "title": str(citation.get("title") or _hostname(str(citation["url"]))),
                })
        return events

    # 4. Direct ToolResultEvent({"type": "tool_result", "tool_result": ...})
    if chunk.get("type") == "tool_result" and isinstance(chunk.get("tool_result"), Mapping):
        events.extend(_extract_tool_result_events(chunk["tool_result"]))
        return events

    # 5. Message added event carrying toolResult blocks
    msg = chunk.get("message")
    if isinstance(msg, Mapping) and msg.get("role") == "user":
        for block in msg.get("content") or []:
            if isinstance(block, Mapping) and isinstance(block.get("toolResult"), Mapping):
                events.extend(_extract_tool_result_events(block["toolResult"]))
        return events

    return events


async def stream_search_session(
    q: str,
    level: SearchLevel = "medium",
    *,
    session_id: str | None = None,
    follow_up: bool = False,
    shopping: bool = True,
    country: str = "US",
    location: Any | None = None,
    provider: str | None = None,
    model_id: str | None = None,
    shopping_model_id: str | None = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Run the Strands Harness Search Agent (and its ``create_harness()`` shopping subagent) and yield
    ``(sse_event_name, payload)`` pairs for ``POST /search/stream``."""
    resolved_provider = (provider or app_config.RON_SEARCH_PROVIDER).strip().lower()
    resolved_model_id = model_id or app_config.RON_SEARCH_AGENT_MODEL
    resolved_shopping_model = shopping_model_id or app_config.RON_SEARCH_SHOPPING_MODEL

    if not follow_up:
        async for event in _stream_answer_and_shopping(
            q, session_id=session_id, shopping=shopping, country=country, location=location,
            provider=resolved_provider, shopping_model_id=resolved_shopping_model,
        ):
            yield event
        return

    if not search_provider_configured(resolved_provider):
        raise SearchAgentError(
            "not_configured",
            f"The {resolved_provider} API key is not set",
            status=503,
        )

    agent, entry = get_or_create_search_session(
        session_id or "ephemeral",
        level,
        provider=resolved_provider,
        model_id=resolved_model_id,
        shopping_model_id=resolved_shopping_model,
        location=location,
        country=country,
    )
    entry.shopping_invoked = False
    answered = _ANSWER_TURNS.pop(session_id or "ephemeral", None)
    if answered and not agent.messages:
        agent.messages.extend(answered)

    agent_text_parts: list[str] = []
    shopping_text_parts: list[str] = []
    shopping_streamed_any = False

    prompt = q

    try:
        async for raw_event in agent.stream_async(prompt):
            if not isinstance(raw_event, Mapping):
                continue

            # Tap intermediate events from the `subagent` tool (`ToolStreamEvent`) into the `shopping.*` lane!
            tool_stream = raw_event.get("tool_stream_event")
            if isinstance(tool_stream, Mapping):
                tool_use = tool_stream.get("tool_use") or {}
                tool_name = tool_use.get("name") if isinstance(tool_use, Mapping) else None
                inner = tool_stream.get("data")
                if tool_name == "subagent" and isinstance(inner, Mapping):
                    entry.shopping_invoked = True
                    for sub_ev in normalize_strands_chunk(inner):
                        shopping_streamed_any = True
                        ev_type = sub_ev["type"]
                        if ev_type == "delta":
                            shopping_text_parts.append(sub_ev["text"])
                        yield f"shopping.{ev_type}", {k: v for k, v in sub_ev.items() if k != "type"}
                continue

            for ev in normalize_strands_chunk(raw_event):
                ev_type = ev["type"]
                if ev_type == "delta":
                    agent_text_parts.append(ev["text"])
                yield f"agent.{ev_type}", {k: v for k, v in ev.items() if k != "type"}

        full_agent_text = "".join(agent_text_parts)
        md_agent_sources = extract_markdown_sources(full_agent_text, default_kind="online")
        if md_agent_sources:
            yield "agent.sources", {"results": md_agent_sources}
            for src in md_agent_sources:
                yield "agent.citation", {"url": src["url"], "title": src["title"]}

        yield "agent.done", {
            "model": f"{resolved_provider}/{resolved_model_id}",
            "effort": resolve_search_effort(resolved_provider, resolved_model_id, level),
            "incomplete": False,
        }
    except SearchAgentError:
        raise
    except Exception as exc:
        logger.warning("level=<%s>, error=<%s> | search agent stream failed", level, exc)
        raise SearchAgentError("upstream", str(exc) or type(exc).__name__, status=502) from exc

    # If `subagent` streamed during the parent run, finalize the shopping lane with extracted markdown links & done.
    if entry.shopping_invoked or shopping_streamed_any:
        full_shop_text = "".join(shopping_text_parts)
        md_shop_sources = extract_markdown_sources(full_shop_text, default_kind="online")
        if md_shop_sources:
            yield "shopping.sources", {"results": md_shop_sources}
            for src in md_shop_sources:
                yield "shopping.citation", {"url": src["url"], "title": src["title"]}
        yield "shopping.done", {
            "model": f"{resolved_provider}/{resolved_shopping_model}",
            "incomplete": False,
        }
        return


async def _answer_events(q: str, session_id: str | None, country: str) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Brave Answers for ``q`` as ``agent.*`` events: text deltas, its citations, then ``agent.done``."""
    client = answers_client()
    text: list[str] = []
    done: dict[str, Any] = {}
    usage: dict[str, Any] | None = None
    try:
        async for kind, payload in client.stream(q, country=country.lower()):
            if kind == "text":
                text.append(payload)
                yield "agent.delta", {"text": payload}
            elif kind == "citation":
                yield "agent.citation", {"url": payload.url, "title": _hostname(payload.url)}
                yield "agent.sources", {"results": [{
                    "title": _hostname(payload.url) or payload.url, "url": payload.url,
                    "snippet": payload.snippet or "", "source": _hostname(payload.url), "kind": "online",
                }]}
            elif kind == "usage":
                usage = payload
            elif kind == "done":
                done = payload
    except BraveSearchError as error:
        raise SearchAgentError(error.code, str(error), status=error.status) from error
    if session_id and text:
        _ANSWER_TURNS[session_id] = [
            {"role": "user", "content": [{"text": q}]},
            {"role": "assistant", "content": [{"text": "".join(text)}]},
        ]
        while len(_ANSWER_TURNS) > MAX_SEARCH_SESSIONS:
            _ANSWER_TURNS.popitem(last=False)
    yield "agent.done", {"model": f"brave/{done.get('model') or client.model}", "usage": usage,
                         "incomplete": done.get("finish_reason") == "length"}


async def _shopping_events(
    q: str, *, provider: str, model_id: str, location: Any | None, country: str,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """The ``create_harness()`` Shopping agent for ``q`` as ``shopping.*`` events."""
    if not search_provider_configured(provider):
        raise SearchAgentError("not_configured", f"The {provider} API key is not set", status=503)
    shopping_agent = build_shopping_harness(provider=provider, model_id=model_id, location=location, country=country)
    text: list[str] = []
    async for raw_event in shopping_agent.stream_async(q):
        if not isinstance(raw_event, Mapping):
            continue
        for event in normalize_strands_chunk(raw_event):
            if event["type"] == "delta":
                text.append(event["text"])
            yield f"shopping.{event['type']}", {k: v for k, v in event.items() if k != "type"}
    sources = extract_markdown_sources("".join(text), default_kind="online")
    if sources:
        yield "shopping.sources", {"results": sources}
        for source in sources:
            yield "shopping.citation", {"url": source["url"], "title": source["title"]}
    yield "shopping.done", {"model": f"{provider}/{model_id}", "incomplete": False}


async def _stream_answer_and_shopping(
    q: str, *, session_id: str | None, shopping: bool, country: str, location: Any | None,
    provider: str, shopping_model_id: str,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """A new search: Brave Answers and the Shopping agent run side by side; one failing lane is
    reported as its own ``source_error`` and never stops the other."""
    import asyncio

    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()

    async def pump(source: str, events: AsyncIterator[tuple[str, dict[str, Any]]]) -> None:
        try:
            async for event in events:
                await queue.put(event)
        except SearchAgentError as error:
            await queue.put(("source_error", {"source": source, "code": error.code, "message": str(error),
                                              "status": error.status}))
        except Exception as error:
            logger.warning("source=<%s>, error=<%s> | search lane failed", source, error)
            await queue.put(("source_error", {"source": source, "code": "upstream",
                                              "message": str(error) or type(error).__name__, "status": 502}))
        finally:
            await queue.put(None)

    lanes = [pump("agent", _answer_events(q, session_id, country))]
    if shopping:
        lanes.append(pump("shopping", _shopping_events(q, provider=provider, model_id=shopping_model_id,
                                                       location=location, country=country)))
    tasks = [asyncio.create_task(lane) for lane in lanes]
    try:
        remaining = len(tasks)
        while remaining:
            item = await queue.get()
            if item is None:
                remaining -= 1
            else:
                yield item
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


# --- Legacy Wire-Format Compatibility Helpers --------------------------------

AGENT_INSTRUCTIONS = (
    "You are the answer engine of the Ren web browser. Answer the query directly and "
    "completely, with inline citations for every sourced claim."
)

SHOPPING_INSTRUCTIONS = (
    "You are the shopping assistant of the Ren web browser. Find concrete, buyable products "
    "across both online retailers and local brick-and-mortar stores."
)


def build_agent_request(q: str, level: str, *, model: str | None = None) -> dict[str, Any]:
    """Build a search agent request descriptor for ``level`` using the native harness config."""
    resolved_level: SearchLevel = level if level in SEARCH_LEVELS else "medium"  # type: ignore[assignment]
    cfg = load_search_harness_config(resolved_level)
    resolved_model = model or app_config.RON_SEARCH_AGENT_MODEL
    effort = resolve_search_effort(app_config.RON_SEARCH_PROVIDER, resolved_model, resolved_level, str(cfg.get("effort") or "low"))
    return {
        "model": resolved_model,
        "provider": app_config.RON_SEARCH_PROVIDER,
        "preset": resolved_level,
        "level": resolved_level,
        "effort": effort,
        "input": q,
        "instructions": cfg["instructions"],
        "harness_config": cfg,
        "tools": [
            {"type": "web_search", "search_context_size": "high"},
            {"type": "image_search"},
            {"type": "fetch_url"},
            {"type": "subagent", "agent_type": "shopping"},
        ],
        "stream": True,
    }


def build_shopping_request(
    q: str,
    *,
    model: str | None = None,
    domains: list[str] | None = None,
) -> dict[str, Any]:
    """Build a shopping subagent request descriptor using ``configs/search/shopping.json``."""
    cfg = load_search_harness_config("shopping")
    resolved_model = model or app_config.RON_SEARCH_SHOPPING_MODEL
    domain_list = list(domains if domains is not None else app_config.RON_SEARCH_SHOPPING_DOMAINS)
    web_tool: dict[str, Any] = {"type": "web_search", "search_context_size": "high"}
    if domain_list:
        web_tool["filters"] = {"search_domain_filter": domain_list}
    return {
        "model": resolved_model,
        "provider": app_config.RON_SEARCH_PROVIDER,
        "effort": cfg.get("effort", "medium"),
        "input": q,
        "instructions": cfg["instructions"],
        "harness_config": cfg,
        "tools": [
            web_tool,
            {"type": "local_search"},
            {"type": "fetch_url"},
            {"type": "image_search"},
        ],
        "max_steps": 10,
        "stream": True,
    }


def _normalize_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    """One decoded SSE/native-tool payload -> one normalized event, or None when irrelevant."""
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
    if kind in ("response.output_item.done", "response.output_item.added"):
        item = payload.get("item") or {}
        item_type = item.get("type")
        if item_type in SOURCES_ITEM_TYPES:
            raw_items = _items(item)
            normalized_sources = [s for r in raw_items if (s := _normalize_source_item(r)) is not None]
            return {"type": "sources", "results": normalized_sources or raw_items} if (normalized_sources or raw_items) else None
        if item_type in IMAGES_ITEM_TYPES:
            images = [_normalize_image(r) for r in _items(item)]
            valid = [i for i in images if i["url"]]
            return {"type": "images", "results": valid} if valid else None
        if item_type in FETCHED_ITEM_TYPES:
            return {"type": "fetched", "results": _items(item)}
        return None
    if kind in ("response.completed", "response.incomplete"):
        response = payload.get("response") or {}
        return {
            "type": "done",
            "usage": response.get("usage"),
            "model": response.get("model"),
            "incomplete": kind == "response.incomplete",
        }
    if kind in ("response.failed", "error"):
        error = (payload.get("response") or {}).get("error") or payload
        raise SearchAgentError("upstream", error.get("message") or "Agent API stream failed")
    return None


async def stream_agent(
    request: dict[str, Any],
    *,
    api_key: str | None | object = _UNSET,
    url: str = app_config.PERPLEXITY_RESPONSES_URL,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream normalized events from an HTTP SSE transport (when ``transport`` or ``api_key`` is provided)
    or from the Strands Harness Search / Shopping Agent."""
    if transport is not None or api_key is not _UNSET:
        if not api_key or not isinstance(api_key, str):
            raise SearchAgentError("not_configured", "API key is not set", status=503)
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
                            payload = json.loads(line[len("data:") :])
                        except ValueError:
                            continue
                        if isinstance(payload, dict) and (event := _normalize_event(payload)):
                            yield event
        except (httpx.TimeoutException, httpx.TransportError) as error:
            raise SearchAgentError("network", type(error).__name__) from error
        return

    q = str(request.get("input") or request.get("q") or "")
    level: SearchLevel = request.get("preset") or request.get("level") or "medium"  # type: ignore[assignment]
    is_shopping = "preset" not in request and "level" not in request
    if is_shopping:
        if not search_provider_configured():
            raise SearchAgentError("not_configured", "Search model provider API key is not set", status=503)
        shop_agent = build_shopping_harness(model_id=str(request.get("model") or app_config.RON_SEARCH_SHOPPING_MODEL))
        text_parts: list[str] = []
        async for raw_ev in shop_agent.stream_async(q):
            if not isinstance(raw_ev, Mapping):
                continue
            for ev in normalize_strands_chunk(raw_ev):
                if ev["type"] == "delta":
                    text_parts.append(ev["text"])
                yield ev
        md_sources = extract_markdown_sources("".join(text_parts), default_kind="online")
        if md_sources:
            yield {"type": "sources", "results": md_sources}
        yield {"type": "done", "usage": None, "model": request.get("model") or app_config.RON_SEARCH_SHOPPING_MODEL, "incomplete": False}
        return

    async for ev_name, payload in stream_search_session(
        q,
        level if level in SEARCH_LEVELS else "medium",
        shopping=False,
        model_id=str(request.get("model") or app_config.RON_SEARCH_AGENT_MODEL),
    ):
        if ev_name.startswith("agent."):
            yield {"type": ev_name.removeprefix("agent."), **payload}


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
