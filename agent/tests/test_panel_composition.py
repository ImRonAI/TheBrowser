"""Exercise the real composition root against Strands 1.56, entirely offline."""

import asyncio
import copy
import json
from unittest.mock import AsyncMock, Mock

import pytest
from strands import Agent, tool
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.hooks.events import BeforeInvocationEvent
from strands.models.model import Model
from strands.plugins import Plugin
from strands.session import SnapshotSessionManager
from strands.storage import InMemoryStorage
from strands.tools import ToolProvider
from strands.tools.executors import ConcurrentToolExecutor, SequentialToolExecutor
from strands.tools.mcp import MCPClient
from strands.tools.mcp.mcp_agent_tool import MCPAgentTool
from strands.vended_plugins.goal import GoalLoop

from agent.api.core import panel_agent as composition
from agent.api.core.panel_runtime import PanelRuntimeManager
from agent.api.core.panel_tools import ChildSpec, accept_browser_elicitation, create_child_agent


class OfflineModel(Model):
    def __init__(self, uses=()):
        self.uses = uses
        self.calls = []
        self.tool_specs = []

    def get_config(self):
        return {"model_id": "offline", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls.append(copy.deepcopy(messages))
        self.tool_specs = list(tool_specs or [])
        uses = self.uses if not any("toolResult" in b for m in messages for b in m["content"]) else ()
        yield {"messageStart": {"role": "assistant"}}
        for index, (name, inputs) in enumerate(uses):
            yield {"contentBlockStart": {"contentBlockIndex": index,
                "start": {"toolUse": {"toolUseId": f"use-{index}", "name": name}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": index,
                "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
            yield {"contentBlockStop": {"contentBlockIndex": index}}
        if not uses:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "answer"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "tool_use" if uses else "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
                            "metrics": {"latencyMs": 1}}}


@pytest.fixture
def offline(monkeypatch, tmp_path):
    for key in ("PANEL_SKILLS_DIR", "PANEL_SKILLS_DIRS", "PANEL_SKILL_TOOLS", "PANEL_FORMATIONS_FILE",
                "PANEL_RETRY_MAX_ATTEMPTS", "PANEL_RETRY_INITIAL_DELAY", "PANEL_RETRY_MAX_DELAY"):
        monkeypatch.delenv(key, raising=False)
    models, catalogs, constructed = [], [], []
    storage = InMemoryStorage()
    monkeypatch.setattr(composition, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(composition, "get_user_session_storage", lambda user: storage)
    # Retain real native memory configuration, using isolated offline storage.
    from agent.api.core import panel_storage
    monkeypatch.setattr(panel_storage, "get_panel_storage", lambda: storage)

    def model(*args):
        value = OfflineModel()
        models.append(value)
        return value

    monkeypatch.setattr(composition, "build_model", model)
    native_catalog = composition._OwnedPanelCatalog

    def catalog(**kwargs):
        value = native_catalog(**kwargs)
        catalogs.append(value)
        return value

    monkeypatch.setattr(composition, "_OwnedPanelCatalog", catalog)
    native_config = composition.config_to_agent

    def config(path, **kwargs):
        value = native_config(path, **kwargs)
        constructed.append((value, kwargs))
        return value

    monkeypatch.setattr(composition, "config_to_agent", config)

    def build(**kwargs):
        return composition.create_panel_agent(provider="perplexity", model_id="offline",
            user_id="user", session_id="session", system_prompt="Test composition", extra_tools=kwargs.pop("extra_tools", []),
            **kwargs)

    yield build, models, catalogs, constructed, storage
    for agent, _ in constructed:
        agent.cleanup()


def test_real_constructor_defaults_stream_and_complete_cleanup(offline):
    build, models, catalogs, constructed, storage = offline
    agent = build()
    kwargs = constructed[-1][1]
    assert isinstance(agent, Agent)
    assert kwargs["tools"] == catalogs
    assert isinstance(kwargs["session_manager"], SnapshotSessionManager)
    assert kwargs["storage"] is storage
    assert agent.memory_manager is not None
    assert kwargs["context_manager"] == "auto"
    assert isinstance(kwargs["tool_executor"], ConcurrentToolExecutor)
    assert kwargs["background_tasks"] is False
    assert kwargs["retry_strategy"]._max_attempts == 6
    names = set(agent.tool_registry.registry)
    # User-mandated core set is always registered; think is Perplexity-only.
    from agent.api.core.panel_tools import CORE_TOOL_NAMES
    assert set(CORE_TOOL_NAMES) <= names
    assert {"ask_user", "think", "research_review", "reasoning_swarm", "nested_research_review"} <= names
    assert "review" not in names and "load_tool" not in names and "discover_tools" not in names
    # No long-lived child agents: think/formations build children per call.
    assert len(models) == 1
    assert catalogs[0].children == []
    result = asyncio.run(agent.invoke_async("hello"))
    assert result.stop_reason == "end_turn"
    agent.cleanup()
    agent.cleanup()
    assert catalogs[0].children == []


@pytest.mark.parametrize("mode", ["auto", "agentic", "sliding"])
def test_runtime_merge_context_executor_and_retry(offline, monkeypatch, mode):
    build, _, _, constructed, storage = offline
    calls = []

    class AppPlugin(Plugin):
        name = "test:runtime"

        def init_agent(self, agent):
            agent.add_hook(lambda event: calls.append("plugin"), BeforeInvocationEvent)

    def hook(event: BeforeInvocationEvent):
        calls.append("hook")

    monkeypatch.setenv("PANEL_RETRY_MAX_ATTEMPTS", "2")
    callback = Mock()
    session = SnapshotSessionManager("runtime", storage=storage)
    runtime = {"agent_id": "runtime-id", "session_manager": session, "callback_handler": callback,
               "hooks": [hook], "plugins": [AppPlugin()]}
    agent = build(options={"context": mode, "tool_execution": "sequential"}, runtime_options=runtime)
    kwargs = constructed[-1][1]
    assert agent.agent_id == "runtime-id"
    assert kwargs["session_manager"] is session and kwargs["callback_handler"] is callback
    assert runtime["hooks"] == [hook] and len(runtime["plugins"]) == 1
    assert isinstance(kwargs["tool_executor"], SequentialToolExecutor)
    assert kwargs["retry_strategy"]._max_attempts == 2
    if mode == "sliding":
        assert kwargs["context_manager"] is False
        assert isinstance(kwargs["conversation_manager"], SlidingWindowConversationManager)
    else:
        assert kwargs["context_manager"] == mode
    asyncio.run(agent.invoke_async("hello"))
    assert sorted(calls) == ["hook", "plugin"]


def test_sync_extra_adapted_and_think_child_inherits_parent_tools(offline, monkeypatch):
    build, models, _, _, _ = offline

    @tool
    def blocking(value: str) -> str:
        """Return the supplied value."""
        return value

    agent = build(extra_tools=[blocking])
    # Parent calls the sync extra tool and think; think's child (fresh model) uses
    # the inherited `blocking` tool itself - interleaved reasoning + tool calling.
    models[-1].uses = [("blocking", {"value": "adapted"}), ("think", {"thought": "reason"})]
    events = []

    async def run():
        async for event in agent.stream_async("use tools"):
            events.append(event)
        return events[-1]["result"]

    def child_model(*args):
        value = OfflineModel()
        value.uses = [("blocking", {"value": "from-child"})]
        models.append(value)
        return value
    monkeypatch.setattr(composition, "build_model", child_model)  # think builds its child via model_factory -> build_model
    result = asyncio.run(run())
    assert result.stop_reason == "end_turn"
    results = [b["toolResult"] for m in agent.messages for b in m["content"] if "toolResult" in b]
    assert len(results) == 2 and all(r["status"] == "success" for r in results)
    child = models[-1]
    assert child is not models[0]
    # Child received the parent's tools minus the excluded meta tools.
    child_tool_names = {spec["name"] for spec in child.tool_specs}
    assert {"blocking", "shell", "editor", "perplexity_search", "mcp_client"} <= child_tool_names
    assert not child_tool_names & {"think", "ask_user", "tool_catalog"}
    # Child events were streamed to the parent as tool progress ({think: True, event}).
    progress = [e["tool_stream_event"]["data"] for e in events if "tool_stream_event" in e]
    assert any(isinstance(d, dict) and d.get("think") is True and "event" in d for d in progress)
    # The child's tool result for `blocking` shows the child actually executed the inherited tool.
    assert any("from-child" in str(d) for d in progress)


@pytest.mark.parametrize("formation", ["research_review", "reasoning_swarm", "nested_research_review"])
def test_default_native_formations_execute_and_release_children(offline, monkeypatch, formation):
    build, models, _, _, _ = offline
    agent = build()
    cleanups = []
    from agent.api.core import panel_tools
    original = panel_tools.create_child_agent

    async def create(*args, **kwargs):
        child = await original(*args, **kwargs)
        assert not child.tool_registry.registry
        cleanup = Mock(wraps=child.cleanup)
        child.cleanup = cleanup
        cleanups.append(cleanup)
        return child

    monkeypatch.setattr(panel_tools, "create_child_agent", create)
    models[-1].uses = [(formation, {"prompt": "analyze supplied text"})]
    result = asyncio.run(agent.invoke_async("delegate"))
    assert result.stop_reason == "end_turn"
    results = [b["toolResult"] for m in agent.messages for b in m["content"] if "toolResult" in b]
    assert results[0]["status"] == "success", results
    assert len(cleanups) == (4 if formation == "nested_research_review" else 2)
    assert all(cleanup.call_count == 1 for cleanup in cleanups)


def test_goal_judge_fresh_and_background_delegation_foreground_only(offline):
    build, models, _, constructed, _ = offline
    agent = build(options={"goal": "Be concise", "background": True, "checkpointing": True})
    kwargs = constructed[-1][1]
    goal = next(plugin for plugin in kwargs["plugins"] if isinstance(plugin, GoalLoop))
    assert goal._judge_model is not agent.model
    assert goal._max_attempts == 3 and goal._timeout == 120 and goal._preserve_context
    assert len(models) == 2  # parent + fresh judge
    background = kwargs["background_tasks"]
    assert background["agentic"] == ["*"] and background["wait_for_completion"] is True
    assert {"think", "run_skill", "research_review", "reasoning_swarm", "nested_research_review",
            "editor", "tool_catalog", "mcp_client", "ask_user"} <= set(background["never"])


@pytest.mark.parametrize("checkpoint", [False, True])
def test_native_question_pause_preserved_with_goal_and_runtime(offline, checkpoint):
    build, models, _, _, storage = offline
    validations = []

    def goal(response, agent):
        validations.append(response)
        return False

    async def factory(**kwargs):
        agent = await asyncio.to_thread(build, options={"checkpointing": checkpoint, "goal": goal},
                                        runtime_options=kwargs["runtime_options"])
        models[-1].uses = [("ask_user", {"question": "Which option?"})]
        return agent

    async def scenario():
        manager = PanelRuntimeManager(factory=factory, storage_factory=lambda user: storage)
        try:
            session = await manager.start("user", "session", "ask me")
            await session.wait()
            assert session.status == ("checkpointed" if checkpoint else "interrupted"), session.result
            assert len(models[-1].calls) == 1  # Goal failure must not bypass the pause.
            assert validations  # Native 1.56 still validates paused invocations.
            if not checkpoint:
                assert session.interrupts[0]["reason"] == {"question": "Which option?"}
                await manager.start("user", "session", action="interrupt", interrupt_responses=[
                    {"interruptResponse": {"interruptId": session.interrupts[0]["id"], "response": "A"}}])
                await session.wait()
                assert session.status == "completed"
                results = [b["toolResult"] for m in session.agent.messages for b in m["content"] if "toolResult" in b]
                assert "A" in json.dumps(results)
        finally:
            await manager.shutdown()

    asyncio.run(scenario())


def test_bind_failure_and_postconstruction_failure_cleanup(offline, monkeypatch):
    build, _, catalogs, _, _ = offline
    cleanup_calls = []
    native_cleanup = Agent.cleanup

    def cleanup(agent):
        cleanup_calls.append(agent)
        native_cleanup(agent)

    monkeypatch.setattr(Agent, "cleanup", cleanup)
    monkeypatch.setattr(composition.PanelToolCatalog, "bind", Mock(side_effect=ValueError("bind failure")))
    with pytest.raises(ValueError, match="bind failure"):
        build()
    assert len(cleanup_calls) == 1  # parent; no long-lived children remain
    assert catalogs[0].children == [] and not catalogs[0].consumers


def test_constructor_failure_also_releases_catalog_children(offline, monkeypatch):
    build, _, catalogs, _, _ = offline
    monkeypatch.setattr(composition, "config_to_agent", Mock(side_effect=ValueError("constructor failure")))
    cleanups = []
    native_cleanup = Agent.cleanup

    def cleanup(agent):
        cleanups.append(agent)
        native_cleanup(agent)

    monkeypatch.setattr(Agent, "cleanup", cleanup)
    with pytest.raises(ValueError, match="constructor failure"):
        build()
    assert len(cleanups) == 0 and catalogs[0].children == []


def test_explicit_skill_assignments_and_unknown_tool_rejected(offline, monkeypatch, tmp_path):
    build, models, catalogs, _, _ = offline
    skill = tmp_path / "skills" / "summarize"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: summarize\ndescription: Summarize provided text\n---\nSummarize the text.")
    monkeypatch.setenv("PANEL_SKILLS_DIR", str(tmp_path / "skills"))
    monkeypatch.setenv("PANEL_SKILL_TOOLS", '{"summarize": ["does_not_exist"]}')
    with pytest.raises(ValueError, match="not registered"):
        build()
    assert catalogs[0].children == []
    monkeypatch.setenv("PANEL_SKILL_TOOLS", '{"summarize": []}')
    agent = build()
    models[-1].uses = [("run_skill", {"skill_name": "summarize", "prompt": "text"})]
    result = asyncio.run(agent.invoke_async("summarize"))
    assert result.stop_reason == "end_turn"
    results = [b["toolResult"] for m in agent.messages for b in m["content"] if "toolResult" in b]
    assert results[0]["status"] == "success", results


def test_mcp_assignment_uses_exact_provider_view_not_unowned_tool():
    from mcp.types import Tool
    client = MCPClient(url="http://localhost:9999/mcp")
    value = MCPAgentTool(Tool(name="remote", description="remote", inputSchema={"type": "object"}), client)
    agent = Mock()
    agent.tool_registry.registry = {"remote": value}
    assigned = composition._assigned_tools(agent, ["remote", "remote"])
    assert len(assigned) == 1 and isinstance(assigned[0], ToolProvider)
    assert assigned[0].client is client and assigned[0].names == frozenset({"remote"})


def test_browser_mcp_goes_through_native_mcp_client_with_elicitation_installed(offline):
    """Browser automation uses strands_tools.mcp_client; composition installs the
    elicitation-capable MCPClient factory on that module (approval-gated
    electron-playwright-mcp otherwise fails with "Elicitation not supported")."""
    from strands.tools.mcp import MCPClient
    from strands_tools import mcp_client as module
    from agent.api.core.panel_tools import accept_browser_elicitation

    build, _, _, _, _ = offline
    agent = build()
    assert "mcp_client" in agent.tool_registry.registry
    assert getattr(module.MCPClient, "__ron_elicitation__", False) is True
    captured = {}

    class Probe(MCPClient):
        def __init__(self, *args, **kwargs):
            captured.update(kwargs)

    real = MCPClient
    try:
        import agent.api.core.panel_tools as tools_module
        tools_module.MCPClient = Probe
        module.MCPClient(lambda: None)
    finally:
        tools_module.MCPClient = real
    assert captured["elicitation_callback"] is accept_browser_elicitation
    # No mcp.json / load_mcp_server machinery remains in composition.
    assert not hasattr(composition, "_browser_client_factories")
    assert "load_mcp_server" not in agent.tool_registry.registry


def test_assigned_read_tool_cannot_invoke_write_and_consumers_are_independent(offline):
    from mcp.types import Tool
    build, _, _, _, _ = offline
    client = MCPClient(lambda: None)
    tools = [MCPAgentTool(Tool(name=name, inputSchema={"type": "object"}), client)
             for name in ("read_file", "write_file")]
    client.load_tools = AsyncMock(return_value=tools)
    client.call_tool_async = AsyncMock(return_value={"toolUseId": "use-0", "status": "success",
                                                    "content": [{"text": "read content"}]})
    parent = build(extra_tools=[client])
    assignments = composition._assigned_tools(parent, ["read_file"])
    assert len(client._consumers) == 1
    assert set(parent.tool_registry.registry) >= {"read_file", "write_file"}

    async def scenario():
        model = OfflineModel(uses=[("read_file", {}), ("write_file", {})])
        first = await create_child_agent(ChildSpec("reader", "Read", assignments), model_factory=lambda _: model)
        second = await create_child_agent(ChildSpec("reader2", "Read", assignments), model_factory=lambda _: OfflineModel())
        try:
            assert set(first.tool_registry.registry) == {"read_file"}
            assert len(client._consumers) == 3
            await first.invoke_async("Try both read and write")
            results = [b["toolResult"] for m in first.messages for b in m["content"] if "toolResult" in b]
            assert [result["status"] for result in results] == ["success", "error"]
            assert [call.kwargs["name"] for call in client.call_tool_async.call_args_list] == ["read_file"]
            # New server tools do not broaden the grant on a later child load.
            tools.append(MCPAgentTool(Tool(name="delete_file", inputSchema={"type": "object"}), client))
            assert [value.tool_name for value in await assignments[0].load_tools()] == ["read_file"]
            first.cleanup()
            first.cleanup()
            assert len(client._consumers) == 2
        finally:
            first.cleanup()
            second.cleanup()

    asyncio.run(scenario())
    assert len(client._consumers) == 1
    parent.cleanup()
    assert not client._consumers


def test_mcp_view_missing_assignment_fails_and_releases_child_consumer(offline):
    from mcp.types import Tool
    from strands.tools.registry import ToolRegistry
    build, _, _, _, _ = offline
    client = MCPClient(lambda: None)
    value = MCPAgentTool(Tool(name="read_file", inputSchema={"type": "object"}), client)
    client.load_tools = AsyncMock(return_value=[value])
    parent = build(extra_tools=[client])
    view = composition._assigned_tools(parent, ["read_file"])[0]
    client.load_tools.return_value = []
    registry = ToolRegistry()
    try:
        with pytest.raises(ValueError, match="no longer available"):
            registry.process_tools([view])
    finally:
        registry.cleanup()
    assert len(client._consumers) == 1


@pytest.mark.parametrize("name", ["search_memory", "add_memory", "retrieve_context"])
def test_parent_memory_and_context_tools_cannot_be_assigned(offline, name):
    build, _, _, _, _ = offline
    agent = build()
    assert name in agent.tool_registry.registry
    with pytest.raises(ValueError, match="parent-bound"):
        composition._assigned_tools(agent, [name])
    assert composition._assigned_tools(agent, ["editor"])[0].tool_name == "editor"


def test_real_constructor_partial_mcp_startup_failure_releases_every_owner(offline, monkeypatch):
    build, _, catalogs, _, _ = offline
    first, second = MCPClient(lambda: None), MCPClient(lambda: None)

    @tool
    async def remote() -> str:
        """Offline remote tool."""
        return "ok"

    first.load_tools = AsyncMock(return_value=[remote])
    second.load_tools = AsyncMock(side_effect=RuntimeError("startup failed"))
    cleaned = []
    native_cleanup = Agent.cleanup

    def cleanup(agent):
        cleaned.append(agent)
        native_cleanup(agent)

    monkeypatch.setattr(Agent, "cleanup", cleanup)
    with pytest.raises(ValueError, match="startup failed"):
        build(extra_tools=[first, second])
    assert not first._consumers and not second._consumers
    assert catalogs[0].children == []
    assert cleaned == []  # no long-lived children exist to release


def test_unassigned_skill_never_inherits_parent_tools(offline, monkeypatch, tmp_path):
    build, models, _, _, _ = offline
    skill = tmp_path / "skills" / "example"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: example\ndescription: Example skill\n---\nDo the task.")
    monkeypatch.setenv("PANEL_SKILLS_DIR", str(tmp_path / "skills"))
    agent = build()
    models[-1].uses = [("run_skill", {"skill_name": "example", "prompt": "task"})]
    asyncio.run(agent.invoke_async("run skill"))
    results = [b["toolResult"] for m in agent.messages for b in m["content"] if "toolResult" in b]
    assert results[0]["status"] == "error"
    assert "explicit tool assignment" in json.dumps(results)
    assert len(models) == 1  # No child model was even constructed.


def test_cleanup_attempts_all_children_even_when_one_fails(offline):
    build, _, catalogs, _, _ = offline
    agent = build()
    # The catalog owns any long-lived children an application registers (none by
    # default now); seed two to verify cleanup fans out and reports all failures.
    children = [Agent(model=OfflineModel(), tools=[], callback_handler=None, context_manager=False) for _ in range(2)]
    catalogs[0].children.extend(children)
    first = Mock(wraps=children[0].cleanup)
    children[0].cleanup = first
    children[1].cleanup = Mock(side_effect=RuntimeError("cleanup failed"))
    with pytest.raises(ExceptionGroup, match="child cleanup failed"):
        agent.cleanup()
    first.assert_called_once()
    assert catalogs[0].children == []


def test_runtime_background_config_cannot_detach_or_background_children(offline):
    build, _, _, constructed, _ = offline
    background = {"wait_for_completion": False, "never": ["custom"]}
    build(runtime_options={"background_tasks": background})
    actual = constructed[-1][1]["background_tasks"]
    assert actual["wait_for_completion"] is True
    assert {"custom", "think", "nested_research_review", "tool_catalog"} <= set(actual["never"])
    assert background == {"wait_for_completion": False, "never": ["custom"]}


def test_formation_unknown_fields_and_unowned_mcp_rejected(offline):
    build, _, _, _, _ = offline
    from mcp.types import Tool
    client = MCPClient(lambda: None)
    value = MCPAgentTool(Tool(name="remote", inputSchema={"type": "object"}), client)
    with pytest.raises(ValueError, match="owning MCPClient"):
        build(extra_tools=[value])
    with pytest.raises(ValueError, match="Unknown agent spec fields"):
        composition._formation_spec({"type": "agent", "name": "child", "system_prompt": "task",
                                     "tools": [], "checkpointing": True}, Mock())


def test_configured_graph_actual_topology_and_explicit_child_tools(offline, monkeypatch, tmp_path):
    build, models, _, constructed, _ = offline
    file = tmp_path / "formations.json"
    file.write_text(json.dumps([{"name": "custom_graph", "type": "graph", "nodes": {
        "first": {"type": "agent", "name": "analyst", "system_prompt": "Analyze", "tools": []},
        "second": {"type": "agent", "name": "critic", "system_prompt": "Review", "tools": []}},
        "edges": [["first", "second"]], "entry_points": ["first"]}]))
    monkeypatch.setenv("PANEL_FORMATIONS_FILE", str(file))
    agent = build(options={"background": True})
    assert "research_review" not in agent.tool_registry.registry
    assert "custom_graph" in constructed[-1][1]["background_tasks"]["never"]
    models[-1].uses = [("custom_graph", {"prompt": "task"})]
    result = asyncio.run(agent.invoke_async("run graph"))
    assert result.stop_reason == "end_turn"
    results = [b["toolResult"] for m in agent.messages for b in m["content"] if "toolResult" in b]
    assert results[0]["status"] == "success", results
    assert len(models) == 3  # parent + two graph children
    assert "first" in json.dumps(models[-1].calls)  # Second node sees native graph context.


def test_create_panel_agent_merges_application_and_runtime_hooks(offline):
    """Application hooks register first, then runtime hooks (priority-200 runtime layer)."""
    from strands.hooks import HookProvider

    build, _models, _catalogs, constructed, _storage = offline
    order = []

    class Recorder(HookProvider):
        def __init__(self, label):
            self.label = label

        def register_hooks(self, registry, **kwargs):
            order.append(self.label)

    app_hook, runtime_hook = Recorder("app"), Recorder("runtime")
    build(hooks=[app_hook], runtime_options={"hooks": [runtime_hook]})
    kwargs = constructed[-1][1]
    assert kwargs["hooks"] == [app_hook, runtime_hook]
    assert order == ["app", "runtime"]


def test_create_panel_agent_without_hooks_is_unchanged(offline):
    build, _models, _catalogs, constructed, _storage = offline
    build()
    assert constructed[-1][1]["hooks"] == []
