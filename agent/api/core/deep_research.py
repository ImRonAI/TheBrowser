"""Deep Research: one Strands Graph of Swarms and Graphs, run in the background.

The formation is ``FORMATION_TOPOLOGY``: an outer Graph, research_swarm -> data_analysis_graph ->
writing_swarm -> production_graph, of which each outcome's team keeps its own agents (``outcome_topology``; an app's
or a website's ends in ``BUILD_SWARM`` after the research swarm), built as the Strands docs build it:

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

Every agent is ``strands_harness.create_harness(...)`` with the level's prompt (``LEVELS``, modeled on the Perplexity
Agent API's effort levels, https://docs.perplexity.ai/docs/agent-api/effort.md), its role, the sections of its skill's
``SKILL.md`` that fit the role (``SKILL_SECTIONS``) and the same tools as every other agent. The Slidev agents load
their Slidev skills with the harness's ``skills`` tool instead (``SLIDEV_SKILLS``). Each agent and each subagent it
starts has the level's turn budget (``TurnBudget``), except the build agents, which have OpenCode build the app or
website on Ren's workspace computer as the Context Agent does (``OPENCODE_BUILD``) and wait on it.
"""

from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
import html
import io
import json
import logging
from pathlib import Path
import re
import shutil
import sys
import threading
import time
from typing import Final, Literal, NotRequired, TypedDict
import uuid

from PIL import Image
from pydantic_monty import MountDir
from strands import Agent
from strands.models import Model, ModelRouter
from strands.models.routing import FallbackStrategy, RoutingCandidate
from strands.multiagent import GraphBuilder, Swarm
from strands.multiagent.base import MultiAgentResult, NodeResult, Status
from strands.multiagent.graph import Graph, GraphState
from strands.hooks import BeforeToolCallEvent, MessageAddedEvent
from strands.injection.types import InjectionContext
from strands.plugins import Plugin
from strands.session import SnapshotSessionManager
from strands.types.exceptions import StorageError
from strands.types.session import encode_bytes_values
from strands.types.tools import AgentTool
from strands.vended_plugins.context_injector import ContextInjector
from strands.vended_plugins.skills import Skill
from strands_harness import create_harness

from agent.api.core import config as app_config
from agent.api.core.brave_tools import brave_tools
from agent.api.core.context_agent import OPENCODE_BUILD, Application, computer_tools, register_application_tool
from agent.api.core.dreaming import MEMORY_PROTOCOL, brain_memory
from agent.api.core.grid import GRID_JSON, GRID_MARKDOWN, grid_block_html, grid_from_json
from agent.api.core.media_understanding import EMBED_TABS_MARKDOWN, markdown_to_html
from agent.api.core.panel_agent import (
    DEFAULT_PROVIDER,
    PROVIDERS,
    ProviderName,
    TimeoutRetryStrategy,
    build_model,
    configured_providers,
    default_selection,
    infer_provider,
    provider_default_model,
)
from agent.api.core.panel_storage import get_user_session_storage
from agent.api.core.panel_tools import installed_http_request
from agent.api.core.render_ui_tool import render_workflow, workflow_block_html, workflow_graph
from agent.api.core.threads import owner_uuid
from agent.api.core.web_tools import web_tools

logger = logging.getLogger(__name__)

ResearchDepth = Literal["fast", "low", "medium", "high", "xhigh", "ultra"]
VALID_DEPTHS: Final[tuple[ResearchDepth, ...]] = ("fast", "low", "medium", "high", "xhigh", "ultra")
DEFAULT_DEPTH: Final[ResearchDepth] = "medium"
#: The levels runs were saved with before these: the lowest, the default and the highest.
LEGACY_DEPTHS: Final[dict[str, ResearchDepth]] = {"standard": "low", "deep": "medium", "exhaustive": "ultra"}
RunStatus = Literal["running", "completed", "failed", "cancelled"]
#: What a Squad run ends in: a report is a Document; a deck is a Slidev deck beside the report it is written from; a
#: datagrid is a spreadsheet, which opens as a Document too.
Outcome = Literal["report", "deck", "datagrid", "web_app", "website", "mobile_app"]
VALID_OUTCOMES: Final[tuple[Outcome, ...]] = ("report", "deck", "datagrid", "web_app", "website", "mobile_app")
#: The outcomes whose team writes report.md.
REPORT_OUTCOMES: Final[frozenset[Outcome]] = frozenset({"report", "deck"})
#: The outcomes OpenCode builds on Ren's workspace computer, offered only while it is configured.
BUILD_OUTCOMES: Final[frozenset[Outcome]] = frozenset({"web_app", "website", "mobile_app"})
DEFAULT_OUTCOME: Final[Outcome] = "report"
JsonDict = dict[str, object]

#: The Deep Research skill library, installed by the Skills CLI (``skills-lock.json`` records each source).
DEEP_RESEARCH_SKILLS_DIR: Final[Path] = (
    Path(__file__).resolve().parents[2] / "skills" / "deep-research" / ".agents" / "skills"
)

