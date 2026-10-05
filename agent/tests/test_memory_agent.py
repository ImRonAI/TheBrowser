"""``recall``: a native strands_harness subagent over read-only views of the user's memory stores.

Real harness ``make_subagent``/``create_harness``/``resolve_memory``, real SDK agents, tool execution
and memory stores; only the Perplexity model builders are scripted.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from strands import Agent
from strands.models.model import Model
from strands.storage import InMemoryStorage
from strands.types.exceptions import ModelThrottledException

from agent.api.core import memory_agent, panel_storage
from agent.api.core.memory_agent import RecallConfig, create_recall_tool


class ChainModel(Model):
    """One recall-chain candidate: searches once with ``search_memories`` then answers."""

    instances: list[ChainModel] = []

    def __init__(self, model_id, *, fail=False):
        self.model_id, self.fail, self.calls, self.tool_specs = model_id, fail, 0, []
        ChainModel.instances.append(self)

    def get_config(self):
        return {"model_id": self.model_id, "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls += 1
        self.tool_specs = sorted(spec["name"] for spec in tool_specs or [])
        if self.fail:
            raise ModelThrottledException("offline throttle")
        yield {"messageStart": {"role": "assistant"}}
        if not any("toolResult" in b for m in messages for b in m["content"]):
            yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": "s1", "name": "search_memories"}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps({"query": "thai", "order": ["topic"], "topic": "LearnedAboutUser"})}}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "tool_use"}}
            return
        found = json.dumps([b for m in messages for b in m["content"] if "toolResult" in b])
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "- Prefers Thai food" if "Thai" in found else "n/a"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


class HostModel(Model):
    """The panel model: calls ``recall`` once, then answers."""

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
            yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": "r1", "name": "recall"}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps({"task": "what food does the user like"})}}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "tool_use"}}
            return
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "host answer"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


@pytest.fixture
def offline(monkeypatch):
    ChainModel.instances = []
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    monkeypatch.setattr(panel_storage, "_server_time", lambda: "2026-10-01T12:00:00")
    failing = {"m-fail"}

    def build_model(provider, model_id, effort=None, *, hosted_tools=True):
        assert (provider, effort, hosted_tools) == ("perplexity", None, False)
        return ChainModel(model_id, fail=model_id in failing)

    monkeypatch.setattr(memory_agent, "build_model", build_model)
    stores = lambda: panel_storage.create_memory_config("u", extraction=False)["stores"]  # noqa: E731
    return stores, failing


ENTRY = """<start_entry>
<topic_name>LearnedAboutUser<topic_name/>
<subject>Prefers Thai food<subject/>
<created_at>x<created_at/>
Loves Thai food.
<end_entry/>"""


def test_schema_exposes_only_task_and_agent_type(offline):
    stores, _ = offline
    tool = create_recall_tool(stores, RecallConfig(models=("m1",)))
    schema = tool.tool_spec["inputSchema"]["json"]
    assert tool.tool_name == "recall" and tool.tool_type == "agent"
    assert schema["required"] == ["task"]
    assert set(schema["properties"]) == {"task", "agent_type"}
    assert schema["properties"]["agent_type"]["enum"] == ["memory"]
    assert "memory" in tool.tool_spec["description"]
    assert create_recall_tool(stores, RecallConfig(enabled=False)) is None


def test_from_env(monkeypatch):
    monkeypatch.setenv("RON_MEMORY_AGENT_MODELS", " a/b , c/d ")
    monkeypatch.setenv("RON_MEMORY_AGENT", "0")
    config = RecallConfig.from_env()
    assert config.models == ("a/b", "c/d") and not config.enabled
    monkeypatch.delenv("RON_MEMORY_AGENT_MODELS")
    monkeypatch.delenv("RON_MEMORY_AGENT")
    assert RecallConfig.from_env() == RecallConfig()


def test_recall_streams_the_child_under_the_host_tool_use_id_and_reads_memory(offline):
    stores, _ = offline

    async def run():
        journal = next(s for s in stores() if s.name == "journal")
        await journal.add(ENTRY)
        host = Agent(model=HostModel(), tools=[create_recall_tool(stores, RecallConfig(models=("m1",)))],
                     callback_handler=None)
        streamed = []
        result = None
        async for event in host.stream_async("what should I cook"):
            if "tool_stream_event" in event:
                streamed.append(event["tool_stream_event"])
            if "result" in event:
                result = event["result"]
        return host, streamed, result

    host, streamed, result = asyncio.run(run())
    assert result.stop_reason == "end_turn"
    assert streamed and all(e["tool_use"]["toolUseId"] == "r1" for e in streamed)
    # The child's own tool call (search_memories) streamed as native ToolStreamEvents.
    assert any(e["data"].get("current_tool_use", {}).get("name") == "search_memories" for e in streamed)
    tool_results = [b["toolResult"] for m in host.messages for b in m["content"] if "toolResult" in b]
    assert tool_results[0]["status"] == "success" and "Prefers Thai food" in json.dumps(tool_results[0])


def test_child_tools_are_search_only_and_stores_are_read_only(offline):
    stores, _ = offline
    tool = create_recall_tool(stores, RecallConfig(models=("m1",)))
    spec = tool._resolve({"task": "t"})
    child = tool._builder(spec)
    try:
        from agent.api.core.a2a_tools import A2A_TOOL_NAMES
        names = set(child.tool_registry.registry)
        # Search tools only, plus the native A2A client tools every Ron agent carries.
        assert names == {"search_memories", "search_memory", *A2A_TOOL_NAMES}, names
        assert child.memory_manager is not None
        for store in child.memory_manager._stores:
            # strands_harness _ReadOnlyStore: no add, no extraction, no get_tools.
            assert not store.writable and store.extraction is None
            assert type(store).__name__ == "_ReadOnlyStore"
        assert child.memory_manager._add_stores == [] and child.memory_manager._extraction_stores == []
        assert child._session_manager is None
        # The child model is the ModelRouter over the chain: one request, one fresh candidate set.
        assert ChainModel.instances and ChainModel.instances[0].tool_specs == []
    finally:
        child.cleanup()


def test_fresh_child_per_call(offline):
    stores, _ = offline
    tool = create_recall_tool(stores, RecallConfig(models=("m1",)))

    async def run():
        host = Agent(model=HostModel(), tools=[tool], callback_handler=None)
        await host.invoke_async("first")
        first = len(ChainModel.instances)
        host2 = Agent(model=HostModel(), tools=[tool], callback_handler=None)
        await host2.invoke_async("second")
        return first, len(ChainModel.instances)

    first, second = asyncio.run(run())
    assert first == 1 and second == 2  # a new candidate chain (fresh child) per call


def test_failover_without_retry_backoff(offline):
    """A throttled first candidate fails over to the next immediately: ``retry_strategy=None`` on
    the child, ``FallbackStrategy`` on the router."""
    stores, _ = offline
    tool = create_recall_tool(stores, RecallConfig(models=("m-fail", "m2")))

    async def run():
        host = Agent(model=HostModel(), tools=[tool], callback_handler=None)
        return await asyncio.wait_for(host.invoke_async("go"), 10), host

    result, host = asyncio.run(run())
    assert result.stop_reason == "end_turn"
    failed, good = ChainModel.instances
    assert failed.model_id == "m-fail" and failed.calls == 1  # no retry backoff on the failing candidate
    assert good.model_id == "m2" and good.calls >= 1
    tool_results = [b["toolResult"] for m in host.messages for b in m["content"] if "toolResult" in b]
    assert tool_results[0]["status"] == "success"
