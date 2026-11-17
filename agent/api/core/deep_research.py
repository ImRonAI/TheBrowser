"""Deep Research: one Strands Graph of Swarms and Graphs, run in the background.

The formation is ``FORMATION_TOPOLOGY``: an outer Graph, research_swarm -> data_analysis_graph ->
writing_swarm -> production_graph, built as the Strands docs build it:

- Swarm: ``Swarm(agents, id=...)`` with repetitive handoff detection on; its agents hand off with the built-in
  ``handoff_to_agent`` and the Swarm ends when an agent finishes without one
  (https://strandsagents.com/latest/documentation/docs/user-guide/concepts/multi-agent/swarm/). Each agent's
  instructions say when it hands off (``SWARM_HANDOFFS``): "each agent's system prompt tells it when to hand off, and
  the model decides" (Agent Swarms, strands-agents/harness-sdk ``site/src/content/docs/learning/
  multi-agent-patterns-agent-swarms.mdx``).
- Graph: ``GraphBuilder`` with ``add_node``, ``add_edge`` and ``build``; a Swarm or a Graph is a
  node of the outer Graph as it is (nested multi-agent systems,
  https://strandsagents.com/latest/documentation/docs/user-guide/concepts/multi-agent/graph/).
- Session: one ``SnapshotSessionManager`` on the outer Graph only, since only the orchestrator
  has one (https://strandsagents.com/latest/documentation/docs/user-guide/concepts/agents/session-management/).
- Streaming: the outer Graph's ``stream_async`` events, kept with the docs' own filter pattern
  (Event Serialization, https://strandsagents.com/latest/documentation/docs/user-guide/concepts/streaming/).

Every agent is ``strands_harness.create_harness(...)`` with its skill's ``SKILL.md`` as its
instructions and every agent has the same tools.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import shutil
import sys
import time
from typing import Final, Literal, TypedDict
import uuid

from strands import Agent
from strands.memory import MemoryManager
from strands.models import Model
from strands.multiagent import GraphBuilder, Swarm
from strands.multiagent.base import MultiAgentResult, NodeResult, Status
from strands.multiagent.graph import Graph
from strands.session import SnapshotSessionManager
from strands.types.session import encode_bytes_values
from strands.types.tools import AgentTool
from strands.vended_plugins.skills import Skill
from strands_harness import create_harness

from agent.api.core import config as app_config
from agent.api.core.brave_tools import brave_tools
from agent.api.core.dreaming import JOURNAL_DIRECTIVE, agent_memory
from agent.api.core.panel_agent import (
    PROVIDERS,
    ProviderName,
    build_model,
    default_selection,
    infer_provider,
    provider_default_model,
)
from agent.api.core.panel_storage import get_user_session_storage
from agent.api.core.panel_tools import installed_http_request
from agent.api.core.web_tools import web_tools

logger = logging.getLogger(__name__)

ResearchDepth = Literal["standard", "deep", "exhaustive"]
VALID_DEPTHS: Final[tuple[ResearchDepth, ...]] = ("standard", "deep", "exhaustive")
RunStatus = Literal["running", "completed", "failed", "cancelled"]
JsonDict = dict[str, object]

#: The Deep Research skill library, installed by the Skills CLI (``skills-lock.json`` records each source).
DEEP_RESEARCH_SKILLS_DIR: Final[Path] = (
    Path(__file__).resolve().parents[2] / "skills" / "deep-research" / ".agents" / "skills"
)

_RUNS_PREFIX: Final[str] = "deep_research/runs"
_SAVE_INTERVAL_SECONDS: Final[float] = 5.0


Edge = TypedDict("Edge", {"from": str, "to": str})


class AgentSpec(TypedDict):
    id: str
    label: str
    kind: Literal["agent"]
    skill: str
    description: str


class FormationSpec(TypedDict):
    id: str
    label: str
    kind: Literal["swarm", "graph"]
    description: str
    children: list[AgentSpec]
    edges: list[Edge]


class Topology(TypedDict):
    id: str
    label: str
    kind: Literal["graph"]
    nodes: list[FormationSpec]
    edges: list[Edge]


def _agent(node_id: str, label: str, skill: str, description: str) -> AgentSpec:
    return {"id": node_id, "label": label, "kind": "agent", "skill": skill, "description": description}


def _edge(source: str, target: str) -> Edge:
    return {"from": source, "to": target}


#: The formation. A Swarm has no edges: its agents choose who goes next with ``handoff_to_agent``,
#: reading each other's descriptions. The renderer draws the same structure.
FORMATION_TOPOLOGY: Final[Topology] = {
    "id": "deep_research_graph",
    "label": "Deep Research",
    "kind": "graph",
    "nodes": [
        {
            "id": "research_swarm",
            "label": "Research Swarm",
            "kind": "swarm",
            "description": "Researches the inquiry from primary sources, fact-checks every claim and cites it.",
            "children": [
                _agent(
                    "researcher",
                    "Researcher",
                    "research",
                    "Researches the inquiry from primary sources and writes research.md, every claim with its "
                    "source URL.",
                ),
                _agent(
                    "fact_checker",
                    "Fact Checker",
                    "scientific-critical-thinking",
                    "Opens the source of every claim in research.md, records a verdict per claim in "
                    "fact-check.md and fixes or removes what fails.",
                ),
                _agent(
                    "citation_manager",
                    "Citation Manager",
                    "citation-management",
                    "Numbers the citations in research.md and lists each source once in references.md.",
                ),
                _agent(
                    "research_qa",
                    "Research QA",
                    "peer-review",
                    "Checks research.md, fact-check.md and references.md: every claim cited, every citation "
                    "in the reference list, every reference real and supporting its claim.",
                ),
            ],
            "edges": [],
        },
        {
            "id": "data_analysis_graph",
            "label": "Data Analysis Graph",
            "kind": "graph",
            "description": "Chooses the data visuals that matter, builds them with code, cites them and checks them.",
            "children": [
                _agent(
                    "visual_planner",
                    "Visual Planner",
                    "data-storytelling",
                    "Chooses the data visuals that matter for the inquiry and specifies each in visuals.md: what "
                    "it shows, the chart type and the data points with their citation numbers.",
                ),
                _agent(
                    "data_analyst",
                    "Data Analyst",
                    "data-visualization",
                    "Builds every visual in visuals.md with Python: figures/<name>.png and the script that made "
                    "it, figures/<name>.py.",
                ),
                _agent(
                    "visual_citation",
                    "Visual Citation",
                    "citation-management",
                    "Adds each chart's caption and the reference numbers its data came from to visuals.md.",
                ),
                _agent(
                    "visual_qa",
                    "Visual QA",
                    "scientific-visualization",
                    "Checks every chart in figures/ is cited, relevant and accurate against its data, and fixes "
                    "what is not.",
                ),
            ],
            "edges": [
                _edge("visual_planner", "data_analyst"),
                _edge("data_analyst", "visual_citation"),
                _edge("visual_citation", "visual_qa"),
            ],
        },
        {
            "id": "writing_swarm",
            "label": "Writing Swarm",
            "kind": "swarm",
            "description": "Designs the report and the deck, writes both, and checks each.",
            "children": [
                _agent(
                    "report_designer",
                    "Report Designer",
                    "theme-factory",
                    "Designs the report in report-layout.md: sections and their order, where each chart goes, "
                    "typography, colour and page style.",
                ),
                _agent(
                    "deck_designer",
                    "Deck Designer",
                    "slidev",
                    "Designs the Slidev deck in deck-layout.md: the slide sequence, each slide's layout and "
                    "chart, theme and styling.",
                ),
                _agent(
                    "layout_qa",
                    "Layout QA",
                    "verification-before-completion",
                    "Checks report-layout.md and deck-layout.md against the inquiry, research.md and figures/.",
                ),
                _agent(
                    "report_writer",
                    "Report Writer",
                    "scientific-writing",
                    "Writes report.md as report-layout.md lays it out: every claim with its citation number, "
                    "charts as ![caption](figures/<name>.png), and the reference list at the end.",
                ),
                _agent(
                    "report_qa",
                    "Report QA",
                    "peer-review",
                    "Checks report.md against research.md, references.md, figures/ and report-layout.md.",
                ),
                _agent(
                    "deck_writer",
                    "Deck Writer",
                    "scientific-slides",
                    "Writes deck-copy.md as deck-layout.md lays it out: each slide's title, points, speaker notes, "
                    "citation numbers and chart.",
                ),
                _agent(
                    "deck_qa",
                    "Deck QA",
                    "copy-editing",
                    "Checks deck-copy.md against report.md and deck-layout.md.",
                ),
            ],
            "edges": [],
        },
        {
            "id": "production_graph",
            "label": "Production Graph",
            "kind": "graph",
            "description": "Builds the PDF report and the Slidev deck in parallel, each checked by its own QA.",
            "children": [
                _agent(
                    "pdf_publisher",
                    "PDF Publisher",
                    "pdf",
                    "Builds report.pdf from report.md as report-layout.md styles it, with its charts, citations "
                    "and reference page.",
                ),
                _agent(
                    "pdf_qa",
                    "PDF QA",
                    "pdf",
                    "Checks report.pdf: charts present, styling as report-layout.md specifies, citations and the "
                    "reference page intact; fixes what is not.",
                ),
                _agent(
                    "deck_producer",
                    "Slidev Producer",
                    "slidev",
                    "Writes slides.md in Slidev Markdown from deck-copy.md and deck-layout.md with the charts "
                    "from figures/, builds it into slides/ (slidev build --out slides --base ./) and exports "
                    "slides.pdf.",
                ),
                _agent(
                    "deck_build_qa",
                    "Slidev QA",
                    "slidev",
                    "Checks slides.md, slides/ and slides.pdf against deck-layout.md: every slide's chart, "
                    "styling and citations; fixes what is not.",
                ),
            ],
            "edges": [_edge("pdf_publisher", "pdf_qa"), _edge("deck_producer", "deck_build_qa")],
        },
    ],
    "edges": [
        _edge("research_swarm", "data_analysis_graph"),
        _edge("data_analysis_graph", "writing_swarm"),
        _edge("writing_swarm", "production_graph"),
    ],
}


#: When each Swarm agent hands off. An agent that replies without handing off ends its Swarm, so only each Swarm's
#: last check ends it.
SWARM_HANDOFFS: Final[dict[str, str]] = {
    "researcher": "When research.md is written, hand off to fact_checker.",
    "fact_checker": "When fact-check.md is written and research.md is fixed, hand off to citation_manager. If a claim "
    "needs new research, hand off to researcher.",
    "citation_manager": "When references.md is written, hand off to research_qa.",
    "research_qa": "If a file fails your check, hand off to the agent that wrote it. When everything passes, reply with "
    "your verdict without handing off: that ends the research.",
    "report_designer": "When report-layout.md is written, hand off to deck_designer.",
    "deck_designer": "When deck-layout.md is written, hand off to layout_qa.",
    "layout_qa": "If a layout fails your check, hand off to its designer. When both pass, hand off to report_writer.",
    "report_writer": "When report.md is written, hand off to report_qa.",
    "report_qa": "If report.md fails your check, hand off to report_writer. When it passes, hand off to deck_writer.",
    "deck_writer": "When deck-copy.md is written, hand off to deck_qa.",
    "deck_qa": "If deck-copy.md fails your check, hand off to deck_writer. When it passes, reply with your verdict "
    "without handing off: that ends the writing.",
}


class Selection(TypedDict):
    provider: str | None
    model_id: str | None
    reasoning_effort: str | None


class RunMeta(TypedDict):
    session_id: str
    user_id: str
    query: str
    context: str
    title: str
    depth: ResearchDepth
    status: RunStatus
    active: bool
    created_at: str
    updated_at: str
    completed_at: str | None
    selection: Selection
    error: str | None


@dataclass
class _Run:
    meta: RunMeta
    events: list[JsonDict] = field(default_factory=list)
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task[None] | None = None


_RUNS: dict[tuple[str, str], _Run] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _provider_name(value: str | None) -> ProviderName | None:
    return next((name for name in PROVIDERS if name == value), None)


def resolve_selection(provider: str | None = None, model_id: str | None = None) -> tuple[ProviderName, str] | None:
    """The run's provider and model: the request's, then ``RON_DEEP_RESEARCH_*``, then Ren's default."""
    chosen_provider = _provider_name(provider or app_config.RON_DEEP_RESEARCH_PROVIDER)
    chosen_model = model_id or app_config.RON_DEEP_RESEARCH_MODEL
    if chosen_provider is not None:
        return chosen_provider, chosen_model or provider_default_model(chosen_provider)
    if chosen_model:
        inferred = infer_provider(chosen_model)
        return (inferred, chosen_model) if inferred is not None else None
    return default_selection()


