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
    assert request["provider"] == "xai" and request["effort"] == "medium"
    assert request["stream"] is True and request["input"] == "best ebikes"
    tool_types = [tool["type"] for tool in request["tools"]]
    assert tool_types == ["web_search", "image_search", "fetch_url", "subagent"]


def test_shopping_request_unrestricted_online_and_local_by_default():
    request = sa.build_shopping_request("ebike")
    assert "preset" not in request
    assert request["model"] == sa.RON_SEARCH_SHOPPING_MODEL
    assert request["provider"] == "xai"
    tools = {tool["type"]: tool for tool in request["tools"]}
    assert set(tools) == {"web_search", "local_search", "fetch_url", "image_search"}
    # Unrestricted by default so both online retailers and brick-and-mortar stores are returned.
    assert "filters" not in tools["web_search"]
    # Explicit domain list is still honored when passed.
    filtered = sa.build_shopping_request("ebike", domains=["amazon.com", "rei.com"])
    filtered_web = next(t for t in filtered["tools"] if t["type"] == "web_search")
    assert filtered_web["filters"]["search_domain_filter"] == ["amazon.com", "rei.com"]


def test_native_strands_harness_configs_and_progressive_efforts(monkeypatch, tmp_path):
    monkeypatch.setenv("XAI_API_KEY", "xai-test-key")
    monkeypatch.setattr(sa.app_config, "XAI_API_KEY", "xai-test-key")

    expected_efforts = {
        "fast": "low",
        "low": "low",
        "medium": "medium",
        "high": "high",
        "xhigh": "xhigh",
    }
    for level, expected_effort in expected_efforts.items():
        cfg = sa.load_search_harness_config(level)
        assert cfg["model"] == "xai/grok-4.7"
        assert cfg["effort"] == expected_effort
        assert cfg["instructions"] and len(cfg["instructions"]) > 80
        assert cfg["agentConfig"] == {"background_tasks": False}

        agent = sa.create_search_agent(
            level,  # type: ignore[arg-type]
            session_id=f"test-{level}",
            session_dir=tmp_path,
        )
        assert agent.model.config["model_id"] in ("grok-4.7", "xai/grok-4.7")
        assert agent.model.config.get("reasoning_effort") == expected_effort
        assert "subagent" in agent.tool_names
        assert "brave_web_search" in agent.tool_names
        assert "brave_local_search" in agent.tool_names
        assert "web_fetch" in agent.tool_names
        assert agent._session_manager is not None

    shop_cfg = sa.load_search_harness_config("shopping")
    assert shop_cfg["model"] == "xai/grok-4.7"
    assert shop_cfg["effort"] == "medium"
    assert shop_cfg["session"] is False
    shop_agent = sa.build_shopping_harness(location={"location": "Seattle, WA"}, country="US")
    assert shop_agent.model.config["model_id"] in ("grok-4.7", "xai/grok-4.7")
    assert shop_agent.model.config.get("reasoning_effort") == "medium"
    assert "brave_local_search" in shop_agent.tool_names
    assert "Seattle, WA" in (shop_agent.system_prompt or "")


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
    assert {"web_search", "local_search", "fetch_url", "image_search"} <= {t["type"] for t in shopping_request["tools"]}


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
    monkeypatch.setattr(search_ep, "XAI_API_KEY", None)
    monkeypatch.setattr(sa.app_config, "XAI_API_KEY", None)
    monkeypatch.setattr(sa.app_config, "PERPLEXITY_API_KEY", None)

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
    monkeypatch.setattr(search_ep, "XAI_API_KEY", "xai-test")

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_with(brave_client())),
                                     base_url="http://test") as http:
            response = await http.get("/search/status")
            assert response.status_code == 200
            return response.json()

    body = asyncio.run(scenario())
    assert body["configured"] == {"brave": True, "xai": True, "perplexity": True}
    assert body["provider"] == "xai"
    assert body["levels"] == list(sa.SEARCH_LEVELS)
    assert body["reasoning_efforts"] == dict(sa.LEVEL_REASONING_EFFORT)
    assert body["models"] == {"agent": sa.RON_SEARCH_AGENT_MODEL, "shopping": sa.RON_SEARCH_SHOPPING_MODEL}
    assert body["shopping_domains"] == []


