"""Offline tests for Deep Research: the formation as Strands builds it, the kept events and the runs.

The agents run on ``ScriptedModel``, a Strands ``Model`` that calls ``subagent`` and
``handoff_to_agent`` where a real model would, so nothing leaves the machine.
"""

from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Iterator
import io
import json
from pathlib import Path
import re
from typing import Any, override

from fastapi import FastAPI
import httpx
from PIL import Image
import pytest
from strands.hooks import BeforeToolCallEvent
from strands import Agent, tool
from strands.models.model import Model
from strands.multiagent import Status, Swarm
from strands.multiagent.base import MultiAgentResult, NodeResult
from strands.multiagent.graph import Graph
from strands.storage import InMemoryStorage
from strands.types.exceptions import StorageError
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolContext
from strands.vended_plugins.context_injector import ContextInjector

from agent.api.core import config as app_config
from agent.api.core import deep_research, panel_storage
from agent.api.core.deep_research_tools import deep_research_tools
from agent.api.endpoints import deep_research as deep_research_endpoints

_ROLE_RE = re.compile(r"^## Your role: (.+)$", re.MULTILINE)

#: Who each Swarm agent hands off to; a Swarm agent that hands off to nobody ends its Swarm.
#: The agent a Swarm agent's "## Handing off" section sends it to once its work is done.
_DONE_HANDOFF_RE = re.compile(r"^## Handing off\n.*?When .*?hand off to (\w+)\.", re.MULTILINE)


def _tool_use(tool_use_id: str, name: str, tool_input: dict[str, Any]) -> Iterator[StreamEvent]:
    yield {"messageStart": {"role": "assistant"}}
    yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": tool_use_id, "name": name}}}}
    yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(tool_input)}}}}
    yield {"contentBlockStop": {"contentBlockIndex": 0}}
    yield {"messageStop": {"stopReason": "tool_use"}}


def _text(text: str) -> Iterator[StreamEvent]:
    yield {"messageStart": {"role": "assistant"}}
    yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"reasoningContent": {"text": "Thinking."}}}}
    yield {"contentBlockStop": {"contentBlockIndex": 0}}
    yield {"contentBlockDelta": {"contentBlockIndex": 1, "delta": {"text": text}}}
    yield {"contentBlockStop": {"contentBlockIndex": 1}}
    yield {"messageStop": {"stopReason": "end_turn"}}


def _tool_results(messages: list[Any]) -> int:
    return sum(
        1
        for message in messages
        if message.get("role") == "user"
        for block in message.get("content") or ()
        if "toolResult" in block
    )


class ScriptedModel(Model):
    """Each Swarm agent hands off as its instructions say once its work is done; the researcher first runs one
    ``subagent``."""

    def __init__(self, gate: asyncio.Event | None = None) -> None:
        self.gate = gate
        self.roles: list[str] = []

    def update_config(self, **model_config: Any) -> None:
        del model_config

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "scripted"}

    async def structured_output(
        self, output_model: Any, prompt: Any, system_prompt: Any = None, **kwargs: Any
    ) -> AsyncGenerator[dict[str, Any], None]:
        raise NotImplementedError
        yield {}

    async def stream(
        self,
        messages: Any,
        tool_specs: list[Any] | None = None,
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[StreamEvent]:
        if self.gate is not None:
            await self.gate.wait()
        role = _ROLE_RE.search(system_prompt or "")
        label = role.group(1) if role else ""
        msg_list = list(messages)
        done = _tool_results(msg_list)
        called = {
            block["toolUse"]["name"]
            for message in msg_list
            if message.get("role") == "assistant"
            for block in message.get("content") or ()
            if "toolUse" in block
        }
        has_subagent = label == "Researcher" and "subagent" in {spec["name"] for spec in tool_specs or ()}
        subagent_settled = any(
            message.get("role") == "user"
            and any(
                isinstance(block.get("text"), str) and block["text"].startswith("[subagent-completed]")
                for block in message.get("content") or ()
            )
            for message in msg_list
        )
        handoff = _DONE_HANDOFF_RE.search(system_prompt or "")
        if role and not called:
            self.roles.append(label)
        next_call: tuple[str, dict[str, Any]] | None = None
        if has_subagent and "subagent" not in called:
            next_call = ("subagent", {"task": "Find the surface code threshold."})
        elif has_subagent and not subagent_settled:
            # Wait for the native background subagent to settle before calling handoff_to_agent.
            next_call = None
        elif handoff and "handoff_to_agent" not in called:
            next_call = ("handoff_to_agent", {"agent_name": handoff.group(1), "message": f"{label} is done."})
        events = _tool_use(f"{label or 'sub'}-{done}", *next_call) if next_call is not None else _text(f"{label} done.")
        for event in events:
            yield event


@pytest.fixture
def isolated(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    monkeypatch.setattr(app_config, "RON_DEEP_RESEARCH_ARTIFACTS_DIR", tmp_path / "artifacts")
    monkeypatch.setattr(app_config, "RON_DEEP_RESEARCH_ENABLED", True)
    monkeypatch.setattr(deep_research, "_RUNS", {})


def _formations() -> list[deep_research.FormationSpec]:
    return [*deep_research.FORMATION_TOPOLOGY["nodes"], deep_research.BUILD_SWARM, deep_research.GRID_SWARM]


def _agents() -> list[deep_research.AgentSpec]:
    return [agent for formation in _formations() for agent in formation["children"]]


def test_every_agent_has_its_skill_and_swarms_have_no_edges() -> None:
    skills = {skill.name for skill in deep_research.Skill.from_directory(deep_research.DEEP_RESEARCH_SKILLS_DIR)}
    agents = _agents()
    assert len(agents) == 21
    assert len({agent["id"] for agent in agents}) == len(agents)
    assert {agent["skill"] for agent in agents} <= skills
    for formation in _formations():
        if formation["kind"] == "swarm":
            assert formation["edges"] == []


def test_each_agent_gets_only_the_listed_sections_of_its_skill() -> None:
    skills = {skill.name: skill for skill in deep_research.Skill.from_directory(deep_research.DEEP_RESEARCH_SKILLS_DIR)}
    agents = {agent["id"]: agent for agent in _agents()}
    assert set(deep_research.SKILL_SECTIONS) <= set(agents)
    for agent_id, headings in deep_research.SKILL_SECTIONS.items():
        skill = skills[agents[agent_id]["skill"]]
        text = deep_research.skill_sections(skill.instructions, headings)
        assert len(text) < len(skill.instructions)
        for heading in headings:
            assert re.search(rf"^#+ {re.escape(heading)}$", text, re.MULTILINE)


def test_skill_sections_end_at_the_next_heading_of_their_level_and_skip_code_fences() -> None:
    body = "# Skill\n## Keep\ntext\n```sh\n# not a heading\n```\n### Inner\nmore\n## Drop\ngone\n"
    assert deep_research.skill_sections(body, ("Keep",)) == "## Keep\ntext\n```sh\n# not a heading\n```\n### Inner\nmore"
    with pytest.raises(ValueError):
        deep_research.skill_sections(body, ("Missing",))


@pytest.mark.parametrize("outcome", deep_research.VALID_OUTCOMES)
def test_every_swarm_agent_is_told_when_to_hand_off_and_only_the_last_agent_ends_it(
    outcome: deep_research.Outcome,
) -> None:
    handoffs = {**deep_research.SWARM_HANDOFFS, **deep_research.OUTCOME_HANDOFFS[outcome]}
    for formation in deep_research.outcome_topology(outcome)["nodes"]:
        ids = [agent["id"] for agent in formation["children"]]
        if formation["kind"] == "graph":
            assert not set(ids) & set(handoffs)
            continue
        for agent_id in ids:
            text = handoffs[agent_id]
            assert set(re.findall(r"hand off to (\w+)", text)) - {"the", "its"} <= set(ids)
            assert ("without handing off" in text) == (agent_id == ids[-1])


def test_each_outcome_keeps_its_team_and_chains_its_formations() -> None:
    report = deep_research.outcome_topology("report")
    assert [node["id"] for node in report["nodes"]] == ["research_swarm", "data_analysis_graph", "writing_swarm"]
    assert [agent["id"] for agent in report["nodes"][2]["children"]] == [
        "report_designer", "layout_qa", "report_writer", "report_qa"
    ]
    assert report["edges"] == [
        {"from": "research_swarm", "to": "data_analysis_graph"},
        {"from": "data_analysis_graph", "to": "writing_swarm"},
    ]
    deck = deep_research.outcome_topology("deck")
    assert [node["id"] for node in deck["nodes"]][-1] == "production_graph"
    production = deck["nodes"][-1]
    assert [agent["id"] for agent in production["children"]] == ["deck_producer", "deck_build_qa"]
    assert production["edges"] == [{"from": "deck_producer", "to": "deck_build_qa"}]


@tool
def computer_start_process(command: str) -> str:
    """Start a process on the workspace computer.

    Args:
        command: The command.
    """
    return command


@pytest.fixture
def computer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_config, "COMPUTER_MCP_URL", "http://computer:8080/computer/mcp")
    monkeypatch.setattr(app_config, "COMPUTER_MCP_TOKEN", "token")
    monkeypatch.setattr(deep_research, "computer_tools", lambda: [computer_start_process])


def test_build_outcomes_are_offered_only_with_the_workspace_computer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_config, "COMPUTER_MCP_URL", "")
    assert deep_research.available_outcomes() == ("report", "deck", "datagrid")
    assert asyncio.run(deep_research_endpoints.get_deep_research_status())["outcomes"] == ["report", "deck", "datagrid"]
    monkeypatch.setattr(app_config, "COMPUTER_MCP_URL", "http://computer:8080/computer/mcp")
    monkeypatch.setattr(app_config, "COMPUTER_MCP_TOKEN", "token")
    assert deep_research.available_outcomes() == deep_research.VALID_OUTCOMES
    status = asyncio.run(deep_research_endpoints.get_deep_research_status())
    assert status["outcomes"] == list(deep_research.VALID_OUTCOMES)
    assert status["topologies"] == {
        outcome: deep_research.outcome_topology(outcome) for outcome in deep_research.VALID_OUTCOMES
    }
    assert status["topology"] == deep_research.FORMATION_TOPOLOGY