def artifacts_dir(session_id: str) -> Path:
    """The run's workspace: every agent reads and writes its files here."""
    return app_config.RON_DEEP_RESEARCH_ARTIFACTS_DIR / session_id


def research_tools() -> list[AgentTool]:
    """Every Deep Research agent's tools beside the harness built-ins: the web tools and ``http_request``."""
    return [*brave_tools(), *web_tools(), installed_http_request()]


def _skills() -> dict[str, Skill]:
    return {skill.name: skill for skill in Skill.from_directory(DEEP_RESEARCH_SKILLS_DIR)}


def build_deep_research_graph(*, session_id: str, user_id: str, model: Model, depth: ResearchDepth) -> Graph:
    """Build ``FORMATION_TOPOLOGY`` as a Strands Graph whose nodes are Swarms and Graphs of harness agents."""
    workspace = artifacts_dir(session_id)
    workspace.mkdir(parents=True, exist_ok=True)
    skills = _skills()
    workspace_note = (
        "## Workspace\n"
        f"Every file of this run is in {workspace}. Read what the other agents saved there and save your work "
        "there under absolute paths.\n"
        f"- Python: {sys.executable}\n"
        "- Run independent sub-tasks in parallel by calling `subagent` several times in one turn.\n"
        f"- Research depth: {depth}. Today is {datetime.now().astimezone().strftime('%A, %B %d, %Y')}."
    )

    def make_agent(spec: AgentSpec) -> Agent:
        skill = skills[spec["skill"]]
        handoff = SWARM_HANDOFFS.get(spec["id"])
        return create_harness(
            name=spec["id"],
            description=spec["description"],
            model=model,
            instructions=(
                f"## Your role: {spec['label']}\n{spec['description']}\n\n"
                + (f"## Handing off\n{handoff}\n\n" if handoff else "")
                + f"{workspace_note}\n\n"
                f"## Skill: {skill.name}\n{skill.instructions}{JOURNAL_DIRECTIVE}"
            ),
            skills=DEEP_RESEARCH_SKILLS_DIR,
            tools=research_tools(),
            builtin_tools=["shell", "read", "write", "edit", "programmatic_tool_caller", "subagent"],
            builtin_plugins=["todos"],
            caching=False,
            session=False,
            memory=MemoryManager(stores=agent_memory(user_id, "deep-research")),
            background_tasks=False,
            callback_handler=None,
        )

    def make_formation(spec: FormationSpec) -> Swarm | Graph:
        agents = [make_agent(child) for child in spec["children"]]
        if spec["kind"] == "swarm":
            return Swarm(
                agents,
                id=spec["id"],
                execution_timeout=app_config.RON_DEEP_RESEARCH_EXECUTION_TIMEOUT,
                node_timeout=app_config.RON_DEEP_RESEARCH_NODE_TIMEOUT,
                repetitive_handoff_detection_window=8,
                repetitive_handoff_min_unique_agents=3,
            )
        builder = GraphBuilder()
        for agent, child in zip(agents, spec["children"]):
            builder.add_node(agent, child["id"])
        for edge in spec["edges"]:
            builder.add_edge(edge["from"], edge["to"])
        builder.set_node_timeout(app_config.RON_DEEP_RESEARCH_NODE_TIMEOUT)
        builder.set_graph_id(spec["id"])
        return builder.build()

    builder = GraphBuilder()
    for formation in FORMATION_TOPOLOGY["nodes"]:
        builder.add_node(make_formation(formation), formation["id"])
    for edge in FORMATION_TOPOLOGY["edges"]:
        builder.add_edge(edge["from"], edge["to"])
    builder.set_graph_id(FORMATION_TOPOLOGY["id"])
    builder.set_session_manager(
        SnapshotSessionManager(session_id=session_id, storage=get_user_session_storage(user_id))
    )
    return builder.build()