#: The Slidev skills, which the deck agents load with the harness's ``skills`` tool: Slidev's own and Deckcraft.
SLIDEV_SKILLS: Final[list[str]] = [
    str(DEEP_RESEARCH_SKILLS_DIR / "slidev"),
    str(DEEP_RESEARCH_SKILLS_DIR.parents[1] / "build-agent-slidev"),
]

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
    "label": "Squad",
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
                    "Researches the inquiry from primary sources, follows every claim back to the source that owns "
                    "it, and writes research.md, every claim with its source URL.",
                ),
                _agent(
                    "fact_checker",
                    "Fact Checker",
                    "scientific-critical-thinking",
                    "The only agent that opens sources: opens the source of every claim in research.md, records a "
                    "verdict per claim in fact-check.md and fixes or removes what fails.",
                ),
                _agent(
                    "citation_manager",
                    "Citation Manager",
                    "citation-management",
                    "Numbers the citations in research.md and lists each source once in references.md, from the "
                    "URLs in research.md and fact-check.md, without opening them.",
                ),
                _agent(
                    "research_qa",
                    "Research QA",
                    "peer-review",
                    "Checks research.md, fact-check.md and references.md against each other, without opening "
                    "sources: every claim cited, every citation in the reference list, every claim passed in "
                    "fact-check.md.",
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
                    "Checks every chart in figures/ against its data and citations in visuals.md and its script, "
                    "without opening sources, and fixes what is not.",
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
                    "Designs the Slidev deck in deck-layout.md: an art direction that follows the subject, the theme, "
                    "palette, type and motion, and each slide's layout, chart, Vue component and transition, with "
                    "three.js scenes where the subject has a shape worth seeing in 3D.",
                ),
                _agent(
                    "layout_qa",
                    "Layout QA",
                    "verification-before-completion",
                    "Checks the layouts the team's designers wrote (report-layout.md, and deck-layout.md when the team "
                    "has a deck) against the inquiry, research.md and figures/.",
                ),
                _agent(
                    "report_writer",
                    "Report Writer",
                    "scientific-writing",
                    "Writes report.md, the run's Document, as report-layout.md lays it out: every claim with its "
                    "citation number, charts as ![caption](figures/<name>.png), processes and timelines as workflows, "
                    "real videos, pages, maps and PDFs as embeds, and the reference list at the end.",
                ),
                _agent(
                    "report_qa",
                    "Report QA",
                    "peer-review",
                    "Checks report.md against research.md, references.md, figures/ and report-layout.md, without "
                    "opening sources.",
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
                    "Builds the deck as a Slidev project in the workspace from deck-copy.md and deck-layout.md: "
                    "slides.md (routerMode: hash), the charts from figures/, Vue components in components/ with "
                    "three.js scenes, layouts and styles; builds it into slides/ (slidev build --out slides --base ./) "
                    "and exports slides.pdf.",
                ),
                _agent(
                    "deck_build_qa",
                    "Slidev QA",
                    "slidev",
                    "Checks slides.md, slides/ and slides.pdf against deck-layout.md by looking at every slide: art "
                    "direction, nothing clipped or overflowing, charts, 3D scenes and citations in place; fixes what "
                    "is not.",
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

#: The formation an app's or a website's team ends in, after the research swarm.
BUILD_SWARM: Final[FormationSpec] = {
    "id": "build_swarm",
    "label": "Build Swarm",
    "kind": "swarm",
    "description": "Has OpenCode build the app or website on Ren's workspace computer, checks it and lists it under "
    "Applications.",
    "children": [
        _agent(
            "app_builder",
            "App Builder",
            "theme-factory",
            "Writes the brief from the inquiry and research.md, has OpenCode build, deploy and check the app or "
            "website on Ren's workspace computer, and lists it under the user's Applications.",
        ),
        _agent(
            "app_qa",
            "App QA",
            "verification-before-completion",
            "Checks what OpenCode built against the brief and research.md: opens the deployed site, or has the APK "
            "built again, and sends what fails back to the App Builder.",
        ),
    ],
    "edges": [],
}

#: The formation a spreadsheet's team ends in, after the research swarm.
GRID_SWARM: Final[FormationSpec] = {
    "id": "grid_swarm",
    "label": "Grid Swarm",
    "kind": "swarm",
    "description": "Builds the spreadsheet from the research, every value with its source and every result a "
    "formula, and checks it.",
    "children": [
        _agent(
            "grid_builder",
            "Grid Builder",
            "data-visualization",
            "Builds the spreadsheet the inquiry asks for from research.md and references.md and writes it as "
            "grid.json: its sheets, a row per item, numbers as numbers, every result a formula and every row's source.",
        ),
        _agent(
            "grid_qa",
            "Grid QA",
            "verification-before-completion",
            "Checks grid.json with Python: its shape, every formula's cells, every value against research.md and "
            "every source against references.md, and sends what fails back to the Grid Builder.",
        ),
    ],
    "edges": [],
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
    "app_builder": "When OpenCode has built it, it works and register_application has listed it, hand off to app_qa.",
    "app_qa": "If it fails your check, hand off to app_builder with exactly what fails. When it passes, reply with "
    "your verdict and where it is without handing off: that ends the build.",
    "grid_builder": "When grid.json is written, hand off to grid_qa.",
    "grid_qa": "If grid.json fails your check, hand off to grid_builder with exactly what fails. When it passes, reply "
    "with your verdict without handing off: that ends the spreadsheet.",
}

#: The agents each outcome's team keeps from ``FORMATION_TOPOLOGY``; a formation left with none drops out. The PDF is
#: printed from the report's Document, so no team builds one.
_RESEARCH_AGENTS: Final[frozenset[str]] = frozenset(
    {"researcher", "fact_checker", "citation_manager", "research_qa", "visual_planner", "data_analyst",
     "visual_citation", "visual_qa", "report_designer", "layout_qa", "report_writer", "report_qa"}
)
_BUILD_AGENTS: Final[frozenset[str]] = frozenset(
    {"researcher", "fact_checker", "citation_manager", "research_qa", "app_builder", "app_qa"}
)
OUTCOME_AGENTS: Final[dict[Outcome, frozenset[str]]] = {
    "report": _RESEARCH_AGENTS,
    "deck": _RESEARCH_AGENTS | {"deck_designer", "deck_writer", "deck_qa", "deck_producer", "deck_build_qa"},
    "datagrid": frozenset({"researcher", "fact_checker", "citation_manager", "research_qa", "grid_builder", "grid_qa"}),
    "web_app": _BUILD_AGENTS,
    "website": _BUILD_AGENTS,
    "mobile_app": _BUILD_AGENTS,
}

#: Handoffs that differ from ``SWARM_HANDOFFS`` where an outcome's team leaves agents out.
OUTCOME_HANDOFFS: Final[dict[Outcome, dict[str, str]]] = {
    "report": {
        "report_designer": "When report-layout.md is written, hand off to layout_qa.",
        "layout_qa": "If report-layout.md fails your check, hand off to report_designer. When it passes, hand off to "
        "report_writer.",
        "report_qa": "If report.md fails your check, hand off to report_writer. When it passes, reply with your "
        "verdict without handing off: that ends the writing.",
    },
    "deck": {},
    "datagrid": {},
    "web_app": {},
    "website": {},
    "mobile_app": {},
}

#: What each build outcome's App Builder has OpenCode make; App QA reads the same.
BUILD_NOTES: Final[dict[Outcome, str]] = {
    "web_app": "Build a web app: an interactive tool that does what the inquiry asks, for the person who asked, its "
    "features and data grounded in research.md. It opens in Ren's browser from Applications.",
    "website": "Build a website: the pages the inquiry asks for, their copy written from research.md (every fact as "
    "the research states it, the sources from references.md linked where a fact appears), designed for its "
    "subject. It opens in Ren's browser from Applications.",
    "mobile_app": "Build an Android app that does what the inquiry asks, its features and data grounded in "
    "research.md. Register it with the APK's full path: it shows under Applications on Ren's home on the user's "
    "phone, where a tap installs it.",
}


def available_outcomes() -> tuple[Outcome, ...]:
    """The outcomes a run can have now: the build outcomes only while Ren's workspace computer is configured."""
    computer = bool(app_config.COMPUTER_MCP_URL and app_config.COMPUTER_MCP_TOKEN)
    return tuple(outcome for outcome in VALID_OUTCOMES if computer or outcome not in BUILD_OUTCOMES)


def build_note(outcome: Outcome, user_id: str) -> str:
    """The App Builder's and App QA's instructions for a build outcome: what to make and how OpenCode builds it.

    A fix goes to the OpenCode session that built it: ``opencode run --continue`` continues the last session of the
    folder it runs in (https://opencode.ai/docs/cli/commands/).
    """
    return (
        f"{BUILD_NOTES[outcome]}\n"
        "OpenCode can't read this run's workspace: copy research.md and references.md into the project folder with "
        "computer_write_file and have the brief point OpenCode at them. computer_read_process_output waits up to 50 s "
        "a call, so keep reading until OpenCode exits. A fix after App QA's check goes to the session that built it: "
        "the same command in the project folder with --continue before the message, which says exactly what fails.\n"
        + OPENCODE_BUILD.replace("{user_id}", user_id)
    )


def outcome_topology(outcome: Outcome) -> Topology:
    """``FORMATION_TOPOLOGY``, ``BUILD_SWARM`` and ``GRID_SWARM`` with only the outcome's team: its formations in
    order, each with its kept agents."""
    kept = OUTCOME_AGENTS[outcome]
    nodes: list[FormationSpec] = []
    for formation in (*FORMATION_TOPOLOGY["nodes"], BUILD_SWARM, GRID_SWARM):
        children = [child for child in formation["children"] if child["id"] in kept]
        if children:
            ids = {child["id"] for child in children}
            edges = [edge for edge in formation["edges"] if edge["from"] in ids and edge["to"] in ids]
            nodes.append({**formation, "children": children, "edges": edges})
    return {
        **FORMATION_TOPOLOGY,
        "nodes": nodes,
        "edges": [_edge(source["id"], target["id"]) for source, target in zip(nodes, nodes[1:])],
    }


#: The headings of each agent's ``SKILL.md`` whose sections it gets, each with its subsections. The skill files are
#: general packs (manuscript peer review, BibTeX from paper databases, marketing copy, PowerPoint), so an agent gets
#: only what fits its role; an agent missing here gets none of its skill, except the Slidev agents (``SLIDEV_AGENTS``).
SKILL_SECTIONS: Final[dict[str, tuple[str, ...]]] = {
    "fact_checker": ("When Uncertain", "Remember"),
    "visual_planner": ("Core Concepts", "Best Practices"),
    "data_analyst": ("Chart Selection Guide", "Python Visualization Code Patterns", "Design Principles",
                     "Color Blindness"),
    "visual_qa": ("2. Choose an honest encoding",),
    "report_designer": ("Themes Available", "Theme Details", "Application Process"),
    "report_writer": ("No fabrication", "Scientific fidelity", "5. Draft without adding facts"),
    "deck_qa": ("Word-Level Checks", "Sentence-Level Checks", "AI-Tell Check"),
    "pdf_publisher": ("reportlab - Create PDFs",),
    "pdf_qa": ("pdfplumber - Text and Table Extraction", "Extract Images"),
}


#: The deck agents, which load ``SLIDEV_SKILLS`` with the harness's ``skills`` tool.
SLIDEV_AGENTS: Final[frozenset[str]] = frozenset({"deck_designer", "deck_producer", "deck_build_qa"})

#: What the agents' roles need beyond their description.
ROLE_NOTES: Final[dict[str, str]] = {
    "report_writer": (
        "report.md becomes a Document in the user's Squad folder, so write it the way Ren's Document Agent "
        "writes a page:\n"
        "- Charts as ![Caption](figures/<name>.png); other images only from real https:// URLs a tool returned.\n"
        "- A process, plan, pipeline, timeline or decision flow as a workflow: draw it with `render_workflow`, then "
        "write the same title, steps and connections into report.md as a ```workflow fence holding "
        "{\"title\": ..., \"steps\": [...], \"connections\": [...]}.\n"
        f"- {EMBED_TABS_MARKDOWN} A YouTube video is a YouTube tab in such a fence, from a real URL a tool returned.\n"
        f"- {GRID_MARKDOWN}\n"
    ),
    "grid_builder": (
        "grid.json is the spreadsheet the user gets: it opens in Ren as a sheet to sort, filter and calculate with, "
        "and downloads as an Excel file. Write it with Python (`json.dump`), so it is valid JSON:\n"
        f"{GRID_JSON}\n"
        "- One row per item the inquiry asks about and one column per fact, so every row reads on its own.\n"
        "- Numbers are numbers, never text with a unit or a separator: the unit goes in the header (\"Price (USD)\") "
        "and the column's number format shows it. A date is text as 2026-11-21.\n"
        "- Whatever follows from other cells is a formula, never a typed result: totals, shares, differences, ranks, "
        "and a summary sheet that reads the data sheet.\n"
        "- Every data row ends with a Source column holding the reference numbers its facts came from, and the last "
        "sheet, Sources, lists references.md: number, title, URL.\n"
    ),
    "grid_qa": (
        "Load grid.json with Python and check it: every sheet has a header and rows no wider than it, numbers are "
        "numbers, every formula points at cells that exist and hold what it needs, and nothing that follows from "
        "other cells is typed in. Then compare every value with research.md and every Source with references.md.\n"
    ),
    "deck_designer": (
        "Load your Slidev skills with the `skills` tool before you design (Deckcraft's references/art-direction.md, "
        "layouts.md, vue-components.md and animations.md, and Slidev's own references). Make the deck beautiful with "
        "everything Slidev allows: a theme, fonts, a deliberate palette, layouts, v-click and v-motion choreography, "
        "Magic Move, Mermaid, LaTeX, transitions, and custom Vue components, three.js among them. Every slide gets a "
        "visual: a chart from figures/, a diagram, a 3D scene or a styled component, never a wall of bullets.\n"
    ),
    "deck_producer": (
        "Load your Slidev skills with the `skills` tool before you build. The workspace is the Slidev project: "
        "`pnpm add @slidev/cli @slidev/theme-default three playwright-chromium` there, slides.md at its root with "
        "`routerMode: hash` in the headmatter, Vue components in components/ (three.js scenes run in onMounted on a "
        "canvas and stop in onUnmounted), layouts in layouts/, styles in styles/, charts copied to public/. Build with "
        "`pnpm exec slidev build --out slides --base ./` and export with `pnpm exec slidev export --output slides.pdf "
        "--timeout 0`. A build that fails is fixed and run again until it passes.\n"
    ),
    "deck_build_qa": (
        "Load your Slidev skills with the `skills` tool. Export every slide as an image "
        "(`pnpm exec slidev export --format png --output qa`) and look at each with `read`; fix slides.md, components/ "
        "or styles/ until every slide looks finished, then build and export slides/ and slides.pdf again.\n"
    ),
}


def skill_sections(instructions: str, headings: tuple[str, ...]) -> str:
    """The sections of a ``SKILL.md`` body under ``headings``, in the file's order: each heading through the line before
    the next heading of its level or higher, headings inside code fences ignored."""
    lines = instructions.splitlines()
    found: list[tuple[int, int]] = []
    fenced = False
    for number, line in enumerate(lines):
        if line.startswith("```"):
            fenced = not fenced
        elif not fenced and line.startswith("#"):
            level = len(line) - len(line.lstrip("#"))
            found.append((number, level))
    sections: list[str] = []
    missing = set(headings)
    for index, (start, level) in enumerate(found):
        title = lines[start][level:].strip()
        if title not in headings:
            continue
        missing.discard(title)
        end = next((line for line, other in found[index + 1:] if other <= level), len(lines))
        sections.append("\n".join(lines[start:end]).strip())
    if missing:
        raise ValueError(f"SKILL.md has no section {sorted(missing)}")
    return "\n\n".join(sections)


class Level(TypedDict):
    label: str
    prompt: str
    pages: tuple[int, int]
    sources: int
    figures: int
    slides: int
    turns: int


#: The last turns of an agent's budget, kept for bringing its work together and handing off.
WRAP_UP_TURNS: Final[int] = 5

_FAST_PROMPT: Final[str] = """# Deep Research: {label}
Today is {today}. You are one agent of Ren's Deep Research at its fastest level. The goal is an accurate, \
well-cited report, with speed and precision before breadth.

## Tools workflow
- Search before you write anything factual. Don't rely on what you remember where current, verifiable sources exist.
- Split the inquiry into its parts and search them in parallel, in one turn. Queries are short keywords: 2 to 5 \
words, 8 at most, none repeating or overlapping another.
- Write in the inquiry's language.
- When searches come back empty or unhelpful, say what stays unknown instead of filling the gap.

## Citations
- Every sentence that rests on a source carries its citation right after the statement, with no space before the \
bracket: "grew 4%[3]." Several sources take separate brackets, "[2][5]", at most three per sentence: the most relevant.
- Only the reference number goes inside the brackets: no commas, spaces or dashes.
- Cite only what a source says. Nothing from memory is cited.
- The reference list at the end of report.md, built from references.md, is the only list of sources.

## Writing
- Open with the direct answer in one or two sentences, never with a header or with how the research went.
- Use ## headings for substantial sections only, and bold sparingly.
- Lists are flat: numbered for sequences, bullets otherwise. Markdown tables for comparisons, citations in the cells. \
Code in fenced blocks with their language. Math in LaTeX, \\( \\) inline and \\[ \\] for blocks. Supporting quotes \
as blockquotes.
- Plain, precise, active voice, varied sentences. No hedging, no first person, nothing about yourself or the search \
("based on my search").
- Fit the inquiry: a scientific write-up for academic questions; news grouped by topic, newest first; a person's \
profile kept apart from others who share the name; code first, then its explanation; exact amounts for anything \
step by step; formulas in LaTeX with their citations after them.
- Never reproduce copyrighted text: quotes stay under 30 words and everything else is in your own words. Plain facts \
are always fine.
"""

_RESEARCH_PROMPT: Final[str] = """# Deep Research: {label}
Today is {today}. You are an expert research assistant, one agent of Ren's Deep Research at the {label} level. \
Gather evidence with search and your other tools before you write: break the inquiry into its parts, make the calls \
each part needs, and read what comes back carefully.

## Searching
- Queries are plain keywords. No quotation marks and no AND, OR or NOT: the engines read them as text. For \
alternatives or an exact phrase, send several short queries.
- Use every research tool you have, not only search: extract, crawl and map pages with Tavily, Exa, Bright Data and \
Olostep, fetch with http_request, compute and parse data with Python. Run independent calls together in one turn.
- Prefer primary sources (the paper, the filing, the dataset, the official page) and use a write-up only to find them.

## Citations
- Cite only when a source in research.md or references.md informs what you write. Never invent a source or a number.
- Cite every source-backed fact, current claim, named entity, figure and recommendation where it appears. One \
citation may cover a bullet or a paragraph that all comes from one source.
- A citation is the source's reference number in brackets, right after what it supports: [n]. Adjacent citations \
sit together with nothing between them: [2][7].
- No raw URLs in the text and no footnotes: the reference list at the end of report.md is the only list of sources.

## Finish complete (this overrides everything else)
- Every file you are responsible for ends complete. Never stop after tool calls alone and never leave a placeholder.
- Never refuse, say you can't finish, or ask for more information.
- When the evidence is incomplete, conflicting or uncertain, commit to the most likely answer, state it first and add \
at most one short caveat.

## Format
- Answer the inquiry's exact question directly, with the name, number, date or entity it asks for up front.
- Ground the answer in tool evidence and cite every factual claim.
- For a list or an "all/every" question, give a complete markdown table: one header row with the columns asked for, \
one row per item, every item covered and every cell filled, empty only where the value truly doesn't exist.
"""

_EXTENDED_PROMPT: Final[str] = _RESEARCH_PROMPT + """
## Sandbox
- The shell and Python in the workspace are your sandbox: download data files, parse them, compute and check every \
number there, never in your head.
- Tool results come back whole and older turns are summarized for you as your context fills, so keep going until \
each part of the inquiry is answered from primary sources.
"""

_ULTRA_PROMPT: Final[str] = _EXTENDED_PROMPT + """- This is the most complete level and a long run is expected: \
cover every angle the inquiry has, including the counterevidence, before anything is written.
"""

#: The research levels, Perplexity's six effort levels from fastest to most complete: each its own prompt
#: (fast's, the shared low/medium/high research prompt, and xhigh/ultra's with the sandbox), the report's length, the
#: least number of sources, the figures, the deck's slides and each agent's turn budget.
LEVELS: Final[dict[ResearchDepth, Level]] = {
    "fast": {"label": "Fast", "prompt": _FAST_PROMPT, "pages": (5, 8), "sources": 15, "figures": 3, "slides": 8,
             "turns": 12},
    "low": {"label": "Low", "prompt": _RESEARCH_PROMPT, "pages": (8, 12), "sources": 25, "figures": 4, "slides": 10,
            "turns": 20},
    "medium": {"label": "Medium", "prompt": _RESEARCH_PROMPT, "pages": (12, 17), "sources": 40, "figures": 6,
               "slides": 14, "turns": 30},
    "high": {"label": "High", "prompt": _RESEARCH_PROMPT, "pages": (17, 23), "sources": 60, "figures": 8, "slides": 18,
             "turns": 45},
    "xhigh": {"label": "Extra High", "prompt": _EXTENDED_PROMPT, "pages": (23, 30), "sources": 90, "figures": 11,
              "slides": 24, "turns": 70},
    "ultra": {"label": "Ultra", "prompt": _ULTRA_PROMPT, "pages": (30, 40), "sources": 130, "figures": 15,
              "slides": 30, "turns": 100},
}

#: Words on a report page, figures and headings included, for the length the report writer aims at.
WORDS_PER_PAGE: Final[int] = 450


def level_prompt(depth: ResearchDepth, today: str, outcome: Outcome = DEFAULT_OUTCOME) -> str:
    """The level's prompt with the outcome's size and the way every agent works through its turns."""
    level = LEVELS[depth]
    low, high = level["pages"]
    if outcome in REPORT_OUTCOMES:
        size = (
            f"- report.md: {low} to {high} pages (about {low * WORDS_PER_PAGE:,} to {high * WORDS_PER_PAGE:,} words), "
            f"with {level['figures']} figures or more and at least {level['sources']} distinct, good sources cited in "
            "it.\n"
        )
    else:
        size = f"- research.md: at least {level['sources']} distinct, good sources.\n"
    if outcome == "deck":
        size += f"- The deck: {level['slides']} slides.\n"
    return level["prompt"].format(label=level["label"], today=today) + (
        f"\n## Size\n{size}\n"
        "## How you work\n"
        "- Use `subagent` for the independent parts (a question, a source, a chart, a section each), several in "
        "parallel, each told the exact files to read and the result to bring back. Each one's full findings come back "
        "to you when it finishes.\n"
        "- Read and write the workspace with `read`, `write`, `edit` and `shell`. `programmatic_tool_caller` code "
        "sees the workspace too (`open()` and `pathlib` under its absolute path), so it can read files, call tools "
        "and write the results in one run.\n"
        "- If a tool fails or stalls, pivot to another tool or write a replacement `@tool` in `./tools/<name>.py` (loaded "
        "automatically). Never call `handoff_to_agent` while subagents are still "
        "running: wait for their findings first.\n"
        "- A reminder tells you when you are down to your last few calls. Then gather what your subagents returned, "
        "write your file, check it against your role, and hand off or finish.\n"
    )


#: What a node may still call once its turns are spent: enough to write its artifact (the production agents build it
#: with ``shell``), collect background results and hand off.
NODE_WRAP_UP_TOOLS: Final[frozenset[str]] = frozenset(
    {"read", "write", "edit", "shell", "handoff_to_agent", "strands_manage_background_task", "todo_write"}
)


class TurnBudget(Plugin):
    """The wrap-up nudge: a reminder over the last turns, then only wrap-up tool calls. Nothing is ever cut off.

    From ``WRAP_UP_TURNS`` before the budget, Strands' ``ContextInjector`` adds the reminder (``reminder``). Past the
    budget, ``BeforeToolCallEvent.cancel_tool`` (Hook events,
    https://strandsagents.com/docs/user-guide/sdk/agents/hooks-events/index.md) declines any call that isn't wrap-up
    work, with a message saying what to do instead; the model keeps going and writes its own last reply. A subagent
    then replies with everything it found, which the subagent tool returns to its parent; a Swarm or Graph node writes
    its artifact and hands off, because a Swarm agent that replies without ``handoff_to_agent`` ends its Swarm
    (https://strandsagents.com/latest/documentation/docs/user-guide/concepts/multi-agent/swarm/). The harness
    rebuilds every subagent with its parent's plugins, so subagents carry the same nudge.
    """

    name = "deep-research:turn-budget"

    def __init__(self, turns: int, node_ids: frozenset[str]) -> None:
        super().__init__()
        self.turns = turns
        self.node_ids = node_ids

    @staticmethod
    def turn(agent: Agent) -> int:
        """The turn the agent is on in its current invocation (``Limits`` counts turns the same way)."""
        invocation = agent.event_loop_metrics.latest_agent_invocation
        return len(invocation.cycles) if invocation is not None else 0

    def init_agent(self, agent: Agent) -> None:
        agent.add_hook(self.wrap_up, BeforeToolCallEvent)

    def wrap_up(self, event: BeforeToolCallEvent) -> None:
        if self.turn(event.agent) <= self.turns:
            return
        if event.agent.name not in self.node_ids:
            event.cancel_tool = ("Wrap up now: no more tool calls. Reply with everything you found, every source, "
                                 "number and quote, so your parent gets all of it.")
        elif event.tool_use["name"] not in NODE_WRAP_UP_TOOLS:
            event.cancel_tool = ("Wrap up now: no more research or delegation. Write your file from what you and your "
                                 "subagents found, then hand off or finish as your role says.")

    def reminder(self, context: InjectionContext) -> str | None:
        """The ``<system-reminder>`` for each of the last turns (the harness's convention for injected text)."""
        turn = self.turn(context.agent)
        if self.turns - turn >= WRAP_UP_TURNS:
            return None
        if context.agent.name in self.node_ids:
            work = ("You are down to your last few calls. Stop delegating and researching: gather what your "
                    "subagents returned, write your file, check it against your role and hand off or finish as your "
                    "role says.")
        else:
            work = ("You are down to your last few calls. Stop starting new searches: finish what is in flight, then "
                    "reply with everything you found, every source, number and quote, for your parent.")
        return f"<system-reminder>{work}</system-reminder>"


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
    #: Missing on a run saved before outcomes, which ran the whole ``FORMATION_TOPOLOGY``.
    outcome: NotRequired[Outcome]
    status: RunStatus
    active: bool
    created_at: str
    updated_at: str
    completed_at: str | None
    selection: Selection
    error: str | None
    document_id: str | None
    #: The app a build outcome's run listed under Applications (``Application``), once it has.
    application: NotRequired[JsonDict]


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
    """Every Deep Research agent's tools beside the harness built-ins: web tools, ``http_request``, and ``load_tool``."""
    from strands.tools.loader import load_tools_from_module
    from strands_tools import load_tool as load_tool_mod

    loaded_tool = [t for t in load_tools_from_module(load_tool_mod, "load_tool") if t.tool_name == "load_tool"]
    return [*brave_tools(), *web_tools(), installed_http_request(), *loaded_tool]


def _skills() -> dict[str, Skill]:
    return {skill.name: skill for skill in Skill.from_directory(DEEP_RESEARCH_SKILLS_DIR)}


def _read_timeout(provider: ProviderName) -> float | None:
    return app_config.RON_DEEP_RESEARCH_NIM_READ_TIMEOUT if provider == "nim" else None


def build_research_model(
    provider: ProviderName, model_id: str, reasoning_effort: str | None = None
) -> ModelRouter:
    """Native ``ModelRouter(FallbackStrategy)``: the chosen model first, then configured native chat defaults."""
    primary = build_model(
        provider, model_id, reasoning_effort, hosted_tools=False, read_timeout=_read_timeout(provider)
    )
    candidates = [RoutingCandidate(primary, name=f"{provider}:{model_id}")]
    seen_ids = {id(primary)}
    ready: tuple[ProviderName, ...] = tuple(name for name in configured_providers() if name != "perplexity")
    for other in sorted(ready, key=lambda name: name != DEFAULT_PROVIDER):
        other_model = provider_default_model(other)
        if (other, other_model) == (provider, model_id):
            continue
        try:
            fallback = build_model(other, other_model, None, hosted_tools=False, read_timeout=_read_timeout(other))
        except Exception:
            continue
        if id(fallback) in seen_ids:
            continue
        seen_ids.add(id(fallback))
        candidates.append(RoutingCandidate(fallback, name=f"{other}:{other_model}"))
    return ModelRouter(candidates, strategy=FallbackStrategy())


def _node_completed(node_id: str) -> Callable[[GraphState], bool]:
    """Graph edge condition (``strands.multiagent.graph``): advance only when the source finished ``COMPLETED``."""
    return lambda state: (node := state.results.get(node_id)) is not None and node.status == Status.COMPLETED


def build_deep_research_graph(
    *,
    session_id: str,
    user_id: str,
    model: Model | ModelRouter,
    depth: ResearchDepth,
    outcome: Outcome = DEFAULT_OUTCOME,
    on_node_event: Callable[[JsonDict], None] | None = None,
    on_application: Callable[[Application], None] | None = None,
) -> Graph:
    """Build the outcome's team as a Strands Graph whose nodes are Swarms and Graphs of harness agents."""
    topology = outcome_topology(outcome)
    handoffs = {**SWARM_HANDOFFS, **OUTCOME_HANDOFFS[outcome]}
    workspace = artifacts_dir(session_id).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "tools").mkdir(exist_ok=True)
    (Path.cwd() / "tools").mkdir(exist_ok=True)
    # Monty's own filesystem (pydantic_monty ``MountDir``): the workspace at its own path, read-write, so
    # ``programmatic_tool_caller`` code opens the same files as ``read``/``write``/``shell``. One mount serves
    # every agent's runs; Monty reuses only its configuration per feed.
    workspace_mount = MountDir(host_path=workspace, virtual_path=str(workspace), mode="read-write")
    skills = _skills()
    level = level_prompt(depth, datetime.now().astimezone().strftime("%A, %B %d, %Y"), outcome)
    workspace_note = (
        "## Workspace\n"
        f"Every file of this run is in {workspace}. Read what the other agents saved there and save your work "
        "there under absolute paths.\n"
        f"- Python: {sys.executable}"
    )
    node_ids = frozenset(child["id"] for formation in topology["nodes"] for child in formation["children"])
    from agent.api.core.build_agent import _context_kwargs

    # The user's connected accounts (Vercel, Netlify, GitHub, GitLab, Supabase, Bitbucket): an app or a site the run
    # builds is pushed and deployed with them.
    from agent.api.core.connections import connection_tools

    connected = connection_tools(user_id)

    def make_agent(spec: AgentSpec, formation_id: str) -> Agent:
        skill = skills[spec["skill"]]
        handoff = handoffs.get(spec["id"])
        sections = SKILL_SECTIONS.get(spec["id"])
        builds = spec in BUILD_SWARM["children"]
        note = build_note(outcome, user_id) if builds else ROLE_NOTES.get(spec["id"])
        budget = TurnBudget(LEVELS[depth]["turns"], node_ids)
        tools = [*research_tools(), *connected]
        if spec["id"] == "report_writer":
            tools.append(render_workflow)
        if builds:
            tools.extend(computer_tools())
        if spec["id"] == "app_builder":
            tools.append(register_application_tool(user_id, on_application))

        agent_holder: list[Agent] = []

        def node_callback(**event: object) -> None:
            if on_node_event is None or "tool_stream_event" not in event or not agent_holder:
                return
            stream = event.get("tool_stream_event")
            tool_use = stream.get("tool_use") if isinstance(stream, dict) else None
            tool_use_id = tool_use.get("toolUseId") if isinstance(tool_use, dict) else None
            if not tool_use_id:
                return
            tasks = agent_holder[0].state.get("strands.background_tasks") or []
            tool_input = tool_use.get("input") if isinstance(tool_use, dict) else None
            is_bg_subagent = isinstance(tool_input, dict) and isinstance(tool_input.get("subagent_id"), str)
            if not is_bg_subagent and not any(
                isinstance(t, dict) and t.get("tool_use_id") == tool_use_id for t in tasks
            ):
                return
            kept = filter_event(event)
            if kept is None:
                return
            on_node_event(
                {
                    "type": "multiagent_node_stream",
                    "node_id": formation_id,
                    "event": {"type": "multiagent_node_stream", "node_id": spec["id"], "event": kept},
                }
            )

        built = create_harness(
            name=spec["id"],
            description=spec["description"],
            model=model,
            instructions=(
                level
                + f"\n## Your role: {spec['label']}\n{spec['description']}\n\n"
                + (f"{note}\n" if note else "")
                + (f"## Handing off\n{handoff}\n\n" if handoff else "")
                + workspace_note
                + (
                    f"\n\n## From the skill {skill.name} (its files are in {skill.path})\n"
                    f"{skill_sections(skill.instructions, sections)}"
                    if sections else ""
                )
                + MEMORY_PROTOCOL
            ),
            skills=[*SLIDEV_SKILLS] if spec["id"] in SLIDEV_AGENTS else False,
            tools=tools,
            # A build agent's work is waiting on OpenCode, so it runs without the turn budget, as Strands has it.
            plugins=[] if builds else [
                budget, ContextInjector(budget.reminder, name="deep-research:wrap-up", trigger="everyTurn")
            ],
            builtin_tools={
                "*": False,
                "shell": True,
                "read": True,
                "write": True,
                "edit": True,
                "programmatic_tool_caller": {"hot_reload": True, "timeout": None, "mount": workspace_mount},
                "subagent": {"background": True, "stall_timeout": 60.0, "max_consecutive_errors": 3},
            },
            builtin_plugins=["todos"],
            caching=False,
            session=False,
            memory=brain_memory(user_id, "deep-research"),
            # The SDK's own policy (background_tasks/_types.py): the model picks background execution per call
            # (``agentic``), so a search returns its result inline unless the model asks otherwise; ``subagent``
            # is backgrounded by the harness itself. ``handoff_to_agent`` never runs in the background, so the
            # Swarm sees the handoff in the turn that makes it.
            background_tasks={"agentic": ["*"], "never": ["handoff_to_agent"]},
            # Tool results stay whole in the conversation (no offload stash, no ``retrieve_context``); the
            # conversation itself is summarized near the model's window, as the panel and Build agents do
            # (https://strandsagents.com/docs/user-guide/sdk/agents/conversation-management/index.md).
            **_context_kwargs("auto", lambda _role: model),
            load_tools_from_directory=True,
            callback_handler=node_callback if on_node_event is not None else None,
            retry_strategy=TimeoutRetryStrategy(max_attempts=2, initial_delay=2),
        )
        agent_holder.append(built)
        if on_node_event is not None:
            emitted_resumes: set[str] = set()

            def on_node_message_added(ev: MessageAddedEvent) -> None:
                msg = ev.message
                if not isinstance(msg, Mapping) or msg.get("role") != "user":
                    return
                for block in msg.get("content", []):
                    txt = block.get("text") if isinstance(block, Mapping) else None
                    if isinstance(txt, str) and (
                        txt.startswith("[subagent-completed]") or txt.startswith("[subagent-hangup]")
                    ):
                        if txt not in emitted_resumes:
                            emitted_resumes.add(txt)
                            kept = filter_event({"message": msg})
                            if kept is not None:
                                on_node_event(
                                    {
                                        "type": "multiagent_node_stream",
                                        "node_id": formation_id,
                                        "event": {
                                            "type": "multiagent_node_stream",
                                            "node_id": spec["id"],
                                            "event": kept,
                                        },
                                    }
                                )

            built.add_hook(on_node_message_added, MessageAddedEvent)
        return built

    def make_formation(spec: FormationSpec) -> Swarm | Graph:
        agents = [make_agent(child, spec["id"]) for child in spec["children"]]
        if spec["kind"] == "swarm":
            return Swarm(
                agents,
                id=spec["id"],
                execution_timeout=app_config.RON_DEEP_RESEARCH_EXECUTION_TIMEOUT,
                node_timeout=app_config.RON_DEEP_RESEARCH_NODE_TIMEOUT,  # type: ignore[arg-type]
                repetitive_handoff_detection_window=8,
                repetitive_handoff_min_unique_agents=3,
            )
        builder = GraphBuilder()
        for agent, child in zip(agents, spec["children"]):
            builder.add_node(agent, child["id"])
        for edge in spec["edges"]:
            builder.add_edge(edge["from"], edge["to"], condition=_node_completed(edge["from"]))
        if app_config.RON_DEEP_RESEARCH_NODE_TIMEOUT is not None:
            builder.set_node_timeout(app_config.RON_DEEP_RESEARCH_NODE_TIMEOUT)
        builder.set_graph_id(spec["id"])
        return builder.build()

    builder = GraphBuilder()
    for formation in topology["nodes"]:
        builder.add_node(make_formation(formation), formation["id"])
    for edge in topology["edges"]:
        builder.add_edge(edge["from"], edge["to"], condition=_node_completed(edge["from"]))
    builder.set_graph_id(topology["id"])
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


