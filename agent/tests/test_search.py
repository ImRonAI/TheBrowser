"""Offline tests for the browser search fan-out (Brave + Perplexity Agent API).

Perplexity SSE fixtures mirror the Agent API stream contract documented in
core/perplexity_model.py; Brave fixtures mirror test_discover.py.
"""
import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI

from agent.api.core import brave_search as bs
from agent.api.core import search_agent as sa
from agent.api.endpoints import search as search_ep

WEB = {"type": "search_result", "title": "Lectric eBikes", "url": "https://lectricebikes.com/", "description": "Discover",
       "profile": {"name": "Lectric eBikes", "img": "https://imgs.search.brave.com/l"}, "page_age": "2026-01-01T00:00:00"}
NEWS = {"type": "news_result", "title": "Honda unveiled an e-MTB", "url": "https://electrek.co/2026/09/22/honda",
        "description": "Honda", "profile": {"name": "Electrek"}}
VIDEO = {"type": "video_result", "url": "https://www.youtube.com/watch?v=T5-2", "title": "Best Ebikes",
         "description": "Review", "video": {"duration": "16:19", "creator": "TailHappyTV", "publisher": "YouTube"}}
IMAGE = {"type": "image_result", "title": "EB3s", "url": "https://www.amazon.com/electric-bike", "source": "amazon.com",
         "thumbnail": {"src": "https://imgs.search.brave.com/i"}, "properties": {"url": "https://m.media/71X.jpg", "width": 1600, "height": 1600}}
PLACE = {"type": "location_result", "id": "loc123", "title": "Mike's Bikes", "url": "https://mikesbikes.com/sf",
         "coordinates": [37.77, -122.41], "rating": {"ratingValue": 4.5, "reviewCount": 321}}

SSE_BODY = (
    'data: {"type": "response.output_text.delta", "delta": "Hello"}\n\n'
    'data: {"type": "response.output_text.delta", "delta": " world"}\n\n'
    'data: {"type": "response.reasoning_summary_text.delta", "delta": "thinking"}\n\n'
    'data: {"type": "response.output_text.annotation.added", "annotation": '
    '{"type": "url_citation", "url": "https://example.com", "title": "Example"}}\n\n'
    'data: {"type": "response.output_item.done", "item": {"type": "search_results", '
    '"results": [{"title": "T", "url": "https://t.co", "snippet": "s"}]}}\n\n'
    'data: {"type": "response.output_item.done", "item": {"type": "image_search_results", '
    '"results": [{"image_url": "https://img/x.jpg", "origin_url": "https://site.co/p", "title": "X", "width": 100}]}}\n\n'
    'data: {"type": "response.completed", "response": {"usage": {"total_tokens": 42}, "model": "openai/gpt-6.1-sol"}}\n\n'
)


