"""Offline integration tests against installed Strands, not a replacement loop."""

import asyncio
import sys
import json
import os
import threading
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from strands import Agent, tool
from strands.agent.agent_result import AgentResult
from strands.hooks.events import AfterToolsEvent
from strands.models.model import Model
from strands.multiagent.base import MultiAgentResult, NodeResult, Status
from strands.multiagent.graph import Graph
from strands.telemetry.metrics import EventLoopMetrics
from strands.tools.mcp import MCPClient
from strands.vended_plugins.skills import AgentSkills

from agent.api.core.panel_a2a import (
    create_a2a_agent_factory,
    create_panel_a2a_client,
    create_panel_a2a_server,
    mount_panel_a2a,
)
from agent.api.core.panel_tools import (
    accept_browser_elicitation,
    ChildSpec,
    GraphSpec,
    LoopCallbackBridge,
    ManagedMCP,
    PanelToolCatalog,
    SwarmSpec,
    CORE_TOOL_NAMES,
    VENDORED_PACKAGE,
    build_core_tools,
    create_tool_catalog,
    create_formation_tool,
    create_skill_tool,
    create_subagent_tool,
    list_mcp_tools,
    serializable_event,
    skills_from_env,
)


class OfflineModel(Model):
    """A deterministic model exercising native agents, graphs and A2A streams."""

    def __init__(self, name="offline", *, entered=None, release=None):
        self.name = name
        self.calls = []
        self.entered = entered
        self.release = release

    def get_config(self):
        return {"model_id": self.name}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield  # pragma: no cover

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls.append({"messages": list(messages), "tools": tool_specs or [], "prompt": system_prompt})
        if self.entered:
            self.entered.set()
        if self.release:
            await self.release.wait()
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": self.name}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}, "metrics": {"latencyMs": 1}}}


@tool
async def alpha(value: str = "a") -> str:
    """Return an alpha value."""
    return value


@tool
async def beta() -> str:
    """Return a beta value."""
    return "b"


async def call_tool(value, inputs, *, agent=None):
    events = [
        event.as_dict()
        async for event in value.stream(
            {"name": value.tool_name, "toolUseId": "test-use", "input": inputs},
            {"agent": agent} if agent else {},
        )
    ]
    return events, events[-1]["tool_result"]


def test_catalog_rejects_sync_imports_duplicates():
    @tool
    def sync_tool() -> str:
        """A forbidden synchronous application tool."""
        return "no"

    with pytest.raises(TypeError, match="must be async"):
        PanelToolCatalog(tools=[sync_tool])
    with pytest.raises(TypeError, match="explicit AgentTool"):
        PanelToolCatalog(tools=["strands_tools.shell"])
    with pytest.raises(ValueError, match="Duplicate"):
        PanelToolCatalog(tools=[alpha, alpha])


