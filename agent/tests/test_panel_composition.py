"""Exercise the real composition root against Strands 1.56, entirely offline."""

import asyncio
import copy
import json
from unittest.mock import AsyncMock, Mock

import pytest
from strands import Agent, tool
from strands.agent.conversation_manager import SlidingWindowConversationManager, SummarizingConversationManager
from strands.vended_plugins.context_offloader import ContextOffloader
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
        self.tool_spec_history = [*getattr(self, "tool_spec_history", []), (copy.deepcopy(messages), self.tool_specs)]
        uses = self.uses if not any("toolResult" in b for m in messages for b in m["content"]) else ()
        yield {"messageStart": {"role": "assistant"}}
        for index, (name, inputs) in enumerate(uses):
            # Unique per model call like every real provider: the native HumanInTheLoop memoises
            # classified toolUseIds, so a reused id would demand approval on the second cycle.
            tool_use_id = f"use-{index}" if len(self.calls) == 1 else f"use-{len(self.calls)}-{index}"
            yield {"contentBlockStart": {"contentBlockIndex": index,
                "start": {"toolUse": {"toolUseId": tool_use_id, "name": name}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": index,
                "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
            yield {"contentBlockStop": {"contentBlockIndex": index}}
        if not uses:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "answer"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "tool_use" if uses else "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
                            "metrics": {"latencyMs": 1}}}


class MemoryChainModel(OfflineModel):
    """The panel Agent's aux_model (memory extraction), kept offline and out of ``models``."""


@pytest.fixture
def offline(monkeypatch, tmp_path):
    for key in ("PANEL_SKILLS_DIR", "PANEL_SKILLS_DIRS", "PANEL_SKILL_TOOLS", "PANEL_FORMATIONS_FILE",
                "PANEL_RETRY_MAX_ATTEMPTS", "PANEL_RETRY_INITIAL_DELAY", "PANEL_RETRY_MAX_DELAY",
                "RON_MEMORY_MODEL"):
        monkeypatch.delenv(key, raising=False)
    models, catalogs, constructed = [], [], []
    storage = InMemoryStorage()
    monkeypatch.setattr(composition, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(composition, "get_user_session_storage", lambda user: storage)
    # Retain real native memory configuration, using isolated offline storage.
    from agent.api.core import panel_storage, teaching
    monkeypatch.setattr(panel_storage, "get_panel_storage", lambda: storage)
    # The learned-skill TeachingService is a process-wide singleton (defaults to the repo's
    # .sessions/teaching): reset per test and pointed at this test's storage.
    monkeypatch.setenv("TEACHING_STORAGE_DIR", str(tmp_path / "teaching"))
    monkeypatch.setattr(teaching, "_service", None)
    monkeypatch.setenv("RON_MEMORY_MODEL", "offline/memory")

    memory_models = []

    def model(*args, hosted_tools=True):
        if not hosted_tools:
            # build_model("perplexity", RON_MEMORY_MODEL, None, hosted_tools=False): the panel
            # Agent's aux_model (memory extraction), never the panel/think/judge/child models.
            assert args[:2] == ("perplexity", "offline/memory")
            value = MemoryChainModel()
            memory_models.append(value)
            return value
        value = OfflineModel()
        models.append(value)
        return value

    monkeypatch.setattr(composition, "build_model", model)
    from agent.api.core import config as app_config
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "offline-not-a-credential")
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

    build.memory_models = memory_models
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
    assert kwargs["context_manager"] is False
    manager = kwargs["conversation_manager"]
    assert isinstance(manager, SummarizingConversationManager)
    assert manager._compression_threshold == 0.87
    summarizer = manager.summarization_agent
    assert isinstance(summarizer, Agent) and summarizer is not agent
    assert summarizer.model is kwargs["model"]
    assert summarizer._session_manager is None
    assert any(isinstance(plugin, ContextOffloader) for plugin in kwargs["plugins"])
    assert isinstance(kwargs["tool_executor"], ConcurrentToolExecutor)
    assert kwargs["background_tasks"] is False
    assert kwargs["retry_strategy"]._max_attempts == 6
    names = set(agent.tool_registry.registry)
    # User-mandated core set is always registered; think is Perplexity-only.
    from agent.api.core.panel_tools import CORE_TOOL_NAMES
    assert set(CORE_TOOL_NAMES) <= names
    assert {"ask_user", "think", "research_review", "reasoning_swarm", "nested_research_review",
            "retrieve_offloaded_content"} <= names
    assert "review" not in names and "load_tool" not in names and "discover_tools" not in names
    # The summarizer is one long-lived Agent on the panel model. think/formations still build per call.
    assert len(models) == 1
    result = asyncio.run(agent.invoke_async("hello"))
    assert result.stop_reason == "end_turn"
    # Memory is the SDK's (core/memory.py): native search_memory/add_memory, the aux_model runs
    # facts extraction, and userTurn injection found nothing so the model saw only the message.
    assert {"search_memory", "add_memory", "list_learned_skills", "use_skill"} <= names
    assert "recall" not in names and "search_memories" not in names
    assert "journal" not in names
    assert len(build.memory_models) == 1 and agent.aux_model is build.memory_models[0]
    assert [s.name for s in agent.memory_manager._stores] == ["facts", "remember", "feedback", "context", "tasks", "learned-skills"]
    assert agent.memory_manager._stores[0].extraction
    texts = [b["text"] for m in models[0].calls[-1] for b in m["content"] if "text" in b]
    # PANEL_ENVIRONMENT_CONTEXT (default on) injects the harness environment block
    # (platform/date/cwd/AGENTS.md) before the user turn.
    assert texts[0] == "hello"
    assert len(texts) == 2 and texts[1].startswith("\n\n<system-reminder>\n<environment>"), texts[1][:80]
    agent.cleanup()
    agent.cleanup()


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
    offloader = any(isinstance(plugin, ContextOffloader) for plugin in kwargs["plugins"])
    if mode == "sliding":
        assert kwargs["context_manager"] is False
        assert isinstance(kwargs["conversation_manager"], SlidingWindowConversationManager)
        assert offloader
    elif mode == "agentic":
        assert kwargs["context_manager"] == "agentic"
        assert "conversation_manager" not in kwargs
        assert not offloader
    else:
        assert kwargs["context_manager"] is False
        assert isinstance(kwargs["conversation_manager"], SummarizingConversationManager)
        assert offloader
    asyncio.run(agent.invoke_async("hello"))
    assert sorted(calls) == ["hook", "plugin"]


def test_sync_extra_adapted_and_think_child_inherits_parent_tools(offline, monkeypatch):
    build, models, _, _, _ = offline

    @tool
    def blocking(value: str) -> str:
        """Return the supplied value."""
        return value

    agent = build(extra_tools=[blocking])
    # Parent calls the sync extra tool and the vendored think.py. think.py builds its child
    # over the parent's own model and tools; ThinkToolsGuard (native BeforeToolCallEvent)
    # removes parent-only tools from that inherited set.
    models[-1].uses = [("blocking", {"value": "adapted"}),
                       ("think", {"thought": "reason offline", "cycle_count": 1, "system_prompt": "child"})]
    result = asyncio.run(agent.invoke_async("use tools"))
    assert result.stop_reason == "end_turn"
    results = [b["toolResult"] for m in agent.messages for b in m["content"] if "toolResult" in b]
    assert len(results) == 2 and all(r["status"] == "success" for r in results)
    assert len(models) == 1  # think.py reuses the parent's model instance
    child_calls = [specs for messages, specs in models[0].tool_spec_history
                   if "Thought to process:\nreason offline" in json.dumps(messages[0]["content"]).replace("\\n", "\n")]
    assert child_calls
    child_tool_names = {spec["name"] for spec in child_calls[0]}
    assert {"blocking", "shell", "editor", "perplexity_search", "mcp_client"} <= child_tool_names
    assert not child_tool_names & {"think", "ask_user", "tool_catalog"}
    assert not any(name.startswith("strands_") for name in child_tool_names)


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


def test_long_run_keeps_tools_and_host_files_across_turns(offline, tmp_path):
    build, _, _, _, storage = offline
    calls = []
    artifact = tmp_path / "progress.txt"

    @tool
    def record_step(step: int) -> str:
        """Persist one completed step and return its number."""
        calls.append(step)
        with artifact.open("a") as handle:
            handle.write(f"{step}\n")
        return str(step)

    class LongModel(OfflineModel):
        async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
            # Reuse the native streaming fixture but request one fresh tool on
            # each model cycle, rather than stopping after the first result.
            self.uses = [("record_step", {"step": len(calls) + 1})] if len(calls) < 30 else ()
            assert any(spec["name"] == "record_step" for spec in tool_specs or [])
            async for event in super().stream([messages[0]], tool_specs, system_prompt, **kwargs):
                yield event

    async def factory(**kwargs):
        return await asyncio.to_thread(build, extra_tools=[record_step],
            runtime_options={**kwargs["runtime_options"], "model": LongModel()})

    async def scenario():
        manager = PanelRuntimeManager(factory=factory, storage_factory=lambda user: storage)
        try:
            session = await manager.start("user", "session", "Complete thirty steps")
            await asyncio.wait_for(session.wait(), 30)
            assert session.status == "completed", (session.status, session.error, session.interrupts)
            assert calls == list(range(1, 31))
            assert len(session.agent.model.calls) == 31
            original_agent = session.agent
            await manager.start("user", "session", "Check the completed work")
            await asyncio.wait_for(session.wait(), 30)
            assert session.status == "completed"
            assert session.agent is original_agent
            assert artifact.read_text().splitlines() == [str(step) for step in range(1, 31)]
        finally:
            await manager.shutdown()

    asyncio.run(scenario())


def test_goal_continues_beyond_three_attempts(offline):
    build, _, _, _, _ = offline
    validations = []

    def goal(response, agent):
        validations.append(response)
        return len(validations) == 5

    agent = build(options={"goal": goal})
    result = asyncio.run(agent.invoke_async("Finish the task"))
    assert result.stop_reason == "end_turn"
    assert len(validations) == 5


def test_goal_judge_fresh_and_background_delegation_foreground_only(offline):
    build, models, _, constructed, _ = offline
    agent = build(options={"goal": "Be concise", "background": True, "checkpointing": True})
    kwargs = constructed[-1][1]
    goal = next(plugin for plugin in kwargs["plugins"] if isinstance(plugin, GoalLoop))
    assert goal._judge_model is not agent.model
    assert goal._max_attempts == float("inf") and goal._timeout == float("inf") and goal._preserve_context
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
        return len(validations) > 1

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
                assert session.status == "completed", session.interrupts
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
    # Parent plus the summarizer built for context=auto. Nothing else stays open.
    assert len(cleanup_calls) == 2
    assert sum(agent._session_manager is None for agent in cleanup_calls) == 1
    assert not catalogs[0].consumers


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
    # The panel agent never existed. The summarizer built for context=auto is released.
    assert len(cleanups) == 1
    assert cleanups[0]._session_manager is None


def test_explicit_skill_assignments_and_unknown_tool_rejected(offline, monkeypatch, tmp_path):
    build, models, catalogs, _, _ = offline
    skill = tmp_path / "skills" / "summarize"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: summarize\ndescription: Summarize provided text\n---\nSummarize the text.")
    monkeypatch.setenv("PANEL_SKILLS_DIR", str(tmp_path / "skills"))
    monkeypatch.setenv("PANEL_SKILL_TOOLS", '{"summarize": ["does_not_exist"]}')
    with pytest.raises(ValueError, match="not registered"):
        build()
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


@pytest.mark.parametrize(
    ("name", "mode"),
    [
        ("search_memory", "auto"),
        ("add_memory", "auto"),
        ("retrieve_offloaded_content", "auto"),
        ("retrieve_context", "agentic"),
        ("summarize_context", "agentic"),
        ("truncate_context", "agentic"),
        ("pin_context", "agentic"),
    ],
)
def test_parent_memory_and_context_tools_cannot_be_assigned(offline, name, mode):
    build, _, _, _, _ = offline
    agent = build(options={"context": mode})
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
    # Panel construction failed before the panel agent existed. The summarizer was
    # already built for context=auto and is released with it.
    assert len(cleaned) == 1
    assert cleaned[0]._session_manager is None


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
    # Application hooks first, then the always-present BrowserAvailabilityHook, ToolObservation,
    # ThreadProjection (Supabase threads read model) and ToolRepairTrigger (RON_TOOL_REPAIR default on),
    # then runtime hooks.
    from agent.api.core.panel_browser import BrowserAvailabilityHook
    from agent.api.core.threads import ThreadProjection
    from agent.api.core.tool_observation import ToolObservation
    from agent.api.core.tool_repair import ToolRepairTrigger

    always = (BrowserAvailabilityHook, ToolObservation, ThreadProjection, ToolRepairTrigger)
    assert [h for h in kwargs["hooks"] if not isinstance(h, always)] == [app_hook, runtime_hook]
    assert isinstance(kwargs["hooks"][1], BrowserAvailabilityHook) and isinstance(kwargs["hooks"][2], ToolObservation)
    assert isinstance(kwargs["hooks"][3], ThreadProjection) and isinstance(kwargs["hooks"][4], ToolRepairTrigger)
    assert order == ["app", "runtime"]


def test_create_panel_agent_without_hooks_is_unchanged(offline):
    build, _models, _catalogs, constructed, _storage = offline
    build()
    from agent.api.core.panel_browser import BrowserAvailabilityHook

    from agent.api.core.tool_observation import ToolObservation

    from agent.api.core.threads import ThreadProjection
    from agent.api.core.tool_repair import ToolRepairTrigger

    hooks = constructed[-1][1]["hooks"]
    assert len(hooks) == 4 and isinstance(hooks[0], BrowserAvailabilityHook) and isinstance(hooks[1], ToolObservation)
    assert isinstance(hooks[2], ThreadProjection) and isinstance(hooks[3], ToolRepairTrigger)
    assert constructed[-1][1]["trace_attributes"] == {"session.id": "session", "user.id": "user"}


def test_document_agent_conversations_are_not_projected_as_threads(offline):
    """Document Agent conversations belong to their page (document_conversations), not the thread list."""
    build, _models, _catalogs, constructed, _storage = offline
    from agent.api.core.threads import ThreadProjection

    build(agent_scope="document")
    assert not any(isinstance(hook, ThreadProjection) for hook in constructed[-1][1]["hooks"])
    build(agent_scope="panel")
    assert any(isinstance(hook, ThreadProjection) for hook in constructed[-1][1]["hooks"])


def test_create_panel_agent_repair_disabled_drops_trigger(offline, monkeypatch):
    monkeypatch.setenv("RON_TOOL_REPAIR", "0")
    build, _models, _catalogs, constructed, _storage = offline
    build()
    from agent.api.core.tool_repair import ToolRepairTrigger

    assert not any(isinstance(h, ToolRepairTrigger) for h in constructed[-1][1]["hooks"])
    assert not any(getattr(p, "name", "") == "ron:tool-repair-notice" for p in constructed[-1][1]["plugins"])


# --- browser target selection (todo 13) ---------------------------------------------------

def test_browser_kwarg_configures_only_the_selected_server(offline, monkeypatch):
    from agent.api.core import panel_browser
    from agent.api.core.panel_browser import BrowserAvailabilityHook, browser_server_config, server_name

    for name in ("RON_BROWSER_DEFAULT",):
        monkeypatch.delenv(name, raising=False)
    build, _models, catalogs, constructed, _storage = offline

    agent = build(browser="cloud")
    catalog = catalogs[-1]
    assert set(catalog._server_config) == {"cloud_browser"}
    assert catalog._server_config["cloud_browser"] == browser_server_config("cloud")["cloud_browser"]
    assert not any(n.startswith(("cloud_browser_", "user_browser_")) for n in agent.tool_registry.registry)
    hooks = [h for h in constructed[-1][1]["hooks"] if isinstance(h, BrowserAvailabilityHook)]
    assert len(hooks) == 1 and hooks[0].browser == "cloud"

    build(browser="user")
    assert set(catalogs[-1]._server_config) == {"user_browser"}
    assert [h.browser for h in constructed[-1][1]["hooks"] if isinstance(h, BrowserAvailabilityHook)] == ["user"]

    build()  # omitted -> default_browser()
    assert set(catalogs[-1]._server_config) == {server_name(panel_browser.default_browser())}


def test_browser_kwarg_invalid_fails_before_model_construction(offline):
    build, models, _catalogs, _constructed, _storage = offline
    before = len(models)
    with pytest.raises(ValueError):
        build(browser="laptop")
    assert len(models) == before


def test_browser_client_factory_builds_prefixed_client_with_elicitation_policy(offline, monkeypatch):
    from agent.api.core.panel_browser import browser_client_factory, server_name

    captured = []
    native_init = MCPClient.__init__

    def spy(self, *args, **kwargs):
        captured.append(kwargs)
        native_init(self, *args, **kwargs)

    monkeypatch.setattr(MCPClient, "__init__", spy)
    build, _models, catalogs, _constructed, _storage = offline
    build(browser="user")
    catalog = catalogs[-1]
    factory = catalog._client_factories[server_name("user")]
    client = factory()
    assert isinstance(client, MCPClient)
    assert client._elicitation_callback is accept_browser_elicitation
    assert client._prefix == "user_browser"
    assert captured[-1]["prefix"] == "user_browser"
    assert captured[-1]["elicitation_callback"] is accept_browser_elicitation
    # Not started: no session thread yet.
    assert getattr(client, "_background_thread", None) is None
    # The module-level factory is the same thing the catalog uses.
    assert browser_client_factory("cloud")()._prefix == "cloud_browser"


def test_browser_tools_are_parent_only(offline):
    """think children and formation children never inherit <browser>_browser_* tools."""
    from agent.api.core.panel_tools import THINK_EXCLUDED_TOOLS, is_parent_only_tool

    build, _models, _catalogs, _constructed, _storage = offline
    agent = build(browser="user")
    assert is_parent_only_tool("user_browser_playwright_List_tabs")
    assert is_parent_only_tool("cloud_browser_playwright_List_tabs")
    assert not is_parent_only_tool("shell")
    assert "tool_catalog" in THINK_EXCLUDED_TOOLS
    with pytest.raises(ValueError):
        composition._assigned_tools(agent, ["user_browser_x"])


def test_xai_agents_get_the_state_pruner_hook(offline, monkeypatch):
    """Only xAI threads carry strands_xai's encrypted-state blobs, so only they get XAIStatePruner."""
    from agent.api.core import panel_agent as composition
    from agent.api.core.xai_model import XAIStatePruner

    build, _models, _catalogs, constructed, _storage = offline
    build()
    assert not any(isinstance(h, XAIStatePruner) for h in constructed[-1][1]["hooks"])
    composition.create_panel_agent(provider="xai", model_id="grok-4.7", user_id="user", session_id="session",
                                   system_prompt="Test composition", extra_tools=[])
    hooks = constructed[-1][1]["hooks"]
    assert sum(isinstance(h, XAIStatePruner) for h in hooks) == 1


def test_harness_builtin_plugins_and_todo_tool(offline):
    from strands_harness.plugins import EnvironmentContext, Todos
    build, models, catalogs, constructed, storage = offline
    agent = build()
    kwargs = constructed[-1][1]
    assert any(isinstance(p, Todos) for p in kwargs["plugins"])
    assert any(isinstance(p, EnvironmentContext) for p in kwargs["plugins"])
    # The Todos plugin vends todo_write; the list lives in agent.state (snapshot-persisted).
    assert "todo_write" in agent.tool_registry.registry


def test_harness_plugins_gated_and_interventions_resolved(offline, monkeypatch):
    from strands_harness.plugins import EnvironmentContext, Todos
    build, models, catalogs, constructed, storage = offline
    monkeypatch.setattr(composition, "PANEL_TODOS", False)
    monkeypatch.setattr(composition, "PANEL_ENVIRONMENT_CONTEXT", False)
    monkeypatch.setattr(composition, "PANEL_INTERVENTIONS", "ask")
    build()
    kwargs = constructed[-1][1]
    assert not any(isinstance(p, (Todos, EnvironmentContext)) for p in kwargs["plugins"])
    # strands_harness intervention sugar resolved onto the native Agent kwarg.
    assert kwargs["interventions"]