def _failure_message(result: MultiAgentResult) -> str:
    for node in result.results.values():
        if isinstance(node.result, Exception):
            return str(node.result) or type(node.result).__name__
        if isinstance(node.result, MultiAgentResult) and node.status == Status.FAILED:
            return _failure_message(node.result)
    return "The formation failed."


async def _checkpoint(run: _Run) -> None:
    """Save the run while it goes on; a refused write (the bucket's 429) is logged and the next save carries it."""
    try:
        await _save(run)
    except StorageError:
        logger.warning("session_id=<%s> | deep research checkpoint not saved", run.meta["session_id"], exc_info=True)


async def _execute(run: _Run, graph: Graph, task: str) -> None:
    saved_at = time.monotonic()
    # The save runs beside the stream, one at a time, so a slow bucket never holds the run's events.
    checkpoint: asyncio.Task[None] | None = None
    try:
        async for event in graph.stream_async(task):
            kept = filter_event(event)
            if kept is None:
                continue
            _append(run, kept)
            if kept.get("type") == "multiagent_result":
                result = event.get("result")
                failed = isinstance(result, MultiAgentResult) and result.status == Status.FAILED
                _finish(
                    run,
                    "failed" if failed else "completed",
                    _failure_message(result) if isinstance(result, MultiAgentResult) and failed else None,
                )
            if (checkpoint is None or checkpoint.done()) and time.monotonic() - saved_at > _SAVE_INTERVAL_SECONDS:
                checkpoint = asyncio.create_task(_checkpoint(run))
                saved_at = time.monotonic()
        if run.meta["active"]:
            _finish(run, "completed", None)
    except asyncio.CancelledError:
        _finish(run, "cancelled", None)
    except Exception as error:
        logger.exception("session_id=<%s> | deep research run failed", run.meta["session_id"])
        _finish(run, "failed", str(error) or type(error).__name__)
    finally:
        if checkpoint is not None:
            await checkpoint
        await _save(run)