def _tool_use(value: object) -> JsonDict | None:
    if not isinstance(value, Mapping):
        return None
    return {"toolUseId": value.get("toolUseId"), "name": value.get("name"), "input": value.get("input")}


def _filter_agent_event(event: Mapping[str, object]) -> JsonDict | None:
    """An agent event's documented fields: text, reasoning, whole messages, tool streams and stops."""
    text = event.get("data")
    if isinstance(text, str):
        return {"data": text}
    reasoning = event.get("reasoningText")
    if isinstance(reasoning, str):
        return {"reasoningText": reasoning}
    message = event.get("message")
    if isinstance(message, Mapping):
        return {"message": encode_bytes_values(dict(message))}
    if event.get("force_stop"):
        return {"force_stop": True, "force_stop_reason": str(event.get("force_stop_reason") or "")}
    tool_stream = event.get("tool_stream_event")
    if not isinstance(tool_stream, Mapping):
        return None
    streamed = tool_stream.get("data")
    inner: JsonDict | str | None = streamed if isinstance(streamed, str) else None
    if isinstance(streamed, Mapping):
        inner = filter_event(streamed)
    if inner is None:
        return None
    return {"tool_stream_event": {"tool_use": _tool_use(tool_stream.get("tool_use")), "data": inner}}


def filter_event(event: Mapping[str, object]) -> JsonDict | None:
    """Keep what the page draws from one ``stream_async`` event, as the docs' ``filter_event`` does.

    Multi-agent events keep their documented fields, with results through ``to_dict()``; an agent
    event inside ``multiagent_node_stream`` or a ``subagent`` tool stream is filtered the same way.
    """
    kind = event.get("type")
    node_id = event.get("node_id")
    if kind == "multiagent_node_stream":
        inner = event.get("event")
        nested = filter_event(inner) if isinstance(inner, Mapping) else None
        return None if nested is None else {"type": kind, "node_id": node_id, "event": nested}
    if kind == "multiagent_node_start":
        return {"type": kind, "node_id": node_id, "node_type": event.get("node_type")}
    if kind == "multiagent_node_stop":
        node_result = event.get("node_result")
        return {
            "type": kind,
            "node_id": node_id,
            "node_result": node_result.to_dict() if isinstance(node_result, NodeResult) else None,
        }
    if kind == "multiagent_handoff":
        return {
            "type": kind,
            "from_node_ids": event.get("from_node_ids"),
            "to_node_ids": event.get("to_node_ids"),
            "message": event.get("message"),
        }
    if kind == "multiagent_node_cancel":
        return {"type": kind, "node_id": node_id, "message": event.get("message")}
    if kind == "multiagent_result":
        result = event.get("result")
        return {"type": kind, "result": result.to_dict() if isinstance(result, MultiAgentResult) else None}
    return _filter_agent_event(event)