def _has_turn_budget(agent: Agent) -> bool:
    return any(isinstance(plugin, deep_research.TurnBudget) for plugin in agent._plugin_registry._plugins.values())


@pytest.mark.parametrize("outcome", sorted(deep_research.BUILD_OUTCOMES))
def test_a_build_outcome_researches_then_has_opencode_build_it(
    isolated: None, computer: None, outcome: deep_research.Outcome
) -> None:
    topology = deep_research.outcome_topology(outcome)
    assert [node["id"] for node in topology["nodes"]] == ["research_swarm", "build_swarm"]
    assert topology["edges"] == [{"from": "research_swarm", "to": "build_swarm"}]
    graph = deep_research.build_deep_research_graph(
        session_id="dr-app", user_id="u1", model=ScriptedModel(), depth="fast", outcome=outcome
    )
    agents = _formation_agents(graph)
    assert set(agents) == deep_research.OUTCOME_AGENTS[outcome]
    agent = agents["app_builder"]
    prompt = agent.system_prompt or ""
    assert deep_research.BUILD_NOTES[outcome] in prompt
    assert "REN_USER_ID=u1 opencode run" in prompt and "--continue" in prompt and "- report.md:" not in prompt
    assert "computer_start_process" in agent.tool_names and "register_application" in agent.tool_names
    assert not _has_turn_budget(agent)
    assert _has_turn_budget(agents["researcher"])


@pytest.mark.asyncio
async def test_a_build_outcome_needs_the_computer_a_mobile_app_an_account_and_the_run_keeps_its_app(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app_config, "COMPUTER_MCP_URL", "")
    with pytest.raises(ValueError, match="workspace computer"):
        await deep_research.start_run(user_id="u1", query="A tide-table app", outcome="mobile_app")
    monkeypatch.setattr(app_config, "COMPUTER_MCP_URL", "http://computer:8080/computer/mcp")
    monkeypatch.setattr(app_config, "COMPUTER_MCP_TOKEN", "token")
    with pytest.raises(ValueError, match="Sign in to Ren"):
        await deep_research.start_run(user_id="u1", query="A tide-table app", outcome="mobile_app")
    monkeypatch.setattr(deep_research, "computer_tools", lambda: [computer_start_process])
    monkeypatch.setattr(deep_research, "build_model", lambda *args, **kwargs: ScriptedModel())
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("gemini", "scripted"))
    listeners: list[Callable[[deep_research.Application], None]] = []
    build = deep_research.build_deep_research_graph

    def capture(**kwargs: Any) -> Graph:
        listeners.append(kwargs["on_application"])
        return build(**kwargs)

    async def hold(run: Any, graph: Graph, task: str) -> None:
        del run, graph, task

    monkeypatch.setattr(deep_research, "build_deep_research_graph", capture)
    monkeypatch.setattr(deep_research, "_execute", hold)
    meta = await deep_research.start_run(user_id="6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5", query="A tide-table app",
                                         depth="fast", outcome="mobile_app")
    app = deep_research.Application(id="app-1", name="Tides", kind="android",
                                    location="/config/workspace/tides/app-debug.apk", description="Tide tables.",
                                    created_at=1.0)
    listeners[0](app)
    assert meta.get("application") == app.model_dump()