def _task_text(query: str, context: str) -> str:
    return f"{query}\n\nContext:\n{context}" if context else query


async def start_run(
    *,
    user_id: str,
    query: str,
    context: str = "",
    depth: ResearchDepth = DEFAULT_DEPTH,
    outcome: Outcome = DEFAULT_OUTCOME,
    provider: str | None = None,
    model_id: str | None = None,
    reasoning_effort: str | None = None,
) -> RunMeta:
    """Build the formation and run it in the background; the returned meta names the run.

    Raises:
        ValueError: When no model provider is configured, or the outcome can't be made: an app or a website without
            the workspace computer, a mobile app for a guest (its APK is served from the account's Applications).
    """
    if outcome not in available_outcomes():
        raise ValueError("Ren's workspace computer isn't configured, so Squad can't build apps or websites.")
    if outcome == "mobile_app" and owner_uuid(user_id) is None:
        raise ValueError("Sign in to Ren to have Squad build a mobile app: it installs from your account's Applications.")
    selection = resolve_selection(provider, model_id)
    if selection is None:
        raise ValueError("No model provider is configured for Squad.")
    chosen_provider, chosen_model = selection
    session_id = f"dr-{uuid.uuid4().hex[:16]}"
    model = build_research_model(chosen_provider, chosen_model, reasoning_effort)
    created = _now()
    run = _Run(
        meta={
            "session_id": session_id,
            "user_id": user_id,
            "query": query,
            "context": context,
            "title": query.splitlines()[0][:96],
            "depth": depth,
            "outcome": outcome,
            "status": "running",
            "active": True,
            "created_at": created,
            "updated_at": created,
            "completed_at": None,
            "selection": {"provider": chosen_provider, "model_id": chosen_model, "reasoning_effort": reasoning_effort},
            "error": None,
            "document_id": None,
        }
    )
    loop = asyncio.get_running_loop()
    loop_thread = threading.get_ident()

    def on_node_event(wrapped: JsonDict) -> None:
        if not run.meta["active"]:
            return
        if threading.get_ident() == loop_thread:
            _append(run, wrapped)
        else:
            loop.call_soon_threadsafe(_append, run, wrapped)

    def on_application(application: Application) -> None:
        run.meta["application"] = application.model_dump()

    graph = build_deep_research_graph(
        session_id=session_id, user_id=user_id, model=model, depth=depth, outcome=outcome,
        on_node_event=on_node_event, on_application=on_application,
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
    # A run saved before the levels and Documents: its depth as the level it matches, and no Document.
    meta["depth"] = LEGACY_DEPTHS.get(meta["depth"], meta["depth"])
    meta.setdefault("document_id", None)
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
        if path.is_file()
        and not any(part.startswith(".") or part == "node_modules" for part in path.relative_to(root).parts)
    )