def _run_key(session_id: str, name: str) -> str:
    return f"{_RUNS_PREFIX}/{session_id}/{name}"


async def _save(run: _Run) -> None:
    storage = get_user_session_storage(run.meta["user_id"])
    session_id = run.meta["session_id"]
    await storage.write(_run_key(session_id, "events.json"), json.dumps(run.events, default=str).encode())
    await storage.write(_run_key(session_id, "run.json"), json.dumps(run.meta).encode())


def _append(run: _Run, event: JsonDict) -> None:
    run.events.append(event)
    run.meta["updated_at"] = _now()
    run.changed.set()
    run.changed = asyncio.Event()


def _finish(run: _Run, status: RunStatus, error: str | None) -> None:
    run.meta.update(status=status, active=False, completed_at=_now(), error=error)
    run.changed.set()


async def _execute(run: _Run, graph: Graph, task: str) -> None:
    saved_at = time.monotonic()
    try:
        async for event in graph.stream_async(task):
            kept = filter_event(event)
            if kept is None:
                continue
            _append(run, kept)
            if kept.get("type") == "multiagent_result":
                result = event.get("result")
                failed = isinstance(result, MultiAgentResult) and result.status == Status.FAILED
                _finish(run, "failed" if failed else "completed", "The formation failed." if failed else None)
            if time.monotonic() - saved_at > _SAVE_INTERVAL_SECONDS:
                await _save(run)
                saved_at = time.monotonic()
        if run.meta["active"]:
            _finish(run, "completed", None)
    except asyncio.CancelledError:
        _finish(run, "cancelled", None)
    except Exception as error:
        logger.exception("session_id=<%s> | deep research run failed", run.meta["session_id"])
        _finish(run, "failed", str(error) or type(error).__name__)
    finally:
        await _save(run)


