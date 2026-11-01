"""Ron's memory (``agent/api/core/memory.py``) on the real Strands memory stack.

Real ``Agent``, ``MemoryManager``, ``ExtractionCoordinator``, ``ModelExtractor`` and
``FileMemoryStore`` over the panel storage; only the models are scripted.
"""

from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient
from strands import Agent
from strands.memory import MemoryManager
from strands.memory.types import InjectionFormatContext, MemoryAddOptions, MemoryEntry
from strands.models.model import Model
from strands.storage import InMemoryStorage
from strands.vended_memory_stores.file_memory_store import FileMemoryStore

from agent.api.core import memory as mem
from agent.api.core import panel_storage


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
    return backend


def _by_name(config: Any) -> dict[str, FileMemoryStore]:
    return {store.name: store for store in config["stores"]}


def _first_user_text(messages: list[dict[str, Any]]) -> str:
    return "".join(block.get("text", "") for block in messages[0]["content"])


def test_stores_are_native_file_stores_per_category_tasks_last() -> None:
    config = mem.memory_manager_config("u1")
    names = [store.name for store in config["stores"]]
    assert names == ["facts", "remember", "feedback", "tasks"]
    assert all(type(store) is FileMemoryStore for store in config["stores"])
    stores = _by_name(config)
    assert stores["facts"].extraction and not stores["remember"].extraction and not stores["tasks"].extraction
    assert config["add_tool_config"] == {"stores": names}
    assert set(config["injection"]) == {"format"}  # SDK default trigger (userTurn), query and size
    assert not _by_name(mem.memory_manager_config("u1", extraction=False))["facts"].extraction


def test_project_and_issue_stores_attach_only_when_scoped() -> None:
    names = [s.name for s in mem.user_stores("u1", mem.MemoryScope(project_id="p_1", issue_id="i-2"))]
    assert names == ["facts", "remember", "feedback", "project-p_1", "issue-i-2", "tasks"]
    with pytest.raises(ValueError):
        mem.user_stores("u1", mem.MemoryScope(project_id="../x"))


def test_users_are_isolated_and_chat_and_live_share_the_same_files() -> None:
    async def run() -> None:
        chat = MemoryManager(**mem.memory_manager_config("u1", extraction=False))
        await chat.add("# Drinks\nLikes tea", MemoryAddOptions(stores=["facts"]))
        live = mem.live_memory_tools("u1")
        search = next(tool for tool in live if tool.tool_name == "search_memory")
        found = await search(query="tea")  # type: ignore[operator]  # DecoratedFunctionTool.__call__
        assert any("Likes tea" in item["content"] for item in found)
        other = MemoryManager(**mem.memory_manager_config("u2", extraction=False))
        assert await other.search("tea") == []

    asyncio.run(run())


def test_live_tools_are_the_native_search_and_add() -> None:
    assert [tool.tool_name for tool in mem.live_memory_tools("u1")] == ["search_memory", "add_memory"]


def test_add_memory_writes_the_store_the_model_names() -> None:
    model = Scripted(add={"entries": ["# Coffee order\nOat flat white, no sugar"], "stores": ["remember"]})
    config = mem.memory_manager_config("u1", extraction=False)
    agent = Agent(model=model, memory_manager=config, callback_handler=None)

    async def run() -> None:
        await agent.invoke_async("Remember my coffee order: oat flat white, no sugar.")
        stores = _by_name(config)
        assert (await stores["remember"].search("flat white"))[0].content.startswith("# Coffee order")
        assert await stores["facts"].search("flat white") == []

    asyncio.run(run())


def test_facts_extraction_runs_on_aux_model_with_the_facts_prompt() -> None:
    main = Scripted()
    aux = Scripted(text=json.dumps([{"content": "# Answer style\nPrefers short answers"}]))
    config = mem.memory_manager_config("u1")
    agent = Agent(model=main, aux_model=aux, memory_manager=config, callback_handler=None)

    async def run() -> None:
        await agent.invoke_async("I prefer short answers.")
        await agent.memory_manager.flush()
        stores = _by_name(config)
        assert "Prefers short answers" in (await stores["facts"].search("short answers"))[0].content
        for name in ("remember", "feedback", "tasks"):
            assert await stores[name].search("short answers") == []

    asyncio.run(run())
    assert aux.calls == 1 and aux.systems == [mem.FACTS_PROMPT]


def test_injection_is_on_user_turns_and_never_includes_tasks() -> None:
    async def seed() -> None:
        manager = MemoryManager(**mem.memory_manager_config("u1", extraction=False))
        await manager.add("# Flights\nPrefers aisle seats on flights", MemoryAddOptions(stores=["facts"]))
        await manager.add("# Flights todo\nBook flights to Lisbon", MemoryAddOptions(stores=["tasks"]))

    asyncio.run(seed())
    model = Scripted()
    agent = Agent(model=model, memory_manager=mem.memory_manager_config("u1", extraction=False), callback_handler=None)
    asyncio.run(agent.invoke_async("Find me flights"))
    sent = _first_user_text(model.seen[0])
    assert '<entry source="facts">' in sent and "aisle seats" in sent
    assert "Lisbon" not in sent and 'source="tasks"' not in sent
    # Injection is ephemeral: nothing is written into the durable conversation.
    assert "<memory>" not in json.dumps(agent.messages)


def test_render_injection_is_the_sdk_block_minus_tasks() -> None:
    entries = [MemoryEntry("likes <tea>", "facts"), MemoryEntry("book flights", "tasks")]
    assert mem.render_injection(InjectionFormatContext(entries=entries)) == (
        '<memory>\n<entry source="facts">likes &lt;tea&gt;</entry>\n</memory>')
    assert mem.render_injection(InjectionFormatContext(entries=[MemoryEntry("x", "tasks")])) == ""


def test_writes_across_threads_land_in_one_file() -> None:
    stores = [mem.user_stores("u1", extraction=False)[1] for _ in range(8)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda i: asyncio.run(stores[i].add(f"# Topic\nline-{i}")), range(8)))
    text = asyncio.run(stores[0].search("Topic"))[0].content
    assert text.startswith("# Topic")


def test_directive_names_every_store_and_forbids_acting_on_tasks() -> None:
    assert all(f"- {name}:" in mem.MEMORY_DIRECTIVE for name in mem.CATEGORIES)
    assert "never your current" in mem.MEMORY_DIRECTIVE and "search_memory" in mem.MEMORY_DIRECTIVE


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
    added = client.post("/memory/entries", json={"store": "feedback", "content": "# Tone\nToo wordy; keep it short"})
    assert added.status_code == 200 and added.json()["key"] == "tone.md"
    listed = client.get("/memory/entries", params={"store": "feedback"}).json()["entries"]
    assert listed == [{"store": "feedback", "key": "tone.md", "content": "# Tone\nToo wordy; keep it short"}]
    assert client.put("/memory/entries", json={"store": "feedback", "key": "tone.md", "content": "# Tone\nShort"}).status_code == 200
    assert client.get("/memory/search", params={"q": "Short"}).json()["results"][0]["store"] == "feedback"
    counts = {s["name"]: s["count"] for s in client.get("/memory/stores").json()["stores"]}
    assert counts == {"facts": 0, "remember": 0, "feedback": 1, "tasks": 0}
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
