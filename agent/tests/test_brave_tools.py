"""Offline tests for the native Brave Search agent tools and Perplexity Search gating."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest

from agent.api.core import brave_search as bs
from agent.api.core.brave_tools import (
    BRAVE_TOOL_NAMES,
    brave_image_search,
    brave_local_search,
    brave_news_search,
    brave_rich_answer,
    brave_tools,
    brave_video_search,
    brave_web_search,
    set_search_client,
)
from agent.api.core.live_tools import live_host_tools
from agent.api.core.panel_agent import PROJECT_TOOLS_DIR
from agent.api.core.panel_tools import CORE_TOOL_NAMES, RESEARCH_TOOL_NAMES, build_core_tools
from agent.tests.test_discover import (
    DISCUSSION,
    IMAGE,
    NEWS,
    PLACE,
    RICH_WEATHER,
    VIDEO,
    WEB,
)


def _mock_brave_transport(
    seen: list[httpx.Request] | None = None,
    *,
    fail_paths: dict[str, httpx.Response] | None = None,
) -> httpx.MockTransport:
    def respond(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        path = request.url.path.removeprefix("/res/v1")
        if fail_paths and path in fail_paths:
            return fail_paths[path]
        if path == "/web/search" and request.url.params.get("enable_rich_callback") == "true":
            q = request.url.params.get("q", "")
            rich = {"hint": {"vertical": "weather", "callback_key": "wkey"}} if "weather" in q else None
            return httpx.Response(200, json={"type": "search", "web": {"results": [WEB]}, "rich": rich})
        if path == "/web/rich":
            return httpx.Response(
                200,
                json={
                    "type": "rich",
                    "results": [RICH_WEATHER],
                    "response_callback_info": {"vertical": "weather", "callback_key": "wkey"},
                },
            )
        payloads: dict[str, Any] = {
            "/web/search": {"web": {"results": [WEB]}, "discussions": {"results": [DISCUSSION]}},
            "/news/search": {"results": [NEWS]},
            "/images/search": {"results": [IMAGE]},
            "/videos/search": {"results": [VIDEO]},
            "/local/place_search": {"type": "locations", "results": [PLACE]},
            "/local/pois": {"results": [PLACE]},
            "/local/descriptions": {
                "results": [{"type": "local_description", "id": PLACE["id"], "description": "A premier destination"}]
            },
        }
        return httpx.Response(200, json=payloads[path])

    return httpx.MockTransport(respond)


@pytest.fixture()
def brave_client_fixture():
    seen: list[httpx.Request] = []
    client = bs.BraveClient(
        "test-key",
        transport=_mock_brave_transport(seen),
        limiter=bs.RateLimiter(1000),
    )
    set_search_client(client)
    try:
        yield client, seen
    finally:
        set_search_client(None)


def test_brave_tools_exports_all_seven_tools():
    tools = brave_tools()
    names = tuple(t.tool_name for t in tools)
    assert names == BRAVE_TOOL_NAMES
    assert BRAVE_TOOL_NAMES == (
        "brave_answer",
        "brave_web_search",
        "brave_news_search",
        "brave_image_search",
        "brave_video_search",
        "brave_local_search",
        "brave_rich_answer",
    )
    assert set(BRAVE_TOOL_NAMES) <= set(CORE_TOOL_NAMES)
    assert set(BRAVE_TOOL_NAMES) <= set(RESEARCH_TOOL_NAMES)


def test_brave_vertical_search_tools_return_normalized_results(brave_client_fixture):
    _, seen = brave_client_fixture

    async def scenario():
        web_out = await brave_web_search("electric bikes", count=5, freshness="pd", extra_snippets=True)
        news_out = await brave_news_search("honda emtb", count=5, freshness="pw")
        img_out = await brave_image_search("ebike", count=10)
        vid_out = await brave_video_search("ebike review", count=5)
        local_out = await brave_local_search("bike shop", location="San Francisco, CA", include_details=True)
        rich_out = await brave_rich_answer("weather in london")
        return web_out, news_out, img_out, vid_out, local_out, rich_out

    web_out, news_out, img_out, vid_out, local_out, rich_out = asyncio.run(scenario())

    assert web_out["query"] == "electric bikes"
    assert [r["kind"] for r in web_out["results"]] == ["web", "discussion"]
    web_req = next(r for r in seen if r.url.path.endswith("/web/search") and "enable_rich_callback" not in r.url.params)
    assert web_req.url.params.get("extra_snippets") == "true"

    assert news_out["query"] == "honda emtb"
    assert news_out["results"][0]["kind"] == "article"
    assert news_out["results"][0]["title"] == NEWS["title"]

    assert img_out["query"] == "ebike"
    assert img_out["results"][0]["kind"] == "image"
    assert img_out["results"][0]["image"]["width"] == 1600

    assert vid_out["query"] == "ebike review"
    assert vid_out["results"][0]["kind"] == "video"
    assert vid_out["results"][0]["video"]["duration"] == "16:19"

    assert local_out["query"] == "bike shop"
    assert local_out["results"][0]["kind"] == "place"
    assert local_out["results"][0]["ai_description"] == "A premier destination"

    assert rich_out["query"] == "weather in london"
    assert rich_out["answers"][0]["vertical"] == "weather"
    assert rich_out["answers"][0]["card"]["location"] == "London, GB"


def test_brave_tools_surface_brave_search_errors_cleanly():
    unconfigured = bs.BraveClient(None, limiter=bs.RateLimiter(1000))
    set_search_client(unconfigured)
    try:
        async def scenario():
            return [
                await brave_web_search("q"),
                await brave_news_search("q"),
                await brave_image_search("q"),
                await brave_video_search("q"),
                await brave_local_search("q", location="SF"),
                await brave_rich_answer("q"),
            ]

        outcomes = asyncio.run(scenario())
    finally:
        set_search_client(None)

    expected_names = (
        "brave_web_search",
        "brave_news_search",
        "brave_image_search",
        "brave_video_search",
        "brave_local_search",
        "brave_rich_answer",
    )
    for name, outcome in zip(expected_names, outcomes, strict=True):
        assert outcome["status"] == "error"
        text = outcome["content"][0]["text"]
        assert f"{name} not_configured:" in text


def test_perplexity_search_flag_gates_core_and_live_tools(monkeypatch):
    monkeypatch.setenv("RON_PERPLEXITY_SEARCH", "0")
    core_disabled = {t.tool_name for t in build_core_tools(PROJECT_TOOLS_DIR)}
    live_disabled = {t.tool_name for t in live_host_tools(PROJECT_TOOLS_DIR)}
    assert "perplexity_search" not in core_disabled
    assert "perplexity_search" not in live_disabled
    assert set(BRAVE_TOOL_NAMES) <= core_disabled
    assert set(BRAVE_TOOL_NAMES) <= live_disabled

    monkeypatch.setenv("RON_PERPLEXITY_SEARCH", "1")
    core_enabled = {t.tool_name for t in build_core_tools(PROJECT_TOOLS_DIR)}
    live_enabled = {t.tool_name for t in live_host_tools(PROJECT_TOOLS_DIR)}
    assert "perplexity_search" in core_enabled
    assert "perplexity_search" in live_enabled
    assert set(BRAVE_TOOL_NAMES) <= core_enabled
    assert set(BRAVE_TOOL_NAMES) <= live_enabled