def fake_brave():
    def respond(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/res/v1")
        table = {
            "/news/search": {"results": [NEWS]},
            "/videos/search": {"results": [VIDEO]},
            "/images/search": {"results": [IMAGE]},
            "/web/search": {"web": {"results": [WEB]}, "discussions": {"results": []}, "mixed": {}},
            "/local/place_search": {"type": "locations", "results": [PLACE]},
        }
        return httpx.Response(200, json=table[path])
    return httpx.MockTransport(respond)


def brave_client() -> bs.BraveClient:
    return bs.BraveClient("test-key", transport=fake_brave(), limiter=bs.RateLimiter(1000))


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for chunk in text.split("\n\n"):
        lines = [line for line in chunk.splitlines() if line.strip()]
        if not lines:
            continue
        event = next((line.removeprefix("event: ") for line in lines if line.startswith("event: ")), None)
        data = next((line.removeprefix("data: ") for line in lines if line.startswith("data: ")), None)
        if event and data:
            events.append((event, json.loads(data)))
    return events


# --- request builders -------------------------------------------------------


def test_agent_request_preset_with_model_override():
    request = sa.build_agent_request("best ebikes", "medium")
    assert request["preset"] == "medium" and request["model"] == sa.RON_SEARCH_AGENT_MODEL
    assert request["stream"] is True and request["input"] == "best ebikes"
    tool_types = [tool["type"] for tool in request["tools"]]
    assert tool_types == ["web_search", "image_search", "fetch_url"]


def test_shopping_request_no_preset_exact_tools_domain_filtered():
    request = sa.build_shopping_request("ebike")
    assert "preset" not in request
    assert request["model"] == sa.RON_SEARCH_SHOPPING_MODEL
    tools = {tool["type"]: tool for tool in request["tools"]}
    assert set(tools) == {"web_search", "fetch_url", "image_search"}
    domains = tools["web_search"]["filters"]["search_domain_filter"]
    assert 0 < len(domains) <= 20
    assert {"amazon.com", "target.com", "walmart.com", "kohls.com", "macys.com",
            "ebay.com", "etsy.com"} <= set(domains)


# --- SSE parsing ------------------------------------------------------------


def test_stream_agent_normalizes_events():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, headers={"content-type": "text/event-stream"}, content=SSE_BODY.encode()))

    async def collect():
        return [event async for event in sa.stream_agent({"input": "x"}, api_key="k", transport=transport)]

    events = asyncio.run(collect())
    kinds = [event["type"] for event in events]
    assert kinds == ["delta", "delta", "reasoning", "citation", "sources", "images", "done"]
    assert events[0]["text"] == "Hello" and events[1]["text"] == " world"
    assert events[3] == {"type": "citation", "url": "https://example.com", "title": "Example"}
    assert events[4]["results"][0]["url"] == "https://t.co"
    # image_search_results entries normalize image_url/origin_url -> url/page_url (live shape, 2026-10-05)
    assert events[5]["results"][0] == {"url": "https://img/x.jpg", "page_url": "https://site.co/p",
                                       "title": "X", "width": 100, "height": None}
    assert events[6]["usage"]["total_tokens"] == 42 and events[6]["model"] == "openai/gpt-6.1-sol"


def test_stream_agent_failed_event_raises_typed_error():
    body = 'data: {"type": "response.failed", "response": {"error": {"message": "boom", "code": "x"}}}\n\n'
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=body.encode()))
    with pytest.raises(sa.SearchAgentError) as info:
        asyncio.run(sa.stream_agent({"input": "x"}, api_key="k", transport=transport).__anext__())
    assert info.value.code == "upstream" and "boom" in str(info.value)


def test_stream_agent_http_error_mapping():
    for status, code in ((401, "unauthorized"), (400, "invalid_request"), (429, "rate_limited"), (500, "upstream")):
        transport = httpx.MockTransport(
            lambda request, s=status: httpx.Response(s, json={"error": {"message": "nope"}}))
        with pytest.raises(sa.SearchAgentError) as info:
            asyncio.run(sa.stream_agent({"input": "x"}, api_key="k", transport=transport).__anext__())
        assert info.value.code == code and info.value.status == status


def test_stream_agent_requires_key():
    with pytest.raises(sa.SearchAgentError) as info:
        asyncio.run(sa.stream_agent({"input": "x"}, api_key=None).__anext__())
    assert info.value.code == "not_configured" and info.value.status == 503


# --- HTTP surface ------------------------------------------------------------


def app_with(brave) -> FastAPI:
    app = FastAPI()
    app.include_router(search_ep.router)
    app.state.brave_client = brave
    return app


def fake_stream_agent(recorded: list[dict], fail_prefix: str | None = None):
    async def fake(request, **kwargs):
        recorded.append(request)
        if fail_prefix and (("preset" in request) == (fail_prefix == "agent")):
            raise sa.SearchAgentError("upstream", "agent blew up", status=502)
        yield {"type": "delta", "text": "answer chunk"}
        yield {"type": "sources", "results": [{"title": "S", "url": "https://s.co"}]}
        yield {"type": "done", "usage": {"total_tokens": 7}, "model": request["model"], "incomplete": False}
    return fake


