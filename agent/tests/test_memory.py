"""Ron's memory (``agent/api/core/memory.py``) on the real Strands memory stack.

Real ``Agent``, ``MemoryManager``, ``ExtractionCoordinator``, ``ModelExtractor`` and
``FileMemoryStore`` over the panel storage; only the models are scripted.
"""

from __future__ import annotations

import asyncio
import json
from array import array
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient
from strands import Agent
from strands.memory import MemoryManager
from strands.memory.types import MemoryAddOptions
from strands.models.model import Model
from strands.storage import InMemoryStorage
from strands.vended_memory_stores.file_memory_store import FileMemoryStore

from agent.api.core import dreaming, panel_storage
from agent.api.core import memory as mem

WORDS = ("tea", "dana", "sam", "co-founder", "flights", "aisle", "short")


class Scripted(Model):
    """Answers each call from a script: text, or an ``add_memory`` call once."""

    def __init__(self, *, text: str = "Noted.", add: dict[str, Any] | None = None) -> None:
        self.text, self.add, self.calls = text, add, 0
        self.systems: list[str | None] = []
        self.seen: list[list[dict[str, Any]]] = []

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "scripted", "stateful": False}

    def update_config(self, **kwargs: Any) -> None:
        pass

    async def structured_output(self, *args: Any, **kwargs: Any):  # type: ignore[override]
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):  # type: ignore[override]
        self.calls += 1
        self.systems.append(system_prompt)
        self.seen.append(json.loads(json.dumps(messages, default=str)))
        yield {"messageStart": {"role": "assistant"}}
        tool_turn = any("toolResult" in block for message in messages for block in message["content"])
        if self.add is not None and not tool_turn:
            yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": "m1", "name": "add_memory"}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(self.add)}}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "tool_use"}}
            return
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": self.text}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


@pytest.fixture(autouse=True)
def storage(monkeypatch: pytest.MonkeyPatch) -> InMemoryStorage:
    backend = InMemoryStorage()
    monkeypatch.setattr(panel_storage, "_storage", backend)
    monkeypatch.setattr(dreaming, "_marked", {})
    return backend


