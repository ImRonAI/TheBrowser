"""Offline tests for the shared background Memory Agent (recall + dreaming).

Only model construction is replaced. The native ``ModelRouter``/``FallbackStrategy``,
``MemoryManager``, ``Plugin`` hook discovery, ``create_harness`` composition and the
``InvokeModelStage`` injection boundary are real.
"""

from __future__ import annotations

import asyncio
import copy
import json
from dataclasses import dataclass, field

import pytest
from strands import Agent
from strands.hooks import AfterToolCallEvent, BeforeInvocationEvent, MessageAddedEvent
from strands.injection.types import InjectionContext
from strands.memory import MemoryManager
from strands.models.model import Model
from strands.storage import InMemoryStorage


@dataclass
class Script:
    """What the scripted memory model does on each cycle."""

    inject: str = "n/a"
    search_first: bool = True
    fail: bool = False
    delay: float = 0.0
    calls: list = field(default_factory=list)


class MemoryModel(Model):
    """Scripted recall model: optional ``search_memory`` then exactly one ``inject_memory``."""

    def __init__(self, script: Script, label: str = "scripted") -> None:
        self.script = script
        self.label = label

    def get_config(self):
        return {"model_id": self.label, "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.script.calls.append({"label": self.label, "messages": copy.deepcopy(messages),
                                  "tools": sorted(spec["name"] for spec in tool_specs or [])})
        if self.script.fail:
            raise RuntimeError(f"{self.label} unavailable")
        if self.script.delay:
            await asyncio.sleep(self.script.delay)
        results = [b["toolResult"] for m in messages for b in m["content"] if "toolResult" in b]
        searched = any("search_memory" in json.dumps(r) or True for r in results) and results
        yield {"messageStart": {"role": "assistant"}}
        if self.script.search_first and not searched:
            name, inputs = "search_memory", {"query": "birthday dinner"}
        else:
            name, inputs = "inject_memory", {"content": self.script.inject}
        yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": f"use-{len(self.script.calls)}", "name": name}}}}
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "tool_use"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}, "metrics": {"latencyMs": 1}}}