def _task_text(query: str, context: str) -> str:
    return f"{query}\n\nContext:\n{context}" if context else query


async def start_run(
    *,
    user_id: str,
    query: str,
    context: str = "",
    depth: ResearchDepth = "deep",
    provider: str | None = None,
    model_id: str | None = None,
    reasoning_effort: str | None = None,
) -> RunMeta:
    """Build the formation and run it in the background; the returned meta names the run.

    Raises:
        ValueError: When no model provider is configured.
    """
    selection = resolve_selection(provider, model_id)
    if selection is None:
        raise ValueError("No model provider is configured for Deep Research.")
    chosen_provider, chosen_model = selection
    session_id = f"dr-{uuid.uuid4().hex[:16]}"
    model = build_model(chosen_provider, chosen_model, reasoning_effort, hosted_tools=False)
    graph = build_deep_research_graph(session_id=session_id, user_id=user_id, model=model, depth=depth)
    created = _now()
    run = _Run(
        meta={
            "session_id": session_id,
            "user_id": user_id,
            "query": query,
            "context": context,
            "title": query.splitlines()[0][:96],
            "depth": depth,
            "status": "running",
            "active": True,
            "created_at": created,
            "updated_at": created,
            "completed_at": None,
            "selection": {"provider": chosen_provider, "model_id": chosen_model, "reasoning_effort": reasoning_effort},
            "error": None,
        }
    )
    _RUNS[(user_id, session_id)] = run
    await _save(run)
    run.task = asyncio.create_task(_execute(run, graph, _task_text(query, context)))
    return run.meta