@pytest.fixture(autouse=True)
def embedded(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Embeddings as counts of :data:`WORDS`; returns every text that was embedded."""
    texts: list[str] = []

    async def embed(batch: list[str]) -> list[array[float]]:
        texts.extend(batch)
        return [array("f", [float(text.lower().count(word)) for word in WORDS]) for text in batch]

    monkeypatch.setattr(dreaming, "embed", embed)
    return texts


def _by_name(config: Any) -> dict[str, FileMemoryStore]:
    return {store.name: store for store in config["stores"]}


def _first_user_text(messages: list[dict[str, Any]]) -> str:
    return "".join(block.get("text", "") for block in messages[0]["content"])


def test_stores_are_native_file_stores_people_first_tasks_then_the_brain() -> None:
    config = mem.memory_manager_config("u1")
    names = [store.name for store in config["stores"]]
    assert names == ["brain/people", "context", "tasks", "brain", "journal/panel"]
    assert all(isinstance(store, FileMemoryStore) for store in config["stores"])
    assert isinstance(config["stores"][0], mem.People)
    # Nothing is distilled during a conversation: only the journal takes each turn, for the dream.
    assert [store.name for store in config["stores"] if store.extraction] == ["journal/panel"]
    # The Context widget fills `context` and `remember_person` fills `people`; add_memory writes only tasks.
    assert config["add_tool_config"] == {"stores": ["tasks"]}
    assert config["injection"] is dreaming.INDEX_INJECTION


def test_project_and_issue_stores_attach_only_when_scoped() -> None:
    names = [s.name for s in mem.user_stores("u1", mem.MemoryScope(project_id="p_1", issue_id="i-2"))]
    assert names == ["brain/people", "project-p_1", "issue-i-2", "context", "tasks"]
    with pytest.raises(ValueError):
        mem.user_stores("u1", mem.MemoryScope(project_id="../x"))


def test_users_are_isolated_and_chat_and_live_share_the_same_files() -> None:
    async def run() -> None:
        await dreaming.memory_command("u1", "panel", "create", "/memories/panel/drinks.md",
                                      file_text="# Drinks\nLikes tea")
        live = mem.live_memory_tools("u1")
        search = next(tool for tool in live if tool.tool_name == "search_memory")
        found = await search(query="tea")  # type: ignore[operator]  # DecoratedFunctionTool.__call__
        assert any("Likes tea" in item["content"] for item in found)
        other = MemoryManager(**mem.memory_manager_config("u2"))
        assert await other.search("tea") == []

    asyncio.run(run())


def test_live_tools_are_the_native_search_and_add_plus_the_memory_tool() -> None:
    assert [tool.tool_name for tool in mem.live_memory_tools("u1")] == [
        "search_memory", "add_memory", "remember_person", "memory", "journal"
    ]
    assert mem.people_store("u1", writable=False).get_tools() == []


def test_remember_person_merges_by_heading_and_is_injected_and_shared_over_mcp() -> None:
    import httpx
    from fastmcp import Client
    from fastmcp.client.transports import StreamableHttpTransport

    from agent.api.core import memory_mcp

    async def run() -> None:
        tool = mem.people_store("u1").get_tools()[0]
        first = await tool(name="Dana Kim", relationship="Close friend", contact="+1 801-555-0100")  # type: ignore[operator]
        assert first["content"][0]["json"]["person"] == {"name": "Dana Kim", "key": "dana-kim.md"}
        await tool(name="Dana Kim", notes="Training for Austin half marathon", applies_to="Running, Austin trip")  # type: ignore[operator]
        found = await mem.people_store("u1").search("Dana marathon")
        assert len(found) == 1
        assert "- relationship: Close friend" in found[0].content
        assert "- contact: +1 801-555-0100" in found[0].content
        assert "- applies to: Running, Austin trip" in found[0].content

        # A person is a topic of the brain, so every agent's index lists them.
        model = Scripted()
        agent = Agent(model=model, memory_manager=mem.memory_manager_config("u1"), callback_handler=None)
        await agent.invoke_async("Plan a Saturday run with Dana")
        sent = _first_user_text(model.seen[0])
        assert "<memory_index>" in sent and "- /memories/people/dana-kim.md" in sent

        # Outside agents (OpenCode, ElevenLabs) read and write the same people store over /memory/mcp.
        app = memory_mcp.server.http_app(path="/mcp")
        headers = {"X-Ren-User": "u1", "X-Ren-Agent": "opencode"}

        def factory(headers: dict[str, str] | None = None, timeout: httpx.Timeout | None = None,
                    auth: httpx.Auth | None = None, **_: Any) -> httpx.AsyncClient:
            return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ren", headers=headers,
                                     timeout=timeout, auth=auth)

        async with app.router.lifespan_context(app):
            async with Client(StreamableHttpTransport("http://ren/mcp", headers=headers, httpx_client_factory=factory)) as mcp:
                saved = await mcp.call_tool("remember_person", {"name": "Sam Patel", "relationship": "Co-founder", "applies_to": "Launch"})
                assert saved.data == "Remembered Sam Patel."
                hits = (await mcp.call_tool("search_memory", {"query": "Sam co-founder"})).data
                assert any("Sam Patel" in entry for entry in hits)

    asyncio.run(run())


def test_add_memory_writes_the_store_the_model_names() -> None:
    model = Scripted(add={"entries": ["# Dentist\nBook a cleaning in March"], "stores": ["tasks"]})
    config = mem.memory_manager_config("u1")
    agent = Agent(model=model, memory_manager=config, callback_handler=None)

    async def run() -> None:
        await agent.invoke_async("Track this: book a dentist cleaning in March.")
        stores = _by_name(config)
        assert (await stores["tasks"].search("cleaning"))[0].content.startswith("# Dentist")
        assert await panel_storage.get_user_session_storage("u1").list("memory/brain/") == []

    asyncio.run(run())


def test_injection_is_the_index_alone_with_no_embedding(embedded: list[str]) -> None:
    async def seed() -> None:
        await dreaming.memory_command("u1", "panel", "create", "/memories/panel/flights.md",
                                      file_text="# Flights\nPrefers aisle seats on flights")
        manager = MemoryManager(**mem.memory_manager_config("u1"))
        await manager.add("# Flights todo\nBook flights to Lisbon", MemoryAddOptions(stores=["tasks"]))

    asyncio.run(seed())
    model = Scripted()
    agent = Agent(model=model, memory_manager=mem.memory_manager_config("u1"), callback_handler=None)
    asyncio.run(agent.invoke_async("Find me flights"))
    sent = _first_user_text(model.seen[0])
    assert "- /memories/panel/flights.md" in sent and "aisle seats" not in sent and "Lisbon" not in sent
    assert embedded == []
    # Injection is ephemeral: nothing is written into the durable conversation.
    assert "<memory_index>" not in json.dumps(agent.messages)


def test_writes_across_threads_land_in_one_file() -> None:
    stores = [mem.user_stores("u1")[-1] for _ in range(8)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda i: asyncio.run(stores[i].add(f"# Topic\nline-{i}")), range(8)))
    text = asyncio.run(stores[0].search("Topic"))[0].content
    assert text.startswith("# Topic")


def test_directive_names_every_store_and_forbids_acting_on_tasks() -> None:
    assert all(f"- {name}:" in mem.MEMORY_DIRECTIVE for name in mem.CATEGORIES)
    assert "never your current" in mem.MEMORY_DIRECTIVE and "remember_person" in mem.MEMORY_DIRECTIVE
    assert mem.MEMORY_DIRECTIVE.endswith(dreaming.MEMORY_PROTOCOL)


# --- /memory API: owner-bound view/add/edit/delete --------------------------------------------


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    from fastapi import FastAPI

    from agent.api.core.projects import ProjectIdentity, project_identity
    from agent.api.endpoints import memory as endpoint

    app = FastAPI()
    app.include_router(endpoint.router)
    who = {"user": ProjectIdentity("owner-1", "t", "", "")}
    app.dependency_overrides[project_identity] = lambda: who["user"]
    test = TestClient(app)
    test.who = who  # type: ignore[attr-defined]
    return test


def test_memory_api_add_list_edit_delete_round_trip(client: TestClient) -> None:
    # The Memory panel's Feedback tab is the panel agent's folder of the brain.
    added = client.post("/memory/entries", json={"store": "feedback", "content": "# Tone\nToo wordy; keep it short"})
    assert added.status_code == 200 and added.json() == {"store": "brain/panel", "key": "tone.md"}
    listed = client.get("/memory/entries", params={"store": "brain/panel"}).json()["entries"]
    assert listed == [{"store": "brain/panel", "key": "tone.md", "content": "# Tone\nToo wordy; keep it short"}]
    assert client.put("/memory/entries", json={"store": "feedback", "key": "tone.md", "content": "# Tone\nShort"}).status_code == 200
    assert client.get("/memory/search", params={"q": "short"}).json()["results"][0]["content"] == "# Tone\nShort"
    counts = {s["name"]: s["count"] for s in client.get("/memory/stores").json()["stores"]}
    assert counts == {"tasks": 0, "brain/panel": 1}
    assert client.delete("/memory/entries", params={"store": "feedback", "key": "tone.md"}).json()["deleted"]
    assert client.get("/memory/entries", params={"store": "feedback"}).json()["entries"] == []


def test_memory_api_is_owner_scoped_and_rejects_guests_and_bad_input(client: TestClient) -> None:
    from agent.api.core.projects import ProjectIdentity

    client.post("/memory/entries", json={"store": "remember", "content": "# Secret\nmine"})
    client.who["user"] = ProjectIdentity("owner-2", "t", "", "")  # type: ignore[attr-defined]
    assert client.get("/memory/entries", params={"store": "remember"}).json()["entries"] == []
    assert client.delete("/memory/entries", params={"store": "remember", "key": "secret.md"}).status_code == 404
    assert client.get("/memory/entries", params={"store": "nope"}).status_code == 422
    assert client.put("/memory/entries", json={"store": "remember", "key": "../x.md", "content": "x"}).status_code == 422
    client.who["user"] = ProjectIdentity("guest", "t", "", "", guest=True)  # type: ignore[attr-defined]
    assert client.get("/memory/stores").status_code == 401