class HostModel(Model):
    """The parent/think model: records exactly what it was given."""

    def __init__(self):
        self.calls = []

    def get_config(self):
        return {"model_id": "host", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls.append(copy.deepcopy(messages))
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "host answer"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


@pytest.fixture
def memory_manager():
    from strands.vended_memory_stores.file_memory_store import FileMemoryStore

    store = FileMemoryStore(name="panel-memory", storage=InMemoryStorage(), extraction=False)
    return MemoryManager(stores=[store], search_tool_config=True, add_tool_config={"wait_for_writes": True},
                         injection=False)


@pytest.fixture
def seeded(memory_manager):
    asyncio.run(memory_manager.add("# Mom's birthday\nMom's birthday dinner is next Friday; she loves Thai food."))
    return memory_manager


def _messages(text: str):
    return [{"role": "user", "content": [{"text": text}]}]


def test_memory_agent_builds_router_over_perplexity_chain(monkeypatch, memory_manager):
    """S3 shape: create_harness receives a native ModelRouter with FallbackStrategy over the configured chain."""
    from strands.models import ModelRouter
    from strands.models.routing.router import FallbackStrategy

    from agent.api.core import memory_agent

    built: list[str] = []

    def fake_build_model(provider, model_id, effort=None, *, hosted_tools=True):
        assert provider == "perplexity" and hosted_tools is False
        built.append(model_id)
        return MemoryModel(Script(), label=model_id)

    monkeypatch.setattr(memory_agent, "build_model", fake_build_model)
    monkeypatch.setenv("RON_MEMORY_AGENT_MODELS", "a/one,b/two")
    config = memory_agent.MemoryAgentConfig.from_env()
    agent = memory_agent.MemoryAgent(user_id="u1", memory_manager=memory_manager, config=config).agent
    assert built == ["a/one", "b/two"]
    assert isinstance(agent._model_router, ModelRouter)
    assert isinstance(agent._model_router._strategy, FallbackStrategy)
    assert [c.model.label for c in agent._model_router.candidates] == ["a/one", "b/two"]
    assert agent.model is agent._model_router.candidates[0].model
    assert sorted(agent.tool_names) == ["add_memory", "inject_memory", "journal", "search_memories", "search_memory"]
    assert agent.name == "Ron Memory"


def test_recall_hit_injects_one_trailing_message(monkeypatch, seeded):
    """S1: a relevant memory becomes exactly one ephemeral trailing user message."""
    from agent.api.core import memory_agent

    script = Script(inject="• Mom's birthday dinner is next Friday (loves Thai)")
    monkeypatch.setattr(memory_agent, "build_model", lambda *a, **k: MemoryModel(script))
    monkeypatch.setenv("RON_MEMORY_AGENT_MODELS", "x/fast")
    recall = memory_agent.RecallPlugin(memory_agent.MemoryAgent(
        user_id="u1", memory_manager=seeded, config=memory_agent.MemoryAgentConfig.from_env()))
    host = HostModel()
    parent = Agent(model=host, plugins=[recall], callback_handler=None, load_tools_from_directory=False)

    asyncio.run(parent.invoke_async("help me plan mom's birthday dinner"))

    seen = host.calls[-1]
    assert seen[-1]["role"] == "user" and seen[-1]["content"][0]["text"].startswith("<recall")
    assert "Thai" in seen[-1]["content"][0]["text"]
    # Durable history has the user ask and the assistant reply only — no injected text.
    assert [m["role"] for m in parent.messages] == ["user", "assistant"]
    assert "recall" not in json.dumps(parent.messages)
    # The scripted recall model searched before injecting.
    assert [c["tools"] for c in script.calls][0] == ["add_memory", "inject_memory", "journal", "search_memories", "search_memory"]


def test_recall_na_injects_nothing(monkeypatch, memory_manager):
    """S2: the literal n/a means no injection at all."""
    from agent.api.core import memory_agent

    script = Script(inject="n/a", search_first=False)
    monkeypatch.setattr(memory_agent, "build_model", lambda *a, **k: MemoryModel(script))
    monkeypatch.setenv("RON_MEMORY_AGENT_MODELS", "x/fast")
    recall = memory_agent.RecallPlugin(memory_agent.MemoryAgent(
        user_id="u1", memory_manager=memory_manager, config=memory_agent.MemoryAgentConfig.from_env()))
    host = HostModel()
    parent = Agent(model=host, plugins=[recall], callback_handler=None, load_tools_from_directory=False)

    asyncio.run(parent.invoke_async("what's the weather"))

    assert [m["role"] for m in host.calls[-1]] == ["user"]
    assert host.calls[-1][-1]["content"][0]["text"] == "what's the weather"


def test_recall_falls_back_when_first_model_fails(monkeypatch, seeded):
    """S3: the native router switches to the next candidate on a model exception."""
    from agent.api.core import memory_agent

    bad = Script(fail=True)
    good = Script(inject="• Mom loves Thai food", search_first=False)
    models = {"a/bad": MemoryModel(bad, "a/bad"), "b/good": MemoryModel(good, "b/good")}
    monkeypatch.setattr(memory_agent, "build_model", lambda p, mid, *a, **k: models[mid])
    monkeypatch.setenv("RON_MEMORY_AGENT_MODELS", "a/bad,b/good")
    recall = memory_agent.RecallPlugin(memory_agent.MemoryAgent(
        user_id="u1", memory_manager=seeded, config=memory_agent.MemoryAgentConfig.from_env()))
    host = HostModel()
    parent = Agent(model=host, plugins=[recall], callback_handler=None, load_tools_from_directory=False)

    asyncio.run(parent.invoke_async("dinner ideas for mom"))

    assert bad.calls and good.calls, "both candidates were asked"
    assert "Thai" in host.calls[-1][-1]["content"][0]["text"]


def test_recall_timeout_fails_open(monkeypatch, memory_manager):
    """A slow memory agent never delays or breaks the host; injection is simply skipped."""
    from agent.api.core import memory_agent

    script = Script(inject="late", search_first=False, delay=1.0)
    monkeypatch.setattr(memory_agent, "build_model", lambda *a, **k: MemoryModel(script))
    monkeypatch.setenv("RON_MEMORY_AGENT_MODELS", "x/slow")
    monkeypatch.setenv("RON_MEMORY_AGENT_TIMEOUT_S", "0.05")
    recall = memory_agent.RecallPlugin(memory_agent.MemoryAgent(
        user_id="u1", memory_manager=memory_manager, config=memory_agent.MemoryAgentConfig.from_env()))
    host = HostModel()
    parent = Agent(model=host, plugins=[recall], callback_handler=None, load_tools_from_directory=False)

    asyncio.run(parent.invoke_async("anything"))

    assert [m["role"] for m in host.calls[-1]] == ["user"]
    assert "late" not in json.dumps(host.calls)


def test_hooks_prewarm_once_per_cycle(monkeypatch, memory_manager):
    """Any of the trigger hooks schedules a recall; identical conversation state is deduplicated."""
    from agent.api.core import memory_agent

    script = Script(inject="n/a", search_first=False)
    monkeypatch.setattr(memory_agent, "build_model", lambda *a, **k: MemoryModel(script))
    monkeypatch.setenv("RON_MEMORY_AGENT_MODELS", "x/fast")
    recall = memory_agent.RecallPlugin(memory_agent.MemoryAgent(
        user_id="u1", memory_manager=memory_manager, config=memory_agent.MemoryAgentConfig.from_env()))
    hook_types = {type(h) if not callable(h) else h for h in recall.hooks}
    assert len(recall.hooks) >= 3

    async def run():
        parent = Agent(model=HostModel(), plugins=[recall], callback_handler=None, load_tools_from_directory=False)
        messages = _messages("same state")
        for _ in range(3):
            recall._schedule(messages)
        await asyncio.sleep(0)
        assert len(recall._pending) == 1
        text = await recall.render(InjectionContext(messages=messages, state=parent.state, agent=parent))
        assert text is None
        assert len(script.calls) == 1

    asyncio.run(run())


def test_think_child_receives_recall_plugin(monkeypatch, memory_manager):
    """S4: the think child is built with the same RecallPlugin instance as the parent."""
    from agent.api.core import memory_agent
    from agent.api.core.panel_tools import ChildSpec, create_child_agent

    script = Script(inject="n/a", search_first=False)
    monkeypatch.setattr(memory_agent, "build_model", lambda *a, **k: MemoryModel(script))
    monkeypatch.setenv("RON_MEMORY_AGENT_MODELS", "x/fast")
    recall = memory_agent.RecallPlugin(memory_agent.MemoryAgent(
        user_id="u1", memory_manager=memory_manager, config=memory_agent.MemoryAgentConfig.from_env()))

    child = asyncio.run(create_child_agent(
        ChildSpec(name="think", system_prompt="x", tools=()), model_factory=lambda name: HostModel(),
        plugins=[recall]))
    assert any(p is recall for p in child._plugin_registry._plugins.values())