def test_catalog_refresh_only_at_safe_boundary_and_removes_dynamic_ghosts():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        current = [alpha]
        loader = AsyncMock(side_effect=lambda: list(current))
        catalog = PanelToolCatalog(loader=loader)
        model = OfflineModel(entered=entered, release=release)
        agent = Agent(model=model, tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        alpha.mark_dynamic()
        agent.tool_registry.dynamic_tools[alpha.tool_name] = alpha
        invocation = asyncio.create_task(agent.invoke_async("first"))
        await entered.wait()
        current[:] = [beta]
        await asyncio.to_thread(catalog.request_refresh)
        assert "alpha" in agent.tool_registry.registry
        assert "beta" not in agent.tool_registry.registry
        assert loader.await_count == 1
        release.set()
        await invocation
        await agent.invoke_async("second")
        assert "alpha" not in agent.tool_registry.registry
        assert "alpha" not in agent.tool_registry.dynamic_tools
        assert "beta" in agent.tool_registry.registry
        assert [spec["name"] for spec in model.calls[-1]["tools"]] == ["beta"]
        assert loader.await_count == 2
        agent.cleanup()
        agent.cleanup()

    asyncio.run(scenario())


def test_refresh_failure_is_atomic_and_retried():
    async def scenario():
        current = [alpha]
        loader = AsyncMock(side_effect=lambda: list(current))
        catalog = PanelToolCatalog(loader=loader)
        agent = Agent(model=OfflineModel(), tools=[catalog, beta], callback_handler=None)
        catalog.bind(agent)
        current[:] = [beta]
        catalog.request_refresh()
        with pytest.raises(ValueError, match="conflicts"):
            await agent.invoke_async("collision")
        assert agent.tool_registry.registry == {"alpha": alpha, "beta": beta}
        current[:] = []
        await agent.invoke_async("retry")
        assert agent.tool_registry.registry == {"beta": beta}
        agent.cleanup()

    asyncio.run(scenario())


def test_refresh_requested_during_discovery_is_not_lost():
    async def scenario():
        count = 0
        async def loader():
            nonlocal count
            count += 1
            if count == 2:
                catalog.request_refresh()
            return [alpha]

        catalog = PanelToolCatalog(loader=loader)
        agent = Agent(model=OfflineModel(), tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        catalog.request_refresh()
        await agent.invoke_async("one")
        await agent.invoke_async("two")
        assert count == 3
        agent.cleanup()

    asyncio.run(scenario())


def test_managed_mcp_native_consumer_lifecycle_and_refresh():
    async def scenario():
        client = MCPClient(lambda: None)
        client.load_tools = AsyncMock(return_value=[alpha])
        add, remove = client.add_consumer, client.remove_consumer
        client.add_consumer = Mock(wraps=add)
        client.remove_consumer = Mock(wraps=remove)
        refresh = AsyncMock(return_value=[beta])
        catalog = PanelToolCatalog(managed_mcp=[ManagedMCP(client, refresh)])
        agent = Agent(model=OfflineModel(), tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        assert len(client._consumers) == 1
        assert client.add_consumer.call_count == 1
        client.load_tools.assert_awaited_once()
        catalog.request_refresh()
        await agent.invoke_async("refresh")
        assert agent.tool_registry.registry == {"beta": beta}
        refresh.assert_awaited_once()
        agent.cleanup()
        agent.cleanup()
        assert not client._consumers
        assert client.remove_consumer.call_count == 1

    asyncio.run(scenario())


def test_managed_mcp_partial_startup_cleanup():
    first, second = MCPClient(lambda: None), MCPClient(lambda: None)
    first.load_tools = AsyncMock(return_value=[alpha])
    second.load_tools = AsyncMock(side_effect=RuntimeError("offline"))
    catalog = PanelToolCatalog(managed_mcp=[ManagedMCP(first), ManagedMCP(second)])
    with pytest.raises(ValueError, match="offline"):
        Agent(model=OfflineModel(), tools=[catalog], callback_handler=None)
    assert not first._consumers
    assert not second._consumers


def test_mcp_fresh_listing_pagination():
    class Page(list):
        def __init__(self, values, token):
            super().__init__(values)
            self.pagination_token = token

    async def scenario():
        client = MCPClient(lambda: None)
        client.list_tools_sync = Mock(side_effect=[Page([alpha], "next"), Page([beta], None)])
        assert await list_mcp_tools(client, prefix="p", tool_filters={"allowed": ["alpha"]}) == [alpha, beta]
        assert client.list_tools_sync.call_args_list[-1].args == ("next",)
        assert client.list_tools_sync.call_args.kwargs["prefix"] == "p"

    asyncio.run(scenario())


def test_skills_environment_native_plugin_and_explicit_child_assignments(tmp_path):
    directory = tmp_path / "example"
    directory.mkdir()
    (directory / "SKILL.md").write_text(
        "---\nname: example\ndescription: Example skill\nallowed-tools: [shell]\n---\nUse alpha to help.\n"
    )
    plugin = skills_from_env({"PANEL_SKILLS_DIRS": f"{tmp_path}{os.pathsep}{tmp_path}"})
    assert isinstance(plugin, AgentSkills)
    assert skills_from_env({}) is None
    with pytest.raises(ValueError, match="does not exist"):
        skills_from_env({"PANEL_SKILLS_DIR": str(tmp_path / "missing")})

    async def scenario():
        models = []
        def factory(name):
            value = OfflineModel(name)
            models.append(value)
            return value

        parent = Agent(model=OfflineModel(), plugins=[plugin], callback_handler=None)
        assert [skill.name for skill in plugin.get_available_skills(parent)] == ["example"]
        value = create_skill_tool(skills=plugin, model_factory=factory, tool_assignments={"example": [alpha]})
        _, result = await call_tool(value, {"skill_name": "example", "prompt": "help"}, agent=parent)
        assert result["status"] == "success"
        assert {spec["name"] for spec in models[0].calls[0]["tools"]} == {"alpha", "skills"}
        assert "Use alpha" in models[0].calls[0]["prompt"]
        assert parent.messages == []
        assert plugin.get_activated_skills(parent) == []
        denied = create_skill_tool(skills=plugin, model_factory=factory, tool_assignments={})
        _, result = await call_tool(denied, {"skill_name": "example", "prompt": "help"}, agent=parent)
        assert result["status"] == "error"
        assert len(models) == 1
        parent.cleanup()

    asyncio.run(scenario())


@pytest.mark.parametrize("kind", ["graph", "swarm", "nested"])
def test_native_formations_execute_each_stream_once_and_serialize(kind):
    async def scenario():
        models = []
        def factory(name):
            value = OfflineModel(name)
            models.append(value)
            return value

        one = ChildSpec("one", "First child", ())
        two = ChildSpec("two", "Second child", ())
        if kind == "swarm":
            spec = SwarmSpec("team", (one, two))
            expected = 1  # No model-requested handoff; native swarm finishes at entry.
        elif kind == "nested":
            spec = GraphSpec("team", {"inner": GraphSpec("inner", {"one": one}), "two": two}, (("inner", "two"),))
            expected = 2
        else:
            spec = GraphSpec("team", {"one": one, "two": two}, (("one", "two"),))
            expected = 2
        value = create_formation_tool(spec, model_factory=factory, description="Offline formation")
        events, result = await call_tool(value, {"prompt": "do work"})
        assert result["status"] == "success", result
        payload = result["content"][0]["json"]["result"]
        recovered = MultiAgentResult.from_dict(payload)
        assert recovered.status is Status.COMPLETED
        assert sum(len(model.calls) for model in models) == expected
        json.dumps(serializable_event(events))
        progress = [event["tool_stream_event"]["data"] for event in events if "tool_stream_event" in event]
        assert any(item.get("event", {}).get("type") == "multiagent_node_start" for item in progress)
        if kind == "nested":
            assert isinstance(recovered.results["inner"].result, MultiAgentResult)
        # A second tool invocation constructs fresh children, with fresh histories.
        await call_tool(value, {"prompt": "new work"})
        assert sum(len(model.calls) for model in models) == expected * 2
        assert all(len(model.calls) <= 1 for model in models)

    asyncio.run(scenario())


def test_graph_runs_more_than_twenty_nodes():
    async def scenario():
        names = [f"step_{index}" for index in range(25)]
        spec = GraphSpec("long_graph",
            {name: ChildSpec(name, "Complete this step", ()) for name in names},
            tuple(zip(names, names[1:])), (names[0],))
        assert spec.max_node_executions is spec.execution_timeout is spec.node_timeout is None
        models = []

        def factory(name):
            model = OfflineModel(name)
            models.append(model)
            return model

        value = create_formation_tool(spec, model_factory=factory, description="Long graph")
        _, result = await call_tool(value, {"prompt": "Complete every step"})
        assert result["status"] == "success", result
        assert sum(len(model.calls) for model in models) == 25

    asyncio.run(scenario())


@pytest.mark.parametrize("spec_type, fields", [
    (GraphSpec, ("max_node_executions", "execution_timeout", "node_timeout")),
    (SwarmSpec, ("max_handoffs", "max_iterations", "execution_timeout", "node_timeout")),
])
def test_formation_limits_are_opt_in(spec_type, fields):
    spec = spec_type("team", {} if spec_type is GraphSpec else ())
    assert all(getattr(spec, field) is None for field in fields)
    for field in fields:
        limited = spec_type("team", {} if spec_type is GraphSpec else (), **{field: 2})
        assert getattr(limited, field) == 2
        with pytest.raises(ValueError, match="must be positive"):
            spec_type("team", {} if spec_type is GraphSpec else (), **{field: 0})


def test_formation_missing_result_does_not_reexecute(monkeypatch):
    calls = 0
    async def broken(self, prompt):
        nonlocal calls
        calls += 1
        yield {"type": "multiagent_node_start", "node_id": "one"}

    monkeypatch.setattr(Graph, "stream_async", broken)
    monkeypatch.setattr(Graph, "invoke_async", AsyncMock(side_effect=AssertionError("must not rerun")))
    async def scenario():
        value = create_formation_tool(
            GraphSpec("team", {"one": ChildSpec("one", "First", ())}),
            model_factory=OfflineModel,
            description="Test",
        )
        _, result = await call_tool(value, {"prompt": "go"})
        assert result["status"] == "error"
        assert "without a MultiAgentResult" in result["content"][0]["text"]
        assert calls == 1

    asyncio.run(scenario())


def test_checkpoint_config_rejected_and_nested_checkpoint_not_reported_success(monkeypatch):
    with pytest.raises(ValueError, match="checkpoints are unsupported"):
        ChildSpec("bad", "Bad", (), checkpointing=True)

    checkpoint_result = AgentResult("checkpoint", {"role": "assistant", "content": []}, EventLoopMetrics(), {})
    inner = MultiAgentResult(status=Status.COMPLETED, results={"child": NodeResult(checkpoint_result, status=Status.COMPLETED)})
    outer = MultiAgentResult(status=Status.COMPLETED, results={"inner": NodeResult(inner, status=Status.COMPLETED)})
    async def checkpoint_stream(self, prompt):
        yield {"type": "multiagent_result", "result": outer}

    monkeypatch.setattr(Graph, "stream_async", checkpoint_stream)
    async def scenario():
        value = create_formation_tool(
            GraphSpec("team", {"one": ChildSpec("one", "First", ())}),
            model_factory=OfflineModel,
            description="Test",
        )
        _, result = await call_tool(value, {"prompt": "go"})
        assert result["status"] == "error"
        assert "checkpoint" in result["content"][0]["json"]["error"]
        assert result["content"][0]["json"]["result"]["type"] == "multiagent_result"

    asyncio.run(scenario())


def test_native_as_tool_isolation():
    async def scenario():
        model = OfflineModel()
        value = await create_subagent_tool(ChildSpec("delegate", "Help", (alpha,)), model_factory=lambda _: model)
        assert value.tool_type == "agent"
        assert value.agent._session_manager is None
        assert not value.agent._checkpointing
        for prompt in ["one", "two"]:
            _, result = await call_tool(value, {"input": prompt})
            assert result["status"] == "success"
        assert len(model.calls) == 2
        assert len(model.calls[0]["messages"]) == len(model.calls[1]["messages"]) == 1
        value.agent.cleanup()

    asyncio.run(scenario())


def test_formation_cancellation_joins_native_stream_before_provider_cleanup():
    async def scenario():
        entered, stopped = asyncio.Event(), asyncio.Event()
        class BlockingModel(OfflineModel):
            async def stream(self, *args, **kwargs):
                entered.set()
                try:
                    await asyncio.Future()
                    yield {}
                finally:
                    stopped.set()

        client = MCPClient(lambda: None)
        client.load_tools = AsyncMock(return_value=[alpha])
        original_remove = client.remove_consumer
        def remove(consumer_id, **kwargs):
            assert stopped.is_set(), "Provider must outlive active child execution"
            original_remove(consumer_id, **kwargs)

        client.remove_consumer = Mock(side_effect=remove)
        value = create_formation_tool(
            GraphSpec("team", {"child": ChildSpec("child", "Help", (client,))}),
            model_factory=lambda _: BlockingModel(), description="Cancelable formation",
        )
        task = asyncio.create_task(call_tool(value, {"prompt": "go"}))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert stopped.is_set()
        assert not client._consumers
        assert client.remove_consumer.called

    asyncio.run(scenario())


def test_formation_build_failure_cleans_previously_created_children():
    async def scenario():
        client = MCPClient(lambda: None)
        client.load_tools = AsyncMock(return_value=[alpha])
        def model_factory(name):
            if name == "bad":
                raise RuntimeError("model unavailable")
            return OfflineModel(name)

        value = create_formation_tool(
            GraphSpec("team", {"one": ChildSpec("one", "Help", (client,)), "bad": ChildSpec("bad", "Bad", ())}),
            model_factory=model_factory, description="Failure cleanup",
        )
        _, result = await call_tool(value, {"prompt": "go"})
        assert result["status"] == "error"
        assert "model unavailable" in result["content"][0]["text"]
        assert not client._consumers

    asyncio.run(scenario())


def test_callback_bridge_thread_to_loop_drains_and_reports_errors():
    async def scenario():
        owner = threading.get_ident()
        seen = []
        async def handler(event):
            assert threading.get_ident() == owner
            seen.append(event)
            if event.get("fail"):
                raise ValueError("delivery failed")

        bridge = LoopCallbackBridge(handler)
        await asyncio.to_thread(lambda: [bridge(index=index) for index in range(10)])
        bridge(fail=True)
        bridge(index=10)
        with pytest.raises(ExceptionGroup, match="delivery failed"):
            await bridge.aclose()
        bridge(index=11)
        assert [item["index"] for item in seen if "index" in item] == list(range(11))

    asyncio.run(scenario())


def test_a2a_native_mount_client_stream_and_context_isolation():
    from a2a.client import ClientConfig
    from a2a.types import TaskArtifactUpdateEvent
    from fastapi import FastAPI

    async def scenario():
        built = []
        base = create_a2a_agent_factory(
            model_factory=OfflineModel,
            tools_factory=lambda _: [],
            name="Panel",
            description="Offline panel",
            system_prompt="Help",
        )
        def factory(context_id):
            agent = base(context_id)
            built.append((context_id, agent))
            return agent

        integration = create_panel_a2a_server(agent_factory=factory, http_url="http://test/a2a")
        app = FastAPI()
        assert not mount_panel_a2a(app, integration)
        assert mount_panel_a2a(app, integration, enabled=True)
        with pytest.raises(ValueError, match="already mounted"):
            mount_panel_a2a(app, integration, enabled=True)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
            client = create_panel_a2a_client("http://test/a2a", client_config=ClientConfig(httpx_client=http))
            card = await client.get_agent_card()
            assert card.capabilities.streaming
            assert card.url == "http://test/a2a/"
            results = [event async for event in client.stream_async("hello")]
            assert isinstance(results[-1]["result"], AgentResult)
            assert results[-1]["result"].stop_reason == "end_turn"
            artifacts = [
                event["event"][1] for event in results
                if event.get("type") == "a2a_stream" and isinstance(event["event"], tuple)
                and isinstance(event["event"][1], TaskArtifactUpdateEvent)
            ]
            assert artifacts and artifacts[-1].last_chunk
            assert len({update.artifact.artifact_id for update in artifacts}) == 1
            # Explicit context ids exercise native server history isolation.
            async def send(context, text):
                response = await http.post("/a2a/", json={
                    "jsonrpc": "2.0", "id": text, "method": "message/send",
                    "params": {"message": {"role": "user", "messageId": text, "contextId": context,
                                           "parts": [{"kind": "text", "text": text}]}},
                })
                assert response.status_code == 200
                assert "error" not in response.json(), response.text

            await send("context-a", "a-one")
            await send("context-b", "b-one")
            await send("context-a", "a-two")
        agents = dict(built)
        assert agents["context-a"] is not agents["context-b"]
        a_text = json.dumps(agents["context-a"].messages)
        b_text = json.dumps(agents["context-b"].messages)
        assert "a-one" in a_text and "a-two" in a_text and "b-one" not in a_text
        assert "b-one" in b_text and "a-one" not in b_text
        executor = integration.server.request_handler.agent_executor
        assert executor.enable_a2a_compliant_streaming is True
        await integration.aclose()

    asyncio.run(scenario())


def test_a2a_factory_reuse_and_checkpoint_rejected():
    shared = Agent(model=OfflineModel(), name="shared", description="shared", callback_handler=None)
    integration = create_panel_a2a_server(agent_factory=lambda _: shared, http_url="http://test/a2a")
    async def scenario():
        executor = integration.server.request_handler.agent_executor
        with pytest.raises(ValueError, match="reused"):
            await executor._acquire_context_agent("new")
        await integration.aclose()

    asyncio.run(scenario())
    with pytest.raises(ValueError, match="checkpoint"):
        create_panel_a2a_server(
            agent_factory=lambda _: Agent(model=OfflineModel(), checkpointing=True, callback_handler=None),
            http_url="http://test/a2a",
        )


def test_tool_catalog_editor_search_load_and_use_in_same_invocation(tmp_path, monkeypatch):
    """Editor -> tool_catalog search -> tool_catalog load -> invoke, in ONE native invocation.

    Exercises the mandated core set + tool_catalog: the model writes a tool into
    the library with `editor`, finds it via the catalog, loads it, and calls it in
    the very next cycle. Loading publishes at the AfterTools boundary.
    """
    monkeypatch.setenv("BYPASS_TOOL_CONSENT", "true")
    library = tmp_path / "library"; (library / "generated").mkdir(parents=True)
    (library / "research").mkdir(); (library / "research" / "errors.py").write_text("class NotConfiguredError(Exception): pass\n")
    (library / "research" / "perplexity_search_api.py").write_text(
        'from strands import tool\n@tool\nasync def perplexity_search_api(query: str) -> dict:\n    """Offline stand-in."""\n    return {"query": query}\n')
    source = '''from strands import tool
from ..research.errors import NotConfiguredError  # relative import must resolve
@tool
def generated(value: str) -> str:
    """Return a generated value."""
    return value + " generated"
'''

    class CreationModel(OfflineModel):
        async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
            index = len(self.calls)
            self.calls.append({"tools": tool_specs, "messages": list(messages)})
            steps = [
                ("editor", {"command": "create", "path": str(library / "generated" / "generated.py"), "file_text": source}),
                ("tool_catalog", {"action": "search", "query": "generated"}),
                ("tool_catalog", {"action": "load", "name": "generated"}),
                ("generated", {"value": "hello"}),
            ]
            yield {"messageStart": {"role": "assistant"}}
            if index < len(steps):
                name, inputs = steps[index]
                assert name in {spec["name"] for spec in tool_specs}, (name, sorted(s["name"] for s in tool_specs))
                yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": f"step-{index}", "name": name}}}}
                yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
                yield {"contentBlockStop": {"contentBlockIndex": 0}}
                yield {"messageStop": {"stopReason": "tool_use"}}
            else:
                assert "hello generated" in json.dumps(messages)
                yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "done"}}}
                yield {"contentBlockStop": {"contentBlockIndex": 0}}
                yield {"messageStop": {"stopReason": "end_turn"}}
            yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}, "metrics": {"latencyMs": 1}}}

    async def scenario():
        path_before = list(sys.path)
        catalog = PanelToolCatalog()
        core = build_core_tools(library)
        catalog.add_tools([*core, create_tool_catalog(catalog, library)])
        model = CreationModel()
        agent = Agent(model=model, tools=[catalog], callback_handler=None,
                      background_tasks={"agentic": ["*"], "never": ["editor", "tool_catalog", "mcp_client"], "wait_for_completion": True})
        catalog.bind(agent)
        assert set(CORE_TOOL_NAMES) <= set(agent.tool_registry.registry)
        result = await agent.invoke_async("Create and use a tool")
        assert str(result).strip() == "done"
        assert len(model.calls) == 5
        assert "generated" in agent.tool_registry.dynamic_tools
        # Vendored module imported under the synthetic package; library dir never on sys.path;
        # installed strands_tools distribution untouched.
        assert f"{VENDORED_PACKAGE}.generated.generated" in sys.modules
        assert f"{VENDORED_PACKAGE}.research.errors" in sys.modules
        assert sys.path == path_before
        assert "site-packages" in sys.modules["strands_tools"].__file__
        assert catalog.child_tools(["generated"])[0] is agent.tool_registry.registry["generated"]
        with pytest.raises(ValueError, match="separate child catalog"):
            catalog.child_tools(["tool_catalog"])
        agent.cleanup()

    asyncio.run(scenario())


