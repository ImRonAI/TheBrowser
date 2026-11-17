"""Offline structural, execution, and runtime tests for the Deep Research set formation.

Exercises the real pinned Strands SDK (``Graph``, ``Swarm``, ``SnapshotSessionManager``,
``MultiAgentPlugin``, ``AgentSkills``) and ``strands_harness==0.1.2`` (``create_harness`` with its
built-in ``subagent`` and ``write`` tools) using deterministic Strands ``Model`` test doubles that
emit genuine ``subagent``, ``handoff_to_agent``, file and artifact compilation tool calls.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, AsyncIterator, Iterator
import asyncio
import json
import os
from pathlib import Path
import re
import threading
from typing import Any, cast

from pypdf import PdfReader
import pytest
from strands import Agent, tool
from strands.models.model import Model
from strands.multiagent import Status, Swarm
from strands.multiagent.base import MultiAgentBase
from strands.multiagent.graph import Graph
from strands.storage import InMemoryStorage
from strands.types.streaming import StreamEvent

from agent.api.core.context_agent import context_store
from agent.api.core.deep_research import (
    DEEP_RESEARCH_SKILLS_DIR,
    ORCHESTRATOR_IDS,
    VALID_DEPTHS,
    DeepResearchMultiAgentPlugin,
    DeepResearchRuntime,
    ReplayOverflow,
    build_deep_research_graph,
    build_leaf_tool_pool,
    get_formation_topology,
    load_deep_research_skills,
)


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic Strands Model & Leaf Research Tool Doubles
# ─────────────────────────────────────────────────────────────────────────────


def _assistant_tool_use_stream(
    tool_use_id: str,
    name: str,
    tool_input: dict[str, Any],
) -> Iterator[StreamEvent]:
    yield cast(StreamEvent, {"messageStart": {"role": "assistant"}})
    yield cast(
        StreamEvent,
        {
            "contentBlockStart": {
                "contentBlockIndex": 0,
                "start": {"toolUse": {"toolUseId": tool_use_id, "name": name}},
            }
        },
    )
    yield cast(
        StreamEvent,
        {
            "contentBlockDelta": {
                "contentBlockIndex": 0,
                "delta": {"toolUse": {"input": json.dumps(tool_input)}},
            }
        },
    )
    yield cast(StreamEvent, {"contentBlockStop": {"contentBlockIndex": 0}})
    yield cast(StreamEvent, {"messageStop": {"stopReason": "tool_use"}})
    yield cast(
        StreamEvent,
        {
            "metadata": {
                "usage": {"inputTokens": 12, "outputTokens": 8, "totalTokens": 20},
                "metrics": {"latencyMs": 1},
            }
        },
    )


def _assistant_text_stream(text: str) -> Iterator[StreamEvent]:
    yield cast(StreamEvent, {"messageStart": {"role": "assistant"}})
    mid = max(1, len(text) // 2)
    for chunk in (text[:mid], text[mid:]):
        if chunk:
            yield cast(
                StreamEvent,
                {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": chunk}}},
            )
    yield cast(StreamEvent, {"contentBlockStop": {"contentBlockIndex": 0}})
    yield cast(StreamEvent, {"messageStop": {"stopReason": "end_turn"}})
    yield cast(
        StreamEvent,
        {
            "metadata": {
                "usage": {"inputTokens": 15, "outputTokens": 10, "totalTokens": 25},
                "metrics": {"latencyMs": 1},
            }
        },
    )


def _has_tool_result(messages: list[dict[str, Any]], target_tool_id_prefix: str | None = None) -> bool:
    for msg in reversed(messages):
        if msg.get("role") != "user":
            continue
        for block in msg.get("content") or ():
            if isinstance(block, dict) and isinstance(block.get("toolResult"), dict):
                if target_tool_id_prefix is None:
                    return True
                tid = str(block["toolResult"].get("toolUseId") or "")
                if tid.startswith(target_tool_id_prefix):
                    return True
    return False


def _count_tool_results(messages: list[dict[str, Any]]) -> int:
    total = 0
    for msg in messages:
        if msg.get("role") != "user":
            continue
        for block in msg.get("content") or ():
            if isinstance(block, dict) and "toolResult" in block:
                total += 1
    return total


_ROLE_RE = re.compile(r"^## Your role: (.+)$", re.MULTILINE)
_WORKSPACE_RE = re.compile(r"Every file of this run lives in (.+?)\. Read ")
_ANCHOR = "([ArXiv QEC Benchmark](https://arxiv.org/abs/2401.00001))"

_REPORT_MD = (
    "# Quantum Error Correction Architecture Report\n\n"
    "## Executive Summary\n"
    "Bivariate bicycle qLDPC codes reduce physical-to-logical overhead compared with planar "
    "surface codes ([IBM Quantum LDPC Paper](https://research.ibm.com/publications/qldpc-2026)), "
    "while surface codes retain simpler nearest-neighbor 2D syndrome extraction "
    "([ArXiv QEC Benchmark](https://arxiv.org/abs/2401.00001)).\n\n"
    "| Architecture | Threshold | Connectivity |\n"
    "| --- | --- | --- |\n"
    "| Surface Code | ~1.0% | 2D Nearest-Neighbor |\n"
    "| Bivariate Bicycle qLDPC | ~0.7% | Long-Range Couplers |\n\n"
    "## References\n"
    "1. [ArXiv QEC Benchmark](https://arxiv.org/abs/2401.00001)\n"
    "2. [IBM Quantum LDPC Paper](https://research.ibm.com/publications/qldpc-2026)\n"
)

_SLIDES_MD = (
    "---\n"
    "title: Quantum Error Correction Architecture Deck\n"
    "---\n\n"
    "# Quantum Error Correction\n\n"
    "Surface code vs. bivariate bicycle qLDPC fault-tolerance\n\n"
    "---\n\n"
    "## Key Empirical Findings\n\n"
    "- **~1.0% threshold** on 2D nearest-neighbor planar surface codes\n"
    "- **~0.7% threshold** with reduced overhead on bivariate bicycle qLDPC\n\n"
    "<!--\nSpeaker note: contrast coupler hardware requirements.\n-->\n"
)

_RESEARCH_CALLS: tuple[tuple[str, dict[str, Any]], ...] = (
    ("brave_web_search", {"query": "quantum error correction qLDPC surface code", "count": 3}),
    ("extract_article_content", {"url": "https://arxiv.org/abs/2401.00001"}),
)


def _handoff(agent_name: str, message: str) -> tuple[str, dict[str, Any]]:
    return ("handoff_to_agent", {"agent_name": agent_name, "message": message})


class ScriptedFormationCoordinator:
    """Shared state across per-agent ``ScriptedFormationModel`` instances in a formation run."""

    def __init__(
        self,
        *,
        refine_once: bool = True,
        slow_gate: asyncio.Event | None = None,
        invoke_artifact_tools: bool = True,
        reasoning: str | None = None,
    ) -> None:
        # When set, each QA agent in a feedback loop rejects the work once before approving it.
        self.refine_once = refine_once
        self.slow_gate = slow_gate
        self.invoke_artifact_tools = invoke_artifact_tools
        # When set, every model turn opens with this text as a native reasoning content block.
        self.reasoning = reasoning
        self.lock = threading.Lock()
        self.turns: dict[str, int] = {}
        self.tool_calls: list[str] = []

    def make_model(self, **_: Any) -> "ScriptedFormationModel":
        return ScriptedFormationModel(self)

    def script(self, label: str, turn: int, workspace: str) -> tuple[list[tuple[str, dict[str, Any]]], str]:
        """One formation agent's turn: the tool calls it makes in order, then its final message."""
        revise = self.refine_once and turn == 1
        if label == "Researcher":
            return (
                [
                    ("subagent", {"task": "Research qLDPC and surface code thresholds from primary sources."}),
                    _handoff("fact_checker", "research.md is ready for its reference fact check."),
                ],
                f"Research saved to research.md {_ANCHOR}.",
            )
        if label == "Fact Checker":
            return [_handoff("citation_manager", "Claims checked; number the citations.")], "Claims match sources."
        if label == "Citation Manager":
            return [_handoff("research_qa", "Citations and references.md are ready.")], "References documented."
        if label == "Research QA":
            if revise:
                return [_handoff("citation_manager", "Reference 2 has no URL; fix references.md.")], "Sent back."
            return [], "Every reference and citation checks out.\nAPPROVED"
        if label == "Visual QA":
            if revise:
                return [], "The y axis of figures/thresholds.png is mislabelled.\nREVISE: data_analyst"
            return [], "Every chart is cited, relevant and accurate.\nAPPROVED"
        if label == "Report Designer":
            return [_handoff("deck_designer", "report-layout.md is ready.")], "Report layout saved."
        if label == "Deck Designer":
            return [_handoff("layout_qa", "deck-layout.md is ready.")], "Deck layout saved."
        if label == "Layout QA":
            return [_handoff("report_writer", "Both layouts approved.")], "Layouts approved."
        if label == "Report Writer":
            return (
                [
                    ("write", {"path": f"{workspace}/report.md", "content": _REPORT_MD}),
                    _handoff("report_qa", "report.md is ready."),
                ],
                "Report written to report.md.",
            )
        if label == "Report QA":
            return [_handoff("deck_writer", "Report approved.")], "Report approved."
        if label == "Deck Writer":
            return [_handoff("deck_qa", "deck-copy.md is ready.")], "Slide wording saved."
        if label == "PDF Publisher" and self.invoke_artifact_tools:
            return [("compile_scholarly_pdf", {"css": "h1 { color: #1e3a8a; }"})], "Compiled report.pdf."
        if label == "Slidev Producer" and self.invoke_artifact_tools:
            return (
                [
                    (
                        "compile_slidev_deck",
                        {"slides_markdown": _SLIDES_MD, "title": "Quantum Error Correction Architecture Deck"},
                    )
                ],
                "Built the Slidev deck.",
            )
        return [], f"{label} finished {_ANCHOR}.\nAPPROVED"