async def get_run(*, user_id: str, session_id: str) -> JsonDict | None:
    """The run's meta, every kept event, its workspace files and the text of report.md, slides.md and grid.json."""
    run = await _load(user_id, session_id)
    if run is None:
        return None
    workspace = artifacts_dir(session_id)
    texts = {
        key: (workspace / name).read_text(encoding="utf-8") if (workspace / name).is_file() else ""
        for key, name in (("report_markdown", "report.md"), ("slidev_markdown", "slides.md"), ("grid_json", "grid.json"))
    }
    return {**run.meta, "events": list(run.events), "files": workspace_files(session_id), **texts}


_FIGURE_TYPES: Final[dict[str, str]] = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                                         ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml"}
#: A figure's longer side in a Document: twice the page's width, for sharp charts on a high-density screen.
_INLINE_IMAGE_EDGE: Final[int] = 1600
_WORKFLOW_BLOCK = re.compile(r'<pre><code class="language-workflow">(.*?)</code></pre>', re.DOTALL)
_WORKSPACE_IMAGE = re.compile(r'<img src="(?!https?:|data:)([^"]+)"')
#: The report's own title, which becomes the Document's title rather than its first line.
_LEADING_HEADING = re.compile(r"\s*<h1>(.*?)</h1>\s*", re.DOTALL)