def test_stream_endpoint_fans_out_all_sources(monkeypatch):
    recorded: list[dict] = []
    monkeypatch.setattr(search_ep, "PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(search_ep, "stream_agent", fake_stream_agent(recorded))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_with(brave_client())),
                                     base_url="http://test") as http:
            response = await http.post("/search/stream", json={"q": "electric bikes", "level": "medium"})
            assert response.status_code == 200
            return parse_sse(response.text)

    events = asyncio.run(scenario())
    by_name: dict[str, list[dict]] = {}
    for name, data in events:
        by_name.setdefault(name, []).append(data)

    assert by_name["meta"][0]["level"] == "medium"
    assert by_name["meta"][0]["model"] == sa.RON_SEARCH_AGENT_MODEL
    sections = {s["kind"]: s for s in by_name["section"]}
    assert set(sections) == {"web", "news", "videos", "images", "places"}
    assert all(s["status"] == "ok" for s in sections.values())
    assert sections["web"]["items"][0]["kind"] == "web" and sections["places"]["items"][0]["kind"] == "place"
    assert by_name["agent.delta"][0]["text"] == "answer chunk"
    assert by_name["agent.sources"][0]["results"][0]["url"] == "https://s.co"
    assert by_name["shopping.delta"] and by_name["agent.done"] and by_name["shopping.done"]
    assert by_name["done"][0]["duration_ms"] >= 0
    # The key never leaves the process.
    assert "pplx-test" not in json.dumps(events) and "test-key" not in json.dumps(events)

    # Both Agent API calls went through the real builders.
    assert len(recorded) == 2
    agent_request = next(r for r in recorded if "preset" in r)
    shopping_request = next(r for r in recorded if "preset" not in r)
    assert agent_request["preset"] == "medium" and agent_request["model"] == sa.RON_SEARCH_AGENT_MODEL
    assert shopping_request["model"] == sa.RON_SEARCH_SHOPPING_MODEL
    assert {t["type"] for t in shopping_request["tools"]} == {"web_search", "fetch_url", "image_search"}


def test_stream_endpoint_isolates_source_failures(monkeypatch):
    recorded: list[dict] = []
    monkeypatch.setattr(search_ep, "PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(search_ep, "stream_agent", fake_stream_agent(recorded, fail_prefix="agent"))

    async def scenario():
        brave = bs.BraveClient("test-key", limiter=bs.RateLimiter(1000), transport=httpx.MockTransport(
            lambda request: httpx.Response(429, json={"error": {"detail": "slow down"}})))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_with(brave)),
                                     base_url="http://test") as http:
            response = await http.post("/search/stream", json={"q": "ebikes"})
            assert response.status_code == 200
            return parse_sse(response.text)

    events = asyncio.run(scenario())
    by_name: dict[str, list[dict]] = {}
    for name, data in events:
        by_name.setdefault(name, []).append(data)
    # Brave rate-limited everywhere, main agent blew up — shopping still streamed.
    assert all(s["status"] == "error" and s["error"]["code"] == "rate_limited" for s in by_name["section"])
    agent_errors = [e for e in by_name["source_error"] if e["source"] == "agent"]
    assert agent_errors and agent_errors[0]["code"] == "upstream"
    assert by_name["shopping.delta"] and by_name["done"]


def test_stream_endpoint_validates_level_and_keys(monkeypatch):
    monkeypatch.setattr(search_ep, "PERPLEXITY_API_KEY", None)

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_with(brave_client())),
                                     base_url="http://test") as http:
            bad = await http.post("/search/stream", json={"q": "x", "level": "ludicrous"})
            assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_level"
        # Neither key configured -> 503 before any event.
        no_keys = bs.BraveClient(None, limiter=bs.RateLimiter(1000))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_with(no_keys)),
                                     base_url="http://test") as http:
            response = await http.post("/search/stream", json={"q": "x"})
            assert response.status_code == 503 and response.json()["detail"]["code"] == "not_configured"

    asyncio.run(scenario())


def test_search_status(monkeypatch):
    monkeypatch.setattr(search_ep, "PERPLEXITY_API_KEY", "pplx-test")

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_with(brave_client())),
                                     base_url="http://test") as http:
            response = await http.get("/search/status")
            assert response.status_code == 200
            return response.json()

    body = asyncio.run(scenario())
    assert body["configured"] == {"brave": True, "perplexity": True}
    assert body["levels"] == list(sa.SEARCH_LEVELS)
    assert body["models"] == {"agent": sa.RON_SEARCH_AGENT_MODEL, "shopping": sa.RON_SEARCH_SHOPPING_MODEL}
    assert "amazon.com" in body["shopping_domains"] and len(body["shopping_domains"]) <= 20