def test_a_spreadsheet_outcome_researches_then_builds_the_grid(isolated: None) -> None:
    topology = deep_research.outcome_topology("datagrid")
    assert [node["id"] for node in topology["nodes"]] == ["research_swarm", "grid_swarm"]
    assert topology["edges"] == [{"from": "research_swarm", "to": "grid_swarm"}]
    assert "datagrid" in deep_research.available_outcomes()
    graph = deep_research.build_deep_research_graph(
        session_id="dr-grid", user_id="u1", model=ScriptedModel(), depth="fast", outcome="datagrid"
    )
    agents = _formation_agents(graph)
    assert set(agents) == deep_research.OUTCOME_AGENTS["datagrid"]
    prompt = agents["grid_builder"].system_prompt or ""
    assert deep_research.GRID_JSON in prompt and "grid.json" in prompt
    assert "- research.md: at least 15" in prompt and "- report.md:" not in prompt
    assert _has_turn_budget(agents["grid_builder"])
    # The tool Ren's agents start a run with names every outcome a run can make.
    start = deep_research_tools(user_id="u1")[0]
    assert tuple(start.tool_spec["inputSchema"]["json"]["properties"]["outcome"]["enum"]) == deep_research.VALID_OUTCOMES


@pytest.mark.asyncio
async def test_a_spreadsheet_run_gives_its_grid_and_opens_as_a_document(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = ScriptedModel()
    monkeypatch.setattr(deep_research, "build_model", lambda *args, **kwargs: model)
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("gemini", "scripted"))
    meta = await deep_research.start_run(user_id="u1", query="EV range by model", depth="fast", outcome="datagrid")
    session_id = meta["session_id"]
    run = await _wait_until_done("u1", session_id)
    assert run["status"] == "completed" and run["grid_json"] == ""
    assert model.roles[-1] == "Grid Builder"
    assert await deep_research.report_document(user_id="u1", session_id=session_id) is None
    grid = {"title": "EV range", "sheets": [
        {"name": "Models", "rows": [["Model", "Range (km)", "Price (USD)", "USD per km", "Source"],
                                    ["Atlas", 520, 41000, "=C2/B2", "[1]"]], "formats": {"D": "$#,##0.00"}},
        {"name": "Sources", "rows": [["Number", "Title", "URL"], [1, "Atlas specifications", "https://example.com/atlas"]]},
    ]}
    (deep_research.artifacts_dir(session_id) / "grid.json").write_text(json.dumps(grid), encoding="utf-8")
    run = await deep_research.get_run(user_id="u1", session_id=session_id)
    assert run is not None and json.loads(str(run["grid_json"])) == grid
    document = await deep_research.report_document(user_id="u1", session_id=session_id)
    assert document is not None and document["title"] == "EV range"
    content = str(document["content"])
    assert content.startswith('<grid-block data-grid="{&quot;title&quot;: &quot;EV range&quot;')
    assert "<caption>Models</caption>" in content and "<th>Range (km)</th>" in content and "<td>=C2/B2</td>" in content
    (deep_research.artifacts_dir(session_id) / "grid.json").write_text("{not json", encoding="utf-8")
    assert await deep_research.report_document(user_id="u1", session_id=session_id) is None


def test_the_formation_is_a_graph_of_swarms_and_graphs(isolated: None) -> None:
    graph = deep_research.build_deep_research_graph(
        session_id="dr-build", user_id="u1", model=ScriptedModel(), depth="medium", outcome="deck"
    )
    assert isinstance(graph, Graph)
    kinds = {node_id: type(node.executor) for node_id, node in graph.nodes.items()}
    assert kinds == {
        "research_swarm": Swarm,
        "data_analysis_graph": Graph,
        "writing_swarm": Swarm,
        "production_graph": Graph,
    }
    research = graph.nodes["research_swarm"].executor
    assert isinstance(research, Swarm)
    assert list(research.nodes) == ["researcher", "fact_checker", "citation_manager", "research_qa"]
    production = graph.nodes["production_graph"].executor
    assert isinstance(production, Graph)
    assert {node.node_id for node in production.entry_points} == {"deck_producer"}
    for node in graph.nodes.values():
        assert getattr(node.executor, "_session_manager", None) is None


def _formation_agents(graph: Graph) -> dict[str, Agent]:
    agents: dict[str, Agent] = {}
    for node in graph.nodes.values():
        executor = node.executor
        if isinstance(executor, Swarm):
            agents.update({node_id: swarm_node.executor for node_id, swarm_node in executor.nodes.items()})
        elif isinstance(executor, Graph):
            for inner_id, inner in executor.nodes.items():
                assert isinstance(inner.executor, Agent)
                agents[inner_id] = inner.executor
    return agents


def test_six_levels_from_fast_to_ultra_each_with_its_prompt_and_size() -> None:
    assert deep_research.VALID_DEPTHS == ("fast", "low", "medium", "high", "xhigh", "ultra")
    levels = deep_research.LEVELS
    assert (levels["fast"]["pages"], levels["ultra"]["pages"]) == ((5, 8), (30, 40))
    for field in ("sources", "figures", "slides", "turns"):
        values = [levels[depth][field] for depth in deep_research.VALID_DEPTHS]
        assert values == sorted(set(values)), field
    prompts = {depth: deep_research.level_prompt(depth, "Tuesday, November 17, 2026") for depth in deep_research.VALID_DEPTHS}
    assert len(set(prompts.values())) == 6
    assert "at most three per sentence" in prompts["fast"] and "Finish complete" not in prompts["fast"]
    assert all("Finish complete" in prompts[depth] for depth in ("low", "medium", "high", "xhigh", "ultra"))
    assert "## Sandbox" in prompts["xhigh"] and "## Sandbox" not in prompts["high"]
    assert "a long run is expected" in prompts["ultra"]
    assert "5 to 8 pages" in prompts["fast"] and "30 to 40 pages" in prompts["ultra"]
    assert "turns" not in prompts["ultra"].split("## How you work")[1]


def test_each_agent_has_the_level_prompt_its_budget_and_its_tools(isolated: None) -> None:
    graph = deep_research.build_deep_research_graph(session_id="dr-tools", user_id="u1", model=ScriptedModel(),
                                                    depth="ultra", outcome="deck")
    agents = _formation_agents(graph)
    assert set(agents) == deep_research.OUTCOME_AGENTS["deck"]
    for agent_id, agent in agents.items():
        assert (agent.system_prompt or "").count("# Deep Research: Ultra") == 1, agent_id
        tools = set(agent.tool_names)
        assert ("skills" in tools) == (agent_id in deep_research.SLIDEV_AGENTS), agent_id
        assert ("render_workflow" in tools) == (agent_id == "report_writer"), agent_id
        assert "subagent" in tools
    deck = agents["deck_producer"].system_prompt or ""
    assert "three.js" in deck and "routerMode: hash" in deck