def _workflow_block(match: re.Match[str]) -> str:
    """A ```workflow fence as the editor's workflow block, or the fence as it was when it isn't a workflow."""
    try:
        value = json.loads(html.unescape(match.group(1)))
        graph = workflow_graph(value["steps"], value.get("connections"))
    except (ValueError, KeyError, TypeError):
        return match.group(0)
    title = str(value.get("title") or "Workflow").strip()[:120] or "Workflow"
    return workflow_block_html(title, graph)


def _inline_image(workspace: Path, match: re.Match[str]) -> str:
    """A workspace image as a data URL, as the editor keeps an uploaded image; anything else as it was. A PNG, JPEG
    or WebP figure is WebP at quality 85, as the editor shrinks an upload (``imageDataUrl``), at most
    ``_INLINE_IMAGE_EDGE`` pixels on its longer side, so a page of figures fits a Document."""
    path = (workspace / html.unescape(match.group(1))).resolve()
    media_type = _FIGURE_TYPES.get(path.suffix.lower())
    if media_type is None or not path.is_relative_to(workspace) or not path.is_file():
        return match.group(0)
    data = path.read_bytes()
    if media_type in {"image/png", "image/jpeg", "image/webp"}:
        with Image.open(io.BytesIO(data)) as image:
            image.thumbnail((_INLINE_IMAGE_EDGE, _INLINE_IMAGE_EDGE))
            encoded = io.BytesIO()
            image.save(encoded, "WEBP", quality=85)
        data, media_type = encoded.getvalue(), "image/webp"
    return f'<img src="data:{media_type};base64,{base64.b64encode(data).decode()}"'