async def _load_meta(user_id: str, session_id: str) -> RunMeta | None:
    raw = await get_user_session_storage(user_id).read(_run_key(session_id, "run.json"))
    if raw is None:
        return None
    meta: RunMeta = json.loads(raw)
    if meta["active"]:
        meta.update(status="failed", active=False, error="The server stopped during this run.")
    return meta


async def _load(user_id: str, session_id: str) -> _Run | None:
    live = _RUNS.get((user_id, session_id))
    if live is not None:
        return live
    meta = await _load_meta(user_id, session_id)
    if meta is None:
        return None
    raw_events = await get_user_session_storage(user_id).read(_run_key(session_id, "events.json"))
    events: list[JsonDict] = json.loads(raw_events) if raw_events else []
    return _Run(meta=meta, events=events)


def workspace_files(session_id: str) -> list[str]:
    """The run's workspace files, relative to it."""
    root = artifacts_dir(session_id)
    if not root.is_dir():
        return []
    return sorted(
        str(path.relative_to(root))
        for path in root.rglob("*")
        if path.is_file() and not any(part.startswith(".") for part in path.relative_to(root).parts)
    )


async def get_run(*, user_id: str, session_id: str) -> JsonDict | None:
    """The run's meta, every kept event, its workspace files and the text of report.md and slides.md."""
    run = await _load(user_id, session_id)
    if run is None:
        return None
    workspace = artifacts_dir(session_id)
    texts = {
        key: (workspace / name).read_text(encoding="utf-8") if (workspace / name).is_file() else ""
        for key, name in (("report_markdown", "report.md"), ("slidev_markdown", "slides.md"))
    }
    return {**run.meta, "events": list(run.events), "files": workspace_files(session_id), **texts}


