"""Offline structural, execution, and runtime tests for Deep Research native Strands formations.

Exercises the real pinned Strands SDK (``Graph``, ``Swarm``, ``SnapshotSessionManager``,
``MultiAgentPlugin``, ``AgentSkills``) and ``strands_harness==0.1.2`` (``create_harness``,
``make_subagent``) using deterministic Strands ``Model`` test doubles that emit genuine
``use_skill``, leaf research & artifact compilation tool, and ``handoff_to_agent`` invocations.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, AsyncIterator, Iterator
import asyncio
import json
import os
from pathlib import Path
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
    FRAMEWORK_PLUGIN_TOOL_NAMES,
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


class ScriptedFormationCoordinator:
    """Shared state across per-agent ``ScriptedFormationModel`` instances in a formation run."""

    def __init__(
        self,
        *,
        refine_once: bool = True,
        slow_gate: asyncio.Event | None = None,
        invoke_artifact_tools: bool = True,
    ) -> None:
        self.refine_once = refine_once
        self.slow_gate = slow_gate
        self.invoke_artifact_tools = invoke_artifact_tools
        self.lock = threading.Lock()
        self.verification_critic_visits = 0
        self.adversarial_handoffs = 0
        self.verification_handoffs = 0
        self.use_skill_calls: list[tuple[str, str]] = []
        self.leaf_tool_calls: list[str] = []

    def make_model(self, **_: Any) -> "ScriptedFormationModel":
        return ScriptedFormationModel(self)


class ScriptedFormationModel(Model):
    """Real Strands ``Model`` subclass driving orchestrators, Swarms, and ``use_skill`` subagents."""

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
        del kwargs
        if self.coordinator.slow_gate is not None:
            await self.coordinator.slow_gate.wait()

        msg_list = list(messages or [])
        spec_map: dict[str, dict[str, Any]] = {
            str(spec["name"]): spec for spec in (tool_specs or ()) if isinstance(spec, dict) and "name" in spec
        }
        prompt_text = str(system_prompt or "")

        # ── Case A: Orchestrator Agent (Graph or Swarm member) ──────────────
        if "use_skill" in spec_map:
            use_skill_spec = spec_map["use_skill"]
            agent_type_prop = (
                use_skill_spec.get("inputSchema", {})
                .get("json", {})
                .get("properties", {})
                .get("agent_type", {})
            )
            enum_presets: list[str] = list(agent_type_prop.get("enum") or [])
            chosen_preset = enum_presets[0] if enum_presets else "domain-landscape-scan"

            prior_results = _count_tool_results(msg_list)

            # Step 1 on every orchestrator turn: invoke `use_skill`!
            if prior_results == 0:
                with self.coordinator.lock:
                    seq = len(self.coordinator.use_skill_calls) + 1
                    self.coordinator.use_skill_calls.append((chosen_preset, prompt_text.splitlines()[0]))
                for ev in _assistant_tool_use_stream(
                    f"use-skill-{seq}",
                    "use_skill",
                    {
                        "agent_type": chosen_preset,
                        "task": f"Execute {chosen_preset} analysis for quantum error correction thresholds",
                    },
                ):
                    yield ev
                return

            # Step 2 for Swarm entry agents: handoff to peer via `handoff_to_agent`!
            if "handoff_to_agent" in spec_map:
                if "# Hypothesis Explorer" in prompt_text:
                    with self.coordinator.lock:
                        should_handoff = self.coordinator.adversarial_handoffs < 2
                        if should_handoff:
                            self.coordinator.adversarial_handoffs += 1
                            h_idx = self.coordinator.adversarial_handoffs
                        else:
                            h_idx = 0
                    if should_handoff and prior_results == 1:
                        for ev in _assistant_tool_use_stream(
                            f"handoff-adv-{h_idx}",
                            "handoff_to_agent",
                            {
                                "agent_name": "contrarian_examiner",
                                "message": "Falsify surface-code vs LDPC qubit overhead hypothesis.",
                                "context": {"hypothesis": "qLDPC cuts physical overhead 5x"},
                            },
                        ):
                            yield ev
                        return

                if "# Citation Verifier" in prompt_text:
                    if prior_results == 1:
                        with self.coordinator.lock:
                            self.coordinator.verification_handoffs += 1
                            v_idx = self.coordinator.verification_handoffs
                        for ev in _assistant_tool_use_stream(
                            f"handoff-ver-{v_idx}",
                            "handoff_to_agent",
                            {
                                "agent_name": "analytical_critic",
                                "message": "Citations audited; evaluate sub-question completeness and gate.",
                                "context": {"audited_urls": ["https://arxiv.org/abs/2401.00001"]},
                            },
                        ):
                            yield ev
                        return

                if "# Analytical Critic" in prompt_text:
                    with self.coordinator.lock:
                        self.coordinator.verification_critic_visits += 1
                        visit_no = self.coordinator.verification_critic_visits
                    if self.coordinator.refine_once and visit_no == 1:
                        verdict = (
                            "[NEEDS_REFINEMENT]\n"
                            "Gap identified: gather primary decoder latency numbers from "
                            "[IBM Quantum LDPC Paper](https://research.ibm.com/publications/qldpc-2026)."
                        )
                    else:
                        verdict = (
                            "[VERIFICATION_PASSED]\n"
                            "All claims corroborated across [ArXiv QEC Benchmark](https://arxiv.org/abs/2401.00001) "
                            "and [IBM Quantum LDPC Paper](https://research.ibm.com/publications/qldpc-2026)."
                        )
                    for ev in _assistant_text_stream(verdict):
                        yield ev
                    return

            # Step 3: Terminal Synthesis / Stage output
            if "# Executive Editor" in prompt_text:
                report = (
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
                    "## Sources\n"
                    "- [ArXiv QEC Benchmark](https://arxiv.org/abs/2401.00001)\n"
                    "- [IBM Quantum LDPC Paper](https://research.ibm.com/publications/qldpc-2026)\n"
                )
                for ev in _assistant_text_stream(report):
                    yield ev
                return

            if "# Scholarly PDF Publisher" in prompt_text:
                pdf_manifest = "Compiled report.pdf and report.md via `pdf` preset."
                for ev in _assistant_text_stream(pdf_manifest):
                    yield ev
                return

            if "# Slidev Deck Producer" in prompt_text:
                slidev_deck = (
                    "---\n"
                    "theme: default\n"
                    "title: Quantum Error Correction Architecture Deck\n"
                    "routerMode: hash\n"
                    "aspectRatio: 16/9\n"
                    "---\n\n"
                    "# Quantum Error Correction\n\n"
                    "Planar surface codes vs. bivariate bicycle qLDPC architectures\n\n"
                    "---\n\n"
                    "## Threshold & Connectivity Trade-offs\n\n"
                    "- **Surface Code**: ~1.0% circuit-level threshold on 2D nearest-neighbor grids\n"
                    "- **Bivariate Bicycle qLDPC**: ~0.7% threshold with 5x lower physical overhead\n"
                )
                for ev in _assistant_text_stream(slidev_deck):
                    yield ev
                return

            if "# Report Drafter" in prompt_text:
                draft = (
                    "# Draft: Quantum Error Correction\n\n"
                    "Initial synthesis citing [ArXiv QEC Benchmark](https://arxiv.org/abs/2401.00001)."
                )
                for ev in _assistant_text_stream(draft):
                    yield ev
                return

            stage_summary = (
                f"Completed stage dossier using `{chosen_preset}` with verified anchor "
                "[ArXiv QEC Benchmark](https://arxiv.org/abs/2401.00001)."
            )
            for ev in _assistant_text_stream(stage_summary):
                yield ev
            return

        # ── Case B: Leaf `use_skill` Subagent ───────────────────────────────
        if not _has_tool_result(msg_list):
            artifact_candidates: tuple[tuple[str, dict[str, Any]], ...] = (
                (
                    "compile_scholarly_pdf",
                    {
                        "markdown_content": (
                            "# Quantum Error Correction Architecture Report\n\n"
                            "## Executive Summary\n"
                            "Bivariate bicycle qLDPC codes cut physical qubit overhead relative to planar "
                            "surface codes ([IBM Quantum LDPC Paper](https://research.ibm.com/publications/qldpc-2026), "
                            "[ArXiv QEC Benchmark](https://arxiv.org/abs/2401.00001)).\n\n"
                            "| Architecture | Threshold | Connectivity |\n"
                            "| --- | --- | --- |\n"
                            "| Surface Code | ~1.0% | 2D Nearest-Neighbor |\n"
                            "| Bivariate Bicycle qLDPC | ~0.7% | Long-Range Couplers |\n"
                        ),
                        "title": "Quantum Error Correction Architecture Report",
                    },
                ),
                (
                    "compile_slidev_deck",
                    {
                        "slides_markdown": (
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
                        ),
                        "title": "Quantum Error Correction Architecture Deck",
                    },
                ),
            )
            research_candidates: tuple[tuple[str, dict[str, Any]], ...] = (
                ("brave_web_search", {"query": "quantum error correction qLDPC surface code", "count": 3}),
                ("extract_article_content", {"url": "https://arxiv.org/abs/2401.00001"}),
                ("search_saved_context", {"query": "surface code threshold", "max_results": 3}),
                ("brave_news_search", {"query": "quantum error correction milestone", "count": 3}),
                ("brave_answer", {"query": "qLDPC vs surface code threshold"}),
            )
            candidate_list = (
                (*artifact_candidates, *research_candidates)
                if self.coordinator.invoke_artifact_tools
                else research_candidates
            )
            for candidate_tool, sample_args in candidate_list:
                if candidate_tool in spec_map:
                    with self.coordinator.lock:
                        self.coordinator.leaf_tool_calls.append(candidate_tool)
                        t_seq = len(self.coordinator.leaf_tool_calls)
                    for ev in _assistant_tool_use_stream(
                        f"leaf-tool-{t_seq}",
                        candidate_tool,
                        sample_args,
                    ):
                        yield ev
                    return

        leaf_note = (
            "Leaf skill findings: surface code threshold ~1.0% vs qLDPC ~0.7% "
            "([ArXiv QEC Benchmark](https://arxiv.org/abs/2401.00001))."
        )
        for ev in _assistant_text_stream(leaf_note):
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
# 1. Native Skill & 3-Level Formation Structural Audit Tests
# ─────────────────────────────────────────────────────────────────────────────


def test_all_deep_research_skills_load_strictly_with_valid_metadata_and_references() -> None:
    skills = load_deep_research_skills(DEEP_RESEARCH_SKILLS_DIR, strict=True)
    assert len(skills) == 53

    expected_skills_sh_packages = {
        # Pillar 1: Deep Research
        "research",
        "scientific-critical-thinking",
        # Pillar 2: Data Analytics & Visualization
        "analytics",
        "exploratory-data-analysis",
        "statistical-analysis",
        "scientific-visualization",
        "data-visualization",
        # Pillar 3: QA, Data Validation & Peer Verification
        "verification-before-completion",
        "peer-review",
        "validate-data",
        # Pillar 4: Humanized Voice & Anti-AI-Slop Writing
        "humanizer",
        "copy-editing",
        "scientific-writing",
        "stop-slop",
        "no-ai-slop",
        # Pillar 5: Stylized PDF & Slide Presentation
        "pdf",
        "canvas-design",
        "theme-factory",
        "slidev",
    }
    assert expected_skills_sh_packages.issubset(set(skills.keys()))

    expected_studio_skills = {
        "build-agent-slidev",
        "scientific-slides",
        "academic-paper",
        "openai-pdf",
        "scholarly-pdf-publisher",
        "slidev-deck-producer",
    }
    assert expected_studio_skills.issubset(set(skills.keys()))

    for pdf_leaf in ("pdf", "academic-paper", "openai-pdf"):
        assert "compile_scholarly_pdf" in (skills[pdf_leaf].allowed_tools or [])
    for slidev_leaf in ("build-agent-slidev", "slidev", "scientific-slides"):
        assert "compile_slidev_deck" in (skills[slidev_leaf].allowed_tools or [])

    for pkg in expected_skills_sh_packages:
        meta = skills[pkg].metadata
        assert meta.get("source") == "skills.sh"
        assert int(meta.get("github_stars") or 0) >= 10_000
        audits = meta.get("security_audits") or {}
        assert audits == {
            "gen_agent_trust_hub": "Pass",
            "socket": "Pass",
            "snyk": "Pass",
        }

    for name, skill in skills.items():
        assert skill.name == name
        assert skill.description.strip()
        assert skill.instructions.strip()
        assert isinstance(skill.allowed_tools, list) and len(skill.allowed_tools) >= 1
        assert isinstance(skill.metadata, dict)
        assert skill.metadata.get("role") in ("orchestrator", "swarm_orchestrator", "leaf")
        assert skill.metadata.get("stage") in ("planning", "investigation", "verification", "synthesis")
        assert skill.path is not None and skill.path.is_dir()
        refs_dir = skill.path / "references"
        assert refs_dir.is_dir(), f"{name} missing references/ directory"
        assert any(refs_dir.glob("*.md")), f"{name} missing markdown reference rubric"


def test_nested_formation_topology_and_strict_use_skill_only_invariant(tmp_path: Path) -> None:
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
        assert graph.reset_on_revisit is True

        # Every outer node MUST be a MultiAgentBase (Graph or Swarm).
        expected_outer_kinds = {
            "planning_formation": Graph,
            "investigation_formation": Graph,
            "verification_swarm": Swarm,
            "synthesis_formation": Graph,
        }
        assert set(graph.nodes.keys()) == set(expected_outer_kinds.keys())
        for outer_id, expected_cls in expected_outer_kinds.items():
            executor = graph.nodes[outer_id].executor
            assert isinstance(executor, MultiAgentBase)
            assert isinstance(executor, expected_cls)

        # Investigation formation MUST contain 3 parallel entry branches including nested Swarm
        # `adversarial_swarm`, converging on `evidence_ledger`.
        inv_graph = graph.nodes["investigation_formation"].executor
        assert isinstance(inv_graph, Graph)
        assert inv_graph.id == "deep_research_investigation"
        assert inv_graph.reset_on_revisit is True
        assert {n.node_id for n in inv_graph.entry_points} == {
            "web_intelligence",
            "news_data_intelligence",
            "adversarial_swarm",
        }
        adv_swarm = inv_graph.nodes["adversarial_swarm"].executor
        assert isinstance(adv_swarm, Swarm)
        assert adv_swarm.id == "deep_research_adversarial_swarm"
        assert adv_swarm.max_handoffs == 4
        assert adv_swarm.max_iterations == 5
        assert set(adv_swarm.nodes.keys()) == {"hypothesis_explorer", "contrarian_examiner"}

        # Verification swarm checks.
        ver_swarm = graph.nodes["verification_swarm"].executor
        assert isinstance(ver_swarm, Swarm)
        assert ver_swarm.id == "deep_research_verification_swarm"
        assert ver_swarm.max_handoffs == 4
        assert ver_swarm.max_iterations == 5
        assert set(ver_swarm.nodes.keys()) == {"citation_verifier", "analytical_critic"}

        # Synthesis formation checks: report_drafter -> executive_editor -> {pdf_publisher, slidev_producer}.
        syn_graph = graph.nodes["synthesis_formation"].executor
        assert isinstance(syn_graph, Graph)
        assert syn_graph.id == "deep_research_synthesis"
        assert syn_graph.reset_on_revisit is True
        assert {n.node_id for n in syn_graph.entry_points} == {"report_drafter"}
        assert set(syn_graph.nodes.keys()) == {
            "report_drafter",
            "executive_editor",
            "pdf_publisher",
            "slidev_producer",
        }

        # MultiAgentPlugin initialized all 6 unique orchestrator IDs.
        plugin: DeepResearchMultiAgentPlugin = getattr(graph, "_deep_research_plugin")
        assert isinstance(plugin, DeepResearchMultiAgentPlugin)
        assert set(plugin.initialized_orchestrators) == set(ORCHESTRATOR_IDS)

        # Strict `use_skill`-ONLY invariant on EVERY orchestrator Agent across all formations!
        assert len(owned_agents) == 13
        swarm_agent_names = {
            "hypothesis_explorer",
            "contrarian_examiner",
            "citation_verifier",
            "analytical_critic",
        }
        for orch_agent in owned_agents:
            registered_tools = set(orch_agent.tool_registry.registry.keys())
            assert "use_skill" in registered_tools
            assert "skills" in registered_tools
            assert "compile_scholarly_pdf" not in registered_tools
            assert "compile_slidev_deck" not in registered_tools
            if orch_agent.name in swarm_agent_names:
                allowed = {"use_skill", "handoff_to_agent"} | set(FRAMEWORK_PLUGIN_TOOL_NAMES)
                assert "handoff_to_agent" in registered_tools
            else:
                allowed = {"use_skill"} | set(FRAMEWORK_PLUGIN_TOOL_NAMES)
                assert "handoff_to_agent" not in registered_tools

            unexpected = registered_tools - allowed
            assert not unexpected, (
                f"Orchestrator {orch_agent.name!r} leaked raw tools {sorted(unexpected)}"
            )

        # Topology helper aligns with graph structure & depths.
        topo = get_formation_topology()
        assert topo["id"] == "deep_research_graph"
        assert [n["id"] for n in topo["nodes"]] == [
            "planning_formation",
            "investigation_formation",
            "verification_swarm",
            "synthesis_formation",
        ]
        syn_topo = next(n for n in topo["nodes"] if n["id"] == "synthesis_formation")
        assert [c["id"] for c in syn_topo["children"]] == [
            "report_drafter",
            "executive_editor",
            "pdf_publisher",
            "slidev_producer",
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
async def test_end_to_end_formation_stream_async_with_refinement_revisit_and_snapshots(
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

    stream_events: list[dict[str, Any]] = []
    final_result: Any = None
    try:
        async for ev in graph.stream_async(
            "Compare bivariate bicycle qLDPC codes against planar surface codes.",
            invocation_state={"max_refinements": 1},
        ):
            if isinstance(ev, dict):
                stream_events.append(ev)
                if ev.get("type") == "multiagent_result":
                    final_result = ev.get("result")

        assert final_result is not None
        assert final_result.status == Status.COMPLETED

        # Outer execution order MUST show conditional refinement loop:
        # planning -> investigation -> verification ([NEEDS_REFINEMENT]) -> investigation -> verification ([VERIFICATION_PASSED]) -> synthesis!
        outer_order = [node.node_id for node in final_result.execution_order]
        assert outer_order == [
            "planning_formation",
            "investigation_formation",
            "verification_swarm",
            "investigation_formation",
            "verification_swarm",
            "synthesis_formation",
        ]

        # Swarm handoffs executed in both nested adversarial_swarm and verification_swarm.
        assert coordinator.adversarial_handoffs >= 1
        assert coordinator.verification_handoffs == 2

        # Real `use_skill` subagents spawned via `make_subagent` + `create_harness` and called leaf tools
        # including scoped `compile_scholarly_pdf` and `compile_slidev_deck`!
        assert len(coordinator.use_skill_calls) >= 16
        assert len(coordinator.leaf_tool_calls) >= 12
        assert "compile_scholarly_pdf" in coordinator.leaf_tool_calls
        assert "compile_slidev_deck" in coordinator.leaf_tool_calls
        # 13 stage orchestrators + >=16 dynamically spawned leaf subagents tracked in owned_agents!
        assert len(owned_agents) >= 29

        run_artifacts = artifacts_root / "e2e-formation-run"
        assert (run_artifacts / "report.pdf").is_file()
        assert (run_artifacts / "report.md").is_file()
        assert (run_artifacts / "slides.md").is_file()
        assert (run_artifacts / "slides" / "index.html").is_file()
        assert (run_artifacts / "slides.pdf").is_file()

        # Native `SnapshotSessionManager` persisted `snapshot_latest` for all 6 unique orchestrators!
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

    # Verify nested 3-level paths + new synthesis studio branches appeared in SSE stream.
    all_paths = {"/".join(ev.get("node_path") or []) for ev in parsed_events}
    assert "planning_formation/problem_framing" in all_paths
    assert "investigation_formation/adversarial_swarm/hypothesis_explorer" in all_paths
    assert "investigation_formation/adversarial_swarm/contrarian_examiner" in all_paths
    assert "investigation_formation/evidence_ledger" in all_paths
    assert "verification_swarm/citation_verifier" in all_paths
    assert "verification_swarm/analytical_critic" in all_paths
    assert "synthesis_formation/executive_editor" in all_paths
    assert "synthesis_formation/pdf_publisher" in all_paths
    assert "synthesis_formation/slidev_producer" in all_paths

    # Verify text_delta stream scoping: pdf_publisher & slidev_producer never set is_report=True.
    report_delta_nodes = {
        ev["node_path"][-1]
        for ev in parsed_events
        if ev["type"] == "text_delta" and ev.get("is_report") is True and ev.get("node_path")
    }
    assert report_delta_nodes.issubset({"report_drafter", "executive_editor"})
    slidev_delta_nodes = {
        ev["node_path"][-1]
        for ev in parsed_events
        if ev["type"] == "text_delta" and ev.get("is_slidev") is True and ev.get("node_path")
    }
    assert slidev_delta_nodes == {"slidev_producer"}

    artifact_events = [ev for ev in parsed_events if ev["type"] == "artifact_ready"]
    assert {ev.get("kind") for ev in artifact_events} == {"report_pdf", "slidev_deck"}
    assert {ev.get("artifact_kind") for ev in artifact_events} == {"report_pdf", "slidev_deck"}

    completed = await runtime.wait_run(user_id="user-alpha", session_id="dr-alpha-001", timeout=5.0)
    assert completed is not None
    assert completed["status"] == "completed"
    assert completed["active"] is False
    assert completed["refinement_count"] == 1
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
    snap = await runtime.wait_run(user_id="owner-1", session_id="dr-sec-001", timeout=5.0)
    assert snap is not None
    assert snap["status"] == "completed"
    assert "compile_scholarly_pdf" not in coordinator.leaf_tool_calls
    assert "compile_slidev_deck" not in coordinator.leaf_tool_calls

    # Even without leaf build tool calls, runtime guaranteed all 5 studio artifacts on disk!
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
        timeout=5.0,
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