class ScriptedFormationModel(Model):
    """Real Strands ``Model`` subclass driving the formation's skill agents and their sub-agents."""

    def __init__(self, coordinator: ScriptedFormationCoordinator) -> None:
        self.coordinator = coordinator

    def update_config(self, **model_config: Any) -> None:
        del model_config

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "scripted-deep-research-model"}

    async def structured_output(
        self,
        output_model: Any,
        prompt: Any,
        system_prompt: Any = None,
        **kwargs: Any,
    ) -> AsyncGenerator[dict[str, Any], None]:
        raise NotImplementedError
        yield {}  # pragma: no cover

    async def stream(
        self,
        messages: Any,
        tool_specs: list[Any] | None = None,
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[StreamEvent]:
        async for ev in self._scripted_stream(messages, tool_specs, system_prompt, **kwargs):
            yield ev
            if self.coordinator.reasoning and "messageStart" in ev:
                yield cast(
                    StreamEvent,
                    {
                        "contentBlockDelta": {
                            "contentBlockIndex": 0,
                            "delta": {"reasoningContent": {"text": self.coordinator.reasoning}},
                        }
                    },
                )
                yield cast(StreamEvent, {"contentBlockStop": {"contentBlockIndex": 0}})

    async def _scripted_stream(
        self,
        messages: Any,
        tool_specs: list[Any] | None = None,
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[StreamEvent]:
        del kwargs
        if self.coordinator.slow_gate is not None:
            await self.coordinator.slow_gate.wait()

        spec_names = {str(spec["name"]) for spec in (tool_specs or ()) if isinstance(spec, dict) and "name" in spec}
        prompt_text = str(system_prompt or "")
        prior_results = _count_tool_results(list(messages or []))
        role = _ROLE_RE.search(prompt_text)

        # ── Case A: a built-in `subagent` child: one research tool call, then its findings ──
        if role is None:
            if prior_results == 0:
                for tool_name, sample_args in _RESEARCH_CALLS:
                    if tool_name in spec_names:
                        with self.coordinator.lock:
                            self.coordinator.tool_calls.append(tool_name)
                            t_seq = len(self.coordinator.tool_calls)
                        for ev in _assistant_tool_use_stream(f"leaf-tool-{t_seq}", tool_name, sample_args):
                            yield ev
                        return
            for ev in _assistant_text_stream(f"Sub-agent findings: surface code threshold ~1.0% {_ANCHOR}."):
                yield ev
            return

        # ── Case B: a formation skill agent following its scripted turn ──
        label = role.group(1).strip()
        workspace_match = _WORKSPACE_RE.search(prompt_text)
        assert workspace_match is not None, "every formation agent is told its workspace"
        with self.coordinator.lock:
            if prior_results == 0:
                self.coordinator.turns[label] = self.coordinator.turns.get(label, 0) + 1
            turn = self.coordinator.turns[label]
        steps, final_text = self.coordinator.script(label, turn, workspace_match.group(1))
        if prior_results < len(steps):
            tool_name, tool_input = steps[prior_results]
            assert tool_name in spec_names, f"{label} has no {tool_name} tool"
            with self.coordinator.lock:
                self.coordinator.tool_calls.append(tool_name)
            tool_use_id = f"{label.lower().replace(' ', '-')}-{turn}-{prior_results}"
            for ev in _assistant_tool_use_stream(tool_use_id, tool_name, tool_input):
                yield ev
            return
        for ev in _assistant_text_stream(final_text):
            yield ev


def _offline_leaf_tools() -> list[Any]:
    @tool
    async def brave_web_search(query: str, count: int = 5) -> dict[str, Any]:
        """Offline deterministic Brave web search double."""
        return {
            "query": query,
            "count": count,
            "results": [
                {
                    "title": "ArXiv QEC Benchmark",
                    "url": "https://arxiv.org/abs/2401.00001",
                    "description": "Empirical comparison of surface codes and qLDPC thresholds.",
                },
                {
                    "title": "IBM Quantum LDPC Paper",
                    "url": "https://research.ibm.com/publications/qldpc-2026",
                    "description": "High-rate bivariate bicycle quantum LDPC code results.",
                },
            ],
        }

    @tool
    async def brave_news_search(query: str, count: int = 5) -> dict[str, Any]:
        """Offline deterministic Brave news search double."""
        return {
            "query": query,
            "count": count,
            "results": [
                {
                    "title": "Quantum Fault-Tolerance Hardware Update",
                    "url": "https://www.nature.com/articles/s41586-026-00001-x",
                    "description": "Logical error suppression below break-even reported.",
                }
            ],
        }

    @tool
    async def brave_answer(query: str) -> dict[str, Any]:
        """Offline deterministic Brave grounded answer double."""
        return {
            "query": query,
            "answer": "Surface codes achieve ~1% threshold; qLDPC reduces physical qubit overhead.",
            "citations": [
                {
                    "title": "ArXiv QEC Benchmark",
                    "url": "https://arxiv.org/abs/2401.00001",
                    "snippet": "Threshold ~1.0% under circuit-level noise.",
                }
            ],
        }

    @tool
    async def extract_article_content(url: str) -> dict[str, Any]:
        """Offline deterministic article extractor double."""
        return {
            "url": url,
            "title": "ArXiv QEC Benchmark",
            "source": "arxiv.org",
            "status": "extracted",
            "text": "# QEC Benchmark\nSurface code threshold is ~1.0%; qLDPC achieves ~0.7%.",
        }

    return [brave_web_search, brave_news_search, brave_answer, extract_article_content]


# ─────────────────────────────────────────────────────────────────────────────
# 1. Skill Library & Set Formation Structural Audit Tests
# ─────────────────────────────────────────────────────────────────────────────

_BUILTIN_AGENT_TOOLS = {"shell", "read", "write", "edit", "programmatic_tool_caller", "subagent"}


def _topology_agents() -> list[dict[str, Any]]:
    return [agent for formation in get_formation_topology()["nodes"] for agent in formation["children"]]


def test_skill_library_is_the_skills_cli_install_and_covers_every_agent() -> None:
    skills = load_deep_research_skills()

    # Every skill is a Skills CLI install recorded in skills-lock.json with its GitHub source.
    lock = json.loads((DEEP_RESEARCH_SKILLS_DIR.parents[1] / "skills-lock.json").read_text(encoding="utf-8"))
    assert set(skills) == set(lock["skills"])
    assert all(entry["sourceType"] == "github" and entry["source"] for entry in lock["skills"].values())
    assert lock["skills"]["find-skills"]["source"] == "vercel-labs/skills"

    assert {agent["skill"] for agent in _topology_agents()} <= set(skills)
    for name, skill in skills.items():
        assert skill.name == name
        assert skill.description.strip()
        assert skill.instructions.strip()
        assert skill.path is not None and (skill.path / "SKILL.md").is_file()


def test_set_formation_topology_and_skill_agent_invariants(tmp_path: Path) -> None:
    storage = InMemoryStorage()
    coordinator = ScriptedFormationCoordinator()
    owned_agents: list[Agent] = []

    graph = build_deep_research_graph(
        session_id="struct-audit-session",
        user_id="auditor",
        storage=storage,
        model_factory=coordinator.make_model,
        depth="deep",
        owned_agents=owned_agents,
        extra_leaf_tools=_offline_leaf_tools(),
        artifacts_dir=tmp_path / "artifacts",
    )

    try:
        assert isinstance(graph, Graph)
        assert graph.id == "deep_research_graph"
        # Strands applies a node timeout to a nested formation as a whole, so the outer graph sets none.
        assert graph.node_timeout is None
        assert [node.node_id for node in graph.entry_points] == ["research_swarm"]

        expected_outer_kinds = {
            "research_swarm": Swarm,
            "data_analysis_graph": Graph,
            "writing_swarm": Swarm,
            "production_graph": Graph,
        }
        assert set(graph.nodes.keys()) == set(expected_outer_kinds.keys())
        for outer_id, expected_cls in expected_outer_kinds.items():
            executor = graph.nodes[outer_id].executor
            assert isinstance(executor, MultiAgentBase)
            assert isinstance(executor, expected_cls)

        research = cast(Swarm, graph.nodes["research_swarm"].executor)
        assert research.id == "deep_research_research_swarm"
        assert list(research.nodes) == ["researcher", "fact_checker", "citation_manager", "research_qa"]
        assert research.entry_point is research.nodes["researcher"].executor
        assert research.node_timeout == 300.0 and research.execution_timeout == 1200.0

        analysis = cast(Graph, graph.nodes["data_analysis_graph"].executor)
        assert analysis.id == "deep_research_data_analysis"
        assert analysis.reset_on_revisit is True
        assert analysis.node_timeout == 300.0
        assert {node.node_id for node in analysis.entry_points} == {"visual_planner"}
        # QA's feedback edges go back to each author; the forward chain returns to QA.
        feedback = {(e.from_node.node_id, e.to_node.node_id) for e in analysis.edges if e.condition is not None}
        assert feedback == {
            ("visual_qa", "visual_planner"),
            ("visual_qa", "data_analyst"),
            ("visual_qa", "visual_citation"),
        }

        writing = cast(Swarm, graph.nodes["writing_swarm"].executor)
        assert writing.id == "deep_research_writing_swarm"
        assert list(writing.nodes) == [
            "report_designer",
            "deck_designer",
            "layout_qa",
            "report_writer",
            "report_qa",
            "deck_writer",
            "deck_qa",
        ]

        production = cast(Graph, graph.nodes["production_graph"].executor)
        assert production.id == "deep_research_production"
        # The PDF and the Slidev deck are built in parallel, each with its own QA loop.
        assert {node.node_id for node in production.entry_points} == {"pdf_publisher", "deck_producer"}
        assert {(e.from_node.node_id, e.to_node.node_id) for e in production.edges} == {
            ("pdf_publisher", "pdf_qa"),
            ("pdf_qa", "pdf_publisher"),
            ("deck_producer", "deck_build_qa"),
            ("deck_build_qa", "deck_producer"),
        }

        plugin: DeepResearchMultiAgentPlugin = getattr(graph, "_deep_research_plugin")
        assert isinstance(plugin, DeepResearchMultiAgentPlugin)
        assert set(plugin.initialized_orchestrators) == set(ORCHESTRATOR_IDS)

        # Every agent is a skill agent: SKILL.md in its system prompt, the harness's built-in file, shell,
        # programmatic and `subagent` tools, the research pool, every skill loadable, no browser automation.
        topology_agents = {agent["id"]: agent for agent in _topology_agents()}
        skills = load_deep_research_skills()
        assert len(owned_agents) == len(topology_agents) == 19
        swarm_agent_names = set(research.nodes) | set(writing.nodes)
        for agent in owned_agents:
            spec = topology_agents[agent.name]
            registered_tools = set(agent.tool_registry.registry.keys())
            assert _BUILTIN_AGENT_TOOLS <= registered_tools
            assert {"skills", "http_request", "compile_scholarly_pdf", "compile_slidev_deck"} <= registered_tools
            assert not any(name.startswith(("browser_", "playwright_")) for name in registered_tools)
            assert ("handoff_to_agent" in registered_tools) == (agent.name in swarm_agent_names)
            system_prompt = str(agent.system_prompt)
            assert f"## Your role: {spec['label']}\n{spec['description']}" in system_prompt
            assert skills[spec["skill"]].instructions in system_prompt
            assert f"Location: {skills[spec['skill']].path}/SKILL.md" in system_prompt
            assert str(tmp_path / "artifacts" / "struct-audit-session") in system_prompt
            assert agent.description == spec["description"]

        topo = get_formation_topology()
        assert topo["id"] == "deep_research_graph"
        assert [n["id"] for n in topo["nodes"]] == list(expected_outer_kinds)
        assert [(e["from"], e["to"]) for e in topo["edges"]] == [
            ("research_swarm", "data_analysis_graph"),
            ("data_analysis_graph", "writing_swarm"),
            ("writing_swarm", "production_graph"),
        ]
        assert VALID_DEPTHS == ("standard", "deep", "exhaustive")
    finally:
        for agent in owned_agents:
            agent.cleanup()


def test_leaf_tool_pool_rejects_forbidden_host_and_recursive_tools(tmp_path: Path) -> None:
    storage = InMemoryStorage()
    pool = build_leaf_tool_pool(
        user_id="u1",
        storage=storage,
        artifact_dir=tmp_path / "pool-artifacts",
        session_id="pool-s1",
    )
    assert "extract_article_content" in pool
    assert "search_saved_context" in pool
    assert "http_request" in pool
    assert "compile_scholarly_pdf" in pool
    assert "compile_slidev_deck" in pool
    for forbidden in ("shell", "editor", "read", "write", "deep_research_start"):
        assert forbidden not in pool

    @tool
    def shell(command: str) -> str:
        """Forbidden shell tool."""
        return command

    @tool
    def deep_research_start(query: str) -> str:
        """Forbidden recursive tool."""
        return query

    with pytest.raises(ValueError, match="Forbidden tool"):
        build_leaf_tool_pool(user_id="u1", storage=storage, extra_leaf_tools=[shell])

    with pytest.raises(ValueError, match="Forbidden tool"):
        build_leaf_tool_pool(user_id="u1", storage=storage, extra_leaf_tools=[deep_research_start])


# ─────────────────────────────────────────────────────────────────────────────
# 2. End-to-End Real Formation Execution (`Graph.stream_async`)
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_end_to_end_formation_stream_async_with_qa_loops_and_snapshots(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RON_SLIDEV_DISABLE_CLI", "1")
    storage = InMemoryStorage()
    await context_store("researcher-1", storage=storage).add(
        "Prior lab note: surface code circuit-level threshold is ~1.0%."
    )

    coordinator = ScriptedFormationCoordinator(refine_once=True)
    owned_agents: list[Agent] = []
    artifacts_root = tmp_path / "artifacts"
    (artifacts_root / "e2e-formation-run").mkdir(parents=True)

    graph = build_deep_research_graph(
        session_id="e2e-formation-run",
        user_id="researcher-1",
        storage=storage,
        model_factory=coordinator.make_model,
        depth="deep",
        owned_agents=owned_agents,
        extra_leaf_tools=_offline_leaf_tools(),
        artifacts_dir=artifacts_root,
    )

    final_result: Any = None
    try:
        async for ev in graph.stream_async(
            "Compare bivariate bicycle qLDPC codes against planar surface codes.",
            invocation_state={"max_refinements": 1},
        ):
            if isinstance(ev, dict) and ev.get("type") == "multiagent_result":
                final_result = ev.get("result")

        assert final_result is not None
        assert final_result.status == Status.COMPLETED
        assert [node.node_id for node in final_result.execution_order] == [
            "research_swarm",
            "data_analysis_graph",
            "writing_swarm",
            "production_graph",
        ]

        # Research swarm: QA handed the references back to their author once, then approved.
        research = final_result.results["research_swarm"].result
        assert [node.node_id for node in research.node_history] == [
            "researcher",
            "fact_checker",
            "citation_manager",
            "research_qa",
            "citation_manager",
            "research_qa",
        ]

        # Data analysis graph: QA's `REVISE: data_analyst` went back to that agent and returned to QA.
        analysis = final_result.results["data_analysis_graph"].result
        assert analysis.status == Status.COMPLETED
        assert [node.node_id for node in analysis.execution_order] == [
            "visual_planner",
            "data_analyst",
            "visual_citation",
            "visual_qa",
            "data_analyst",
            "visual_citation",
            "visual_qa",
        ]

        writing = final_result.results["writing_swarm"].result
        assert [node.node_id for node in writing.node_history] == [
            "report_designer",
            "deck_designer",
            "layout_qa",
            "report_writer",
            "report_qa",
            "deck_writer",
            "deck_qa",
        ]

        # Production graph: the PDF and the deck were built in the same batch, each followed by its QA.
        production = final_result.results["production_graph"].result
        production_order = [node.node_id for node in production.execution_order]
        assert set(production_order[:2]) == {"pdf_publisher", "deck_producer"}
        assert set(production_order[2:]) == {"pdf_qa", "deck_build_qa"}

        # The researcher ran a built-in `subagent`, which called a research tool; the writer saved the
        # report with the built-in `write`; the publishers compiled it and the deck.
        assert {"subagent", "brave_web_search", "write", "compile_scholarly_pdf", "compile_slidev_deck"} <= set(
            coordinator.tool_calls
        )
        assert len(owned_agents) == 19

        run_artifacts = artifacts_root / "e2e-formation-run"
        assert (run_artifacts / "report.md").read_text(encoding="utf-8").startswith(
            "# Quantum Error Correction Architecture Report"
        )
        assert (run_artifacts / "report.pdf").is_file()
        assert (run_artifacts / "slides.md").is_file()
        assert (run_artifacts / "slides" / "index.html").is_file()
        assert (run_artifacts / "slides.pdf").is_file()

        # Native `SnapshotSessionManager` persisted `snapshot_latest` for the outer graph and each formation.
        stored_keys = await storage.list("")
        for orch_id in ORCHESTRATOR_IDS:
            assert any(orch_id in key and "snapshot_latest" in key for key in stored_keys), (
                f"Missing SnapshotSessionManager snapshot_latest for {orch_id} in {stored_keys}"
            )

        # Native `DeepResearchMultiAgentPlugin` recorded all 5 multiagent lifecycle hook types!
        plugin: DeepResearchMultiAgentPlugin = getattr(graph, "_deep_research_plugin")
        fired_hooks = {entry["hook"] for entry in plugin.events}
        assert fired_hooks == {
            "MultiAgentInitializedEvent",
            "BeforeMultiAgentInvocationEvent",
            "BeforeNodeCallEvent",
            "AfterNodeCallEvent",
            "AfterMultiAgentInvocationEvent",
        }
    finally:
        for agent in owned_agents:
            agent.cleanup()


def test_local_images_are_embedded_for_every_renderer(tmp_path: Path) -> None:
    from agent.api.core.deep_research import _inline_local_images

    (tmp_path / "figures").mkdir()
    (tmp_path / "figures" / "a.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (tmp_path.parent / "outside.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    markdown = (
        "![A](figures/a.png)\n"
        f"![Abs]({tmp_path}/figures/a.png)\n"
        '<img src="figures/a.png" class="w-80" />\n'
        "![Remote](https://example.org/b.png)\n"
        "![Missing](figures/missing.png)\n"
        "![Escape](../outside.png)\n"
    )
    embedded = "data:image/png;base64,iVBORw0KGgo="
    assert _inline_local_images(markdown, tmp_path) == (
        f"![A]({embedded})\n"
        f"![Abs]({embedded})\n"
        f'<img src="{embedded}" class="w-80" />\n'
        "![Remote](https://example.org/b.png)\n"
        "![Missing](figures/missing.png)\n"
        "![Escape](../outside.png)\n"
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3. `DeepResearchRuntime` Lifecycle, Artifacts, SSE Replay, Persistence & Cancel
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_deep_research_runtime_sse_streaming_persistence_and_delete(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RON_SLIDEV_DISABLE_CLI", "1")
    shared_storage = InMemoryStorage()
    coordinator = ScriptedFormationCoordinator(refine_once=True)
    artifacts_root = tmp_path / "artifacts"

    runtime = DeepResearchRuntime(
        storage_factory=lambda _uid: shared_storage,
        model_builder=coordinator.make_model,
        extra_leaf_tools=_offline_leaf_tools(),
        artifacts_dir=artifacts_root,
    )

    initial = await runtime.start_run(
        user_id="user-alpha",
        query="Compare qLDPC vs surface code fault-tolerant architectures",
        session_id="dr-alpha-001",
        context="Focus on physical qubit overhead and syndrome extraction connectivity.",
        depth="deep",
    )
    assert initial["version"] == 1
    assert initial["session_id"] == "dr-alpha-001"
    assert initial["user_id"] == "user-alpha"
    assert initial["active"] is True
    assert initial["artifacts"] == {}

    # Consume live SSE stream from sequence 0 through run_finished.
    sse_frames: list[str] = []
    parsed_events: list[dict[str, Any]] = []
    async for frame in runtime.sse(user_id="user-alpha", session_id="dr-alpha-001", after=0):
        sse_frames.append(frame)
        lines = [ln for ln in frame.strip().splitlines() if ln]
        assert lines[0].startswith("id: ")
        assert lines[1].startswith("data: ")
        parsed_events.append(json.loads(lines[1][6:]))

    event_types = {ev["type"] for ev in parsed_events}
    for expected_type in (
        "run_started",
        "node_start",
        "node_stop",
        "node_handoff",
        "skill_start",
        "skill_tool",
        "skill_delta",
        "skill_stop",
        "text_delta",
        "citation",
        "artifact_ready",
        "run_finished",
    ):
        assert expected_type in event_types, f"Missing SSE event type {expected_type!r} in {event_types}"

    # Every formation agent of the set graph appeared in the SSE stream under its formation.
    all_paths = {"/".join(ev.get("node_path") or []) for ev in parsed_events}
    for formation in get_formation_topology()["nodes"]:
        for agent in formation["children"]:
            assert f"{formation['id']}/{agent['id']}" in all_paths

    # The researcher's built-in `subagent` is the sub-agent the formation view nests under it.
    skill_starts = [ev for ev in parsed_events if ev["type"] == "skill_start"]
    assert skill_starts and all(ev["node_path"] == ["research_swarm", "researcher"] for ev in skill_starts)
    assert all(ev["task"].startswith("Research qLDPC") for ev in skill_starts)
    # QA sent the data analyst's work back once, so it ran twice.
    analyst_starts = [
        ev
        for ev in parsed_events
        if ev["type"] == "node_start" and ev["node_path"] == ["data_analysis_graph", "data_analyst"]
    ]
    assert len(analyst_starts) == 2

    # The report and the deck are files in the run's workspace, never an agent's streamed text.
    assert not any(
        ev.get("is_report") or ev.get("is_slidev") for ev in parsed_events if ev["type"] == "text_delta"
    )

    artifact_events = [ev for ev in parsed_events if ev["type"] == "artifact_ready"]
    assert {ev.get("kind") for ev in artifact_events} == {"report_pdf", "slidev_deck"}
    assert {ev.get("artifact_kind") for ev in artifact_events} == {"report_pdf", "slidev_deck"}
    report_ready = next(ev for ev in artifact_events if ev["kind"] == "report_pdf")
    assert report_ready["node_path"][0] == "production_graph"
    assert report_ready["report_markdown"].startswith("# Quantum Error Correction Architecture Report")

    completed = await runtime.wait_run(user_id="user-alpha", session_id="dr-alpha-001", timeout=60.0)
    assert completed is not None
    assert completed["status"] == "completed"
    assert completed["active"] is False
    assert completed["report_markdown"].startswith("# Quantum Error Correction Architecture Report")
    assert "Compiled report.pdf" not in completed["report_markdown"]
    assert "routerMode: hash" in completed["slidev_markdown"]
    assert completed["artifacts"] == {
        "report_pdf_url": "/deep-research/runs/dr-alpha-001/artifacts/report.pdf",
        "report_markdown_url": "/deep-research/runs/dr-alpha-001/artifacts/report.md",
        "slidev_preview_url": "/deep-research/runs/dr-alpha-001/artifacts/slides/index.html",
        "slidev_pdf_url": "/deep-research/runs/dr-alpha-001/artifacts/slides.pdf",
        "slidev_markdown_url": "/deep-research/runs/dr-alpha-001/artifacts/slides.md",
    }
    assert len(completed["citations"]) >= 2
    assert completed["usage"]["totalTokens"] > 0

    # Verify compiled PDFs on disk with pypdf and check relative Slidev SPA sub-assets.
    report_pdf_file = runtime.resolve_artifact_path(
        session_id="dr-alpha-001",
        relative_path="report.pdf",
        user_id="user-alpha",
    )
    assert report_pdf_file is not None and report_pdf_file.is_file()
    report_reader = PdfReader(str(report_pdf_file))
    assert len(report_reader.pages) >= 1
    assert report_reader.metadata is not None and report_reader.metadata.title

    slides_pdf_file = runtime.resolve_artifact_path(
        session_id="dr-alpha-001",
        relative_path="slides.pdf",
        user_id="user-alpha",
    )
    assert slides_pdf_file is not None and slides_pdf_file.is_file()
    slides_reader = PdfReader(str(slides_pdf_file))
    assert len(slides_reader.pages) >= 2

    deck_js_file = runtime.resolve_artifact_path(
        session_id="dr-alpha-001",
        relative_path="slides/assets/deck.js",
        user_id=None,
    )
    assert deck_js_file is not None and deck_js_file.is_file()

    # `include_report=False` omits full Markdown & Slidev bodies while preserving artifact URLs.
    lightweight = await runtime.get_run(
        user_id="user-alpha",
        session_id="dr-alpha-001",
        include_report=False,
    )
    assert lightweight is not None
    assert lightweight["report_markdown"] is None
    assert lightweight["slidev_markdown"] is None
    assert lightweight["artifacts"]["report_pdf_url"].endswith("/artifacts/report.pdf")
    assert lightweight["status"] == "completed"

    # Replay from cursor `after=5` yields strictly `sequence > 5`.
    replayed = [
        ev async for ev in runtime.events(user_id="user-alpha", session_id="dr-alpha-001", after=5)
    ]
    assert replayed and all(ev["sequence"] > 5 for ev in replayed)
    assert replayed[0]["sequence"] == 6

    await runtime.aclose()

    # Fresh runtime instance over the same storage & artifacts_dir restores snapshot, artifacts, and ownership!
    restarted_runtime = DeepResearchRuntime(
        storage_factory=lambda _uid: shared_storage,
        model_builder=coordinator.make_model,
        extra_leaf_tools=_offline_leaf_tools(),
        artifacts_dir=artifacts_root,
    )
    listed = await restarted_runtime.list_runs(user_id="user-alpha", limit=10)
    assert len(listed) == 1
    assert listed[0]["session_id"] == "dr-alpha-001"
    assert listed[0]["status"] == "completed"
    assert listed[0]["artifacts"]["slidev_preview_url"].endswith("/artifacts/slides/index.html")

    restored = await restarted_runtime.get_run(
        user_id="user-alpha",
        session_id="dr-alpha-001",
        include_report=True,
    )
    assert restored is not None
    assert "# Quantum Error Correction Architecture Report" in restored["report_markdown"]
    assert "routerMode: hash" in restored["slidev_markdown"]
    assert (
        restarted_runtime.resolve_artifact_path(
            session_id="dr-alpha-001",
            relative_path="report.pdf",
            user_id="user-alpha",
        )
        is not None
    )
    assert (
        restarted_runtime.resolve_artifact_path(
            session_id="dr-alpha-001",
            relative_path="report.pdf",
            user_id="other-user",
        )
        is None
    )

    # `delete_run` removes snapshot, index entry, session state, AND disk artifacts!
    deleted = await restarted_runtime.delete_run(user_id="user-alpha", session_id="dr-alpha-001")
    assert deleted is True
    assert not (artifacts_root / "dr-alpha-001").exists()
    assert await restarted_runtime.get_run(user_id="user-alpha", session_id="dr-alpha-001") is None
    assert await restarted_runtime.list_runs(user_id="user-alpha") == []
    await restarted_runtime.aclose()


@pytest.mark.asyncio
async def test_run_transcripts_keep_reasoning_and_tool_payloads_and_lists_leave_them_out(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RON_SLIDEV_DISABLE_CLI", "1")
    shared_storage = InMemoryStorage()
    coordinator = ScriptedFormationCoordinator(refine_once=False, reasoning="Weighing which source to read first.")
    runtime = DeepResearchRuntime(
        storage_factory=lambda _uid: shared_storage,
        model_builder=coordinator.make_model,
        extra_leaf_tools=_offline_leaf_tools(),
        artifacts_dir=tmp_path / "artifacts",
    )
    await runtime.start_run(
        user_id="user-alpha",
        query="Compare qLDPC vs surface code fault-tolerant architectures",
        session_id="dr-transcript-001",
        depth="standard",
    )
    events: list[dict[str, Any]] = []
    async for frame in runtime.sse(user_id="user-alpha", session_id="dr-transcript-001", after=0):
        events.append(json.loads(frame.strip().splitlines()[1][6:]))
    await runtime.wait_run(user_id="user-alpha", session_id="dr-transcript-001", timeout=60.0)

    # Reasoning streams for the node's own agent and, with `skill_id`, for its `subagent` sub-agent.
    reasoning = [ev for ev in events if ev["type"] == "reasoning_delta"]
    assert any(not ev.get("skill_id") for ev in reasoning)
    assert any(ev.get("skill_id") for ev in reasoning)
    assert all(ev["delta"] == "Weighing which source to read first." for ev in reasoning)
    assert all(ev["node_path"] for ev in reasoning)

    # A finished tool call keeps its name and carries its whole result.
    finished = [ev for ev in events if ev["type"] == "skill_tool" and ev.get("status") in ("completed", "failed")]
    assert finished
    assert all(ev.get("tool_name") and ev["tool_name"] != "research_tool" for ev in finished)
    assert all(isinstance(ev.get("output"), str) and ev.get("output_truncated") is False for ev in finished)
    started = [ev for ev in events if ev["type"] == "skill_tool" and ev.get("status") == "running"]
    assert any(isinstance(ev.get("input"), dict) and ev["input"] for ev in started)

    full = await runtime.get_run(user_id="user-alpha", session_id="dr-transcript-001")
    assert full is not None
    node = full["nodes"]["research_swarm/researcher"]
    kinds = [part["kind"] for part in node["activity"]]
    assert kinds[0] == "reasoning"
    assert "skill" in kinds and kinds[-1] == "text"
    assert node["activity"][0]["text"] == "Weighing which source to read first."
    skill_part = next(part for part in node["activity"] if part["kind"] == "skill")
    skill = next(sk for sk in full["skill_invocations"] if sk["id"] == skill_part["skill_id"])
    assert skill["node_key"] == "research_swarm/researcher"
    step_kinds = [step["kind"] for step in skill["steps"]]
    assert step_kinds[0] == "reasoning" and "tool" in step_kinds and step_kinds[-1] == "text"
    tool_step = next(step for step in skill["steps"] if step["kind"] == "tool")
    tool_call = next(item for item in skill["tools"] if item["id"] == tool_step["tool_id"])
    assert tool_call["tool_name"] != "research_tool"
    assert isinstance(tool_call["input"], dict) and tool_call["input"]
    assert tool_call["output"] and tool_call["status"] == "completed"
    assert "".join(step["text"] for step in skill["steps"] if step["kind"] == "text") == skill["output_text"]
    # No tool row is created for a framework plugin tool's result, and none loses its name on completion.
    assert all(
        item["tool_name"] != "research_tool" for sk in full["skill_invocations"] for item in sk["tools"]
    )
    # The node's own copy of its skills is a summary: the transcript is stored once.
    node_skill = node["skill_invocations"][0]
    assert "steps" not in node_skill
    assert all("output" not in item and "input" not in item for item in node_skill["tools"])

    # Lists carry status and previews only.
    listed = next(
        item for item in await runtime.list_runs(user_id="user-alpha") if item["session_id"] == "dr-transcript-001"
    )
    assert listed["status"] == "completed"
    assert all("activity" not in listed_node for listed_node in listed["nodes"].values())
    assert listed["skill_invocations"] and all("steps" not in sk for sk in listed["skill_invocations"])
    assert all(
        "output" not in item and "input" not in item and item["tool_name"]
        for sk in listed["skill_invocations"]
        for item in sk["tools"]
    )
    # Reading the list did not strip the stored run.
    again = await runtime.get_run(user_id="user-alpha", session_id="dr-transcript-001")
    assert again is not None and again["nodes"]["research_swarm/researcher"]["activity"]


def test_tool_output_text_keeps_json_blocks_and_cuts_at_the_configured_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent.api.core import config as app_config
    from agent.api.core.deep_research import _tool_output_text

    result = {"content": [{"text": "alpha"}, {"json": {"hits": [1, 2]}}]}
    text, truncated = _tool_output_text(result)
    assert text.startswith("alpha\n{") and '"hits"' in text and truncated is False
    monkeypatch.setattr(app_config, "RON_DEEP_RESEARCH_TOOL_OUTPUT_CHARS", 3)
    assert _tool_output_text(result) == ("alp", True)


@pytest.mark.asyncio
async def test_resolve_artifact_path_security_and_fallback_materialization(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Exercise deterministic pure-Python PDF-1.4 fallback (`RON_CHROMIUM_EXECUTABLE=__none__`)
    # AND runtime pre-`run_finished` materialization when leaf build tools were skipped.
    monkeypatch.setenv("RON_SLIDEV_DISABLE_CLI", "1")
    monkeypatch.setenv("RON_CHROMIUM_EXECUTABLE", "__none__")

    storage = InMemoryStorage()
    coordinator = ScriptedFormationCoordinator(refine_once=False, invoke_artifact_tools=False)
    artifacts_root = tmp_path / "artifacts"
    outside_secret = tmp_path / "outside-secret.txt"
    outside_secret.write_text("top-secret", encoding="utf-8")

    runtime = DeepResearchRuntime(
        storage_factory=lambda _uid: storage,
        model_builder=coordinator.make_model,
        extra_leaf_tools=_offline_leaf_tools(),
        artifacts_dir=artifacts_root,
    )

    await runtime.start_run(
        user_id="owner-1",
        query="Evaluate solid-state electrolyte dendrite suppression",
        session_id="dr-sec-001",
        depth="standard",
    )
    snap = await runtime.wait_run(user_id="owner-1", session_id="dr-sec-001", timeout=60.0)
    assert snap is not None
    assert snap["status"] == "completed"
    assert "compile_scholarly_pdf" not in coordinator.tool_calls
    assert "compile_slidev_deck" not in coordinator.tool_calls

    # Even without the publishers' build tool calls, runtime guaranteed all 5 studio artifacts on disk!
    assert set(snap["artifacts"].keys()) == {
        "report_pdf_url",
        "report_markdown_url",
        "slidev_preview_url",
        "slidev_pdf_url",
        "slidev_markdown_url",
    }
    assert "routerMode: hash" in snap["slidev_markdown"]

    fallback_pdf = runtime.resolve_artifact_path(
        session_id="dr-sec-001",
        relative_path="report.pdf",
        user_id="owner-1",
    )
    assert fallback_pdf is not None and fallback_pdf.is_file()
    reader = PdfReader(str(fallback_pdf))
    assert len(reader.pages) >= 1

    # Sub-asset requests with user_id=None or "default" succeed; wrong user_id is rejected.
    assert (
        runtime.resolve_artifact_path(
            session_id="dr-sec-001",
            relative_path="slides/index.html",
            user_id=None,
        )
        is not None
    )
    assert (
        runtime.resolve_artifact_path(
            session_id="dr-sec-001",
            relative_path="slides/assets/deck.css",
            user_id="default",
        )
        is not None
    )
    assert (
        runtime.resolve_artifact_path(
            session_id="dr-sec-001",
            relative_path="report.pdf",
            user_id="intruder",
        )
        is None
    )

    # Symlink escape inside session artifact directory MUST be rejected by realpath containment.
    escape_link = artifacts_root / "dr-sec-001" / "escape.txt"
    os.symlink(outside_secret, escape_link)
    assert (
        runtime.resolve_artifact_path(
            session_id="dr-sec-001",
            relative_path="escape.txt",
            user_id="owner-1",
        )
        is None
    )

    # Path traversal, dotfiles, backslashes, NUL bytes, absolute paths, and bad session IDs MUST return None.
    for bad_rel in (
        "",
        "../outside-secret.txt",
        "slides/../../outside-secret.txt",
        "/etc/passwd",
        "~/report.pdf",
        "report.pdf\x00.txt",
        "slides\\index.html",
        ".owner.json",
        "does-not-exist.pdf",
    ):
        assert (
            runtime.resolve_artifact_path(
                session_id="dr-sec-001",
                relative_path=bad_rel,
                user_id="owner-1",
            )
            is None
        ), f"Expected None for unsafe relative_path {bad_rel!r}"

    for bad_sid in ("", "../dr-sec-001", "dr/sec", ".hidden"):
        assert (
            runtime.resolve_artifact_path(
                session_id=bad_sid,
                relative_path="report.pdf",
                user_id="owner-1",
            )
            is None
        )

    await runtime.aclose()


@pytest.mark.asyncio
async def test_deep_research_runtime_replay_overflow_and_cancellation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RON_SLIDEV_DISABLE_CLI", "1")
    storage = InMemoryStorage()
    coordinator = ScriptedFormationCoordinator(refine_once=False)
    artifacts_root = tmp_path / "artifacts"

    # Small bounded ring (16 events) forces eviction during a multi-stage run -> ReplayOverflow on stale cursor.
    small_ring_runtime = DeepResearchRuntime(
        storage_factory=lambda _uid: storage,
        model_builder=coordinator.make_model,
        extra_leaf_tools=_offline_leaf_tools(),
        max_events_per_run=16,
        artifacts_dir=artifacts_root,
    )
    await small_ring_runtime.start_run(
        user_id="u-overflow",
        query="Test bounded replay ring overflow",
        session_id="dr-overflow-1",
        depth="standard",
    )
    snap = await small_ring_runtime.wait_run(
        user_id="u-overflow",
        session_id="dr-overflow-1",
        timeout=60.0,
    )
    assert snap is not None and snap["sequence"] > 16
    assert snap["replay_after"] > 0

    with pytest.raises(ReplayOverflow) as exc_info:
        async for _ in small_ring_runtime.events(
            user_id="u-overflow",
            session_id="dr-overflow-1",
            after=1,
        ):
            pass
    assert exc_info.value.requested == 1
    assert exc_info.value.earliest > 2
    assert exc_info.value.latest == snap["sequence"]
    await small_ring_runtime.aclose()

    # Active run cancellation test.
    never_finish = asyncio.Event()
    slow_coordinator = ScriptedFormationCoordinator(refine_once=False, slow_gate=never_finish)
    cancel_runtime = DeepResearchRuntime(
        storage_factory=lambda _uid: storage,
        model_builder=slow_coordinator.make_model,
        extra_leaf_tools=_offline_leaf_tools(),
        artifacts_dir=artifacts_root,
    )
    started = await cancel_runtime.start_run(
        user_id="u-cancel",
        query="Long-running investigation to cancel",
        session_id="dr-cancel-1",
    )
    assert started["active"] is True

    cancelled = await cancel_runtime.cancel_run(user_id="u-cancel", session_id="dr-cancel-1")
    assert cancelled is not None
    settled = await cancel_runtime.wait_run(user_id="u-cancel", session_id="dr-cancel-1", timeout=3.0)
    assert settled is not None
    assert settled["status"] == "cancelled"
    assert settled["active"] is False
    await cancel_runtime.aclose()
