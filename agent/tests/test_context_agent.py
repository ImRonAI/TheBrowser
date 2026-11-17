"""Context Agent: context items as native Markdown memory entries, its two tools, and /context."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from strands import Agent
from strands.models.model import Model
from strands.storage import InMemoryStorage

from agent.api.core import context_agent as ctx
from agent.api.core import memory as mem
from agent.api.core import panel_storage
from agent.api.endpoints import context as context_endpoints


@pytest.fixture(autouse=True)
def storage(monkeypatch: pytest.MonkeyPatch) -> InMemoryStorage:
    backend = InMemoryStorage()
    monkeypatch.setattr(panel_storage, "_storage", backend)
    return backend


class ToolThenText(Model):
    """Scripted model: one tool call with the given input, then a short answer."""

    def __init__(self, name: str, tool_input: dict[str, Any]) -> None:
        self.name, self.tool_input = name, tool_input
        self.config: dict[str, Any] = {}

    def update_config(self, **config: Any) -> None:
        self.config.update(config)

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "scripted", "stateful": False}

    async def structured_output(self, *args: Any, **kwargs: Any):  # type: ignore[override]
        raise NotImplementedError
        yield {}

    async def stream(self, messages: list[dict[str, Any]], *_: Any, **__: Any):
        done = any("toolResult" in block for message in messages for block in message["content"])
        yield {"messageStart": {"role": "assistant"}}
        if done:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Updated."}}}
        else:
            yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": "t1", "name": self.name}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(self.tool_input)}}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn" if done else "tool_use"}}


def _tool_result(agent: Agent) -> dict[str, Any]:
    return next(block["toolResult"] for message in agent.messages for block in message["content"] if "toolResult" in block)


def test_items_are_markdown_entries_in_the_users_native_context_store() -> None:
    async def run() -> None:
        link = await ctx.add_item("u1", kind="link", title="Async Rust", body="Tokio runtimes and executors",
                                  source="https://tokio.rs/")
        await asyncio.sleep(0.002)
        shot = await ctx.add_item("u1", kind="screenshot", title="Checkout bug", data=b"\x89PNG\r\n",
                                  media_type="image/png", file_name="bug.png")
        assert [item["id"] for item in await ctx.list_items("u1")] == [shot["id"], link["id"]]
        item, markdown = await ctx.read_item("u1", link["id"])  # type: ignore[misc]
        assert markdown.startswith(f"# {link['id']} Async Rust\n") and "- source: https://tokio.rs/" in markdown
        assert item["kind"] == "link" and item["preview"] == "Tokio runtimes and executors"
        assert await ctx.read_file("u1", shot["id"]) == b"\x89PNG\r\n"
        # Every Ron agent's memory searches it natively; another user never sees it.
        search = next(t for t in mem.live_memory_tools("u1") if t.tool_name == "search_memory")
        found = await search(query="tokio executors")  # type: ignore[operator]
        assert any("Tokio runtimes" in entry["content"] for entry in found)
        assert await ctx.list_items("u2") == []
        assert await ctx.delete_item("u1", shot["id"]) and await ctx.read_file("u1", shot["id"]) is None
        assert [item["id"] for item in await ctx.list_items("u1")] == [link["id"]]

    asyncio.run(run())


def test_specialists_search_the_same_context_read_only() -> None:
    from agent.api.core.harness_agents import context_search_tools

    async def run() -> None:
        owner = "6f1c3c1e-0c1a-4c1e-9d55-0d6a2b5e9a11"
        await ctx.add_item(owner, kind="document", title="Launch plan", body="## Milestones\nBeta in March")
        tools = context_search_tools(owner)
        assert [tool.tool_name for tool in tools] == ["search_context"]
        found = await tools[0](query="beta milestones")  # type: ignore[operator]
        assert "Beta in March" in found[0]["content"]

    asyncio.run(run())


def test_update_interest_graph_returns_the_graph_as_a_json_tool_result() -> None:
    graph = [{"label": "Formula 1", "weight": 0.9, "category": "entertainment", "reason": "five race pages"},
             {"label": "formula 1", "weight": 0.2, "category": "entertainment"},
             {"label": "Home espresso", "weight": 0.55, "category": "other"}]
    agent = Agent(model=ToolThenText("update_interest_graph", {"interests": graph}),
                  tools=ctx.context_agent_tools("default"), callback_handler=None)
    agent("[browsing] ...")
    result = _tool_result(agent)
    assert result["status"] == "success"
    interests = ctx.interest_graph_from_result(result["content"])
    assert [item["label"] for item in interests] == ["Formula 1", "Home espresso"]


def test_recommend_agent_returns_a_recommendation_with_an_id() -> None:
    agent = Agent(model=ToolThenText("recommend_agent", {
        "name": "Race Weekend Briefer", "description": "Briefs you before every F1 session.",
        "interest": "Formula 1", "rationale": "You read race previews daily.", "tools": ["brave_news_search"]}),
        tools=ctx.context_agent_tools("default"), callback_handler=None)
    agent("[browsing] ...")
    payload = _tool_result(agent)["content"][0]["json"]["agent_recommendation"]
    assert payload["id"].startswith("rec-") and payload["name"] == "Race Weekend Briefer"
    assert payload["tools"] == ["brave_news_search"] and payload["skills"] == []


def test_prompt_names_the_agent_tools_mcp_server_only_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RON_AGENT_TOOLS_MCP_URL", raising=False)
    assert "ron_tools" not in ctx.context_agent_prompt("u1")
    monkeypatch.setenv("RON_AGENT_TOOLS_MCP_URL", "https://tools.example.com/mcp")
    assert '"ron_tools": {"url": "https://tools.example.com/mcp"' in ctx.context_agent_prompt("u1")


def test_opencode_and_the_computer_join_only_when_the_computer_is_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ctx.app_config, "COMPUTER_MCP_URL", "")
    monkeypatch.setattr(ctx.app_config, "COMPUTER_MCP_TOKEN", "")
    assert "opencode run" not in ctx.context_agent_prompt("u1")
    names = [t.tool_name for t in ctx.context_agent_tools("default")]
    assert names == ["update_interest_graph", "recommend_agent", "schedule_agent"]
    monkeypatch.setattr(ctx.app_config, "COMPUTER_MCP_URL", "https://computer.example.com/mcp")
    monkeypatch.setattr(ctx.app_config, "COMPUTER_MCP_TOKEN", "token")
    assert "REN_USER_ID=u1 opencode run --standalone --auto" in ctx.context_agent_prompt("u1")
    assert "register_application" in [t.tool_name for t in ctx.context_agent_tools("default")]


def test_registered_applications_list_newest_first_and_replace_by_name(client: TestClient) -> None:
    user = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab"
    register = ctx.register_application_tool(user)
    with pytest.raises(ValueError):
        asyncio.run(register(name="Tide", kind="web", location="/config/workspace/tide/dist", description="Tides."))
    asyncio.run(register(name="Tide", kind="web", location="https://tide-one.vercel.app", description="Tides."))
    asyncio.run(register(name="Pager", kind="android", location="/config/workspace/pager/app.apk", description="Pages."))
    asyncio.run(register(name="tide", kind="web", location="https://tide-two.vercel.app", description="Tides, v2."))
    listed = client.get("/context/applications", params={"user_id": user}).json()["applications"]
    assert [(item["name"], item["location"]) for item in listed] == [
        ("tide", "https://tide-two.vercel.app"), ("Pager", "/config/workspace/pager/app.apk")]
    removed = client.delete(f"/context/applications/{listed[1]['id']}", params={"user_id": user}).json()
    assert [item["name"] for item in removed["applications"]] == ["tide"]
    assert client.delete("/context/applications/app-missing", params={"user_id": user}).status_code == 404


def test_schedule_agent_takes_the_scheduler_s_cadence() -> None:
    spec = ctx.schedule_agent_tool("default").tool_spec
    properties = spec["inputSchema"]["json"]["properties"]
    assert properties["every"]["enum"] == ["hours", "day", "weekdays", "week"]
    assert set(spec["inputSchema"]["json"]["required"]) == {"agent_id", "every", "task", "timezone"}


def test_thread_markdown_keeps_the_conversation_and_names_tools() -> None:
    markdown = ctx.thread_markdown([
        {"role": "user", "content": [{"text": "Find espresso grinders"}]},
        {"role": "assistant", "content": [{"reasoningContent": {"reasoningText": {"text": "hidden"}}},
                                          {"toolUse": {"name": "brave_web_search", "input": {}, "toolUseId": "1"}}]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": "1", "content": [{"text": "raw"}]}}]},
        {"role": "assistant", "content": [{"text": "The Niche Zero is quiet."}]},
    ])
    assert markdown == ("**User:** Find espresso grinders\n\n**Ren:** _Used tool `brave_web_search`._\n\n"
                        "**Ren:** The Niche Zero is quiet.")


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(context_endpoints.router)
    return TestClient(app)


def test_context_api_round_trip(client: TestClient) -> None:
    created = client.post("/context/items", json={"user_id": "u1", "kind": "selection", "title": "Quote",
                                                   "text": "Simplicity is prerequisite for reliability.",
                                                   "url": "http://example.com/essay"})
    assert created.status_code == 200, created.text
    text_item = created.json()["item"]
    uploaded = client.post("/context/files", data={"user_id": "u1", "kind": "recording", "title": "Repro"},
                           files={"file": ("repro.webm", b"webm-bytes", "video/webm")})
    assert uploaded.status_code == 200, uploaded.text
    file_item = uploaded.json()["item"]
    assert file_item["file"] == {"media_type": "video/webm", "size": 10, "name": "repro.webm"}
    listed = client.get("/context/items", params={"user_id": "u1"}).json()["items"]
    assert [item["id"] for item in listed] == [file_item["id"], text_item["id"]]
    body = client.get(f"/context/items/{file_item['id']}/file", params={"user_id": "u1"})
    assert body.content == b"webm-bytes" and body.headers["content-type"] == "video/webm"
    assert body.headers["content-disposition"].startswith("inline;") and body.headers["x-content-type-options"] == "nosniff"
    assert "Origin" in body.headers["vary"]
    page = client.post("/context/files", data={"user_id": "u1", "kind": "file"},
                       files={"file": ("x.html", b"<script>fetch('/chat')</script>", "text/html")}).json()["item"]
    served = client.get(f"/context/items/{page['id']}/file", params={"user_id": "u1"})
    assert served.headers["content-disposition"].startswith("attachment;")
    assert served.headers["content-security-policy"].startswith("sandbox")
    detail = client.get(f"/context/items/{text_item['id']}", params={"user_id": "u1"}).json()
    assert "Simplicity is prerequisite" in detail["markdown"]
    assert client.get(f"/context/items/{text_item['id']}", params={"user_id": "u2"}).status_code == 404
    assert client.delete(f"/context/items/{file_item['id']}", params={"user_id": "u1"}).json() == {"deleted": file_item["id"]}
    assert client.get(f"/context/items/{file_item['id']}/file", params={"user_id": "u1"}).status_code == 404


def test_context_api_rejects_empty_items_and_guest_agent_listing(client: TestClient) -> None:
    assert client.post("/context/items", json={"user_id": "u1", "kind": "note"}).status_code == 422
    assert client.post("/context/items", json={"user_id": "u1", "kind": "thread"}).status_code == 422
    assert client.post("/context/files", data={"user_id": "u1"}, files={"file": ("a.bin", b"", "x/y")}).status_code == 422
    assert client.get("/context/items/not-an-id", params={"user_id": "u1"}).status_code == 404
    assert client.get("/context/agents", params={"user_id": "default"}).json() == {"agents": [], "sign_in_required": True}


def test_profile_follows_the_account_and_keeps_the_newer_save(client: TestClient) -> None:
    user = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab"
    assert client.get("/context/profile", params={"user_id": user}).json() == {"profile": None}
    profile = {
        "onboarding": {"answers": [{"question": "What topics are you most interested in?", "answer": "AI, F1"}], "isComplete": True},
        "interests": {"nodes": [{"id": "n1", "label": "AI", "weight": 0.9, "category": "ai", "source": "onboarding", "lastUpdated": 1}],
                      "connections": [{"id": "n1-n2", "from": "n1", "to": "n2", "strength": 0.5}], "isInitialized": True},
        "updated_at": 2000,
    }
    saved = client.put("/context/profile", json={"user_id": user, "profile": profile})
    assert saved.status_code == 200, saved.text
    read = client.get("/context/profile", params={"user_id": user}).json()["profile"]
    assert read["onboarding"]["isComplete"] is True and read["interests"]["connections"][0]["from"] == "n1"
    older = {**profile, "onboarding": {"answers": [], "isComplete": False}, "updated_at": 1000}
    assert client.put("/context/profile", json={"user_id": user, "profile": older}).json()["profile"]["updated_at"] == 2000
    assert client.get("/context/profile", params={"user_id": user}).json()["profile"]["onboarding"]["isComplete"] is True
    assert client.get("/context/profile", params={"user_id": "default"}).status_code == 401
    assert client.put("/context/profile", json={"user_id": "default", "profile": profile}).status_code == 401
    assert client.put("/context/profile", json={"user_id": user, "profile": {**profile, "extra": 1}}).status_code == 422


def test_a_dream_notifies_once_and_its_review_reaches_the_dreaming_journal(client: TestClient,
                                                                           monkeypatch: pytest.MonkeyPatch) -> None:
    from agent.api.core import dreaming

    monkeypatch.setattr(dreaming, "_timers", {})
    assert client.get("/context/dream", params={"user_id": "u1"}).json() == {"dream": None}
    storage = panel_storage.get_user_session_storage("u1")
    version = "20261117T201500123456"
    asyncio.run(storage.write("memory/brain/panel/travel.md", b"# Travel\nThe user flies from SLC."))
    asyncio.run(storage.write(f"memory/dreams/{version}.json",
                              json.dumps({"memory/brain/panel/travel.md": None, "memory/brain/panel/old.md": "# Old"}).encode()))
    dream = client.get("/context/dream", params={"user_id": "u1"}).json()["dream"]
    assert dream == {"version": version, "topics": [
        {"key": "memory/brain/panel/travel.md", "text": "# Travel\nThe user flies from SLC."},
        {"key": "memory/brain/panel/old.md", "text": None}]}
    review = {"user_id": "u1", "topics": [{"key": "memory/brain/panel/travel.md", "right": False, "comment": "Ogden"},
                                          {"key": "memory/brain/panel/old.md", "right": True}]}
    assert client.post(f"/context/dream/{version}", json=review).json() == {"reviewed": version}
    assert client.get("/context/dream", params={"user_id": "u1"}).json() == {"dream": None}
    notes = asyncio.run(dreaming.Journal("u1", dreaming.DREAMING).notes())
    assert "- memory/brain/panel/travel.md: wrong. Ogden\n- memory/brain/panel/old.md: right" in notes
    assert client.post("/context/dream/latest", json=review).status_code == 422
    assert client.post(f"/context/dream/{version}", json={"topics": [{"key": "../x", "right": True}]}).status_code == 422
