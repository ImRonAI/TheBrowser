"""Dreaming is the SDK's native extraction on the long-term store (``agent/api/core/dreaming.py``).

Real ``MemoryManager``/``ExtractionCoordinator``/``ModelExtractor`` and stores; only the models are
scripted. The aux model plays the dreaming extractor and the host model journals via ``add_memory``.
"""

from __future__ import annotations

import asyncio
import json

from strands import Agent
from strands.memory import MemoryManager, MemoryMessageFilter
from strands.models.model import Model
from strands.storage import InMemoryStorage

from agent.api.core import dreaming, panel_storage

JOURNAL_ENTRY = """<start_entry>
<topic_name>LearnedAboutUser<topic_name/>
<subject>Prefers Thai food<subject/>
<created_at>placeholder<created_at/>
The user's favourite cuisine is Thai.
<end_entry/>"""

DREAMED = """# LearnedAboutUser | Prefers Thai food
<start_entry>
<topic_name>LearnedAboutUser<topic_name/>
<subject>Prefers Thai food<subject/>
<created_at>{created}<created_at/>
<tags>preference, food, family, home, fact, habit, decision, style, recurring, learning</tags>
Favourite cuisine: Thai.
<end_entry/>"""


class HostModel(Model):
    """Journals once with add_memory, then answers."""

    def get_config(self):
        return {"model_id": "host", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        yield {"messageStart": {"role": "assistant"}}
        if not any("toolResult" in b for m in messages for b in m["content"]):
            yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": "j1", "name": "add_memory"}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps({"entries": [JOURNAL_ENTRY]})}}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "tool_use"}}
            return
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Noted."}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


class AuxModel(Model):
    """The dreaming extractor: proves it saw the journal add_memory call and emits a tagged entry."""

    def __init__(self):
        self.prompts, self.transcripts = [], []

    def get_config(self):
        return {"model_id": "aux", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.prompts.append(system_prompt)
        transcript = "".join(b.get("text", "") for m in messages for b in m["content"])
        self.transcripts.append(transcript)
        yield {"messageStart": {"role": "assistant"}}
        text = json.dumps([{"content": DREAMED.format(created="2026-10-01T12:00:00")}]) if "add_memory" in transcript else "[]"
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": text}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


def test_dream_prompt_and_extraction_config():
    config = dreaming.dream_extraction(InMemoryStorage(), ("a", "b"))
    assert isinstance(config["extractor"], dreaming.DreamExtractor)
    assert config["filter"] == MemoryMessageFilter(exclude=[])
    prompt = dreaming.dream_prompt(("alpha", "beta"))
    assert "# <topic_name> | <subject>" in prompt and "alpha, beta" in prompt
    assert all(topic in prompt for topic in panel_storage.ENTRY_TOPICS)
    assert "newest" in prompt.lower() and "REUSE" in prompt


def test_tag_vocabulary_from_env(monkeypatch):
    monkeypatch.setenv("RON_MEMORY_TAGS", "x, y ,,z")
    assert dreaming.tag_vocabulary() == ("x", "y", "z")
    monkeypatch.delenv("RON_MEMORY_TAGS")
    assert dreaming.tag_vocabulary() == dreaming.DEFAULT_TAGS


def test_flush_consolidates_the_journal_into_tagged_long_term_entries(monkeypatch):
    """Journal add_memory -> journal store only. flush() runs the dreaming extractor on
    agent.aux_model over a transcript that still contains the toolUse (exclude=[]), and the
    tagged ``# Topic | Subject`` entry lands in panel-memory; the journal receives no extraction."""
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    monkeypatch.setattr(panel_storage, "_server_time", lambda: "2026-10-01T12:00:00")
    aux = AuxModel()
    config = panel_storage.create_memory_config("u")
    long_term, journal = config["stores"][0], config["stores"][1]
    agent = Agent(model=HostModel(), aux_model=aux, memory_manager=MemoryManager(**config), callback_handler=None)

    async def run():
        result = await agent.invoke_async("I love Thai food")
        assert result.stop_reason == "end_turn"
        journal_keys = await journal._storage.list("")
        assert journal_keys == ["learnedaboutuser/20261001T120000-prefers-thai-food.md"]
        assert await long_term._storage.list("") == []  # not until dreaming
        await agent.memory_manager.flush()
        long_keys = await long_term._storage.list("")
        return journal_keys, long_keys, await journal._storage.list("")

    journal_keys, long_keys, journal_after = asyncio.run(run())
    assert len(aux.prompts) == 1 and "memory consolidator" in aux.prompts[0]
    # exclude=[]: the extractor's transcript carries the add_memory call's journal entry verbatim.
    assert "[journaled with add_memory]" in aux.transcripts[0]
    assert "<subject>Prefers Thai food<subject/>" in aux.transcripts[0]
    assert long_keys == ["learnedaboutuser-prefers-thai-food.md"]
    text = asyncio.run(long_term._storage.read(long_keys[0])).decode()
    assert text.startswith("# LearnedAboutUser | Prefers Thai food")
    entry = panel_storage.parse_entries(text)[0]
    assert entry.topic == "LearnedAboutUser" and entry.created_at == "2026-10-01T12:00:00"
    assert 10 <= len(entry.tags) <= 12 and set(entry.tags) <= set(dreaming.DEFAULT_TAGS)
    assert journal_after == journal_keys  # journal store: no extraction writes


def test_second_dream_pass_lists_existing_headings_and_appends_newest_last(monkeypatch):
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    aux = AuxModel()
    config = panel_storage.create_memory_config("u")
    long_term = config["stores"][0]

    async def run():
        await long_term.add(DREAMED.format(created="2026-09-01T00:00:00"))
        manager = MemoryManager(**config)
        agent = Agent(model=HostModel(), aux_model=aux, memory_manager=manager, callback_handler=None)
        await agent.invoke_async("Thai again please")
        await manager.flush()
        key = "learnedaboutuser-prefers-thai-food.md"
        return (await long_term._storage.read(key)).decode()

    text = asyncio.run(run())
    assert "Existing topics" in aux.prompts[0] and "learnedaboutuser prefers thai food" in aux.prompts[0]
    created = [entry.created_at for entry in panel_storage.parse_entries(text)]
    assert created == ["2026-09-01T00:00:00", "2026-10-01T12:00:00"]  # correction appended under the original
