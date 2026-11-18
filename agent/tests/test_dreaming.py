"""The second brain, the journal and the dream (``agent/api/core/dreaming.py``) on the real Strands stack.

Real ``Agent``, ``MemoryManager``, ``ModelRouter``, extraction and ``FileMemoryStore`` over the panel
storage. Only the models are scripted and the embeddings are counted words, so nothing is billed.
"""

from __future__ import annotations

import asyncio
import json
from array import array
from typing import Any

import pytest
from strands import Agent
from strands.memory import MemoryManager
from strands.models.model import Model
from strands.storage import InMemoryStorage

from agent.api.core import dreaming, panel_storage
from agent.api.core.memory import memory_manager_config

WORDS = ("dolphin", "birthday", "gift", "css", "flight", "seat", "mom", "friday")


class Scripted(Model):
    """Answers each call with the next step of a script: tool calls, text, or an error."""

    def __init__(self, *steps: Any) -> None:
        self.steps, self.calls = list(steps), 0
        self.seen: list[str] = []

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "scripted", "stateful": False}

    def update_config(self, **kwargs: Any) -> None:
        pass

    async def structured_output(self, *args: Any, **kwargs: Any):  # type: ignore[override]
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):  # type: ignore[override]
        self.calls += 1
        self.seen.append(json.dumps(messages, default=str))
        step = self.steps.pop(0) if self.steps else "Done."
        if isinstance(step, Exception):
            raise step
        yield {"messageStart": {"role": "assistant"}}
        if isinstance(step, str):
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": step}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}
            return
        for index, (name, arguments) in enumerate(step):
            yield {"contentBlockStart": {"contentBlockIndex": index, "start": {"toolUse": {"toolUseId": f"t{self.calls}{index}", "name": name}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": index, "delta": {"toolUse": {"input": json.dumps(arguments)}}}}
            yield {"contentBlockStop": {"contentBlockIndex": index}}
        yield {"messageStop": {"stopReason": "tool_use"}}


@pytest.fixture(autouse=True)
def storage(monkeypatch: pytest.MonkeyPatch) -> InMemoryStorage:
    backend = InMemoryStorage()
    monkeypatch.setattr(panel_storage, "_storage", backend)
    monkeypatch.setattr(dreaming, "_timers", {})
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


def _dreams_with(monkeypatch: pytest.MonkeyPatch, *steps: Any) -> Scripted:
    model = Scripted(*steps)
    monkeypatch.setattr(dreaming, "dream_model", lambda: model)
    return model


async def _keys(prefix: str, user: str = "u1") -> list[str]:
    return await panel_storage.get_user_session_storage(user).list(prefix)


def test_every_agent_reads_the_whole_brain_and_writes_its_own_journal() -> None:
    brain, journal = dreaming.agent_memory("u1", "issue:42")
    assert (brain.name, brain.writable, journal.name) == ("brain", False, "journal/issue")
    assert dreaming.folder("Trip Planner") == "trip-planner"
    with pytest.raises(ValueError):
        dreaming.folder("!!!")


def test_journal_tool_notes_without_waiting_and_reads_back() -> None:
    async def run() -> None:
        journal = dreaming.agent_memory("u1", "panel")[1].get_tools()[0]
        assert journal.tool_name == "journal"
        assert await journal(entry="User's mom has a birthday on Friday") == "Noted."  # type: ignore[operator]
        await asyncio.gather(*dreaming._tasks)
        assert await journal() == "- User's mom has a birthday on Friday"  # type: ignore[operator]
        assert [key.rsplit("-", 1)[-1] for key in await _keys("memory/journal/panel/")] == ["note.md"]
        other = dreaming.agent_memory("u1", "build")[1].get_tools()[0]
        assert await other() == "Nothing jotted yet."  # type: ignore[operator]

    asyncio.run(run())


def test_each_turn_is_journaled_without_a_model_call_and_never_injected_back() -> None:
    main, aux = Scripted("Sure.", "Again."), Scripted()
    agent = Agent(model=main, aux_model=aux, memory_manager=memory_manager_config("u1"), callback_handler=None)

    async def run() -> None:
        await agent.invoke_async("My mom loves dolphins.")
        await agent.memory_manager.flush()
        (key,) = await _keys("memory/journal/panel/")
        assert key.endswith("-turn.md")
        text = (await panel_storage.get_user_session_storage("u1").read(key) or b"").decode()
        assert text == "user: My mom loves dolphins.\nassistant: Sure."
        await agent.invoke_async("What does my mom love? dolphins?")

    asyncio.run(run())
    assert aux.calls == 0 and main.calls == 2
    assert "<memory>" not in main.seen[1]


def test_brain_is_searched_by_meaning_and_embeds_a_topic_once(embedded: list[str]) -> None:
    async def run() -> None:
        storage = panel_storage.get_user_session_storage("u1")
        await storage.write("memory/brain/shared/mom.md", b"# Mom\nMom loves dolphin art. Birthday on 2026-11-20.")
        await storage.write("memory/brain/build/css.md", b"# CSS\nThe user wants plain CSS, no frameworks.")
        brain = dreaming.agent_memory("u1", "trip-planner")[0]
        found = await brain.search("a gift with a dolphin on it")
        assert found[0].content.startswith("# Mom") and found[0].metadata == {"path": "shared/mom.md", "score": 1.0}
        assert (await brain.search("css"))[0].content.startswith("# CSS")
        assert len(embedded) == 4  # two topics once, two queries
        await storage.write("memory/brain/build/css.md", b"# CSS\nThe user now wants a flight tracker in css.")
        await storage.delete("memory/brain/shared/mom.md")
        assert [entry.metadata["path"] for entry in await brain.search("flight")] == ["build/css.md"]
        assert len(embedded) == 6  # the edited topic and the query
        index = json.loads(await storage.read("memory/brain/vectors.json") or b"{}")
        assert len(index) == 1

    asyncio.run(run())


def test_an_empty_brain_or_a_failed_embedding_never_reaches_the_conversation(monkeypatch: pytest.MonkeyPatch,
                                                                              embedded: list[str]) -> None:
    async def run() -> None:
        manager = MemoryManager(**memory_manager_config("u1"))
        assert await manager.search("dolphin") == [] and embedded == []

        async def down(batch: list[str]) -> list[array[float]]:
            raise TimeoutError("mistral is down")

        monkeypatch.setattr(dreaming, "embed", down)
        await panel_storage.get_user_session_storage("u1").write("memory/brain/shared/mom.md", b"# Mom\ndolphin")
        assert await manager.search("dolphin") == []  # the manager logs the failed store and carries on

    asyncio.run(run())


def test_dream_files_the_journal_into_the_agent_and_shared_folders_as_one_version(monkeypatch: pytest.MonkeyPatch) -> None:
    model = _dreams_with(monkeypatch, [
        ("add_memory", {"entries": ["# Mom\nThe user's mom loves dolphins.\nHer birthday is 2026-11-20."], "stores": ["brain/shared"]}),
        ("add_memory", {"entries": ["# Gift ideas\nThe user asked for gift ideas under $50."], "stores": ["brain/panel"]}),
    ])

    async def run() -> None:
        journal = dreaming.agent_memory("u1", "panel")[1]
        await journal.add("User's mom loves dolphins; birthday Friday")
        await journal.add_messages([{"role": "user", "content": [{"text": "Gift ideas under $50?"}]}])
        version = await dreaming.dream("u1")
        assert version is not None
        await asyncio.gather(*dreaming._tasks)  # the changed topics are embedded in the background
        assert await _keys("memory/journal/") == []
        assert await _keys("memory/brain/") == ["memory/brain/panel/gift-ideas.md", "memory/brain/shared/mom.md",
                                                 "memory/brain/vectors.json"]
        storage = panel_storage.get_user_session_storage("u1")
        before = json.loads(await storage.read(f"memory/dreams/{version}.json") or b"{}")
        assert before == {"memory/brain/shared/mom.md": None, "memory/brain/panel/gift-ideas.md": None}
        # A different agent, and one that did not exist when the dream ran, finds it at once.
        found = await dreaming.agent_memory("u1", "A brand new agent")[0].search("dolphin gift for mom")
        assert found[0].content.startswith("# Mom")
        assert await dreaming.dream("u1") is None  # nothing journaled, nothing to do

    asyncio.run(run())
    sent = json.loads(model.seen[0])[0]["content"][0]["text"]
    assert sent.startswith("Agent: panel\nIts own store: brain/panel\nTopics in brain/panel: none yet\n")
    assert "-note]\nUser's mom loves dolphins; birthday Friday" in sent and "-turn]\nuser: Gift ideas under $50?" in sent


def test_dream_rewrites_and_deletes_topics_and_undo_puts_them_back(monkeypatch: pytest.MonkeyPatch) -> None:
    _dreams_with(monkeypatch, [
        ("add_memory", {"entries": ["# Mom\nThe user's mom loves dolphins.\nHer birthday is 2026-11-21."], "stores": ["brain/shared"]}),
        ("add_memory", {"entries": ["# Old plan"], "stores": ["brain/shared"]}),
    ])

    async def run() -> None:
        storage = panel_storage.get_user_session_storage("u1")
        await storage.write("memory/brain/shared/mom.md", b"# Mom\nHer birthday is 2026-11-20.")
        await storage.write("memory/brain/shared/old-plan.md", b"# Old plan\nFly to Lisbon.")
        await dreaming.agent_memory("u1", "search")[1].add("Correction: the birthday is the 21st. Lisbon is off.")
        version = await dreaming.dream("u1")
        assert (await storage.read("memory/brain/shared/mom.md") or b"").decode().endswith("2026-11-21.")
        assert await storage.read("memory/brain/shared/old-plan.md") is None
        assert await dreaming.undo_dream("u1") == version
        assert await storage.read("memory/brain/shared/mom.md") == b"# Mom\nHer birthday is 2026-11-20."
        assert await storage.read("memory/brain/shared/old-plan.md") == b"# Old plan\nFly to Lisbon."
        assert await _keys("memory/dreams/") == [] and await dreaming.undo_dream("u1") is None

    asyncio.run(run())


def test_a_topic_is_rewritten_only_after_it_was_read() -> None:
    async def run() -> None:
        storage = panel_storage.get_user_session_storage("u1")
        await storage.write("memory/brain/shared/mom.md", b"# Mom\nHer birthday is 2026-11-20.")
        before: dict[str, str | None] = {}
        topics = dreaming.Topics("u1", "shared", before)
        with pytest.raises(ValueError, match="Read it with search_memory"):
            await topics.add("# Mom\nLoves dolphins.")
        with pytest.raises(ValueError, match="markdown heading"):
            await topics.add("###\nno name")
        assert before == {} and len(await topics.search("mom birthday")) == 1
        await topics.add("# Mom\nLoves dolphins.\nHer birthday is 2026-11-20.")
        await topics.add("# Mom\nLoves dolphins.")
        assert before == {"memory/brain/shared/mom.md": "# Mom\nHer birthday is 2026-11-20."}  # as it was before the dream

    asyncio.run(run())


def test_dream_models_fall_back_in_the_owners_order(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent.api.core import panel_agent

    built: list[tuple[str, str]] = []
    models = [Scripted(RuntimeError("down")), Scripted(RuntimeError("down")),
              Scripted([("add_memory", {"entries": ["# Seat\nPrefers an aisle seat."], "stores": ["brain/shared"]})])]

    def build_model(provider: str, model_id: str) -> Scripted:
        built.append((provider, model_id))
        return models[len(built) - 1]

    monkeypatch.setattr(panel_agent, "build_model", build_model)
    monkeypatch.setattr(panel_agent, "provider_api_key", lambda provider: "key")

    async def run() -> None:
        await dreaming.agent_memory("u1", "panel")[1].add("Prefers an aisle seat")
        assert await dreaming.dream("u1") is not None

    asyncio.run(run())
    assert built == [("nim", "minimaxai/minimax-m3.1-flash"), ("mistral", "zai-glm-5-3-flash"),
                     ("mistral", "mistral-medium-latest")]
    assert [model.calls for model in models] == [1, 1, 2]


def test_a_failed_dream_keeps_that_agents_journal_and_still_files_the_others(monkeypatch: pytest.MonkeyPatch) -> None:
    _dreams_with(monkeypatch, RuntimeError("every model is down"),
                 [("add_memory", {"entries": ["# Seat\nPrefers an aisle seat."], "stores": ["brain/search"]})])

    async def run() -> None:
        await dreaming.agent_memory("u1", "build")[1].add("User wants plain css")
        await dreaming.agent_memory("u1", "search")[1].add("Prefers an aisle seat")
        assert await dreaming.dream("u1") is not None
        assert [key.split("/")[2] for key in await _keys("memory/journal/")] == ["build"]
        assert "memory/brain/search/seat.md" in await _keys("memory/brain/")

    asyncio.run(run())


def test_a_dream_whose_writes_all_fail_keeps_the_journal(monkeypatch: pytest.MonkeyPatch) -> None:
    _dreams_with(monkeypatch, [("add_memory", {"content": "# Seat\nPrefers an aisle seat."})], "Filed.")

    async def run() -> None:
        await dreaming.agent_memory("u1", "search")[1].add("Prefers an aisle seat")
        assert await dreaming.dream("u1") is None
        assert len(await _keys("memory/journal/")) == 1

    asyncio.run(run())


def test_a_long_journal_is_filed_in_batches(monkeypatch: pytest.MonkeyPatch) -> None:
    model = _dreams_with(monkeypatch)
    monkeypatch.setattr(dreaming, "DREAM_BATCH_CHARS", 60)

    async def run() -> None:
        journal = dreaming.agent_memory("u1", "panel")[1]
        for number in range(3):
            await journal.add(f"note {number} " + "x" * 40)
        assert await dreaming.dream("u1") is None  # the model kept nothing
        assert await _keys("memory/journal/") == []

    asyncio.run(run())
    assert model.calls == 3


def test_the_dream_runs_once_the_user_has_been_idle(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent.api.core import config

    model = _dreams_with(monkeypatch)
    monkeypatch.setattr(config, "RON_MEMORY_IDLE_SECONDS", 0.05)

    async def run() -> None:
        journal = dreaming.agent_memory("u1", "panel")[1]
        await journal.add("first")
        await asyncio.sleep(0.03)
        await journal.add("second")  # activity restarts the countdown
        await asyncio.sleep(0.03)
        assert model.calls == 0
        await asyncio.sleep(0.1)
        await asyncio.gather(*dreaming._tasks)
        assert model.calls == 1 and await _keys("memory/journal/") == []

    asyncio.run(run())


def test_a_review_corrects_any_agents_topic_and_teaches_every_later_dream(monkeypatch: pytest.MonkeyPatch) -> None:
    model = _dreams_with(monkeypatch,
        [("add_memory", {"entries": ["# Travel\nThe user flies from SLC."], "stores": ["brain/panel"]})],
        "Done.",
        [("search_memory", {"query": "travel"})],
        [("add_memory", {"entries": ["# Travel\nThe user flies from Ogden."], "stores": ["brain/panel"]}),
         ("add_memory", {"entries": ["# Airports\nAsk before storing an airport."], "stores": ["brain/dreaming"]})],
    )

    async def run() -> None:
        await dreaming.agent_memory("u1", "panel")[1].add("flies from SLC")
        version = await dreaming.dream("u1")
        assert version is not None
        await dreaming.dream_feedback("u1", version, [("memory/brain/panel/travel.md", False, "Ogden, not SLC")])
        assert await dreaming.dream("u1") is not None
        storage = panel_storage.get_user_session_storage("u1")
        assert (await storage.read("memory/brain/panel/travel.md") or b"").decode() == "# Travel\nThe user flies from Ogden."
        await dreaming.agent_memory("u1", "panel")[1].add("likes aisle seats")
        await dreaming.dream("u1")

    asyncio.run(run())
    review = json.loads(model.seen[2])[0]["content"][0]["text"]
    assert "Agent: dreaming\nIts own store: brain/dreaming\n" in review and "Topics in brain/panel: travel" in review
    assert "- memory/brain/panel/travel.md: wrong. Ogden, not SLC" in review
    later = json.loads(model.seen[-1])[0]["content"][0]["text"]
    assert later.startswith("How this user wants their memory kept, from their reviews of earlier dreams:\n# Airports")


def test_a_countdown_cut_by_a_restart_is_resumed(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent.api.core import config

    model = _dreams_with(monkeypatch)
    monkeypatch.setattr(config, "RON_MEMORY_IDLE_SECONDS", 0.05)

    async def run() -> None:
        await dreaming.agent_memory("u1", "panel")[1].add("first")
        await asyncio.gather(*dreaming._tasks)
        assert await panel_storage.get_panel_storage().list("panel/dreams-pending/")
        for timer in dreaming._timers.values():  # the process stops
            timer.cancel()
        dreaming._timers.clear()
        await dreaming.resume_dreams()
        await asyncio.sleep(0.1)
        await asyncio.gather(*dreaming._tasks)
        assert model.calls == 1 and await _keys("memory/journal/") == []
        assert await panel_storage.get_panel_storage().list("panel/dreams-pending/") == []

    asyncio.run(run())


def test_a_subagent_inherits_its_parents_search_and_journal() -> None:
    tools = {tool.tool_name: tool for tool in dreaming.agent_memory_tools("u1", "panel")}
    assert set(tools) == {"search_memory", "journal"}
    assert dreaming.inherited_memory({**tools, "shell": tools["journal"]}) == [tools["search_memory"], tools["journal"]]


def test_an_outside_agent_journals_in_its_own_folder_over_mcp() -> None:
    import httpx
    from fastmcp import Client
    from fastmcp.client.transports import StreamableHttpTransport

    from agent.api.core import memory_mcp

    app = memory_mcp.server.http_app(path="/mcp")

    def client(headers: dict[str, str]) -> Client[StreamableHttpTransport]:
        def factory(headers: dict[str, str] | None = None, timeout: httpx.Timeout | None = None,
                    auth: httpx.Auth | None = None, **_: Any) -> httpx.AsyncClient:
            return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ren", headers=headers,
                                     timeout=timeout, auth=auth)
        return Client(StreamableHttpTransport("http://ren/mcp", headers=headers, httpx_client_factory=factory))

    async def run() -> None:
        async with app.router.lifespan_context(app):
            async with client({"X-Ren-User": "u1", "X-Ren-Agent": "ElevenLabs Voice"}) as voice:
                assert (await voice.call_tool("journal", {"entry": "prefers texts to calls"})).data == "Noted."
                await asyncio.gather(*dreaming._tasks)
                assert "prefers texts to calls" in (await voice.call_tool("journal", {})).data
            async with client({"X-Ren-User": "u1"}) as nameless:
                assert (await nameless.call_tool("journal", {"entry": "x"}, raise_on_error=False)).is_error

    asyncio.run(run())
    assert [key.split("/")[2] for key in asyncio.run(_keys("memory/journal/"))] == ["elevenlabs-voice"]