def test_perplexity_agent_api_disabled(monkeypatch):
    recorded: list[dict] = []
    monkeypatch.setattr(search_ep, "PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(search_ep, "XAI_API_KEY", None)
    monkeypatch.setenv("RON_PERPLEXITY_AGENT_API", "0")
    monkeypatch.setattr(search_ep, "stream_agent", fake_stream_agent(recorded))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_with(brave_client())),
                                     base_url="http://test") as http:
            status_resp = await http.get("/search/status")
            assert status_resp.status_code == 200
            status_body = status_resp.json()
            stream_resp = await http.post("/search/stream", json={"q": "electric bikes", "level": "medium"})
            assert stream_resp.status_code == 200
            return status_body, parse_sse(stream_resp.text)

    status_body, events = asyncio.run(scenario())
    assert status_body["configured"] == {"brave": True, "xai": False, "perplexity": False}
    assert recorded == []

    by_name: dict[str, list[dict]] = {}
    for name, data in events:
        by_name.setdefault(name, []).append(data)

    sections = {s["kind"]: s for s in by_name["section"]}
    assert set(sections) == {"web", "news", "videos", "images", "places"}
    assert all(s["status"] == "ok" for s in sections.values())
    errors = {e["source"]: e for e in by_name.get("source_error", [])}
    assert set(errors) == {"agent", "shopping"}
    assert errors["agent"]["code"] == "disabled"
    assert errors["shopping"]["code"] == "disabled"
    assert by_name["done"][0]["duration_ms"] >= 0


def test_subagent_tool_streams_online_and_brick_and_mortar_shopping_and_follow_up(monkeypatch):
    from strands.types._events import ToolStreamEvent

    monkeypatch.setattr(search_ep, "XAI_API_KEY", "xai-test")
    monkeypatch.setattr(sa.app_config, "XAI_API_KEY", "xai-test")

    class FakeParentAgent:
        def __init__(self):
            self.prompts: list[str] = []

        async def stream_async(self, prompt: str):
            self.prompts.append(prompt)
            if len(self.prompts) == 1:
                yield {"reasoningText": "Checking specs and delegating shopping subagent"}
                yield {"data": "The **Breville Bambino Plus** is our top compact espresso pick [Breville](https://www.breville.com/us/en/products/espresso/bes500.html)."}
                # Simulate the `subagent` tool streaming shopping findings (online + brick-and-mortar).
                tool_use = {"name": "subagent", "toolUseId": "sub-1", "input": {"agent_type": "shopping"}}
                yield ToolStreamEvent(
                    tool_use,  # type: ignore[arg-type]
                    {
                        "data": (
                            "### Online Retailers\n"
                            "- [Seattle Coffee Gear — Breville Bambino Plus ($499.95)](https://www.seattlecoffeegear.com/breville-bambino-plus)\n\n"
                            "### Brick-and-Mortar & Local Stores\n"
                            "- [Sur La Table Downtown](https://www.surlatable.com/stores/seattle) — 90 Pike St, Seattle, WA 98101 · 4.7/5 stars · (206) 622-0722\n"
                        )
                    },
                )
            else:
                yield {"data": f"Follow-up answer for: {prompt}"}

    fake_agent = FakeParentAgent()
    fake_entry = sa._SearchSessionEntry(fake_agent, "high")  # type: ignore[arg-type]
    monkeypatch.setattr(
        sa,
        "get_or_create_search_session",
        lambda session_id, level, **kwargs: (fake_agent, fake_entry),
    )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_with(brave_client())),
                                     base_url="http://test") as http:
            initial = await http.post(
                "/search/stream",
                json={"q": "breville bambino plus", "level": "high", "session_id": "sess-42"},
            )
            assert initial.status_code == 200
            initial_events = parse_sse(initial.text)

            follow = await http.post(
                "/search/stream",
                json={
                    "q": "Does it have a 3-way solenoid valve?",
                    "level": "high",
                    "session_id": "sess-42",
                    "follow_up": True,
                },
            )
            assert follow.status_code == 200
            follow_events = parse_sse(follow.text)
            return initial_events, follow_events

    initial_events, follow_events = asyncio.run(scenario())
    by_initial: dict[str, list[dict]] = {}
    for name, data in initial_events:
        by_initial.setdefault(name, []).append(data)

    assert by_initial["meta"][0]["session_id"] == "sess-42"
    assert by_initial["meta"][0]["effort"] == "high"
    assert by_initial["meta"][0]["provider"] == "xai"
    assert len(by_initial["section"]) == 5
    assert "Breville Bambino Plus" in by_initial["agent.delta"][0]["text"]
    assert by_initial["shopping.delta"]
    shopping_sources = [ item for batch in by_initial.get("shopping.sources", []) for item in batch["results"] ]
    kinds = {item["url"]: item.get("kind") for item in shopping_sources}
    assert kinds.get("https://www.seattlecoffeegear.com/breville-bambino-plus") == "online"
    assert kinds.get("https://www.surlatable.com/stores/seattle") == "local"

    by_follow: dict[str, list[dict]] = {}
    for name, data in follow_events:
        by_follow.setdefault(name, []).append(data)

    # Follow-up skips re-running static Brave sections and continues the same session.
    assert "section" not in by_follow
    assert by_follow["meta"][0]["session_id"] == "sess-42"
    assert by_follow["meta"][0]["follow_up"] is True
    assert "Follow-up answer for: Does it have a 3-way solenoid valve?" in by_follow["agent.delta"][0]["text"]
    assert len(fake_agent.prompts) == 2
