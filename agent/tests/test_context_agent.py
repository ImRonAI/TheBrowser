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
                  tools=ctx.context_agent_tools(), callback_handler=None)
    agent("[browsing] ...")
    result = _tool_result(agent)
    assert result["status"] == "success"
    interests = ctx.interest_graph_from_result(result["content"])
    assert [item["label"] for item in interests] == ["Formula 1", "Home espresso"]


def test_recommend_agent_returns_a_recommendation_with_an_id() -> None:
    agent = Agent(model=ToolThenText("recommend_agent", {
        "name": "Race Weekend Briefer", "description": "Briefs you before every F1 session.",
        "interest": "Formula 1", "rationale": "You read race previews daily.", "tools": ["brave_news_search"]}),
        tools=ctx.context_agent_tools(), callback_handler=None)
    agent("[browsing] ...")
    payload = _tool_result(agent)["content"][0]["json"]["agent_recommendation"]
    assert payload["id"].startswith("rec-") and payload["name"] == "Race Weekend Briefer"
    assert payload["tools"] == ["brave_news_search"] and payload["skills"] == []


def test_prompt_names_the_agent_tools_mcp_server_only_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RON_AGENT_TOOLS_MCP_URL", raising=False)
    assert "ron_tools" not in ctx.context_agent_prompt()
    monkeypatch.setenv("RON_AGENT_TOOLS_MCP_URL", "https://tools.example.com/mcp")
    assert '"ron_tools": {"url": "https://tools.example.com/mcp"' in ctx.context_agent_prompt()


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