class LoopingModel(Model):
    """Calls ``note`` on every turn, recording the text the last user message carried into each call."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def update_config(self, **model_config: Any) -> None:
        del model_config

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "looping"}

    async def structured_output(
        self, output_model: Any, prompt: Any, system_prompt: Any = None, **kwargs: Any
    ) -> AsyncGenerator[dict[str, Any], None]:
        raise NotImplementedError
        yield {}

    async def stream(
        self, messages: Any, tool_specs: list[Any] | None = None, system_prompt: str | None = None, **kwargs: Any
    ) -> AsyncIterator[StreamEvent]:
        last = list(messages)[-1]
        self.calls.append("".join(block.get("text", "") for block in last.get("content") or ()))
        for event in _tool_use(f"t{len(self.calls)}", "note", {"text": str(len(self.calls))}):
            yield event


@tool
def note(text: str) -> str:
    """Note something down.

    Args:
        text: What to note.
    """
    return text


class WrapUpModel(LoopingModel):
    """Keeps calling ``note`` until a call is declined, then replies with its findings."""

    async def stream(
        self, messages: Any, tool_specs: list[Any] | None = None, system_prompt: str | None = None, **kwargs: Any
    ) -> AsyncIterator[StreamEvent]:
        msgs = list(messages)
        last = msgs[-1]
        self.calls.append(json.dumps(last.get("content")))
        if "Wrap up now" in self.calls[-1]:
            for event in _text("All findings: 1, 2, 3."):
                yield event
            return
        for event in _tool_use(f"t{len(self.calls)}", "note", {"text": str(len(self.calls))}):
            yield event


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["researcher", "a-subagent"])
async def test_the_wrap_up_nudge_reminds_then_declines_calls_and_the_agent_writes_its_own_last_reply(
    name: str,
) -> None:
    """Nothing is cut off: past the budget a call is declined with what to do, and the model replies itself."""
    budget = deep_research.TurnBudget(7, frozenset({"researcher"}))
    model = WrapUpModel()
    agent = Agent(name=name, model=model, tools=[note], callback_handler=None,
                  plugins=[budget, ContextInjector(budget.reminder, trigger="everyTurn")])
    result = await agent.invoke_async("Research it.", limits={"turns": 20})
    assert str(result).strip() == "All findings: 1, 2, 3."
    assert result.stop_reason == "end_turn"
    assert len(model.calls) == 9
    reminded = [call for call in model.calls if "last few calls" in call]
    assert len(reminded) == 7 and "last few calls" not in model.calls[1]
    assert ("Stop delegating" in model.calls[7]) == (name == "researcher")
    assert "Wrap up now" in model.calls[8]


@pytest.mark.asyncio
async def test_a_node_past_its_budget_can_still_write_its_file_and_hand_off() -> None:
    budget = deep_research.TurnBudget(1, frozenset({"researcher"}))
    agent = Agent(name="researcher", model=LoopingModel(), callback_handler=None)
    for tool_name, declined in (("write", False), ("handoff_to_agent", False), ("tavily_search", True)):
        event = BeforeToolCallEvent(agent=agent, selected_tool=None, tool_use={"toolUseId": "x", "name": tool_name,
                                                                                "input": {}}, invocation_state={})
        budget.turns = -1
        budget.wrap_up(event)
        assert bool(event.cancel_tool) is declined


@pytest.mark.asyncio
async def test_the_report_becomes_document_html_with_workflow_blocks_and_inline_figures(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = ScriptedModel()
    monkeypatch.setattr(deep_research, "build_model", lambda *args, **kwargs: model)
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("gemini", "scripted"))
    meta = await deep_research.start_run(user_id="u1", query="Grid storage", depth="fast")
    session_id = meta["session_id"]
    await _wait_until_done("u1", session_id)
    workspace = deep_research.artifacts_dir(session_id)
    (workspace / "figures").mkdir()
    Image.new("RGB", (3200, 1000), (85, 67, 255)).save(workspace / "figures" / "cost.png")
    workflow = {"title": "Permitting", "steps": [{"id": "a", "label": "Apply"}, {"id": "b", "label": "Approve"}]}
    (workspace / "report.md").write_text(
        "# Grid storage costs\n\nCosts fell[1].\n\n![Cost per kWh](figures/cost.png)\n\n```workflow\n"
        + json.dumps(workflow) + "\n```\n\n```embeds\n[YouTube: Tour](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n```\n",
        encoding="utf-8",
    )
    document = await deep_research.report_document(user_id="u1", session_id=session_id)
    assert document is not None and document["title"] == "Grid storage costs" and document["document_id"] is None
    content = str(document["content"])
    assert content.startswith("<p>Costs fell[1].</p>")
    figure = re.search(r'<img src="data:image/webp;base64,([^"]+)"', content)
    assert figure is not None
    with Image.open(io.BytesIO(base64.b64decode(figure.group(1)))) as image:
        assert (image.format, image.size) == ("WEBP", (1600, 500))
    assert '<workflow-block data-id="' in content and 'data-title="Permitting"' in content and "<li>Apply</li>" in content
    assert '<code class="language-embeds">' in content
    saved = await deep_research.set_report_document(user_id="u1", session_id=session_id, document_id="doc-1")
    assert saved is not None and saved["document_id"] == "doc-1"
    assert await deep_research.report_document(user_id="u2", session_id=session_id) is None


def test_filter_event_keeps_documented_fields_through_nested_streams() -> None:
    agent_text = {"data": "Hello", "delta": {"text": "Hello"}, "agent": object()}
    nested = {
        "type": "multiagent_node_stream",
        "node_id": "research_swarm",
        "event": {"type": "multiagent_node_stream", "node_id": "researcher", "event": agent_text},
    }
    assert deep_research.filter_event(nested) == {
        "type": "multiagent_node_stream",
        "node_id": "research_swarm",
        "event": {"type": "multiagent_node_stream", "node_id": "researcher", "event": {"data": "Hello"}},
    }
    sub = {
        "tool_stream_event": {
            "tool_use": {"toolUseId": "t1", "name": "subagent", "input": {"task": "x"}, "extra": 1},
            "data": {"reasoningText": "Hmm", "reasoning": True},
        }
    }
    assert deep_research.filter_event(sub) == {
        "tool_stream_event": {
            "tool_use": {"toolUseId": "t1", "name": "subagent", "input": {"task": "x"}},
            "data": {"reasoningText": "Hmm"},
        }
    }
    stop = {"type": "multiagent_node_stop", "node_id": "n", "node_result": NodeResult(result=Exception("boom"))}
    kept = deep_research.filter_event(stop)
    assert kept is not None and kept["node_result"] == NodeResult(result=Exception("boom")).to_dict()
    result = {"type": "multiagent_result", "result": MultiAgentResult(status=Status.COMPLETED)}
    assert deep_research.filter_event(result) == {
        "type": "multiagent_result",
        "result": MultiAgentResult(status=Status.COMPLETED).to_dict(),
    }
    assert deep_research.filter_event({"init_event_loop": True}) is None
    assert deep_research.filter_event({"event": {"messageStart": {"role": "assistant"}}}) is None


def _inner_events(events: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    for event in events:
        current: Any = event
        while isinstance(current, dict):
            yield current
            current = current.get("event")


async def _wait_until_done(user_id: str, session_id: str) -> dict[str, object]:
    for _ in range(600):
        run = await deep_research.get_run(user_id=user_id, session_id=session_id)
        assert run is not None
        if not run["active"]:
            return run
        await asyncio.sleep(0.05)
    raise AssertionError("the run did not finish")


@pytest.mark.asyncio
async def test_a_run_streams_the_sdk_events_and_reopens_from_storage(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = ScriptedModel()
    monkeypatch.setattr(deep_research, "build_model", lambda *args, **kwargs: model)
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("gemini", "scripted"))

    meta = await deep_research.start_run(user_id="u1", query="Surface codes vs qLDPC", depth="fast", outcome="deck")
    assert meta["outcome"] == "deck"
    session_id = meta["session_id"]
    run = await _wait_until_done("u1", session_id)
    assert run["status"] == "completed", run["error"]

    assert model.roles[:15] == [
        "Researcher",
        "Fact Checker",
        "Citation Manager",
        "Research QA",
        "Visual Planner",
        "Data Analyst",
        "Visual Citation",
        "Visual QA",
        "Report Designer",
        "Deck Designer",
        "Layout QA",
        "Report Writer",
        "Report QA",
        "Deck Writer",
        "Deck QA",
    ]
    assert set(model.roles[15:]) == {"Slidev Producer", "Slidev QA"}

    events = run["events"]
    assert isinstance(events, list)
    flat = list(_inner_events(events))
    assert {"type": "multiagent_handoff", "from_node_ids": ["researcher"], "to_node_ids": ["fact_checker"],
            "message": "Researcher is done."} in flat
    assert any(event.get("type") == "multiagent_node_start" and event.get("node_id") == "writing_swarm" for event in flat)
    assert any("reasoningText" in event for event in flat)
    sub_events = [event["tool_stream_event"] for event in flat if "tool_stream_event" in event]
    assert sub_events and sub_events[0]["tool_use"]["name"] == "subagent"
    assert events[-1]["type"] == "multiagent_result"

    frames = [frame async for frame in deep_research.stream_events(user_id="u1", session_id=session_id, after=0)]
    assert len(frames) == len(events) + 1
    assert frames[0].startswith("id: 1\ndata: ")
    assert frames[-1].startswith("event: run\n")

    monkeypatch.setattr(deep_research, "_RUNS", {})
    reopened = await deep_research.get_run(user_id="u1", session_id=session_id)
    assert reopened is not None and reopened["events"] == json.loads(json.dumps(events, default=str))
    assert [listed["session_id"] for listed in await deep_research.list_runs(user_id="u1")] == [session_id]
    assert await deep_research.get_run(user_id="u2", session_id=session_id) is None

    assert await deep_research.delete_run(user_id="u1", session_id=session_id)
    assert await deep_research.get_run(user_id="u1", session_id=session_id) is None


class RefusingStorage(InMemoryStorage):
    """The bucket refusing a run's save, as Hugging Face's 429 did: while ``refusing``, a write of a run file waits
    for ``gate`` and then fails once."""

    def __init__(self) -> None:
        super().__init__()
        self.gate = asyncio.Event()
        self.refusing = False
        self.refused = 0

    @override
    async def write(self, key: str, data: bytes) -> None:
        if self.refusing and "deep_research/runs/" in key:
            _ = await self.gate.wait()
            self.refusing = False
            self.refused += 1
            raise StorageError(f"HF Bucket write failed for {key!r}")
        await super().write(key, data)


@pytest.mark.asyncio
async def test_a_refused_save_neither_holds_the_events_nor_fails_the_run(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = RefusingStorage()
    monkeypatch.setattr(panel_storage, "_storage", storage)
    monkeypatch.setattr(deep_research, "_SAVE_INTERVAL_SECONDS", 0.0)
    model = ScriptedModel()

    def scripted(*_args: object, **_kwargs: object) -> ScriptedModel:
        return model

    def selection(*_args: object) -> tuple[str, str]:
        return ("gemini", "scripted")

    monkeypatch.setattr(deep_research, "build_model", scripted)
    monkeypatch.setattr(deep_research, "resolve_selection", selection)

    meta = await deep_research.start_run(user_id="u1", query="Surface codes vs qLDPC", depth="fast")
    session_id = meta["session_id"]
    storage.refusing = True
    seen = 0
    async with asyncio.timeout(10):
        async for _frame in deep_research.stream_events(user_id="u1", session_id=session_id):
            seen += 1
            if seen > 20:
                break
    assert storage.refused == 0

    storage.gate.set()
    run = await _wait_until_done("u1", session_id)
    assert storage.refused and run["status"] == "completed", run["error"]

    monkeypatch.setattr(deep_research, "_RUNS", {})
    reopened = await deep_research.get_run(user_id="u1", session_id=session_id)
    assert reopened is not None and reopened["status"] == "completed"


@pytest.mark.asyncio
async def test_cancel_stops_the_run_and_a_saved_active_run_reads_as_failed(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    gate = asyncio.Event()
    monkeypatch.setattr(deep_research, "build_model", lambda *args, **kwargs: ScriptedModel(gate))
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("gemini", "scripted"))

    meta = await deep_research.start_run(user_id="u1", query="Battery chemistry")
    session_id = meta["session_id"]
    await asyncio.sleep(0.2)
    cancelled = await deep_research.cancel_run(user_id="u1", session_id=session_id)
    assert cancelled is not None and cancelled["status"] == "cancelled" and not cancelled["active"]

    storage = panel_storage.get_user_session_storage("u1")
    saved = {**cancelled, "status": "running", "active": True}
    await storage.write(f"deep_research/runs/{session_id}/run.json", json.dumps(saved).encode())
    monkeypatch.setattr(deep_research, "_RUNS", {})
    reread = await deep_research.get_run(user_id="u1", session_id=session_id)
    assert reread is not None
    assert (reread["status"], reread["active"], reread["error"]) == (
        "failed",
        False,
        "The server stopped during this run.",
    )


@pytest.mark.asyncio
async def test_endpoints_are_loopback_only_and_serve_the_workspace(isolated: None) -> None:
    app = FastAPI()
    app.include_router(deep_research_endpoints.router)
    remote = httpx.ASGITransport(app=app, client=("203.0.113.42", 52100))
    async with httpx.AsyncClient(transport=remote, base_url="http://test") as client:
        assert (await client.get("/deep-research/status")).status_code == 403

    workspace = deep_research.artifacts_dir("dr-files")
    (workspace / "slides").mkdir(parents=True)
    (workspace / "report.md").write_text("# Report\n", encoding="utf-8")
    (workspace / "slides" / "index.html").write_text("<html></html>", encoding="utf-8")
    (workspace.parent / "secret.txt").write_text("no", encoding="utf-8")

    local = httpx.ASGITransport(app=app, client=("127.0.0.1", 52100))
    async with httpx.AsyncClient(transport=local, base_url="http://test") as client:
        status = (await client.get("/deep-research/status")).json()
        assert status["topology"]["nodes"][0]["id"] == "research_swarm"
        report = await client.get("/deep-research/runs/dr-files/artifacts/report.md")
        assert report.status_code == 200 and report.text == "# Report\n"
        assert (await client.get("/deep-research/runs/dr-files/artifacts/slides/")).text == "<html></html>"
        assert (await client.get("/deep-research/runs/dr-files/artifacts/%2E%2E/secret.txt")).status_code == 404
        download = await client.get("/deep-research/runs/dr-files/artifacts/report.md?download=true")
        assert download.headers["content-disposition"] == 'attachment; filename="report.md"'
        assert (await client.get("/deep-research/runs/dr-missing")).status_code == 404
        assert (await client.post("/deep-research/runs", json={"query": "  "})).status_code == 422
        assert (await client.post("/deep-research/runs", json={"query": "x", "depth": "deep"})).status_code == 422
        assert (await client.get("/deep-research/runs/dr-missing/document")).status_code == 404
        assert (await client.post("/deep-research/runs/dr-missing/document", json={"document_id": "d"})).status_code == 404


@pytest.mark.asyncio
async def test_a_run_saved_before_the_levels_is_listed_and_opened(isolated: None) -> None:
    """A run.json as the earlier version saved it: an old depth, and no document_id."""
    legacy = {
        "session_id": "dr-legacy", "user_id": "u1", "query": "Grid bottlenecks", "context": "", "title": "Grid",
        "depth": "deep", "status": "failed", "active": False, "created_at": "2026-11-17T11:49:13+00:00",
        "updated_at": "2026-11-17T12:05:01+00:00", "completed_at": None,
        "selection": {"provider": "mistral", "model_id": "mistral-large-latest", "reasoning_effort": None},
        "error": "The server stopped during this run.",
    }
    storage = panel_storage.get_user_session_storage("u1")
    await storage.write("deep_research/runs/dr-legacy/run.json", json.dumps(legacy).encode())
    await storage.write("deep_research/runs/dr-legacy/events.json", b"[]")
    app = FastAPI()
    app.include_router(deep_research_endpoints.router)
    local = httpx.ASGITransport(app=app, client=("127.0.0.1", 52100))
    async with httpx.AsyncClient(transport=local, base_url="http://test") as client:
        listed = await client.get("/deep-research/runs", params={"user_id": "u1"})
        assert listed.status_code == 200
        assert [(run["depth"], run["document_id"]) for run in listed.json()["runs"]] == [("medium", None)]
        opened = await client.get("/deep-research/runs/dr-legacy", params={"user_id": "u1"})
        assert opened.status_code == 200 and opened.json()["depth"] == "medium"


class FailingResearcherModel(Model):
    """Fails immediately in ``Researcher`` so ``research_swarm`` ends ``FAILED``."""

    def __init__(self) -> None:
        self.roles: list[str] = []

    def update_config(self, **model_config: Any) -> None:
        del model_config

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "failing"}

    async def structured_output(
        self, output_model: Any, prompt: Any, system_prompt: Any = None, **kwargs: Any
    ) -> AsyncGenerator[dict[str, Any], None]:
        raise NotImplementedError
        yield {}

    async def stream(
        self, messages: Any, tool_specs: list[Any] | None = None, system_prompt: str | None = None, **kwargs: Any
    ) -> AsyncIterator[StreamEvent]:
        del messages, tool_specs
        role = _ROLE_RE.search(system_prompt or "")
        if role:
            self.roles.append(role.group(1))
        raise RuntimeError("NIM container stalled")
        yield {}


@pytest.mark.asyncio
async def test_a_failed_swarm_stops_the_outer_graph_and_surfaces_its_node_exception(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = FailingResearcherModel()
    monkeypatch.setattr(deep_research, "configured_providers", lambda: ["nim"])
    monkeypatch.setattr(deep_research, "build_model", lambda *args, **kwargs: model)
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("nim", "minimaxai/minimax-m3.1-flash"))

    meta = await deep_research.start_run(user_id="u1", query="Coachella Valley population health")
    run = await _wait_until_done("u1", meta["session_id"])
    assert run["status"] == "failed"
    assert run["error"] == "NIM container stalled"
    assert model.roles == ["Researcher"]
    started = [
        event["node_id"]
        for event in _inner_events(run["events"])  # type: ignore[arg-type]
        if event.get("type") == "multiagent_node_start"
    ]
    assert started == ["research_swarm", "researcher"]


class FlakyTimeoutModel(ScriptedModel):
    """Fails ``fail_times`` calls with an ``httpx.ReadTimeout``-chained ``RuntimeError`` (matching ``RonNIMModel``)."""

    def __init__(self, fail_times: int) -> None:
        super().__init__()
        self.remaining_failures = fail_times
        self.attempts = 0

    async def stream(
        self, messages: Any, tool_specs: list[Any] | None = None, system_prompt: str | None = None, **kwargs: Any
    ) -> AsyncIterator[StreamEvent]:
        self.attempts += 1
        if self.remaining_failures > 0:
            self.remaining_failures -= 1
            raise RuntimeError("NVIDIA NIM stream went silent") from httpx.ReadTimeout("timed out")
        async for event in super().stream(messages, tool_specs=tool_specs, system_prompt=system_prompt, **kwargs):
            yield event


@pytest.mark.asyncio
async def test_transient_timeout_retries_and_model_router_fails_over_across_formation_and_subagents(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_sleep = asyncio.sleep

    async def fast_sleep(_delay: float) -> None:
        await real_sleep(0)

    monkeypatch.setattr("strands.event_loop._retry.asyncio.sleep", fast_sleep)

    # 1. Single-provider transient timeout recovers in place via TimeoutRetryStrategy.
    flaky = FlakyTimeoutModel(fail_times=1)
    monkeypatch.setattr(deep_research, "configured_providers", lambda: ["nim"])
    monkeypatch.setattr(deep_research, "build_model", lambda *args, **kwargs: flaky)
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("nim", "minimaxai/minimax-m3.1-flash"))
    meta_retry = await deep_research.start_run(user_id="u1", query="Retry test")
    run_retry = await _wait_until_done("u1", meta_retry["session_id"])
    assert run_retry["status"] == "completed", run_retry["error"]
    assert flaky.attempts > 19

    # 2. Persistent NIM failure fails over to Mistral across both formation agents and subagent children,
    #    and NIM receives RON_DEEP_RESEARCH_NIM_READ_TIMEOUT while Mistral keeps its default (None).
    dead_nim = FlakyTimeoutModel(fail_times=10_000)
    healthy_mistral = ScriptedModel()
    timeouts: dict[str, float | None] = {}

    def fake_build_model(
        provider: str, model_id: str, reasoning_effort: str | None = None, *, hosted_tools: bool = True,
        read_timeout: float | None = None,
    ) -> Model:
        assert hosted_tools is False
        timeouts[provider] = read_timeout
        return dead_nim if provider == "nim" else healthy_mistral

    monkeypatch.setattr(deep_research, "configured_providers", lambda: ["nim", "perplexity", "mistral"])
    monkeypatch.setattr(deep_research, "build_model", fake_build_model)
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("nim", "minimaxai/minimax-m3.1-flash"))

    router = deep_research.build_research_model("nim", "minimaxai/minimax-m3.1-flash")
    assert [candidate.name for candidate in router.candidates] == [
        "nim:minimaxai/minimax-m3.1-flash",
        "mistral:mistral-large-latest",
    ]
    assert timeouts == {"nim": app_config.RON_DEEP_RESEARCH_NIM_READ_TIMEOUT, "mistral": None}

    meta_failover = await deep_research.start_run(user_id="u1", query="Failover test")
    run_failover = await _wait_until_done("u1", meta_failover["session_id"])
    assert run_failover["status"] == "completed", run_failover["error"]
    assert len(healthy_mistral.roles) == len(deep_research.OUTCOME_AGENTS["report"])
    assert dead_nim.attempts >= 2


@pytest.mark.asyncio
async def test_hung_or_failing_background_tool_is_polled_cancelled_and_formation_persists(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A formation agent launches a hung background tool + a failing tool, polls via native
    ``strands_manage_background_task(mode='list'|'get')``, cancels the hung task with ``mode='cancel'``,
    and persists across the entire formation to completion."""
    from strands import tool
    from strands.types.tools import ToolContext

    hung_started = asyncio.Event()
    hung_cancelled = asyncio.Event()

    @tool(context=True)
    async def olostep_scrape_website(url_to_scrape: str, tool_context: ToolContext) -> str:
        """Simulate a remote scrape tool that hangs until cancelled."""
        del url_to_scrape
        hung_started.set()
        try:
            while not tool_context.cancel_signal.is_set():
                await asyncio.sleep(0.01)
        finally:
            hung_cancelled.set()
        return "unreachable"

    @tool
    async def flaky_source(query: str) -> str:
        """Simulate a tool that raises an error immediately."""
        del query
        raise RuntimeError("Upstream 502 Bad Gateway")

    monkeypatch.setattr(
        deep_research,
        "research_tools",
        lambda: [olostep_scrape_website, flaky_source],
    )

    polled_modes: list[str] = []

    class PersistPastHangModel(ScriptedModel):
        async def stream(
            self, messages: Any, tool_specs: list[Any] | None = None, system_prompt: str | None = None, **kwargs: Any
        ) -> AsyncIterator[StreamEvent]:
            role = _ROLE_RE.search(system_prompt or "")
            label = role.group(1) if role else ""
            spec_names = {spec["name"] for spec in tool_specs or ()}
            if label == "Researcher" and "subagent" in spec_names:
                assert "strands_manage_background_task" in spec_names
                assert "retrieve_context" not in spec_names
                scrape_spec = next(spec for spec in (tool_specs or ()) if spec["name"] == "olostep_scrape_website")
                # The SDK's agentic policy: the model chooses background per call; handoff never goes there.
                assert "_background_execution" in scrape_spec["inputSchema"]["json"]["properties"]
                assert "handoff_to_agent" in spec_names
                handoff_spec = next(spec for spec in (tool_specs or ()) if spec["name"] == "handoff_to_agent")
                assert "_background_execution" not in handoff_spec["inputSchema"]["json"]["properties"]

                msg_list = list(messages)
                done = _tool_results(msg_list)
                uses = [
                    block["toolUse"]
                    for m in msg_list
                    if m.get("role") == "assistant"
                    for block in m.get("content") or ()
                    if "toolUse" in block
                ]
                called_names = [u["name"] for u in uses]
                if not called_names:
                    self.roles.append(label)
                    for ev in _tool_use(
                        "res-scrape",
                        "olostep_scrape_website",
                        {"url_to_scrape": "https://slow.example", "_background_execution": True},
                    ):
                        yield ev
                    return
                # Extract dispatched task_id from the initial olostep_scrape_website dispatch acknowledgement.
                task_id = ""
                for m in msg_list:
                    for block in m.get("content") or ():
                        tr = block.get("toolResult") or {}
                        if tr.get("toolUseId") != "res-scrape":
                            continue
                        for item in tr.get("content") or ():
                            txt = item.get("text", "")
                            match = re.search(r"Task ID:\s*([0-9a-fA-F-]+)", txt)
                            if match:
                                task_id = match.group(1)
                assert task_id, "Expected native BackgroundTasks dispatch Task ID"
                if "flaky_source" not in called_names:
                    await asyncio.wait_for(hung_started.wait(), timeout=2.0)
                    for ev in _tool_use("res-flaky", "flaky_source", {"query": "backup"}):
                        yield ev
                    return
                explicit_modes = [
                    u["input"].get("mode")
                    for u in uses
                    if u["name"] == "strands_manage_background_task" and u["toolUseId"].startswith("res-")
                ]
                if "list" not in explicit_modes:
                    polled_modes.append("list")
                    for ev in _tool_use("res-list", "strands_manage_background_task", {"mode": "list"}):
                        yield ev
                    return
                if "get" not in explicit_modes:
                    polled_modes.append("get")
                    for ev in _tool_use(
                        "res-get", "strands_manage_background_task", {"mode": "get", "task_id": task_id}
                    ):
                        yield ev
                    return
                if "cancel" not in explicit_modes:
                    polled_modes.append("cancel")
                    for ev in _tool_use(
                        "res-cancel", "strands_manage_background_task", {"mode": "cancel", "task_id": task_id}
                    ):
                        yield ev
                    return
                # Wait for the cancelled task settlement before handing off to Fact Checker.
                settled = any(u["name"] == "strands_manage_background_task" and u["toolUseId"] == task_id for u in uses)
                if not settled:
                    for ev in _text("Waiting for cancelled task cleanup."):
                        yield ev
                    return
                if "handoff_to_agent" not in called_names:
                    handoff = _DONE_HANDOFF_RE.search(system_prompt or "")
                    assert handoff is not None
                    for ev in _tool_use(
                        f"res-handoff-{done}",
                        "handoff_to_agent",
                        {"agent_name": handoff.group(1), "message": "Persisted past hung scrape and failed source."},
                    ):
                        yield ev
                    return
                for ev in _text("Researcher done."):
                    yield ev
                return

            async for ev in super().stream(messages, tool_specs=tool_specs, system_prompt=system_prompt, **kwargs):
                yield ev

    model = PersistPastHangModel()
    monkeypatch.setattr(deep_research, "build_research_model", lambda *args, **kwargs: model)
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("mistral", "mistral-large-latest"))

    meta = await deep_research.start_run(user_id="u1", query="Persist past hung scrape")
    run = await _wait_until_done("u1", meta["session_id"])
    assert run["status"] == "completed", run["error"]
    assert polled_modes == ["list", "get", "cancel"]
    assert hung_cancelled.is_set()
    assert len(model.roles) == len(deep_research.OUTCOME_AGENTS["report"])


