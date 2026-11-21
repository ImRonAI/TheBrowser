"""The second brain, the memory tool, the journal and the dream (``agent/api/core/dreaming.py``) on the real Strands
stack.

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


def _dreams_with(monkeypatch: pytest.MonkeyPatch, *steps: Any) -> Scripted:
    model = Scripted(*steps)
    monkeypatch.setattr(dreaming, "dream_model", lambda: model)
    return model


async def _keys(prefix: str, user: str = "u1") -> list[str]:
    return await panel_storage.get_user_session_storage(user).list(prefix)


async def _read(key: str, user: str = "u1") -> str | None:
    data = await panel_storage.get_user_session_storage(user).read(key)
    return None if data is None else data.decode()


async def _review(version: str, wrong: dict[str, str] | None = None) -> list[str]:
    record = json.loads(await _read(f"memory/dreams/{version}.json") or "{}")
    return await dreaming.apply_dream("u1", version, [(key, key not in (wrong or {}), (wrong or {}).get(key, ""))
                                                      for key in record["topics"]])


def test_every_agent_reads_the_whole_brain_and_writes_its_own_folder_and_journal() -> None:
    brain, journal = dreaming.agent_memory("u1", "issue:42")
    assert (brain.name, brain.writable, journal.name) == ("brain", False, "journal/issue")
    assert [tool.tool_name for tool in brain.get_tools()] == ["memory"]
    assert [tool.tool_name for tool in journal.get_tools()] == ["journal"]
    assert dreaming.folder("Trip Planner") == "trip-planner"
    with pytest.raises(ValueError):
        dreaming.folder("!!!")


def test_the_memory_tool_works_as_anthropics_docs_specify() -> None:
    async def run() -> None:
        command = dreaming.memory_command
        assert (await command("u1", "panel", "view", "/memories")).endswith("excluding hidden items:\n")
        assert await command("u1", "panel", "create", "/memories/panel/seat.md",
                             file_text="# Seat\nPrefers an aisle seat. (2026-11-20, panel, confirmed)") == \
            "File created successfully at: /memories/panel/seat.md"
        with pytest.raises(ValueError, match="already exists"):
            await command("u1", "panel", "create", "/memories/panel/seat.md", file_text="x")
        assert await command("u1", "panel", "str_replace", "/memories/panel/seat.md", old_str="aisle",
                             new_str="window") == "The memory file has been edited."
        with pytest.raises(ValueError, match="did not appear verbatim"):
            await command("u1", "panel", "str_replace", "/memories/panel/seat.md", old_str="aisle", new_str="x")
        await command("u1", "panel", "insert", "/memories/panel/seat.md", insert_line=1, insert_text="Flies from Ogden.")
        assert await command("u1", "panel", "view", "/memories/panel/seat.md") == (
            "Here's the content of /memories/panel/seat.md with line numbers:\n     1\t# Seat\n     2\tFlies from Ogden.\n"
            "     3\tPrefers an window seat. (2026-11-20, panel, confirmed)")
        assert await command("u1", "panel", "view", "/memories/panel/seat.md", view_range=[2, 2]) == (
            "Here's the content of /memories/panel/seat.md with line numbers:\n     2\tFlies from Ogden.")
        await command("u1", "panel", "rename", old_path="/memories/panel/seat.md", new_path="/memories/panel/travel.md")
        assert (await command("u1", "build", "view", "/memories")).endswith("\n/memories/panel\n/memories/panel/travel.md")
        for path, error in (("/memories/shared/mom.md", "read-only"), ("/memories/../secrets.env", "outside"),
                            ("/memories/panel/%2e%2e/x.md", "outside"), ("/etc/passwd", "outside"),
                            ("/memories/panel/Travel Plans.md", "name a memory file")):
            with pytest.raises(ValueError, match=error):
                await command("u1", "panel", "create", path, file_text="x")
        with pytest.raises(ValueError, match="at most 100 kB"):
            await command("u1", "panel", "create", "/memories/panel/big.md", file_text="x" * 100_001)
        with pytest.raises(ValueError, match="does not exist"):
            await command("u1", "panel", "view", "/memories/panel/none.md")
        assert await command("u1", "panel", "delete", "/memories/panel/travel.md") == \
            "Successfully deleted /memories/panel/travel.md"
        assert await _keys("memory/brain/") == []

    asyncio.run(run())


def test_every_model_call_carries_the_index_and_each_turn_is_journaled(embedded: list[str]) -> None:
    main, aux = Scripted("Sure.", "Again."), Scripted()
    agent = Agent(model=main, aux_model=aux, memory_manager=dreaming.brain_memory("u1", "panel"), callback_handler=None)

    async def run() -> None:
        storage = panel_storage.get_user_session_storage("u1")
        await storage.write("memory/brain/shared/mom.md", b"# Mom\nMom loves dolphin art.")
        await storage.write("memory/brain/dreaming/airports.md", b"# Airports\nAsk first.")
        await agent.invoke_async("My mom loves dolphins.")
        await agent.memory_manager.flush()
        (key,) = await _keys("memory/journal/panel/")
        assert key.endswith("-turn.md")
        assert await _read(key) == "user: My mom loves dolphins.\nassistant: Sure."
        await agent.invoke_async("What does my mom love?")

    asyncio.run(run())
    assert aux.calls == 0 and main.calls == 2
    assert "<memory_index>" in main.seen[1] and "- /memories/shared/mom.md" in main.seen[1]
    assert "dolphin art" not in main.seen[1] and "airports" not in main.seen[1]
    assert embedded == []  # the index costs no embedding


def test_the_index_is_capped_like_claude_codes_memory_md() -> None:
    async def run() -> None:
        storage = panel_storage.get_user_session_storage("u1")
        for number in range(205):
            await storage.write(f"memory/brain/shared/topic-{number:03}.md", b"# Topic")
        index = await dreaming.memory_index("u1")
        assert index.count("\n- ") == 199 and index.endswith("... and 5 more: view /memories to see them all.")
        assert (await dreaming.index_block("u1")).startswith("<memory_index>\n")

    asyncio.run(run())


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


def test_a_dream_waits_for_approval_and_keeps_the_journal_as_transcripts(monkeypatch: pytest.MonkeyPatch) -> None:
    model = _dreams_with(monkeypatch, [
        ("add_memory", {"entries": ["# Mom\nThe user's mom loves dolphins. (2026-11-20, panel, confirmed)"],
                        "stores": ["brain/shared"]}),
        ("add_memory", {"entries": ["# Gift ideas\nGift ideas under $50. (2026-11-20, panel, confirmed)"],
                        "stores": ["brain/panel"]}),
    ])

    async def run() -> None:
        journal = dreaming.agent_memory("u1", "panel")[1]
        await journal.add("User's mom loves dolphins; birthday Friday")
        await journal.add_messages([{"role": "user", "content": [{"text": "Gift ideas under $50?"}]}])
        version = await dreaming.dream("u1")
        assert version is not None
        assert await _keys("memory/journal/") == [] and len(await _keys("memory/transcripts/panel/")) == 2
        assert await _keys("memory/brain/") == []  # nothing reaches memory before the user approves
        assert await dreaming.dream("u1") is None  # nothing journaled
        pending = await dreaming.pending_dream("u1")
        assert pending is not None and pending[0] == version
        assert pending[1]["topics"]["memory/brain/shared/mom.md"]["before"] is None
        assert await _review(version) == ["memory/brain/shared/mom.md", "memory/brain/panel/gift-ideas.md"]
        await asyncio.gather(*dreaming._tasks)  # the approved topics are embedded in the background
        assert await dreaming.pending_dream("u1") is None
        found = await dreaming.agent_memory("u1", "A brand new agent")[0].search("dolphin gift for mom")
        assert found[0].content.startswith("# Mom")

    asyncio.run(run())
    sent = json.loads(model.seen[0])[0]["content"][0]["text"]
    assert sent.startswith("Agent: panel\nIts own store: brain/panel\nTopics in brain/panel: none yet\n")
    assert "-note]\nUser's mom loves dolphins; birthday Friday" in sent and "-turn]\nuser: Gift ideas under $50?" in sent


def test_only_approved_topics_that_still_read_as_before_reach_memory_and_undo_puts_them_back(
        monkeypatch: pytest.MonkeyPatch) -> None:
    _dreams_with(monkeypatch, [
        ("add_memory", {"entries": ["# Mom\nHer birthday is 2026-11-21."], "stores": ["brain/shared"]}),
        ("add_memory", {"entries": ["# Old plan"], "stores": ["brain/shared"]}),
        ("add_memory", {"entries": ["# Seat\nAisle."], "stores": ["brain/shared"]}),
    ])

    async def run() -> None:
        storage = panel_storage.get_user_session_storage("u1")
        await storage.write("memory/brain/shared/mom.md", b"# Mom\nHer birthday is 2026-11-20.")
        await storage.write("memory/brain/shared/old-plan.md", b"# Old plan\nFly to Lisbon.")
        await dreaming.agent_memory("u1", "search")[1].add("Birthday is the 21st. Lisbon is off. Aisle seat.")
        version = await dreaming.dream("u1")
        assert version is not None
        await storage.write("memory/brain/shared/old-plan.md", b"# Old plan\nFly to Porto.")  # edited meanwhile
        applied = await _review(version, wrong={"memory/brain/shared/seat.md": "I never said that"})
        assert applied == ["memory/brain/shared/mom.md"]
        assert await _read("memory/brain/shared/mom.md") == "# Mom\nHer birthday is 2026-11-21."
        assert await _read("memory/brain/shared/old-plan.md") == "# Old plan\nFly to Porto."
        assert await _read("memory/brain/shared/seat.md") is None
        (note,) = await _keys("memory/journal/dreaming/")
        assert "- memory/brain/shared/seat.md: wrong. I never said that" in (await _read(note) or "")
        assert await dreaming.undo_dream("u1") == version
        assert await _read("memory/brain/shared/mom.md") == "# Mom\nHer birthday is 2026-11-20."
        assert await dreaming.undo_dream("u1") is None

    asyncio.run(run())


def test_dismissing_a_dream_changes_nothing() -> None:
    async def run() -> None:
        storage = panel_storage.get_user_session_storage("u1")
        record = {"status": "pending", "topics": {"memory/brain/shared/mom.md": {"before": None, "after": "# Mom\nx"}},
                  "applied": []}
        await storage.write("memory/dreams/20261120T000000000000.json", json.dumps(record).encode())
        assert await dreaming.apply_dream("u1", "20261120T000000000000", []) == []
        assert await dreaming.pending_dream("u1") is None and await _keys("memory/brain/") == []

    asyncio.run(run())


def test_a_topic_is_rewritten_only_after_it_was_read() -> None:
    async def run() -> None:
        storage = panel_storage.get_user_session_storage("u1")
        await storage.write("memory/brain/shared/mom.md", b"# Mom\nHer birthday is 2026-11-20.")
        changes: dict[str, str | None] = {}
        topics = dreaming.Proposal("u1", "shared", changes)
        with pytest.raises(ValueError, match="Read it with search_memory"):
            await topics.add("# Mom\nLoves dolphins.")
        with pytest.raises(ValueError, match="markdown heading"):
            await topics.add("###\nno name")
        assert changes == {} and len(await topics.search("mom birthday")) == 1
        await topics.add("# Mom\nLoves dolphins.\nHer birthday is 2026-11-20.")
        await topics.add("# Mom\nLoves dolphins.")
        assert changes == {"memory/brain/shared/mom.md": "# Mom\nLoves dolphins."}
        assert (await topics.search("mom"))[0].content == "# Mom\nLoves dolphins."  # the dream reads its own change
        assert await _read("memory/brain/shared/mom.md") == "# Mom\nHer birthday is 2026-11-20."

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
        version = await dreaming.dream("u1")
        assert version is not None
        assert [key.split("/")[2] for key in await _keys("memory/journal/")] == ["build"]
        assert await _review(version) == ["memory/brain/search/seat.md"]

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
        assert await _keys("memory/journal/") == [] and len(await _keys("memory/transcripts/")) == 3

    asyncio.run(run())
    assert model.calls == 3


def test_one_dreamer_runs_a_due_dream_and_waits_for_review_before_the_next(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent.api.core import config

    model = _dreams_with(monkeypatch,
                         [("add_memory", {"entries": ["# Seat\nAisle."], "stores": ["brain/panel"]})])
    monkeypatch.setattr(config, "RON_MEMORY_IDLE_SECONDS", 0.05)

    async def run() -> None:
        journal = dreaming.agent_memory("u1", "panel")[1]
        await journal.add("first")
        await asyncio.gather(*dreaming._tasks)
        await dreaming.dream_due()
        assert model.calls == 0  # not idle yet
        await asyncio.sleep(0.06)
        await dreaming.dream_due()
        calls = model.calls
        assert calls and await dreaming.pending_dream("u1") is not None
        await journal.add("second")
        await asyncio.gather(*dreaming._tasks)
        await asyncio.sleep(0.06)
        await dreaming.dream_due()
        assert model.calls == calls  # the first dream still waits for review
        assert await panel_storage.get_panel_storage().list("panel/dreams-pending/")

    asyncio.run(run())


def test_a_review_teaches_every_later_dream(monkeypatch: pytest.MonkeyPatch) -> None:
    model = _dreams_with(monkeypatch,
        [("add_memory", {"entries": ["# Travel\nThe user flies from SLC."], "stores": ["brain/panel"]})],
        "Done.",
        [("add_memory", {"entries": ["# Travel\nThe user flies from Ogden."], "stores": ["brain/panel"]}),
         ("add_memory", {"entries": ["# Airports\nAsk before storing an airport."], "stores": ["brain/dreaming"]})],
    )

    async def run() -> None:
        await dreaming.agent_memory("u1", "panel")[1].add("flies from SLC")
        version = await dreaming.dream("u1")
        assert version is not None
        assert await _review(version, wrong={"memory/brain/panel/travel.md": "Ogden, not SLC"}) == []
        second = await dreaming.dream("u1")
        assert second is not None and sorted(await _review(second)) == ["memory/brain/dreaming/airports.md",
                                                                        "memory/brain/panel/travel.md"]
        assert await _read("memory/brain/panel/travel.md") == "# Travel\nThe user flies from Ogden."
        await dreaming.agent_memory("u1", "panel")[1].add("likes aisle seats")
        await dreaming.dream("u1")

    asyncio.run(run())
    review = json.loads(model.seen[2])[0]["content"][0]["text"]
    assert "Agent: dreaming\nIts own store: brain/dreaming\n" in review
    assert "- memory/brain/panel/travel.md: wrong. Ogden, not SLC" in review
    later = json.loads(model.seen[-1])[0]["content"][0]["text"]
    assert later.startswith("How this user wants their memory kept, from their reviews of earlier dreams:\n# Airports")


def test_a_subagent_inherits_its_parents_search_and_memory_tool() -> None:
    tools = {tool.tool_name: tool for tool in dreaming.agent_memory_tools("u1", "panel")}
    assert set(tools) == {"search_memory", "memory", "journal"}
    assert dreaming.inherited_memory({**tools, "shell": tools["memory"]}) == [tools[name] for name in ("search_memory", "memory", "journal")]


def test_an_outside_agent_writes_its_own_folder_over_mcp() -> None:
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
                created = await voice.call_tool("memory", {"command": "create", "path": "/memories/elevenlabs-voice/calls.md",
                                                           "file_text": "# Calls\nPrefers texts to calls."})
                assert created.data == "File created successfully at: /memories/elevenlabs-voice/calls.md"
                denied = await voice.call_tool("memory", {"command": "create", "path": "/memories/shared/calls.md",
                                                          "file_text": "x"}, raise_on_error=False)
                assert denied.is_error
                assert (await voice.call_tool("journal", {"entry": "Asked to text Dana."})).data == "Noted."
                assert (await voice.call_tool("journal", {})).data == "- Asked to text Dana."
            async with client({"X-Ren-User": "u1"}) as nameless:
                assert (await nameless.call_tool("memory", {"command": "view", "path": "/memories"},
                                                 raise_on_error=False)).is_error

    asyncio.run(run())
    assert asyncio.run(_keys("memory/brain/")) == ["memory/brain/elevenlabs-voice/calls.md"]


def test_the_panels_old_stores_fold_into_the_brain_once() -> None:
    from agent.api.core import migrate_brain

    async def run() -> None:
        storage = panel_storage.get_user_session_storage("u1")
        await storage.write("memory/facts/coffee.md", b"# Coffee\nDrinks oat lattes.")
        await storage.write("memory/remember/coffee.md", b"# Coffee\nNo sugar.")
        await storage.write("memory/feedback/tone.md", b"# Tone\nShorter replies.")
        await storage.write("memory/people/dana-kim.md", b"# Dana Kim\n- relationship: friend")
        await storage.write("memory/brain/people/dana-kim.md", b"# Dana Kim\n- contact: dana@example.com")
        await migrate_brain.migrate()
        await migrate_brain.migrate()  # once only
        assert await _read("memory/brain/shared/coffee.md") == "# Coffee\nDrinks oat lattes.\nNo sugar."
        assert await _read("memory/brain/panel/tone.md") == "# Tone\nShorter replies."
        assert await _read("memory/brain/people/dana-kim.md") == \
            "# Dana Kim\n- contact: dana@example.com\n- relationship: friend"
        assert await _read("memory/facts/coffee.md") == "# Coffee\nDrinks oat lattes."  # the old store stays

    asyncio.run(run())