async def report_document(*, user_id: str, session_id: str) -> JsonDict | None:
    """report.md as the page editor stores it (``markdown_to_html``, as Ren's workspace tools save a page): its
    first heading as the title, its workflows as workflow blocks, its ```embeds fences left for the editor's Embed
    tabs, its figures inline. A spreadsheet's run gives grid.json as the editor's grid block."""
    run = await _load(user_id, session_id)
    if run is None:
        return None
    workspace = artifacts_dir(session_id).resolve()
    if run.meta.get("outcome") == "datagrid":
        sheet = workspace / "grid.json"
        grid = grid_from_json(sheet.read_text(encoding="utf-8")) if sheet.is_file() else None
        if grid is None:
            return None
        return {"title": grid["title"], "content": grid_block_html(grid), "document_id": run.meta.get("document_id")}
    report = workspace / "report.md"
    if not report.is_file():
        return None
    content = markdown_to_html(report.read_text(encoding="utf-8"))
    content = _WORKFLOW_BLOCK.sub(_workflow_block, content)
    content = _WORKSPACE_IMAGE.sub(lambda match: _inline_image(workspace, match), content)
    heading = _LEADING_HEADING.match(content)
    title = re.sub(r"<[^>]+>", "", html.unescape(heading.group(1))).strip() if heading else ""
    if title:
        content = content[heading.end():] if heading else content
    return {"title": title or run.meta["title"], "content": content, "document_id": run.meta.get("document_id")}


async def set_report_document(*, user_id: str, session_id: str, document_id: str) -> RunMeta | None:
    """Record the Document the report was saved as."""
    run = await _load(user_id, session_id)
    if run is None:
        return None
    run.meta["document_id"] = document_id
    await _save(run)
    return run.meta


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