def test_tool_catalog_list_describe_collisions_and_import_errors(tmp_path):
    library = tmp_path / "lib"
    (library / "research").mkdir(parents=True)
    (library / "research" / "errors.py").write_text("class NotConfiguredError(Exception): pass\n")
    (library / "research" / "perplexity_search_api.py").write_text(
        'from strands import tool\n@tool\nasync def perplexity_search_api(query: str) -> dict:\n    """Offline stand-in."""\n    return {"query": query}\n')
    (library / "devops").mkdir()
    # Collides with a core tool name -> must be hidden from the catalog.
    (library / "devops" / "shell.py").write_text('from strands import tool\n@tool\ndef shell(cmd: str) -> str:\n    """shadow"""\n    return cmd\n')
    (library / "devops" / "broken.py").write_text('import definitely_not_installed_pkg\nfrom strands import tool\n@tool\ndef broken() -> str:\n    """needs a missing dependency"""\n    return "x"\n')
    (library / "devops" / "spec_style.py").write_text(
        'TOOL_SPEC = {"name": "spec_style", "description": "TOOL_SPEC module", "inputSchema": {"json": {"type": "object", "properties": {}}}}\n'
        'def spec_style(tool, **kwargs):\n    return {"toolUseId": tool["toolUseId"], "status": "success", "content": [{"text": "spec ok"}]}\n')
    marker = library / "devops" / "imported.txt"
    (library / "devops" / "lazy.py").write_text(f'from pathlib import Path\nPath({str(marker)!r}).write_text("imported")\nfrom strands import tool\n@tool\nasync def lazy() -> str:\n    """lazy"""\n    return "lazy"\n')

    async def scenario():
        catalog = PanelToolCatalog()
        catalog.add_tools([*build_core_tools(library), create_tool_catalog(catalog, library)])
        agent = Agent(model=OfflineModel(), tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        tc = agent.tool_registry.registry["tool_catalog"]
        _, listing = await call_tool(tc, {"action": "list"}, agent=agent)
        payload = json.loads(listing["content"][0]["text"])
        names = {n for v in payload["categories"].values() for n in v}
        assert {"broken", "spec_style", "lazy"} <= names
        assert "shell" not in names and "perplexity_search_api" not in names or "shell" not in names
        assert not marker.exists()  # list/describe never import
        _, described = await call_tool(tc, {"action": "describe", "name": "spec_style"}, agent=agent)
        assert json.loads(described["content"][0]["text"])["description"] == "TOOL_SPEC module"
        _, failed = await call_tool(tc, {"action": "load", "name": "broken"}, agent=agent)
        assert failed["status"] == "error" and "cannot be imported" in json.dumps(failed)
        assert "broken" not in agent.tool_registry.registry
        _, loaded = await call_tool(tc, {"action": "load", "name": "spec_style"}, agent=agent)
        assert loaded["status"] == "success" and marker.exists() is False
        await agent.hooks.invoke_callbacks_async(AfterToolsEvent(agent=agent, message={"role": "user", "content": []}, invocation_state={}))
        _, out = await call_tool(agent.tool_registry.registry["spec_style"], {}, agent=agent)
        assert out["content"][0]["text"] == "spec ok"
        _, again = await call_tool(tc, {"action": "load", "name": "spec_style"}, agent=agent)
        assert "already loaded" in json.dumps(again)
        _, unknown = await call_tool(tc, {"action": "load", "name": "nope"}, agent=agent)
        assert unknown["status"] == "error" and "Unknown library tool" in json.dumps(unknown)
        agent.cleanup()

    asyncio.run(scenario())


def test_dynamic_reload_replaces_both_maps_and_rejects_bad_load(tmp_path):
    source = tmp_path / "reloadable.py"
    source.write_text('from strands import tool\n@tool\nasync def reloadable() -> str:\n    """Original."""\n    return "old"\n')
    async def scenario():
        catalog = PanelToolCatalog(tools=[alpha])
        agent = Agent(model=OfflineModel(), tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        await catalog.stage_tool(source, "reloadable", agent=agent)
        await agent.invoke_async("activate")
        old = agent.tool_registry.registry["reloadable"]
        source.write_text('from strands import tool\n@tool\nasync def reloadable() -> str:\n    """Replacement."""\n    return "replacement"\n')
        await catalog.stage_tool(source, "reloadable", agent=agent)
        assert agent.tool_registry.registry["reloadable"] is old
        await agent.invoke_async("activate replacement")
        new = agent.tool_registry.registry["reloadable"]
        assert new is not old and agent.tool_registry.dynamic_tools["reloadable"] is new
        _, result = await call_tool(new, {})
        assert result["content"][0]["text"] == "replacement"
        with pytest.raises(ValueError, match="does not export"):
            await catalog.stage_tool(source, "missing", agent=agent)
        assert "missing" not in agent.tool_registry.registry
        agent.cleanup()

    asyncio.run(scenario())


def test_mcp_callback_installed_before_start_chained_and_reconciled():
    async def scenario():
        old_callback = Mock()
        client = MCPClient(lambda: None, on_tools_changed=old_callback)
        async def initial():
            assert client.on_tools_changed is not old_callback
            # Simulates an SDK notification arriving during initial discovery.
            client.on_tools_changed(["alpha"], [beta])
            return [alpha]

        client.load_tools = AsyncMock(side_effect=initial)
        catalog = PanelToolCatalog(managed_mcp=[ManagedMCP(client)])
        agent = Agent(model=OfflineModel(), tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        assert agent.tool_registry.registry == {"beta": beta}
        await asyncio.to_thread(client.on_tools_changed, ["beta"], [alpha])
        assert agent.tool_registry.registry == {"beta": beta}
        await agent.invoke_async("refresh")
        assert agent.tool_registry.registry == {"alpha": alpha}
        assert "beta" not in agent.tool_registry.dynamic_tools
        await asyncio.to_thread(client.on_tools_changed, ["alpha"], [])
        await agent.invoke_async("remove")
        assert agent.tool_registry.registry == {}
        assert agent.tool_registry.dynamic_tools == {}
        assert old_callback.call_count == 3
        agent.cleanup()
        assert client.on_tools_changed is old_callback

    asyncio.run(scenario())


def test_legacy_tool_spec_native_stream_offloads(tmp_path):
    path = tmp_path / "legacy.py"
    path.write_text('''import threading
TOOL_SPEC = {"name": "legacy", "description": "Legacy tool", "inputSchema": {"json": {"type": "object", "properties": {}}}}
def legacy(tool, **kwargs):
    return {"toolUseId": tool["toolUseId"], "status": "success", "content": [{"text": str(threading.get_ident())}]}
''')
    async def scenario():
        catalog = PanelToolCatalog()
        agent = Agent(model=OfflineModel(), tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        await catalog.stage_tool(path, "legacy", agent=agent)
        await agent.invoke_async("activate")
        _, result = await call_tool(agent.tool_registry.registry["legacy"], {}, agent=agent)
        assert result["status"] == "success"
        assert result["content"][0]["text"] != str(threading.get_ident())
        agent.cleanup()

    asyncio.run(scenario())


def test_child_rejects_unowned_mcp_tool():
    from mcp.types import Tool
    from strands.tools.mcp.mcp_agent_tool import MCPAgentTool
    value = MCPAgentTool(Tool(name="remote", inputSchema={"type": "object"}), MCPClient(lambda: None))
    with pytest.raises(ValueError, match="Assign MCPClient"):
        ChildSpec("child", "Help", (value,))


def test_installed_mcp_client_gets_elicitation_capable_factory_once():
    """Browser MCP is reached through strands_tools.mcp_client; composition swaps
    that module's MCPClient for an elicitation-capable factory exactly once so
    approval-gated servers (electron-playwright-mcp) don't fail."""
    from strands.tools.mcp import MCPClient
    from strands_tools import mcp_client as module
    import agent.api.core.panel_tools as tools_module

    tools_module._install_mcp_client_elicitation()
    first = module.MCPClient
    tools_module._install_mcp_client_elicitation()
    assert module.MCPClient is first  # idempotent
    assert getattr(first, "__ron_elicitation__", False) is True
    captured = {}

    class Probe(MCPClient):
        def __init__(self, *args, **kwargs):
            captured.update(kwargs)

    real = tools_module.MCPClient
    tools_module.MCPClient = Probe
    try:
        module.MCPClient(lambda: None)
        module.MCPClient(lambda: None, elicitation_callback="custom")
    finally:
        tools_module.MCPClient = real
    assert captured["elicitation_callback"] == "custom"  # explicit callers win; default otherwise


def test_tool_catalog_loads_configured_mcp_servers_by_name(tmp_path):
    """tool_catalog(action=load, name=<configured server>) stages that server via stage_mcp_server."""
    library = tmp_path / "lib"
    library.mkdir()

    async def scenario():
        catalog = PanelToolCatalog(mcp_servers={"cloud_browser": {"command": "/bin/true"}})
        staged = []

        async def fake_stage(name, *, agent):
            staged.append(name)
            catalog._active_servers.add(name)
            return ["cloud_browser_x"]

        catalog.stage_mcp_server = fake_stage  # type: ignore[method-assign]
        catalog.add_tools([create_tool_catalog(catalog, library)])
        agent = Agent(model=OfflineModel(), tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        tc = agent.tool_registry.registry["tool_catalog"]

        _, listing = await call_tool(tc, {"action": "list"}, agent=agent)
        assert json.loads(listing["content"][0]["text"])["mcp_servers"] == {"cloud_browser": False}

        _, described = await call_tool(tc, {"action": "describe", "name": "cloud_browser"}, agent=agent)
        assert json.loads(described["content"][0]["text"]) == {
            "server": "cloud_browser", "kind": "mcp_server", "loaded": False}

        _, loaded = await call_tool(tc, {"action": "load", "name": "cloud_browser"}, agent=agent)
        assert loaded["status"] == "success"
        assert json.loads(loaded["content"][0]["text"]) == {
            "server": "cloud_browser", "loaded": True, "tools": ["cloud_browser_x"],
            "activation": "callable from your next step"}
        assert staged == ["cloud_browser"]

        _, again = await call_tool(tc, {"action": "load", "name": "cloud_browser"}, agent=agent)
        assert json.loads(again["content"][0]["text"]) == {
            "server": "cloud_browser", "loaded": True, "note": "already loaded"}
        assert staged == ["cloud_browser"]  # stage not called twice

        _, listing = await call_tool(tc, {"action": "list"}, agent=agent)
        assert json.loads(listing["content"][0]["text"])["mcp_servers"] == {"cloud_browser": True}

        # Library-tool behaviour unchanged: unknown names still error the same way.
        _, unknown = await call_tool(tc, {"action": "load", "name": "nope"}, agent=agent)
        assert unknown["status"] == "error" and "Unknown library tool" in json.dumps(unknown)
        agent.cleanup()

    asyncio.run(scenario())