async def list_runs(*, user_id: str, limit: int = 50) -> list[RunMeta]:
    """The user's runs, newest first."""
    keys = await get_user_session_storage(user_id).list(f"{_RUNS_PREFIX}/")
    session_ids = {key.split("/")[-2] for key in keys if key.endswith("/run.json")}
    metas: list[RunMeta] = []
    for session_id in session_ids:
        live = _RUNS.get((user_id, session_id))
        meta = live.meta if live is not None else await _load_meta(user_id, session_id)
        if meta is not None:
            metas.append(meta)
    return sorted(metas, key=lambda meta: meta["created_at"], reverse=True)[:limit]


async def stream_events(*, user_id: str, session_id: str, after: int = 0) -> AsyncIterator[str]:
    """Server-sent events: each kept event after ``after`` (``id`` is its position), then ``run`` with the meta."""
    run = await _load(user_id, session_id)
    if run is None:
        return
    sent = after
    while True:
        changed = run.changed
        for position in range(sent, len(run.events)):
            yield f"id: {position + 1}\ndata: {json.dumps(run.events[position], default=str)}\n\n"
        sent = len(run.events)
        if not run.meta["active"]:
            yield f"event: run\ndata: {json.dumps(run.meta)}\n\n"
            return
        await changed.wait()


async def cancel_run(*, user_id: str, session_id: str) -> RunMeta | None:
    """Cancel the run's task; a finished run is returned as it is."""
    run = await _load(user_id, session_id)
    if run is None:
        return None
    if run.task is not None and not run.task.done():
        run.task.cancel()
        await asyncio.gather(run.task, return_exceptions=True)
    return run.meta


async def delete_run(*, user_id: str, session_id: str) -> bool:
    """Delete the run's record, its events and its workspace."""
    run = await _load(user_id, session_id)
    if run is None:
        return False
    await cancel_run(user_id=user_id, session_id=session_id)
    _RUNS.pop((user_id, session_id), None)
    storage = get_user_session_storage(user_id)
    for name in ("run.json", "events.json"):
        await storage.delete(_run_key(session_id, name))
    shutil.rmtree(artifacts_dir(session_id), ignore_errors=True)
    return True


async def shutdown() -> None:
    """Cancel every active run; each saves itself as cancelled."""
    tasks = [run.task for run in _RUNS.values() if run.task is not None and not run.task.done()]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