def test_hosted_mcp_sets_native_tasks_config_and_request_timeout_and_recovers_dead_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HostedMCP configures native ``DEFAULT_TASK_CONFIG``, bounds non-task ``MCPAgentTool.timeout`` so SSE hangs
    cannot deadlock forever, and recreates dropped remote MCP sessions."""
    from mcp.types import TASK_OPTIONAL, Tool as MCPTool, ToolExecution
    from strands.tools.mcp import MCPClient as RealMCPClient
    from strands.tools.mcp.mcp_agent_tool import MCPAgentTool
    from strands.tools.mcp.mcp_tasks import DEFAULT_TASK_CONFIG, DEFAULT_TASK_REQUEST_TIMEOUT
    from agent.api.core import hosted_mcp

    constructed_clients: list[Any] = []

    class OfflineMCPClient(RealMCPClient):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(**kwargs)
            self.active = True
            self.started = 0
            self.stopped = 0
            self._tool_task_support_cache["create_crawl"] = TASK_OPTIONAL
            self._tools = [
                MCPAgentTool(
                    MCPTool(name="scrape_website", inputSchema={"type": "object"}),
                    self,
                    name_override=f"{self._prefix}_scrape_website" if self._prefix else None,
                ),
                MCPAgentTool(
                    MCPTool(
                        name="create_crawl",
                        inputSchema={"type": "object"},
                        execution=ToolExecution(taskSupport="optional"),
                    ),
                    self,
                    name_override=f"{self._prefix}_create_crawl" if self._prefix else None,
                ),
            ]
            constructed_clients.append(self)

        def _is_session_active(self) -> bool:
            return self.active

        def _has_server_task_support(self) -> bool:
            return True

        def start(self) -> Any:
            self.started += 1
            return self

        def stop(self, *args: Any) -> None:
            del args
            self.stopped += 1
            self.active = False

        def list_tools_sync(self, *args: Any, **kwargs: Any) -> list[MCPAgentTool]:
            del args, kwargs
            return list(self._tools)

    monkeypatch.setattr(hosted_mcp, "MCPClient", OfflineMCPClient)
    provider = hosted_mcp.HostedMCP("olostep")

    tools_first = provider.tools("https://mcp.olostep.com/mcp", "tok")
    assert len(constructed_clients) == 1
    assert constructed_clients[0]._tasks_config == DEFAULT_TASK_CONFIG
    by_name = {t.tool_name: t for t in tools_first}
    # Non-task tool gets bounded native request timeout instead of None; task-capable tool uses TasksConfig polling.
    assert by_name["olostep_scrape_website"].timeout == DEFAULT_TASK_REQUEST_TIMEOUT
    assert by_name["olostep_create_crawl"].timeout is None

    # Simulate remote session drop; next tools() stops the dead client and starts a fresh one.
    constructed_clients[0].active = False
    tools_second = provider.tools("https://mcp.olostep.com/mcp", "tok")
    assert len(constructed_clients) == 2
    assert constructed_clients[0].stopped == 1
    assert constructed_clients[1].started == 1
    assert len(tools_second) == 2


def test_deep_research_defaults_have_no_timeout_dependencies(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Deep Research formations, NIM read defaults, programmatic_tool_caller, and Slidev export impose no timeouts."""
    import math

    from strands.multiagent.graph import Graph
    from strands.multiagent.swarm import Swarm

    assert math.isinf(app_config.RON_DEEP_RESEARCH_EXECUTION_TIMEOUT)
    assert app_config.RON_DEEP_RESEARCH_NODE_TIMEOUT is None
    assert app_config.RON_DEEP_RESEARCH_NIM_READ_TIMEOUT == 0.0
    assert "--timeout 0" in deep_research.ROLE_NOTES["deck_producer"]
    assert "--timeout 120000" not in deep_research.ROLE_NOTES["deck_producer"]

    captured_ptc_configs: list[Any] = []
    real_create_harness = deep_research.create_harness

    def spy_create_harness(*args: Any, **kwargs: Any) -> Any:
        builtin = kwargs.get("builtin_tools")
        if isinstance(builtin, dict) and "programmatic_tool_caller" in builtin:
            captured_ptc_configs.append(builtin["programmatic_tool_caller"])
        return real_create_harness(*args, **kwargs)

    monkeypatch.setattr(deep_research, "create_harness", spy_create_harness)
    graph = deep_research.build_deep_research_graph(
        session_id="no-timeout-check",
        user_id="u1",
        model=ScriptedModel(),
        depth="medium",
    )
    assert graph.execution_timeout is None
    assert graph.node_timeout is None
    assert len(captured_ptc_configs) == len(deep_research.OUTCOME_AGENTS["report"])
    assert all(
        {k: v for k, v in cfg.items() if k != "mount"} == {"hot_reload": True, "timeout": None}
        for cfg in captured_ptc_configs
    )
    mounts = {id(cfg["mount"]) for cfg in captured_ptc_configs}
    assert len(mounts) == 1
    mount = captured_ptc_configs[0]["mount"]
    workspace = str(deep_research.artifacts_dir("no-timeout-check").resolve())
    assert (str(mount.host_path), mount.virtual_path, mount.mode) == (workspace, workspace, "read-write")
    for node in graph.nodes.values():
        executor = node.executor
        if isinstance(executor, Swarm):
            assert math.isinf(executor.execution_timeout)
            assert executor.node_timeout is None
        elif isinstance(executor, Graph):
            assert executor.execution_timeout is None
            assert executor.node_timeout is None
