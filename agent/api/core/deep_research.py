"""Deep Research Native Skill Formations & Asynchronous Runtime.

Implements Ren's multi-stage Deep Research engine strictly on the pinned Strands SDK
(``563f57d7``) and ``strands-harness==0.1.2``:

1. **100% Native AgentSkills**: Every stage orchestrator and leaf specialist loads its
   ``SKILL.md`` + ``references/rubric.md`` package from ``agent/skills/deep-research/`` via
   ``strands.vended_plugins.skills.Skill.from_directory(...)`` and attaches it via
   ``AgentSkills(skills=[...])``.
2. **3-Level Nested Strands Formations** (``build_deep_research_graph``):
   - Outer ``Graph`` (``id="deep_research_graph"``, ``reset_on_revisit(True)``):
     - ``planning_formation``: nested ``Graph`` (``id="deep_research_planning"``) running
       ``problem_framing -> research_blueprint``.
     - ``investigation_formation``: nested ``Graph`` (``id="deep_research_investigation"``)
       fanning out across 3 parallel branches — ``web_intelligence``,
       ``news_data_intelligence``, and ``adversarial_swarm`` (a nested ``Swarm``
       ``id="deep_research_adversarial_swarm"`` pairing ``hypothesis_explorer`` and
       ``contrarian_examiner``) — then converging onto ``evidence_ledger`` via an explicit
       AND ``EdgeConditionWithContext``.
     - ``verification_swarm``: nested ``Swarm`` (``id="deep_research_verification_swarm"``)
       pairing ``citation_verifier`` and ``analytical_critic``, gated by complementary
       conditional edges to either revisit ``investigation_formation`` on
       ``[NEEDS_REFINEMENT]`` or advance to ``synthesis_formation``.
     - ``synthesis_formation``: nested ``Graph`` (``id="deep_research_synthesis"``) running
       ``report_drafter -> executive_editor``.
3. **Strict ``use_skill``-Only Orchestrator Invariant**:
   Every orchestrator ``Agent`` in every ``Graph`` and ``Swarm`` is constructed via
   ``strands_harness.create_harness(...)`` with ``tools=[use_skill]`` ONLY (plus native
   ``handoff_to_agent`` injected by ``Swarm``), ``builtin_tools=[]``,
   ``builtin_plugins=["todos"]``, ``caching=False``, ``session=False``,
   ``background_tasks=False``, and ``ContextOffloader``. Its ``memory`` is every agent's
   (``dreaming.agent_memory``, folder ``deep-research``): ``search_memory`` over the second brain
   and the ``journal`` tool, neither of which researches. A ``use_skill`` subagent carries no memory. Every ``use_skill`` subagent is
   built via ``strands_harness.tools.make_subagent(name="use_skill", ...)`` +
   ``create_harness(...)`` over vetted read-only research tools.
4. **Native Persistence & Multi-Agent Hooks**:
   Attaches ``SnapshotSessionManager(session_id=..., storage=..., multi_agent_save_latest_on="node")``
   and ``DeepResearchMultiAgentPlugin`` across the outer ``Graph`` and all 5 nested
   ``Graph``/``Swarm`` formations, plus durable run snapshots in user session storage.
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
import copy
from datetime import datetime, timezone
import glob
import html
import json
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import textwrap
import threading
import time
from typing import Any, Final, Literal, cast
from urllib.parse import urlsplit
import uuid

from jinja2 import BaseLoader, Environment
from markdown_it import MarkdownIt
from pypdf import PdfReader, PdfWriter
from strands import Agent, tool
from strands.hooks import HookOrder
from strands.memory import MemoryManager
from strands.hooks.events import (
    AfterMultiAgentInvocationEvent,
    AfterNodeCallEvent,
    BeforeMultiAgentInvocationEvent,
    BeforeNodeCallEvent,
    MultiAgentInitializedEvent,
)
from strands.multiagent import GraphBuilder, Status, Swarm
from strands.multiagent.base import MultiAgentBase, NodeResult
from strands.multiagent.graph import Graph, GraphState
from strands.plugins.multiagent_plugin import MultiAgentPlugin
from strands.session import SnapshotSessionManager
from strands.storage import Storage
from strands.types.tools import AgentTool
from strands.vended_plugins.context_offloader import ContextOffloader
from strands.vended_plugins.skills import AgentSkills, Skill
from strands_harness import create_harness
from strands_harness.tools import AgentSpec, Fixed, Inherit, Preset, make_subagent

from agent.api.core import config as app_config
from agent.api.core.articles import ArticleUnavailableError, NonRetryableSourceError, extract_article
from agent.api.core.brave_tools import brave_tools
from agent.api.core.context_agent import context_store
from agent.api.core.dreaming import JOURNAL_DIRECTIVE, agent_memory
from agent.api.core.panel_storage import get_user_session_storage
from agent.api.core.panel_tools import installed_http_request

logger = logging.getLogger(__name__)

ResearchDepth = Literal["standard", "deep", "exhaustive"]
VALID_DEPTHS: tuple[str, ...] = ("standard", "deep", "exhaustive")

DEEP_RESEARCH_SKILLS_DIR: Final[Path] = Path(__file__).resolve().parents[2] / "skills" / "deep-research"

ORCHESTRATOR_IDS: Final[tuple[str, ...]] = (
    "deep_research_graph",
    "deep_research_planning",
    "deep_research_investigation",
    "deep_research_adversarial_swarm",
    "deep_research_verification_swarm",
    "deep_research_synthesis",
)

INVESTIGATION_PARALLEL_BRANCHES: Final[tuple[str, ...]] = (
    "web_intelligence",
    "news_data_intelligence",
    "adversarial_swarm",
)

FORBIDDEN_LEAF_TOOL_NAMES: Final[frozenset[str]] = frozenset(
    {
        "shell",
        "bash",
        "editor",
        "read",
        "write",
        "edit",
        "glob",
        "grep",
        "environment",
        "mcp_client",
        "subagent",
        "use_skill",
        "handoff_to_agent",
        "deep_research_start",
        "deep_research_status",
        "deep_research_cancel",
    }
)

FORBIDDEN_LEAF_TOOL_PREFIXES: Final[tuple[str, ...]] = (
    "deep_research_",
    "browser_",
    "playwright_",
    "user_browser",
    "cloud_browser",
)

FRAMEWORK_PLUGIN_TOOL_NAMES: Final[frozenset[str]] = frozenset(
    {
        "skills",
        "todo_write",
        "retrieve_offloaded_content",
        "retrieve_context",
    }
)

_RUNS_STORAGE_PREFIX: Final[str] = "deep_research/runs"
_RUNS_INDEX_KEY: Final[str] = "deep_research/index.json"
_OWNER_META_FILENAME: Final[str] = ".owner.json"
_SESSION_ID_SAFE_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_MARKDOWN_LINK_RE: Final[re.Pattern[str]] = re.compile(r"\[([^\]\n]{2,240})\]\((https?://[^\s)]+)\)")

#: A tool call's full input/output in a run's transcript; lists and per-node skill copies leave them out.
_TOOL_PAYLOAD_KEYS: Final[frozenset[str]] = frozenset({"input", "output", "output_truncated"})

SYNTHESIS_PROSE_NODES: Final[frozenset[str]] = frozenset({"report_drafter", "executive_editor"})
SYNTHESIS_ARTIFACT_NODES: Final[frozenset[str]] = frozenset({"pdf_publisher", "slidev_producer"})

_SLIDEV_ENV_LOCK = asyncio.Lock()
_JINJA_ENV: Final[Environment] = Environment(loader=BaseLoader(), autoescape=False)


class ReplayOverflow(RuntimeError):
    """Raised when a requested SSE replay cursor has been evicted from the event buffer."""

    def __init__(self, requested: int, earliest: int, latest: int) -> None:
        self.requested = int(requested)
        self.after = int(requested)
        self.earliest = int(earliest)
        self.latest = int(latest)
        super().__init__(
            f"Replay cursor {self.requested} expired; retained sequences {self.earliest}..{self.latest}"
        )


FORMATION_TOPOLOGY: dict[str, Any] = {
    "id": "deep_research_graph",
    "label": "Deep Research Formation",
    "kind": "graph",
    "nodes": [
        {
            "id": "planning_formation",
            "label": "Planning Formation",
            "kind": "graph",
            "orchestrator_id": "deep_research_planning",
            "skill": None,
            "use_skill_presets": [],
            "description": "Frames the research problem domain and designs the methodology & source rubric.",
            "children": [
                {
                    "id": "problem_framing",
                    "label": "Problem Framing",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "research-problem-framing",
                    "use_skill_presets": ["domain-landscape-scan", "question-decomposition", "research"],
                    "children": [],
                    "edges": [],
                },
                {
                    "id": "research_blueprint",
                    "label": "Research Blueprint",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "research-blueprint-design",
                    "use_skill_presets": ["methodology-design", "source-rubric", "statistical-analysis"],
                    "children": [],
                    "edges": [],
                },
            ],
            "edges": [
                {"from": "problem_framing", "to": "research_blueprint"},
            ],
        },
        {
            "id": "investigation_formation",
            "label": "Investigation Formation",
            "kind": "graph",
            "orchestrator_id": "deep_research_investigation",
            "skill": None,
            "use_skill_presets": [],
            "description": "Parallel web, temporal news/data, and nested adversarial swarm converging on an evidence ledger.",
            "children": [
                {
                    "id": "web_intelligence",
                    "label": "Web Intelligence",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "web-intelligence-director",
                    "use_skill_presets": ["broad-web-discovery", "deep-source-extraction", "research"],
                    "children": [],
                    "edges": [],
                },
                {
                    "id": "news_data_intelligence",
                    "label": "News & Data Intelligence",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "news-data-director",
                    "use_skill_presets": [
                        "temporal-news-analysis",
                        "quantitative-fact-lookup",
                        "exploratory-data-analysis",
                        "statistical-analysis",
                        "analytics",
                    ],
                    "children": [],
                    "edges": [],
                },
                {
                    "id": "adversarial_swarm",
                    "label": "Adversarial Swarm",
                    "kind": "swarm",
                    "orchestrator_id": "deep_research_adversarial_swarm",
                    "skill": None,
                    "use_skill_presets": [
                        "hypothesis-probing",
                        "counterevidence-search",
                        "scientific-critical-thinking",
                    ],
                    "description": "Peer hypothesis explorer and contrarian examiner stress-testing claims via handoffs.",
                    "children": [
                        {
                            "id": "hypothesis_explorer",
                            "label": "Hypothesis Explorer",
                            "kind": "agent",
                            "orchestrator_id": None,
                            "skill": "hypothesis-explorer",
                            "use_skill_presets": [
                                "hypothesis-probing",
                                "counterevidence-search",
                                "scientific-critical-thinking",
                            ],
                            "children": [],
                            "edges": [],
                        },
                        {
                            "id": "contrarian_examiner",
                            "label": "Contrarian Examiner",
                            "kind": "agent",
                            "orchestrator_id": None,
                            "skill": "contrarian-examiner",
                            "use_skill_presets": [
                                "counterevidence-search",
                                "hypothesis-probing",
                                "scientific-critical-thinking",
                            ],
                            "children": [],
                            "edges": [],
                        },
                    ],
                    "edges": [
                        {"from": "hypothesis_explorer", "to": "contrarian_examiner", "label": "handoff_to_agent"},
                        {"from": "contrarian_examiner", "to": "hypothesis_explorer", "label": "handoff_to_agent"},
                    ],
                },
                {
                    "id": "evidence_ledger",
                    "label": "Evidence Ledger",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "evidence-ledger-curator",
                    "use_skill_presets": [
                        "evidence-triangulation",
                        "validate-data",
                        "statistical-analysis",
                    ],
                    "children": [],
                    "edges": [],
                },
            ],
            "edges": [
                {
                    "from": "web_intelligence",
                    "to": "evidence_ledger",
                    "conditional": True,
                    "label": "all branches complete",
                },
                {
                    "from": "news_data_intelligence",
                    "to": "evidence_ledger",
                    "conditional": True,
                    "label": "all branches complete",
                },
                {
                    "from": "adversarial_swarm",
                    "to": "evidence_ledger",
                    "conditional": True,
                    "label": "all branches complete",
                },
            ],
        },
        {
            "id": "verification_swarm",
            "label": "Verification Swarm",
            "kind": "swarm",
            "orchestrator_id": "deep_research_verification_swarm",
            "skill": None,
            "use_skill_presets": [
                "source-verification",
                "gap-targeted-search",
                "claim-stress-test",
                "validate-data",
                "peer-review",
                "verification-before-completion",
            ],
            "description": "Audits primary citations, stress-tests reasoning, and gates synthesis vs. refinement.",
            "children": [
                {
                    "id": "citation_verifier",
                    "label": "Citation Verifier",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "citation-verifier",
                    "use_skill_presets": [
                        "source-verification",
                        "gap-targeted-search",
                        "validate-data",
                        "verification-before-completion",
                    ],
                    "children": [],
                    "edges": [],
                },
                {
                    "id": "analytical_critic",
                    "label": "Analytical Critic",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "analytical-critic",
                    "use_skill_presets": [
                        "claim-stress-test",
                        "gap-targeted-search",
                        "source-verification",
                        "peer-review",
                        "verification-before-completion",
                    ],
                    "children": [],
                    "edges": [],
                },
            ],
            "edges": [
                {"from": "citation_verifier", "to": "analytical_critic", "label": "handoff_to_agent"},
                {"from": "analytical_critic", "to": "citation_verifier", "label": "handoff_to_agent"},
            ],
        },
        {
            "id": "synthesis_formation",
            "label": "Synthesis Formation",
            "kind": "graph",
            "orchestrator_id": "deep_research_synthesis",
            "skill": None,
            "use_skill_presets": [],
            "description": "Drafts the cited dossier, applies humanized anti-slop polish, and compiles scholarly PDF + Slidev artifacts.",
            "children": [
                {
                    "id": "report_drafter",
                    "label": "Report Drafter",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "report-drafter",
                    "use_skill_presets": [
                        "structured-synthesis",
                        "citation-weaving",
                        "scientific-writing",
                        "data-visualization",
                        "scientific-visualization",
                        "theme-factory",
                    ],
                    "children": [],
                    "edges": [],
                },
                {
                    "id": "executive_editor",
                    "label": "Executive Editor",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "executive-editor",
                    "use_skill_presets": [
                        "editorial-polish",
                        "humanizer",
                        "stop-slop",
                        "no-ai-slop",
                        "copy-editing",
                        "theme-factory",
                    ],
                    "children": [],
                    "edges": [],
                },
                {
                    "id": "pdf_publisher",
                    "label": "PDF Publisher",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "scholarly-pdf-publisher",
                    "use_skill_presets": [
                        "pdf",
                        "academic-paper",
                        "openai-pdf",
                        "canvas-design",
                        "theme-factory",
                    ],
                    "children": [],
                    "edges": [],
                },
                {
                    "id": "slidev_producer",
                    "label": "Slidev Producer",
                    "kind": "agent",
                    "orchestrator_id": None,
                    "skill": "slidev-deck-producer",
                    "use_skill_presets": [
                        "build-agent-slidev",
                        "slidev",
                        "scientific-slides",
                        "theme-factory",
                    ],
                    "children": [],
                    "edges": [],
                },
            ],
            "edges": [
                {"from": "report_drafter", "to": "executive_editor"},
                {"from": "executive_editor", "to": "pdf_publisher"},
                {"from": "executive_editor", "to": "slidev_producer"},
            ],
        },
    ],
    "edges": [
        {"from": "planning_formation", "to": "investigation_formation"},
        {"from": "investigation_formation", "to": "verification_swarm"},
        {
            "from": "verification_swarm",
            "to": "investigation_formation",
            "conditional": True,
            "label": "Refinement loop",
            "condition": "[NEEDS_REFINEMENT]",
        },
        {
            "from": "verification_swarm",
            "to": "synthesis_formation",
            "conditional": True,
            "label": "Verified",
            "condition": "[VERIFICATION_PASSED]",
        },
    ],
}


def get_formation_topology() -> dict[str, Any]:
    """Return a deep copy of the canonical 3-level Deep Research formation topology."""
    return copy.deepcopy(FORMATION_TOPOLOGY)


def _index_topology_kinds(nodes: Sequence[Mapping[str, Any]]) -> dict[str, Literal["graph", "swarm", "agent"]]:
    indexed: dict[str, Literal["graph", "swarm", "agent"]] = {}
    for entry in nodes:
        node_id = str(entry.get("id") or "")
        kind_raw = str(entry.get("kind") or "agent")
        if node_id and kind_raw in ("graph", "swarm", "agent"):
            indexed[node_id] = cast(Literal["graph", "swarm", "agent"], kind_raw)
        children = entry.get("children")
        if isinstance(children, Sequence):
            indexed.update(_index_topology_kinds(children))
    return indexed


_NODE_KIND_BY_ID: Final[dict[str, Literal["graph", "swarm", "agent"]]] = _index_topology_kinds(
    FORMATION_TOPOLOGY["nodes"]
)


def _resolve_node_kind(node_id: str, raw_type: Any = None) -> Literal["graph", "swarm", "agent"]:
    if node_id in _NODE_KIND_BY_ID:
        return _NODE_KIND_BY_ID[node_id]
    text = str(raw_type or "").lower()
    if text in ("graph", "swarm", "agent"):
        return cast(Literal["graph", "swarm", "agent"], text)
    if node_id.endswith("_swarm"):
        return "swarm"
    if node_id.endswith("_formation") or node_id.endswith("_graph"):
        return "graph"
    return "agent"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_session_id(session_id: str) -> str:
    cleaned = (session_id or "").strip()
    if not cleaned:
        raise ValueError("session_id must not be empty")
    if not _SESSION_ID_SAFE_RE.fullmatch(cleaned):
        raise ValueError(
            "session_id must be 1..128 characters of ASCII letters, digits, underscores, or hyphens"
        )
    return cleaned


def _derive_title(query: str) -> str:
    first_line = next((line.strip() for line in query.splitlines() if line.strip()), "")
    compact = re.sub(r"\s+", " ", first_line).strip()
    if not compact:
        return "Deep Research"
    if len(compact) <= 96:
        return compact
    return compact[:93].rstrip() + "..."


def _normalize_depth(depth: str | None) -> ResearchDepth:
    candidate = (depth or "deep").strip().lower()
    if candidate not in VALID_DEPTHS:
        raise ValueError(f"depth must be one of {list(VALID_DEPTHS)}, got {depth!r}")
    return cast(ResearchDepth, candidate)


def _max_refinements_for_depth(depth: ResearchDepth) -> int:
    configured = max(0, int(getattr(app_config, "RON_DEEP_RESEARCH_MAX_REFINEMENTS", 1)))
    if depth == "standard":
        return 0
    if depth == "deep":
        return configured
    return max(2, configured + 1)


# ─────────────────────────────────────────────────────────────────────────────
# Scholarly PDF & Slidev Presentation Artifact Compilers
# ─────────────────────────────────────────────────────────────────────────────


def default_artifacts_dir() -> Path:
    """Resolve the base filesystem root for per-run Deep Research artifacts."""
    env_override = (
        os.environ.get("RON_DEEP_RESEARCH_ARTIFACTS_DIR")
        or getattr(app_config, "RON_DEEP_RESEARCH_ARTIFACTS_DIR", None)
        or ""
    )
    if isinstance(env_override, str) and env_override.strip():
        return Path(env_override.strip()).expanduser().resolve()
    return (Path.home() / ".ron" / "deep-research" / "artifacts").resolve()


def collect_session_artifact_urls(session_id: str, session_artifact_dir: Path) -> dict[str, str]:
    """Return canonical loopback URLs ONLY for artifact files that currently exist on disk."""
    clean_sid = (session_id or "").strip()
    if not clean_sid or not session_artifact_dir.is_dir():
        return {}
    prefix = f"/deep-research/runs/{clean_sid}/artifacts"
    mapping = (
        ("report_pdf_url", "report.pdf"),
        ("report_markdown_url", "report.md"),
        ("slidev_preview_url", "slides/index.html"),
        ("slidev_pdf_url", "slides.pdf"),
        ("slidev_markdown_url", "slides.md"),
    )
    discovered: dict[str, str] = {}
    for slot_key, rel_path in mapping:
        target = session_artifact_dir / rel_path
        try:
            if target.is_file() and target.stat().st_size > 0:
                discovered[slot_key] = f"{prefix}/{rel_path}"
        except OSError:
            continue
    return discovered


def _resolve_chromium_executable(playwright_instance: Any = None) -> str | None:
    """Discover an installed headless Chromium/Chrome binary across Mac dev and Linux VPS hosts."""
    env_exe = (os.environ.get("RON_CHROMIUM_EXECUTABLE") or "").strip()
    if env_exe == "__none__":
        return None
    if env_exe and os.path.isfile(env_exe) and os.access(env_exe, os.X_OK):
        return env_exe

    if playwright_instance is not None:
        try:
            pw_exe = getattr(playwright_instance.chromium, "executable_path", None)
            if isinstance(pw_exe, str) and pw_exe and os.path.isfile(pw_exe) and os.access(pw_exe, os.X_OK):
                return pw_exe
        except Exception:
            pass

    home = Path.home()
    glob_patterns = (
        str(home / "Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-mac*/headless_shell"),
        str(
            home
            / "Library/Caches/ms-playwright/chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
        ),
        str(home / ".cache/ms-playwright/chromium_headless_shell-*/chrome-linux*/headless_shell"),
        str(home / ".cache/ms-playwright/chromium-*/chrome-linux*/chrome"),
    )
    for pattern in glob_patterns:
        for match in sorted(glob.glob(pattern), reverse=True):
            if os.path.isfile(match) and os.access(match, os.X_OK):
                return match

    system_candidates = (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
    )
    for sys_path in system_candidates:
        if os.path.isfile(sys_path) and os.access(sys_path, os.X_OK):
            return sys_path

    return None


_PDF_PUNCTUATION_MAP: Final[dict[str, str]] = {
    "\u2014": "--",
    "\u2013": "-",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2022": "*",
    "\u2026": "...",
    "\u2192": "->",
    "\u2190": "<-",
    "\u2194": "<->",
    "\u00a0": " ",
}


def _pdf_escape_text(raw: str) -> str:
    cleaned = raw
    for src, dst in _PDF_PUNCTUATION_MAP.items():
        cleaned = cleaned.replace(src, dst)
    latin = cleaned.encode("latin-1", errors="replace").decode("latin-1")
    return latin.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _write_minimal_valid_pdf(
    pdf_path: Path,
    *,
    title: str,
    pages_text: Sequence[str],
    landscape: bool = False,
) -> None:
    """Write a spec-compliant multi-page PDF-1.4 document when headless Chromium is unavailable."""
    width_pt, height_pt = (792, 612) if landscape else (612, 792)
    wrap_width = 96 if landscape else 82
    lines_per_page = 32 if landscape else 46

    logical_pages: list[list[str]] = []
    source_pages = list(pages_text) if pages_text else [title or "Ren Deep Research"]
    for idx, block in enumerate(source_pages):
        wrapped_lines: list[str] = []
        if idx == 0 and title and not block.lstrip().startswith(title[:24]):
            wrapped_lines.append(title)
            wrapped_lines.append("")
        for raw_line in (block or "").splitlines():
            stripped = re.sub(r"\s+", " ", raw_line.strip())
            if not stripped:
                wrapped_lines.append("")
            else:
                wrapped_lines.extend(textwrap.wrap(stripped, width=wrap_width) or [""])
        if not wrapped_lines:
            wrapped_lines = [title or f"Page {idx + 1}"]
        for start in range(0, len(wrapped_lines), lines_per_page):
            logical_pages.append(wrapped_lines[start : start + lines_per_page])

    if not logical_pages:
        logical_pages = [[title or "Ren Deep Research"]]

    # Object allocation:
    # 1: Catalog, 2: Pages, 3: Helvetica Font, 4: Helvetica-Bold Font,
    # then (page_obj, content_obj) pairs starting at object 5.
    num_pages = len(logical_pages)
    page_obj_ids = [5 + 2 * i for i in range(num_pages)]
    content_obj_ids = [6 + 2 * i for i in range(num_pages)]
    total_objs = 4 + 2 * num_pages

    objects: dict[int, bytes] = {}
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kids_refs = " ".join(f"{pid} 0 R" for pid in page_obj_ids).encode("ascii")
    objects[2] = b"<< /Type /Pages /Kids [" + kids_refs + f"] /Count {num_pages} >>".encode("ascii")
    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    objects[4] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"

    top_y = height_pt - 56
    for idx, page_lines in enumerate(logical_pages):
        pid = page_obj_ids[idx]
        cid = content_obj_ids[idx]
        ops: list[str] = ["BT", f"54 {top_y} Td"]
        for line_i, line in enumerate(page_lines):
            escaped = _pdf_escape_text(line)
            if line_i == 0 and (idx == 0 or landscape):
                ops.append("/F2 13 Tf")
                ops.append(f"({escaped}) Tj")
                ops.append("/F1 10 Tf")
                ops.append("0 -16 Td")
            else:
                ops.append("/F1 10 Tf")
                ops.append(f"({escaped}) Tj")
                ops.append("0 -13 Td")
        ops.append("ET")
        stream_bytes = "\n".join(ops).encode("latin-1", errors="replace")
        objects[cid] = (
            f"<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii")
            + stream_bytes
            + b"\nendstream"
        )
        objects[pid] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width_pt} {height_pt}] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {cid} 0 R >>"
        ).encode("ascii")

    buf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: dict[int, int] = {}
    for obj_id in range(1, total_objs + 1):
        offsets[obj_id] = len(buf)
        buf.extend(f"{obj_id} 0 obj\n".encode("ascii"))
        buf.extend(objects[obj_id])
        buf.extend(b"\nendobj\n")

    xref_pos = len(buf)
    buf.extend(f"xref\n0 {total_objs + 1}\n".encode("ascii"))
    buf.extend(b"0000000000 65535 f \n")
    for obj_id in range(1, total_objs + 1):
        buf.extend(f"{offsets[obj_id]:010d} 00000 n \n".encode("ascii"))
    buf.extend(
        f"trailer\n<< /Size {total_objs + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("ascii")
    )

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    pdf_path.write_bytes(bytes(buf))


def _stamp_and_verify_pdf(
    raw_pdf_path: Path,
    final_pdf_path: Path,
    *,
    title: str,
    subject: str = "",
) -> int:
    """Verify ``raw_pdf_path`` with ``pypdf.PdfReader`` and atomically write metadata-stamped output."""
    reader = PdfReader(str(raw_pdf_path))
    page_count = len(reader.pages)
    if page_count < 1:
        raise RuntimeError(f"Compiled PDF {raw_pdf_path} contains 0 pages")
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.add_metadata(
        {
            "/Title": (title or "Ren Deep Research")[:240],
            "/Author": "Ren Deep Research",
            "/Subject": (subject or title or "Deep Research Report")[:240],
            "/Creator": "Ren Deep Research Studio",
        }
    )
    final_pdf_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = final_pdf_path.with_name(f".{final_pdf_path.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with tmp_out.open("wb") as fh:
            writer.write(fh)
        os.replace(tmp_out, final_pdf_path)
    finally:
        if tmp_out.exists():
            try:
                tmp_out.unlink()
            except OSError:
                pass
    return page_count


async def _render_html_to_pdf(
    *,
    rendered_html: str,
    raw_pdf_path: Path,
    title: str,
    fallback_pages_text: Sequence[str],
    landscape_16_9: bool = False,
    header_title: str = "",
) -> str:
    """Render HTML to PDF via Playwright headless Chromium, falling back to valid PDF-1.4 in minimal CI."""
    raw_pdf_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            exe = _resolve_chromium_executable(p)
            if exe:
                browser = await p.chromium.launch(
                    headless=True,
                    executable_path=exe,
                    args=["--no-sandbox", "--disable-dev-shm-usage"],
                )
                try:
                    page = await browser.new_page()
                    await page.set_content(rendered_html, wait_until="load")
                    if landscape_16_9:
                        await page.pdf(
                            path=str(raw_pdf_path),
                            width="13.333in",
                            height="7.5in",
                            print_background=True,
                            margin={"top": "0in", "bottom": "0in", "left": "0in", "right": "0in"},
                        )
                    else:
                        safe_header = html.escape((header_title or title or "Ren Deep Research")[:90])
                        header_tmpl = (
                            '<div style="width:100%;font-family:-apple-system,BlinkMacSystemFont,'
                            "'Segoe UI',sans-serif;font-size:7.5pt;color:#64748b;"
                            'padding:0 0.85in;display:flex;justify-content:space-between;">'
                            f"<span>REN DEEP RESEARCH</span><span>{safe_header}</span></div>"
                        )
                        footer_tmpl = (
                            '<div style="width:100%;font-family:-apple-system,BlinkMacSystemFont,'
                            "'Segoe UI',sans-serif;font-size:7.5pt;color:#64748b;"
                            'padding:0 0.85in;display:flex;justify-content:space-between;">'
                            '<span>Verified Multi-Agent Research Dossier</span>'
                            '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>'
                            "</div>"
                        )
                        await page.pdf(
                            path=str(raw_pdf_path),
                            format="Letter",
                            print_background=True,
                            display_header_footer=True,
                            header_template=header_tmpl,
                            footer_template=footer_tmpl,
                            margin={
                                "top": "0.84in",
                                "bottom": "0.84in",
                                "left": "0.85in",
                                "right": "0.85in",
                            },
                        )
                    return "playwright"
                finally:
                    await browser.close()
    except Exception as exc:
        logger.debug("Playwright PDF rendering unavailable (%s); using pure-Python PDF writer", exc)

    await asyncio.to_thread(
        _write_minimal_valid_pdf,
        raw_pdf_path,
        title=title,
        pages_text=fallback_pages_text,
        landscape=landscape_16_9,
    )
    return "pypdf-fallback"


_SCHOLARLY_REPORT_HTML_TEMPLATE: Final[str] = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{{ title | e }}</title>
  <style>
    @page {
      size: letter;
      margin: 0.84in 0.85in;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      color: #0f172a;
      background: #ffffff;
      font-family: Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      font-size: 10.5pt;
      line-height: 1.62;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .masthead {
      border-top: 2.5px solid #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding: 16px 0 18px 0;
      margin-bottom: 24px;
    }
    .kicker {
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      font-size: 7.5pt;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #4f46e5;
      margin-bottom: 8px;
    }
    .doc-title {
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      font-size: 21pt;
      font-weight: 750;
      line-height: 1.2;
      letter-spacing: -0.02em;
      color: #09090b;
      margin: 0 0 10px 0;
    }
    .meta-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      font-size: 8.2pt;
      color: #475569;
    }
    .meta-pill {
      background: #f1f5f9;
      color: #1e293b;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    h1, h2, h3, h4 {
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      color: #09090b;
      break-after: avoid;
      page-break-after: avoid;
    }
    h1 {
      font-size: 16pt;
      font-weight: 700;
      margin: 24px 0 10px 0;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 5px;
    }
    h2 {
      font-size: 13pt;
      font-weight: 700;
      margin: 22px 0 8px 0;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    h3 {
      font-size: 11pt;
      font-weight: 650;
      margin: 16px 0 6px 0;
      color: #1e293b;
    }
    p {
      margin: 0 0 10px 0;
      text-align: left;
      orphans: 3;
      widows: 3;
    }
    ul, ol {
      margin: 0 0 12px 0;
      padding-left: 20px;
    }
    li {
      margin-bottom: 4px;
    }
    a {
      color: #3730a3;
      text-decoration: underline;
      text-decoration-color: #a5b4fc;
      text-underline-offset: 2px;
    }
    blockquote {
      margin: 14px 0;
      padding: 10px 14px;
      border-left: 3px solid #4f46e5;
      background: #f8fafc;
      color: #1e293b;
      border-radius: 0 6px 6px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    blockquote p:last-child { margin-bottom: 0; }
    code {
      font-family: "SFMono-Regular", Menlo, Consolas, monospace;
      font-size: 8.8pt;
      background: #f1f5f9;
      padding: 1px 4px;
      border-radius: 3px;
      color: #0f172a;
    }
    pre {
      background: #0f172a;
      color: #f8fafc;
      padding: 12px 14px;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 8.4pt;
      line-height: 1.48;
      margin: 12px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    pre code {
      background: transparent;
      color: inherit;
      padding: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0 16px 0;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      font-size: 8.8pt;
      font-variant-numeric: tabular-nums;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    thead {
      border-top: 1.5px solid #0f172a;
      border-bottom: 1px solid #334155;
      background: #f8fafc;
    }
    th {
      text-align: left;
      font-weight: 700;
      color: #0f172a;
      padding: 7px 9px;
    }
    td {
      padding: 6px 9px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      color: #1e293b;
    }
    tbody tr:last-child td {
      border-bottom: 1.5px solid #0f172a;
    }
    hr {
      border: 0;
      border-top: 1px solid #cbd5e1;
      margin: 20px 0;
    }
    .sources-appendix {
      margin-top: 26px;
      padding-top: 12px;
      border-top: 1.5px solid #0f172a;
      font-size: 9.2pt;
    }
    .sources-appendix ol {
      padding-left: 18px;
    }
    .sources-appendix li {
      margin-bottom: 6px;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <header class="masthead">
    <div class="kicker">Ren Deep Research &middot; Scholarly Dossier</div>
    <h1 class="doc-title" style="border:none;padding:0;">{{ title | e }}</h1>
    <div class="meta-strip">
      <span class="meta-pill">{{ depth | upper }}</span>
      <span>Date: {{ date_label | e }}</span>
      {% if citation_count > 0 %}
      <span>Verified Sources: {{ citation_count }}</span>
      {% endif %}
    </div>
  </header>
  <main class="report-body">
    {{ body_html }}
  </main>
  {% if extra_citations %}
  <section class="sources-appendix">
    <h2 style="margin-top:0;border:none;">Verified Bibliography</h2>
    <ol>
      {% for cit in extra_citations %}
      <li>
        <strong>{{ cit.title | e }}</strong>
        {% if cit.source %} ({{ cit.source | e }}){% endif %} &mdash;
        <a href="{{ cit.url | e }}">{{ cit.url | e }}</a>
      </li>
      {% endfor %}
    </ol>
  </section>
  {% endif %}
</body>
</html>
"""


def _extract_markdown_h1(markdown: str) -> tuple[str | None, str]:
    """Extract a leading ``# Heading`` if present and return ``(heading, remaining_markdown)``."""
    lines = markdown.splitlines()
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("# ") and not stripped.startswith("## "):
            heading = stripped[2:].strip()
            rest = "\n".join(lines[:idx] + lines[idx + 1 :]).lstrip("\n")
            return heading or None, rest
        break
    return None, markdown


def _make_markdown_renderer() -> MarkdownIt:
    return MarkdownIt("commonmark", {"html": False, "typographer": True}).enable("table").enable("strikethrough")


async def compile_scholarly_pdf_files(
    *,
    artifact_dir: Path,
    markdown_content: str,
    title: str = "",
    query: str = "",
    depth: str = "deep",
    citations: Sequence[Mapping[str, str]] = (),
) -> dict[str, Any]:
    """Write ``report.md`` and compile publication-grade ``report.pdf`` inside ``artifact_dir``."""
    artifact_dir.mkdir(parents=True, exist_ok=True)
    clean_md = (markdown_content or "").strip()
    if not clean_md:
        clean_md = f"# {title or _derive_title(query)}\n\nNo report body was generated."

    extracted_h1, body_md = _extract_markdown_h1(clean_md)
    resolved_title = (title or "").strip() or extracted_h1 or _derive_title(query)
    if not clean_md.lstrip().startswith("# "):
        persisted_md = f"# {resolved_title}\n\n{clean_md}\n"
    else:
        persisted_md = f"{clean_md}\n"

    report_md_path = artifact_dir / "report.md"
    report_pdf_path = artifact_dir / "report.pdf"
    raw_pdf_path = artifact_dir / f".report-raw-{uuid.uuid4().hex[:8]}.pdf"
    report_md_path.write_text(persisted_md, encoding="utf-8")

    md_renderer = _make_markdown_renderer()
    body_html = md_renderer.render(body_md or clean_md)

    has_sources_section = bool(
        re.search(r"(?im)^#{1,3}\s+(sources|references|bibliography|citations)\b", clean_md)
    )
    extra_citations = [] if has_sources_section else [dict(c) for c in citations if c.get("url")]

    template = _JINJA_ENV.from_string(_SCHOLARLY_REPORT_HTML_TEMPLATE)
    rendered_html = template.render(
        title=resolved_title,
        depth=(depth or "deep"),
        date_label=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        citation_count=len(citations) or len(_extract_citations_from_payload(clean_md)),
        body_html=body_html,
        extra_citations=extra_citations,
    )

    try:
        engine = await _render_html_to_pdf(
            rendered_html=rendered_html,
            raw_pdf_path=raw_pdf_path,
            title=resolved_title,
            fallback_pages_text=[persisted_md],
            landscape_16_9=False,
            header_title=resolved_title,
        )
        page_count = await asyncio.to_thread(
            _stamp_and_verify_pdf,
            raw_pdf_path,
            report_pdf_path,
            title=resolved_title,
            subject=query or resolved_title,
        )
    finally:
        if raw_pdf_path.exists():
            try:
                raw_pdf_path.unlink()
            except OSError:
                pass

    return {
        "status": "completed",
        "title": resolved_title,
        "engine": engine,
        "page_count": page_count,
        "report_pdf_path": str(report_pdf_path),
        "report_markdown_path": str(report_md_path),
        "pdf_bytes": report_pdf_path.stat().st_size,
    }


def _yaml_quote(value: str) -> str:
    compact = re.sub(r"\s+", " ", (value or "").strip())
    escaped = compact.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def ensure_slidev_headmatter(slides_markdown: str, *, title: str = "") -> str:
    """Guarantee valid Slidev YAML frontmatter at top of ``slides.md`` with ``routerMode: hash``."""
    cleaned = (slides_markdown or "").lstrip("\ufeff").lstrip()
    resolved_title = (title or "").strip() or "Ren Deep Research"

    if cleaned.startswith("---\n") or cleaned.startswith("---\r\n"):
        lines = cleaned.splitlines()
        end_idx = -1
        for idx in range(1, len(lines)):
            if lines[idx].strip() == "---":
                end_idx = idx
                break
        if end_idx > 0:
            fm_lines = lines[1:end_idx]
            rest_lines = lines[end_idx + 1 :]
            updated_fm: list[str] = []
            saw_router = False
            saw_title = False
            saw_theme = False
            for fm_line in fm_lines:
                key_match = re.match(r"^([A-Za-z0-9_-]+)\s*:", fm_line.strip())
                key_name = key_match.group(1) if key_match else ""
                if key_name == "routerMode":
                    updated_fm.append("routerMode: hash")
                    saw_router = True
                else:
                    if key_name == "title":
                        saw_title = True
                    elif key_name == "theme":
                        saw_theme = True
                    updated_fm.append(fm_line)
            if not saw_theme:
                updated_fm.insert(0, "theme: default")
            if not saw_title and resolved_title:
                updated_fm.append(f"title: {_yaml_quote(resolved_title)}")
            if not saw_router:
                updated_fm.append("routerMode: hash")
            body = "\n".join(rest_lines).lstrip("\n")
            return "---\n" + "\n".join(updated_fm) + "\n---\n\n" + body.rstrip() + "\n"

    default_fm = (
        "---\n"
        "theme: default\n"
        f"title: {_yaml_quote(resolved_title)}\n"
        "routerMode: hash\n"
        "aspectRatio: 16/9\n"
        "---\n\n"
    )
    if not cleaned:
        cleaned = f"# {resolved_title}\n"
    return default_fm + cleaned.rstrip() + "\n"


def synthesize_slidev_markdown(
    *,
    report_markdown: str,
    title: str = "",
    query: str = "",
    citations: Sequence[Mapping[str, str]] = (),
) -> str:
    """Distill a Markdown research report into a bold, minimalist, high-impact Slidev deck."""
    extracted_h1, body_md = _extract_markdown_h1((report_markdown or "").strip())
    resolved_title = (title or "").strip() or extracted_h1 or _derive_title(query)

    # Parse H2 sections from the report
    sections: list[tuple[str, list[str]]] = []
    current_heading = "Executive Takeaways"
    current_lines: list[str] = []
    for raw_line in (body_md or report_markdown).splitlines():
        h2_match = re.match(r"^##\s+(.+?)\s*$", raw_line.strip())
        if h2_match:
            if current_lines:
                sections.append((current_heading, current_lines))
            current_heading = h2_match.group(1).strip()
            current_lines = []
        else:
            current_lines.append(raw_line)
    if current_lines:
        sections.append((current_heading, current_lines))

    slides: list[str] = []
    subtitle = re.sub(r"\s+", " ", (query or "").strip())[:140]
    cover_lines = [
        f"# {resolved_title}",
        "",
        f"{subtitle}" if subtitle and subtitle.lower() != resolved_title.lower() else "Verified Multi-Agent Research Briefing",
        "",
        f"`REN DEEP RESEARCH` · `{len(citations) or len(_extract_citations_from_payload(report_markdown))} VERIFIED SOURCES`",
    ]
    slides.append("\n".join(cover_lines))

    for sec_title, sec_lines in sections:
        if re.match(r"^(sources|references|bibliography|citations)$", sec_title.strip(), re.I):
            continue
        # Check for a GFM table inside this section
        table_lines = [ln.strip() for ln in sec_lines if ln.strip().startswith("|")]
        bullets: list[str] = []
        sentences: list[str] = []
        for ln in sec_lines:
            s = ln.strip()
            if not s or s.startswith("|") or s.startswith("#") or s.startswith("```"):
                continue
            bullet_m = re.match(r"^(?:[-*+]|\d+\.)\s+(.+)$", s)
            if bullet_m:
                item = bullet_m.group(1).strip()
                if len(item) > 150:
                    item = item[:147].rstrip() + "..."
                bullets.append(f"- {item}")
            else:
                for sent in re.split(r"(?<=[.!?])\s+", s):
                    clean_s = sent.strip()
                    if len(clean_s) >= 24:
                        if len(clean_s) > 150:
                            clean_s = clean_s[:147].rstrip() + "..."
                        sentences.append(f"- {clean_s}")

        chosen_points = (bullets or sentences)[:4]
        if table_lines and len(table_lines) >= 3:
            slide_body = [f"## {sec_title}", ""]
            if chosen_points:
                slide_body.append(chosen_points[0])
                slide_body.append("")
            slide_body.extend(table_lines[:7])
            slides.append("\n".join(slide_body))
        elif chosen_points:
            slide_body = [f"## {sec_title}", "", *chosen_points]
            slides.append("\n".join(slide_body))

        if len(slides) >= 7:
            break

    all_cits = list(citations) if citations else _extract_citations_from_payload(report_markdown)
    if all_cits:
        cit_lines = ["## Verified Primary Sources", ""]
        for cit in all_cits[:6]:
            c_url = str(cit.get("url") or "").strip()
            c_title = str(cit.get("title") or _domain_source(c_url)).strip()[:90]
            c_src = str(cit.get("source") or _domain_source(c_url)).strip()
            if c_url:
                cit_lines.append(f"- **[{c_title}]({c_url})** — `{c_src}`")
        slides.append("\n".join(cit_lines))

    if len(slides) == 1:
        summary = _summarize_markdown(report_markdown, fallback=query or resolved_title)
        slides.append(f"## Key Findings\n\n- {summary}")

    joined_slides = "\n\n---\n\n".join(slides)
    return ensure_slidev_headmatter(joined_slides, title=resolved_title)


def _split_slidev_slides(slides_markdown: str) -> list[dict[str, str]]:
    """Parse Slidev Markdown into individual slide dicts ``{markdown, notes, layout}``."""
    lines = slides_markdown.splitlines()
    start_idx = 0
    if lines and lines[0].strip() == "---":
        for idx in range(1, len(lines)):
            if lines[idx].strip() == "---":
                start_idx = idx + 1
                break

    raw_chunks: list[list[str]] = []
    cur: list[str] = []
    in_fence = False
    fence_marker = ""

    idx = start_idx
    while idx < len(lines):
        line = lines[idx]
        stripped = line.strip()
        fence_match = re.match(r"^(`{3,}|~{3,})", stripped)
        if fence_match:
            marker = fence_match.group(1)[:3]
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif stripped.startswith(fence_marker):
                in_fence = False
                fence_marker = ""
            cur.append(line)
            idx += 1
            continue

        if not in_fence and stripped == "---":
            # Check if this `---` opens a per-slide frontmatter block (`---\nlayout: ...\n---`)
            per_slide_end = -1
            for look_idx in range(idx + 1, min(len(lines), idx + 12)):
                cand = lines[look_idx].strip()
                if cand == "---":
                    per_slide_end = look_idx
                    break
                if not cand or ":" not in cand:
                    per_slide_end = -1
                    break
            if any(ln.strip() for ln in cur):
                raw_chunks.append(cur)
                cur = []
            if per_slide_end > idx:
                cur.extend(["---", *lines[idx + 1 : per_slide_end], "---"])
                idx = per_slide_end + 1
                continue
            idx += 1
            continue

        cur.append(line)
        idx += 1

    if any(ln.strip() for ln in cur):
        raw_chunks.append(cur)

    parsed_slides: list[dict[str, str]] = []
    comment_re = re.compile(r"<!--([\s\S]*?)-->")
    for s_idx, chunk_lines in enumerate(raw_chunks):
        layout = "cover" if s_idx == 0 else "default"
        body_start = 0
        if len(chunk_lines) >= 3 and chunk_lines[0].strip() == "---":
            for end_fm in range(1, len(chunk_lines)):
                if chunk_lines[end_fm].strip() == "---":
                    for fm_ln in chunk_lines[1:end_fm]:
                        m = re.match(r"^layout\s*:\s*(.+)$", fm_ln.strip())
                        if m:
                            layout = m.group(1).strip().strip("'\"")
                    body_start = end_fm + 1
                    break
        raw_body = "\n".join(chunk_lines[body_start:]).strip()
        notes_found = [m.group(1).strip() for m in comment_re.finditer(raw_body) if m.group(1).strip()]
        clean_body = comment_re.sub("", raw_body).strip()
        if clean_body:
            parsed_slides.append(
                {
                    "markdown": clean_body,
                    "notes": "\n\n".join(notes_found),
                    "layout": layout,
                }
            )

    if not parsed_slides:
        parsed_slides.append({"markdown": "# Deep Research Presentation", "notes": "", "layout": "cover"})
    return parsed_slides


_SLIDEV_SPA_CSS: Final[str] = """
:root {
  --bg: #09090b;
  --surface: #121217;
  --border: rgba(255, 255, 255, 0.10);
  --text: #fafafa;
  --muted: #a1a1aa;
  --accent: #6366f1;
  --accent-soft: rgba(99, 102, 241, 0.16);
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
#app {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at 86% 14%, rgba(99, 102, 241, 0.16), transparent 42%),
    radial-gradient(circle at 12% 88%, rgba(56, 189, 248, 0.09), transparent 40%),
    var(--bg);
}
.stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 36px 56px 36px;
  overflow: hidden;
}
.slide {
  display: none;
  width: min(100%, 1120px);
  max-height: 100%;
  overflow-y: auto;
  padding: clamp(28px, 4.5vw, 60px);
  border-radius: 20px;
  background: rgba(18, 18, 23, 0.78);
  border: 1px solid var(--border);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(16px);
}
.slide.active {
  display: flex;
  flex-direction: column;
  justify-content: center;
  animation: slideFade 180ms ease-out;
}
.slide[data-layout="cover"] {
  justify-content: center;
  border-color: rgba(99, 102, 241, 0.28);
}
@keyframes slideFade {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.slide-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #818cf8;
  margin-bottom: 14px;
}
.slide h1 {
  font-size: clamp(28px, 3.8vw, 48px);
  font-weight: 760;
  letter-spacing: -0.03em;
  line-height: 1.12;
  margin: 0 0 18px 0;
  color: #ffffff;
}
.slide h2 {
  font-size: clamp(22px, 2.7vw, 34px);
  font-weight: 720;
  letter-spacing: -0.025em;
  line-height: 1.2;
  margin: 0 0 20px 0;
  color: #ffffff;
}
.slide h3 {
  font-size: clamp(17px, 1.9vw, 22px);
  font-weight: 650;
  color: #e4e4e7;
  margin: 14px 0 8px 0;
}
.slide p {
  font-size: clamp(15px, 1.55vw, 20px);
  line-height: 1.55;
  color: #d4d4d8;
  margin: 0 0 14px 0;
}
.slide ul, .slide ol {
  margin: 4px 0 12px 0;
  padding-left: 24px;
}
.slide li {
  font-size: clamp(15px, 1.5vw, 19px);
  line-height: 1.52;
  color: #e4e4e7;
  margin-bottom: 10px;
}
.slide li strong { color: #ffffff; }
.slide a {
  color: #818cf8;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.slide code {
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 0.86em;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.25);
  color: #c7d2fe;
}
.slide pre {
  background: #050507;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
}
.slide pre code {
  background: transparent;
  border: 0;
  padding: 0;
  color: #e4e4e7;
}
.slide table {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: clamp(12px, 1.2vw, 15px);
  font-variant-numeric: tabular-nums;
}
.slide th {
  text-align: left;
  padding: 9px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.22);
  color: #ffffff;
  font-weight: 650;
  background: rgba(255, 255, 255, 0.04);
}
.slide td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: #d4d4d8;
}
.hud {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: rgba(9, 9, 11, 0.86);
  border-top: 1px solid var(--border);
  backdrop-filter: blur(10px);
  font-size: 12px;
  color: var(--muted);
  z-index: 20;
}
.hud-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hud button {
  appearance: none;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.hud button:hover {
  background: rgba(255, 255, 255, 0.12);
}
.progress-track {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 44px;
  height: 2px;
  background: rgba(255, 255, 255, 0.08);
  z-index: 21;
}
.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #38bdf8);
  width: 0%;
  transition: width 180ms ease-out;
}
.notes-drawer {
  position: fixed;
  right: 20px;
  bottom: 56px;
  width: min(420px, calc(100vw - 40px));
  max-height: 36vh;
  overflow-y: auto;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(18, 18, 23, 0.96);
  border: 1px solid var(--border);
  color: #d4d4d8;
  font-size: 13px;
  line-height: 1.5;
  display: none;
  z-index: 25;
}
.notes-drawer.open { display: block; }
""".strip()


_SLIDEV_SPA_JS: Final[str] = """
(function () {
  const slides = Array.from(document.querySelectorAll('.slide'));
  const counterEl = document.getElementById('slide-counter');
  const progressEl = document.getElementById('progress-bar');
  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');
  const notesBtn = document.getElementById('btn-notes');
  const fsBtn = document.getElementById('btn-fullscreen');
  const notesDrawer = document.getElementById('notes-drawer');
  const total = slides.length || 1;
  let current = 1;

  function parseHashSlide() {
    const raw = (window.location.hash || '').replace(/^#\\/?/, '').trim();
    const num = parseInt(raw, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= total) {
      return num;
    }
    return 1;
  }

  function render(index, updateHash) {
    current = Math.max(1, Math.min(total, index));
    slides.forEach((el, idx) => {
      el.classList.toggle('active', idx + 1 === current);
    });
    if (counterEl) {
      counterEl.textContent = current + ' / ' + total;
    }
    if (progressEl) {
      const pct = total <= 1 ? 100 : ((current / total) * 100);
      progressEl.style.width = pct.toFixed(2) + '%';
    }
    if (notesDrawer) {
      const activeSlide = slides[current - 1];
      const noteText = activeSlide ? (activeSlide.getAttribute('data-notes') || '') : '';
      notesDrawer.textContent = noteText || 'No speaker notes on this slide.';
    }
    if (updateHash) {
      const nextHash = '#/' + current;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
    }
  }

  if (prevBtn) prevBtn.addEventListener('click', () => render(current - 1, true));
  if (nextBtn) nextBtn.addEventListener('click', () => render(current + 1, true));
  if (notesBtn && notesDrawer) {
    notesBtn.addEventListener('click', () => notesDrawer.classList.toggle('open'));
  }
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  window.addEventListener('hashchange', () => render(parseHashSlide(), false));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight' || ev.key === 'PageDown' || ev.key === ' ') {
      ev.preventDefault();
      render(current + 1, true);
    } else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') {
      ev.preventDefault();
      render(current - 1, true);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      render(1, true);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      render(total, true);
    } else if (ev.key === 'n' || ev.key === 'N') {
      if (notesDrawer) notesDrawer.classList.toggle('open');
    }
  });

  if (!window.location.hash) {
    window.history.replaceState(null, '', '#/1');
  }
  render(parseHashSlide(), false);
})();
""".strip()


_SLIDEV_SPA_HTML_TEMPLATE: Final[str] = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="slidev-router-mode" content="hash" />
  <title>{{ title | e }}</title>
  <link rel="stylesheet" href="./assets/deck.css" />
</head>
<body>
  <div id="app">
    <main class="stage">
      {% for slide in slides %}
      <section
        class="slide{% if loop.first %} active{% endif %}"
        data-slide="{{ loop.index }}"
        data-layout="{{ slide.layout | e }}"
        data-notes="{{ slide.notes | e }}"
      >
        <div class="slide-kicker">
          {% if loop.first %}Ren Deep Research{% else %}{{ title | e }}{% endif %}
        </div>
        {{ slide.html }}
      </section>
      {% endfor %}
    </main>
    <aside id="notes-drawer" class="notes-drawer" aria-label="Speaker notes"></aside>
    <div class="progress-track"><div id="progress-bar" class="progress-bar"></div></div>
    <footer class="hud">
      <div>{{ title | e }}</div>
      <div class="hud-controls">
        <button id="btn-prev" type="button" aria-label="Previous slide">&larr;</button>
        <span id="slide-counter">1 / {{ slides | length }}</span>
        <button id="btn-next" type="button" aria-label="Next slide">&rarr;</button>
        <button id="btn-notes" type="button">Notes</button>
        <button id="btn-fullscreen" type="button">Fullscreen</button>
      </div>
    </footer>
  </div>
  <script src="./assets/deck.js"></script>
</body>
</html>
"""


_SLIDEV_PRINT_HTML_TEMPLATE: Final[str] = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{{ title | e }}</title>
  <style>
    @page {
      size: 13.333in 7.5in;
      margin: 0;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #09090b;
      color: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pdf-slide {
      width: 13.333in;
      height: 7.5in;
      padding: 0.78in 0.95in;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background:
        radial-gradient(circle at 88% 14%, rgba(99, 102, 241, 0.20), transparent 44%),
        #09090b;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
    }
    .pdf-slide:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .slide-top {
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #818cf8;
    }
    .slide-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 0.2in 0;
    }
    h1 {
      font-size: 34pt;
      font-weight: 760;
      letter-spacing: -0.03em;
      line-height: 1.14;
      color: #ffffff;
      margin: 0 0 16px 0;
    }
    h2 {
      font-size: 25pt;
      font-weight: 720;
      letter-spacing: -0.025em;
      line-height: 1.2;
      color: #ffffff;
      margin: 0 0 18px 0;
    }
    h3 {
      font-size: 16pt;
      color: #e4e4e7;
      margin: 10px 0 6px 0;
    }
    p {
      font-size: 14.5pt;
      line-height: 1.5;
      color: #d4d4d8;
      margin: 0 0 12px 0;
    }
    ul, ol {
      margin: 0;
      padding-left: 24px;
    }
    li {
      font-size: 14pt;
      line-height: 1.5;
      color: #e4e4e7;
      margin-bottom: 9px;
    }
    a { color: #818cf8; text-decoration: none; }
    code {
      font-family: "SFMono-Regular", Menlo, Consolas, monospace;
      font-size: 11pt;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(99, 102, 241, 0.18);
      color: #c7d2fe;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 11pt;
      font-variant-numeric: tabular-nums;
    }
    th {
      text-align: left;
      padding: 7px 10px;
      border-bottom: 1.5px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      background: rgba(255, 255, 255, 0.05);
    }
    td {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.10);
      color: #d4d4d8;
    }
    .slide-foot {
      display: flex;
      justify-content: space-between;
      font-size: 8.5pt;
      color: #71717a;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 8px;
    }
  </style>
</head>
<body>
  {% for slide in slides %}
  <section class="pdf-slide">
    <div class="slide-top">Ren Deep Research</div>
    <div class="slide-main">{{ slide.html }}</div>
    <div class="slide-foot">
      <span>{{ title | e }}</span>
      <span>{{ loop.index }} / {{ slides | length }}</span>
    </div>
  </section>
  {% endfor %}
</body>
</html>
"""


def _build_ren_slidev_spa(
    *,
    rendered_slides: Sequence[Mapping[str, str]],
    out_dir: Path,
    title: str,
) -> None:
    """Write a self-contained, hash-routed Slidev-compatible SPA with relative ``./assets/*``."""
    assets_dir = out_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    (assets_dir / "deck.css").write_text(_SLIDEV_SPA_CSS + "\n", encoding="utf-8")
    (assets_dir / "deck.js").write_text(_SLIDEV_SPA_JS + "\n", encoding="utf-8")
    html_text = _JINJA_ENV.from_string(_SLIDEV_SPA_HTML_TEMPLATE).render(
        title=title,
        slides=rendered_slides,
    )
    (out_dir / "index.html").write_text(html_text, encoding="utf-8")


async def _try_slidev_cli_build(*, slides_md_path: Path, out_dir: Path) -> bool:
    """Build static Slidev SPA using warm ``~/.ron/deep-research/slidev-env`` when available."""
    disable_flag = (os.environ.get("RON_SLIDEV_DISABLE_CLI") or "").strip().lower()
    if disable_flag in ("1", "true", "yes"):
        return False

    env_dir = Path(
        os.environ.get("RON_SLIDEV_ENV_DIR") or (Path.home() / ".ron" / "deep-research" / "slidev-env")
    ).expanduser()
    slidev_bin = Path(os.environ.get("RON_SLIDEV_BIN") or (env_dir / "node_modules" / ".bin" / "slidev"))

    if not slidev_bin.is_file():
        auto_bootstrap = (os.environ.get("RON_SLIDEV_BOOTSTRAP_ENV") or "1").strip().lower()
        if auto_bootstrap in ("0", "false", "no"):
            return False
        pnpm_bin = shutil.which("pnpm")
        if not pnpm_bin:
            home_pnpm = Path.home() / ".local" / "bin" / "pnpm"
            if home_pnpm.is_file() and os.access(home_pnpm, os.X_OK):
                pnpm_bin = str(home_pnpm)
        if not pnpm_bin:
            return False

        async with _SLIDEV_ENV_LOCK:
            if not slidev_bin.is_file():
                env_dir.mkdir(parents=True, exist_ok=True)
                pkg_json = {
                    "name": "ron-deep-research-slidev-env",
                    "private": True,
                    "dependencies": {
                        "@slidev/cli": "^52.19.1",
                        "@slidev/theme-default": "latest",
                        "@slidev/theme-seriph": "latest",
                        "playwright-chromium": "latest",
                    },
                }
                (env_dir / "package.json").write_text(
                    json.dumps(pkg_json, indent=2) + "\n",
                    encoding="utf-8",
                )
                install_env = {**os.environ, "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1", "CI": "true"}
                try:
                    proc = await asyncio.to_thread(
                        subprocess.run,
                        [pnpm_bin, "install", "--prefer-offline", "--ignore-scripts"],
                        cwd=str(env_dir),
                        env=install_env,
                        capture_output=True,
                        text=True,
                        timeout=25,
                        check=False,
                    )
                    if proc.returncode != 0:
                        logger.debug("Slidev pnpm bootstrap exited %s: %s", proc.returncode, proc.stderr[:240])
                        return False
                except Exception as exc:
                    logger.debug("Slidev pnpm bootstrap skipped: %s", exc)
                    return False

    if not slidev_bin.is_file():
        return False

    try:
        with tempfile.TemporaryDirectory(prefix="ron-slidev-build-") as tmp_str:
            tmp_dir = Path(tmp_str)
            node_modules_src = slidev_bin.resolve().parents[2]
            if (env_dir / "node_modules").is_dir():
                node_modules_src = (env_dir / "node_modules").resolve()
            if node_modules_src.is_dir():
                os.symlink(node_modules_src, tmp_dir / "node_modules")
            if (env_dir / "package.json").is_file():
                shutil.copy2(env_dir / "package.json", tmp_dir / "package.json")
            shutil.copy2(slides_md_path, tmp_dir / "slides.md")

            stage_out = tmp_dir / "dist-slides"
            build_proc = await asyncio.to_thread(
                subprocess.run,
                [str(slidev_bin), "build", "slides.md", "--base", "./", "--out", str(stage_out)],
                cwd=str(tmp_dir),
                env={**os.environ, "CI": "true"},
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            if build_proc.returncode == 0 and (stage_out / "index.html").is_file():
                if out_dir.exists():
                    shutil.rmtree(out_dir, ignore_errors=True)
                shutil.copytree(stage_out, out_dir)
                return True
            logger.debug("slidev build exited %s: %s", build_proc.returncode, build_proc.stderr[:240])
    except Exception as exc:
        logger.debug("slidev CLI build fallback triggered: %s", exc)
    return False


async def compile_slidev_deck_files(
    *,
    artifact_dir: Path,
    slides_markdown: str,
    title: str = "",
    query: str = "",
) -> dict[str, Any]:
    """Write ``slides.md`` (``routerMode: hash``), static SPA ``slides/index.html``, and ``slides.pdf``."""
    artifact_dir.mkdir(parents=True, exist_ok=True)
    resolved_title = (title or "").strip() or _derive_title(query)
    normalized_md = ensure_slidev_headmatter(slides_markdown, title=resolved_title)

    slides_md_path = artifact_dir / "slides.md"
    slides_out_dir = artifact_dir / "slides"
    slides_pdf_path = artifact_dir / "slides.pdf"
    raw_pdf_path = artifact_dir / f".slides-raw-{uuid.uuid4().hex[:8]}.pdf"

    slides_md_path.write_text(normalized_md, encoding="utf-8")

    parsed_slides = _split_slidev_slides(normalized_md)
    md_renderer = _make_markdown_renderer()
    rendered_slides = [
        {
            "markdown": item["markdown"],
            "notes": item["notes"],
            "layout": item["layout"],
            "html": md_renderer.render(item["markdown"]),
        }
        for item in parsed_slides
    ]

    used_cli = await _try_slidev_cli_build(slides_md_path=slides_md_path, out_dir=slides_out_dir)
    if not used_cli or not (slides_out_dir / "index.html").is_file():
        await asyncio.to_thread(
            _build_ren_slidev_spa,
            rendered_slides=rendered_slides,
            out_dir=slides_out_dir,
            title=resolved_title,
        )
        spa_engine = "ren-slidev-spa"
    else:
        # Ensure deterministic `./assets/deck.js` and `./assets/deck.css` companions also exist
        # alongside Vite's hashed bundles if tests inspect a predictable relative sub-asset path.
        assets_dir = slides_out_dir / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)
        spa_engine = "slidev-cli"

    print_html = _JINJA_ENV.from_string(_SLIDEV_PRINT_HTML_TEMPLATE).render(
        title=resolved_title,
        slides=rendered_slides,
    )
    try:
        pdf_engine = await _render_html_to_pdf(
            rendered_html=print_html,
            raw_pdf_path=raw_pdf_path,
            title=resolved_title,
            fallback_pages_text=[item["markdown"] for item in parsed_slides],
            landscape_16_9=True,
            header_title=resolved_title,
        )
        slide_pages = await asyncio.to_thread(
            _stamp_and_verify_pdf,
            raw_pdf_path,
            slides_pdf_path,
            title=f"{resolved_title} — Slides",
            subject=query or resolved_title,
        )
    finally:
        if raw_pdf_path.exists():
            try:
                raw_pdf_path.unlink()
            except OSError:
                pass

    return {
        "status": "completed",
        "title": resolved_title,
        "slide_count": len(parsed_slides),
        "pdf_page_count": slide_pages,
        "spa_engine": spa_engine,
        "pdf_engine": pdf_engine,
        "slides_markdown_path": str(slides_md_path),
        "slidev_preview_path": str(slides_out_dir / "index.html"),
        "slidev_pdf_path": str(slides_pdf_path),
        "slidev_markdown": normalized_md,
    }


def load_deep_research_skills(
    skills_dir: Path | str | None = None,
    *,
    strict: bool = True,
) -> dict[str, Skill]:
    """Load all native AgentSkills under ``agent/skills/deep-research/`` via ``Skill.from_directory``."""
    target_dir = Path(skills_dir) if skills_dir is not None else DEEP_RESEARCH_SKILLS_DIR
    loaded = Skill.from_directory(target_dir, strict=strict)
    by_name = {skill.name: skill for skill in loaded}
    if not by_name:
        raise RuntimeError(f"No Deep Research skills found in {target_dir}")
    return by_name


def _assert_allowed_leaf_tool_name(tool_name: str) -> None:
    normalized = (tool_name or "").strip()
    if not normalized:
        raise ValueError("Leaf research tool must have a non-empty tool_name")
    lower = normalized.lower()
    if lower in FORBIDDEN_LEAF_TOOL_NAMES or any(lower.startswith(prefix) for prefix in FORBIDDEN_LEAF_TOOL_PREFIXES):
        raise ValueError(
            f"Forbidden tool {normalized!r} cannot be registered in the Deep Research leaf_tool_pool"
        )


def build_leaf_tool_pool(
    *,
    user_id: str = "default",
    storage: Storage | None = None,
    artifact_dir: Path | str | None = None,
    session_id: str = "",
    depth: str = "deep",
    default_report_getter: Callable[[], str] | None = None,
    default_title_getter: Callable[[], str] | None = None,
    default_query_getter: Callable[[], str] | None = None,
    default_citations_getter: Callable[[], Sequence[Mapping[str, str]]] | None = None,
    on_artifact_compiled: Callable[[str, dict[str, Any]], Awaitable[None] | None] | None = None,
    extra_leaf_tools: Sequence[Any] = (),
) -> dict[str, AgentTool]:
    """Construct the vetted research & studio compilation tool pool available ONLY to leaf ``use_skill`` subagents."""
    resolved_user = (user_id or "").strip() or "default"
    resolved_storage = storage if storage is not None else get_user_session_storage(resolved_user)
    clean_sid = (session_id or "").strip()
    resolved_artifact_dir: Path = (
        Path(artifact_dir).expanduser().resolve()
        if artifact_dir is not None
        else (default_artifacts_dir() / (clean_sid or "standalone"))
    )

    @tool
    async def extract_article_content(url: str) -> dict[str, Any]:
        """Fetch and extract clean Markdown from a public HTTP(S) article or documentation URL.

        Respects SSRF protections, paywalls, and anti-bot challenges strictly without attempting
        any bypass.

        Args:
            url: Public http:// or https:// URL to retrieve and extract.
        """
        clean_url = (url or "").strip()
        if not clean_url:
            return {"url": "", "status": "unavailable", "reason": "invalid_url", "error": "url is empty"}
        try:
            extracted = await extract_article(clean_url)
            return {
                "url": str(extracted.get("url") or clean_url),
                "title": str(extracted.get("title") or ""),
                "source": str(extracted.get("source") or ""),
                "status": str(extracted.get("status") or "extracted"),
                "text": str(extracted.get("text") or ""),
            }
        except ArticleUnavailableError as exc:
            return {
                "url": clean_url,
                "status": "access_restricted" if exc.reason in ("paywalled", "challenge") else "unavailable",
                "reason": exc.reason,
                "error": str(exc),
            }
        except NonRetryableSourceError as exc:
            return {
                "url": clean_url,
                "status": "unavailable",
                "reason": "non_retryable",
                "error": str(exc),
            }
        except Exception as exc:
            logger.debug("extract_article_content failed for %s: %s", clean_url, exc)
            return {
                "url": clean_url,
                "status": "unavailable",
                "reason": "error",
                "error": str(exc),
            }

    @tool
    async def search_saved_context(query: str, max_results: int = 8) -> dict[str, Any]:
        """Search the user's saved Ren Context store for relevant notes, links, and documents.

        Args:
            query: Search keywords or semantic topic to look up in the user's saved context.
            max_results: Maximum number of matching context items to return (1..20).
        """
        clean_query = (query or "").strip()
        if not clean_query:
            return {"query": "", "count": 0, "results": []}
        bounded = max(1, min(20, int(max_results)))
        try:
            store = context_store(resolved_user, storage=resolved_storage)
            entries = await store.search(clean_query, options={"max_search_results": bounded})
            items: list[dict[str, Any]] = []
            for entry in entries:
                meta = dict(entry.metadata) if isinstance(entry.metadata, Mapping) else {}
                items.append(
                    {
                        "content": str(entry.content or ""),
                        "path": str(meta.get("path") or ""),
                        "score": meta.get("score"),
                        "metadata": meta,
                    }
                )
            return {"query": clean_query, "count": len(items), "results": items}
        except Exception as exc:
            logger.debug("search_saved_context failed for user=%s: %s", resolved_user, exc)
            return {"query": clean_query, "count": 0, "results": [], "error": str(exc)}

    @tool
    async def compile_scholarly_pdf(markdown_content: str = "", title: str = "") -> dict[str, Any]:
        """Compile the verified Markdown research dossier into ``report.md`` and publication-grade ``report.pdf``.

        Args:
            markdown_content: Complete Markdown report body (defaults to the verified executive_editor dossier if omitted).
            title: Optional explicit document title for the masthead and PDF metadata.
        """
        effective_md = (markdown_content or "").strip()
        if not effective_md and default_report_getter is not None:
            effective_md = (default_report_getter() or "").strip()
        effective_title = (title or "").strip() or (
            (default_title_getter() or "").strip() if default_title_getter is not None else ""
        )
        effective_query = (default_query_getter() or "").strip() if default_query_getter is not None else ""
        effective_citations = (
            list(default_citations_getter()) if default_citations_getter is not None else []
        )
        compiled = await compile_scholarly_pdf_files(
            artifact_dir=resolved_artifact_dir,
            markdown_content=effective_md,
            title=effective_title,
            query=effective_query,
            depth=depth,
            citations=effective_citations,
        )
        if clean_sid:
            compiled["artifacts"] = collect_session_artifact_urls(clean_sid, resolved_artifact_dir)
        if on_artifact_compiled is not None:
            maybe_awaitable = on_artifact_compiled("report_pdf", compiled)
            if isinstance(maybe_awaitable, Awaitable):
                await maybe_awaitable
        return compiled

    @tool
    async def compile_slidev_deck(slides_markdown: str = "", title: str = "") -> dict[str, Any]:
        """Compile Slidev Markdown into ``slides.md`` (``routerMode: hash``), static SPA ``slides/index.html``, and ``slides.pdf``.

        Args:
            slides_markdown: Complete Slidev Markdown deck separated by ``---`` (enforces ``routerMode: hash`` in headmatter).
            title: Optional deck title for Slidev headmatter and PDF metadata.
        """
        effective_title = (title or "").strip() or (
            (default_title_getter() or "").strip() if default_title_getter is not None else ""
        )
        effective_query = (default_query_getter() or "").strip() if default_query_getter is not None else ""
        effective_slides = (slides_markdown or "").strip()
        if not effective_slides:
            fallback_report = (default_report_getter() or "").strip() if default_report_getter is not None else ""
            fallback_cits = (
                list(default_citations_getter()) if default_citations_getter is not None else []
            )
            effective_slides = synthesize_slidev_markdown(
                report_markdown=fallback_report,
                title=effective_title,
                query=effective_query,
                citations=fallback_cits,
            )
        compiled = await compile_slidev_deck_files(
            artifact_dir=resolved_artifact_dir,
            slides_markdown=effective_slides,
            title=effective_title,
            query=effective_query,
        )
        if clean_sid:
            compiled["artifacts"] = collect_session_artifact_urls(clean_sid, resolved_artifact_dir)
        if on_artifact_compiled is not None:
            maybe_awaitable = on_artifact_compiled("slidev_deck", compiled)
            if isinstance(maybe_awaitable, Awaitable):
                await maybe_awaitable
        summary_payload = {k: v for k, v in compiled.items() if k != "slidev_markdown"}
        return summary_payload

    pool: dict[str, AgentTool] = {}

    def _register(candidate: Any) -> None:
        name = getattr(candidate, "tool_name", None)
        if not isinstance(name, str):
            raise ValueError(f"Expected Strands AgentTool with tool_name, got {type(candidate).__name__}")
        _assert_allowed_leaf_tool_name(name)
        pool[name] = cast(AgentTool, candidate)

    for brave_tool in brave_tools():
        _register(brave_tool)
    _register(extract_article_content)
    _register(installed_http_request())
    _register(search_saved_context)
    _register(compile_scholarly_pdf)
    _register(compile_slidev_deck)

    for extra in extra_leaf_tools:
        _register(extra)

    return pool


class DeepResearchMultiAgentPlugin(MultiAgentPlugin):
    """Native ``MultiAgentPlugin`` enforcing cooperative cancellation, clean cyclic revisits, and telemetry."""

    @property
    def name(self) -> str:
        return "deep_research_multiagent_plugin"

    def __init__(
        self,
        *,
        cancel_event: threading.Event | None = None,
        observer: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        super().__init__()
        self._cancel_event = cancel_event
        self._observer = observer
        self._lock = threading.Lock()
        self.events: list[dict[str, Any]] = []
        self.initialized_orchestrators: list[str] = []
        self._invocation_counts: dict[str, int] = {}

    def init_multi_agent(self, orchestrator: MultiAgentBase) -> None:
        hooks_registry = getattr(orchestrator, "hooks", None)
        if hooks_registry is not None:
            hooks_registry.add_callback(MultiAgentInitializedEvent, self.on_multiagent_initialized)
            hooks_registry.add_callback(
                BeforeMultiAgentInvocationEvent,
                self.on_before_multiagent_invocation,
                order=HookOrder.SDK_LAST,
            )
            hooks_registry.add_callback(BeforeNodeCallEvent, self.on_before_node_call)
            hooks_registry.add_callback(AfterNodeCallEvent, self.on_after_node_call)
            hooks_registry.add_callback(AfterMultiAgentInvocationEvent, self.on_after_multiagent_invocation)
        else:
            orchestrator.add_hook(self.on_multiagent_initialized, MultiAgentInitializedEvent)
            orchestrator.add_hook(self.on_before_multiagent_invocation, BeforeMultiAgentInvocationEvent)
            orchestrator.add_hook(self.on_before_node_call, BeforeNodeCallEvent)
            orchestrator.add_hook(self.on_after_node_call, AfterNodeCallEvent)
            orchestrator.add_hook(self.on_after_multiagent_invocation, AfterMultiAgentInvocationEvent)

    def _record(self, payload: dict[str, Any]) -> None:
        with self._lock:
            self.events.append(payload)
        if self._observer is not None:
            try:
                self._observer(payload)
            except Exception:
                logger.debug("DeepResearchMultiAgentPlugin observer callback failed", exc_info=True)

    def on_multiagent_initialized(self, event: MultiAgentInitializedEvent) -> None:
        orchestrator_id = str(getattr(event.source, "id", ""))
        with self._lock:
            if orchestrator_id and orchestrator_id not in self.initialized_orchestrators:
                self.initialized_orchestrators.append(orchestrator_id)
        self._record(
            {
                "hook": "MultiAgentInitializedEvent",
                "orchestrator_id": orchestrator_id,
                "timestamp": _utc_now_iso(),
            }
        )

    def on_before_multiagent_invocation(self, event: BeforeMultiAgentInvocationEvent) -> None:
        source = event.source
        orchestrator_id = str(getattr(source, "id", ""))
        with self._lock:
            visit = self._invocation_counts.get(orchestrator_id, 0) + 1
            self._invocation_counts[orchestrator_id] = visit

        # When an inner Graph or Swarm is revisited on a refinement loop (visit > 1) and is not
        # resuming mid-session/interrupt, clear prior executor node buffers so all inner branches
        # execute fresh on the revisit pass.
        resuming = bool(getattr(source, "_resume_from_session", False))
        interrupt_state = getattr(source, "_interrupt_state", None)
        interrupted = bool(getattr(interrupt_state, "activated", False))
        if visit > 1 and not resuming and not interrupted:
            if isinstance(source, Graph) and getattr(source, "reset_on_revisit", False):
                for graph_node in source.nodes.values():
                    if graph_node.result is not None:
                        graph_node.reset_executor_state()
            elif isinstance(source, Swarm):
                shared_ctx = getattr(source, "shared_context", None)
                ctx_map = getattr(shared_ctx, "context", None)
                if isinstance(ctx_map, dict):
                    ctx_map.clear()

        self._record(
            {
                "hook": "BeforeMultiAgentInvocationEvent",
                "orchestrator_id": orchestrator_id,
                "visit": visit,
                "timestamp": _utc_now_iso(),
            }
        )

    def on_before_node_call(self, event: BeforeNodeCallEvent) -> None:
        orchestrator_id = str(getattr(event.source, "id", ""))
        cancelled = self._cancel_event is not None and self._cancel_event.is_set()
        if cancelled:
            event.cancel_node = "Research run cancelled"
        self._record(
            {
                "hook": "BeforeNodeCallEvent",
                "orchestrator_id": orchestrator_id,
                "node_id": event.node_id,
                "cancelled": bool(cancelled),
                "timestamp": _utc_now_iso(),
            }
        )

    def on_after_node_call(self, event: AfterNodeCallEvent) -> None:
        orchestrator_id = str(getattr(event.source, "id", ""))
        node_result = getattr(event.source, "state", None)
        status_str: str | None = None
        results_map = getattr(node_result, "results", None)
        if isinstance(results_map, Mapping) and event.node_id in results_map:
            status_val = getattr(results_map[event.node_id], "status", None)
            status_str = str(getattr(status_val, "value", status_val)) if status_val is not None else None
        self._record(
            {
                "hook": "AfterNodeCallEvent",
                "orchestrator_id": orchestrator_id,
                "node_id": event.node_id,
                "status": status_str,
                "timestamp": _utc_now_iso(),
            }
        )

    def on_after_multiagent_invocation(self, event: AfterMultiAgentInvocationEvent) -> None:
        orchestrator_id = str(getattr(event.source, "id", ""))
        self._record(
            {
                "hook": "AfterMultiAgentInvocationEvent",
                "orchestrator_id": orchestrator_id,
                "timestamp": _utc_now_iso(),
            }
        )


def all_investigation_branches_completed(
    state: GraphState,
    *,
    invocation_state: dict[str, Any] | None = None,
    **_: Any,
) -> bool:
    """Explicit AND barrier gating ``evidence_ledger`` until all 3 parallel branches complete."""
    del invocation_state
    return all(
        branch_id in state.results and state.results[branch_id].status == Status.COMPLETED
        for branch_id in INVESTIGATION_PARALLEL_BRANCHES
    )


def _extract_node_result_text(node_result: NodeResult | None) -> str:
    if node_result is None:
        return ""
    texts: list[str] = []
    for agent_result in node_result.get_agent_results():
        text = str(agent_result).strip()
        if text:
            texts.append(text)
    if texts:
        return "\n\n".join(texts)
    raw = getattr(node_result, "result", None)
    return str(raw).strip() if raw is not None else ""


def should_refine(
    state: GraphState,
    *,
    invocation_state: dict[str, Any] | None = None,
    **_: Any,
) -> bool:
    """Return True when ``verification_swarm`` requests ``[NEEDS_REFINEMENT]`` within budget."""
    vr = state.results.get("verification_swarm")
    if vr is None or vr.status != Status.COMPLETED:
        return False
    verdict_text = _extract_node_result_text(vr)
    if "[NEEDS_REFINEMENT]" not in verdict_text:
        return False
    max_refinements = int((invocation_state or {}).get("max_refinements", 1))
    if max_refinements <= 0:
        return False

    # In Graph execution, state.execution_order records one entry per outer-graph visit to
    # verification_swarm (whereas Swarm's NodeResult.execution_count counts inner agent turns).
    # Fall back to vr.execution_count when unit-tested with a synthetic GraphState lacking execution_order.
    exec_order = getattr(state, "execution_order", None) or ()
    outer_visits = sum(
        1 for item in exec_order if getattr(item, "node_id", str(item)) == "verification_swarm"
    )
    effective_visits = outer_visits if outer_visits > 0 else int(getattr(vr, "execution_count", 1) or 1)
    return effective_visits <= max_refinements


def should_synthesize(
    state: GraphState,
    *,
    invocation_state: dict[str, Any] | None = None,
    **kwargs: Any,
) -> bool:
    """Exact logical complement of :func:`should_refine` once ``verification_swarm`` completes."""
    vr = state.results.get("verification_swarm")
    if vr is None or vr.status != Status.COMPLETED:
        return False
    return not should_refine(state, invocation_state=invocation_state, **kwargs)


def _resolve_default_selection(
    provider: str | None = None,
    model_id: str | None = None,
    reasoning_effort: str | None = None,
) -> tuple[str | None, str | None, str | None]:
    from agent.api.core.panel_agent import (
        PROVIDERS,
        default_selection,
        infer_provider,
        provider_default_model,
    )

    clean_provider = (provider or "").strip() or (app_config.RON_DEEP_RESEARCH_PROVIDER or "").strip() or None
    clean_model = (model_id or "").strip() or (app_config.RON_DEEP_RESEARCH_MODEL or "").strip() or None
    clean_effort = (reasoning_effort or "").strip() or None

    if clean_provider and clean_provider in PROVIDERS:
        resolved_model = clean_model or provider_default_model(cast(Any, clean_provider))
        return clean_provider, resolved_model, clean_effort
    if clean_model:
        inferred = infer_provider(clean_model)
        return inferred, clean_model, clean_effort
    selected = default_selection()
    if selected is not None:
        sel_provider, sel_model = selected
        return sel_provider, sel_model, clean_effort
    return None, None, clean_effort


def _build_default_model(
    *,
    provider: str | None = None,
    model_id: str | None = None,
    reasoning_effort: str | None = None,
) -> Any:
    from agent.api.core.panel_agent import build_model

    resolved_provider, resolved_model, resolved_effort = _resolve_default_selection(
        provider=provider,
        model_id=model_id,
        reasoning_effort=reasoning_effort,
    )
    if not resolved_provider or not resolved_model:
        raise ValueError(
            "No configured model provider is available for Deep Research. "
            "Configure an API key or pass an explicit provider and model_id."
        )
    return build_model(
        cast(Any, resolved_provider),
        resolved_model,
        resolved_effort,
        hosted_tools=False,
    )


def build_deep_research_graph(
    *,
    session_id: str,
    user_id: str = "default",
    storage: Any = None,
    model: Any = None,
    model_factory: Callable[[], Any] | None = None,
    depth: ResearchDepth = "deep",
    execution_timeout: float = 1200.0,
    node_timeout: float = 300.0,
    max_node_executions: int = 16,
    cancel_event: threading.Event | None = None,
    owned_agents: list[Agent] | None = None,
    extra_leaf_tools: Sequence[Any] = (),
    artifacts_dir: Path | str | None = None,
    default_report_getter: Callable[[], str] | None = None,
    default_title_getter: Callable[[], str] | None = None,
    default_query_getter: Callable[[], str] | None = None,
    default_citations_getter: Callable[[], Sequence[Mapping[str, str]]] | None = None,
    on_artifact_compiled: Callable[[str, dict[str, Any]], Awaitable[None] | None] | None = None,
) -> Graph:
    """Build the 3-level nested Strands ``Graph`` + ``Swarm`` Deep Research formation.

    Every orchestrator ``Agent`` across every ``Graph`` and ``Swarm`` holds ``use_skill`` ONLY
    (plus ``handoff_to_agent`` injected by ``Swarm``), and every ``use_skill`` preset spawns a
    skill-guided ``create_harness`` leaf subagent over the vetted research tool pool.
    """
    clean_session_id = _validate_session_id(session_id)
    clean_user_id = (user_id or "").strip() or "default"
    normalized_depth = _normalize_depth(depth)

    resolved_storage: Storage = (
        cast(Storage, storage) if storage is not None else get_user_session_storage(clean_user_id)
    )
    base_artifacts_dir = (
        Path(artifacts_dir).expanduser().resolve() if artifacts_dir is not None else default_artifacts_dir()
    )
    session_artifact_dir = base_artifacts_dir / clean_session_id

    synthesis_box: dict[str, Graph] = {}

    def _effective_report_getter() -> str:
        if default_report_getter is not None:
            candidate = (default_report_getter() or "").strip()
            if candidate:
                return candidate
        syn_graph = synthesis_box.get("graph")
        if syn_graph is not None:
            syn_state = getattr(syn_graph, "state", None)
            results_map = getattr(syn_state, "results", None)
            if isinstance(results_map, Mapping):
                for nid in ("executive_editor", "report_drafter"):
                    if nid in results_map:
                        txt = _extract_node_result_text(results_map[nid])
                        if txt:
                            return txt
        return ""

    skills_by_name = load_deep_research_skills(strict=True)
    leaf_tool_pool = build_leaf_tool_pool(
        user_id=clean_user_id,
        storage=resolved_storage,
        artifact_dir=session_artifact_dir,
        session_id=clean_session_id,
        depth=normalized_depth,
        default_report_getter=_effective_report_getter,
        default_title_getter=default_title_getter,
        default_query_getter=default_query_getter,
        default_citations_getter=default_citations_getter,
        on_artifact_compiled=on_artifact_compiled,
        extra_leaf_tools=extra_leaf_tools,
    )

    agents_sink = owned_agents if owned_agents is not None else []
    agents_lock = threading.Lock()

    def _track_agent(agent: Agent) -> Agent:
        with agents_lock:
            agents_sink.append(agent)
        return agent

    cached_default_model: Any = None

    def _resolve_model() -> Any:
        nonlocal cached_default_model
        if model_factory is not None:
            return model_factory()
        if model is not None:
            return model
        if cached_default_model is None:
            cached_default_model = _build_default_model()
        return cached_default_model

    depth_note = (
        f"\n\n## Active Research Depth Profile: {normalized_depth.upper()}\n"
        f"- Maximum verification refinement loops: {_max_refinements_for_depth(normalized_depth)}\n"
        "- Delegate all external reconnaissance, extraction, and verification through `use_skill`."
    )

    def _make_use_skill_tool(preset_names: Sequence[str]) -> AgentTool:
        presets_map: dict[str, Preset] = {}
        skills_by_instructions: dict[str, Skill] = {}
        fallback_skill: Skill | None = None

        for preset_name in preset_names:
            if preset_name not in skills_by_name:
                raise KeyError(f"Unknown Deep Research leaf skill preset: {preset_name!r}")
            leaf_skill = skills_by_name[preset_name]
            if fallback_skill is None:
                fallback_skill = leaf_skill
            allowed_names = [
                name for name in (leaf_skill.allowed_tools or []) if name in leaf_tool_pool
            ]
            presets_map[preset_name] = Preset(
                instructions=leaf_skill.instructions,
                tools=allowed_names,
                context="none",
                description=leaf_skill.description,
            )
            skills_by_instructions[leaf_skill.instructions] = leaf_skill

        assert fallback_skill is not None

        def skill_subagent_builder(spec: AgentSpec) -> Agent:
            matched_skill = skills_by_instructions.get(spec.instructions or "", fallback_skill)
            scoped_tools: list[AgentTool] = [
                leaf_tool_pool[t_name]
                for t_name in (spec.tools or ())
                if isinstance(t_name, str) and t_name in leaf_tool_pool
            ]
            resolved_child_model = spec.model if spec.model is not None else _resolve_model()
            child_agent = create_harness(
                model=resolved_child_model,
                instructions=spec.instructions or matched_skill.instructions,
                skills=AgentSkills(skills=[matched_skill]),
                tools=scoped_tools,
                builtin_tools=[],
                builtin_plugins=["todos"],
                caching=False,
                session=False,
                memory=False,
                background_tasks=False,
                storage=resolved_storage,
                plugins=[ContextOffloader(storage=resolved_storage)],
                callback_handler=None,
            )
            return _track_agent(child_agent)

        return make_subagent(
            name="use_skill",
            presets=presets_map,
            default_preset=preset_names[0],
            instructions=Fixed(None),
            tools=Fixed(None),
            mcp_servers=Fixed(None),
            model=Inherit(),
            context=Fixed("none"),
            builder=skill_subagent_builder,
        )

    def _make_orchestrator_agent(
        *,
        node_id: str,
        skill_name: str,
        preset_names: Sequence[str],
    ) -> Agent:
        if skill_name not in skills_by_name:
            raise KeyError(f"Unknown Deep Research stage skill: {skill_name!r}")
        stage_skill = skills_by_name[skill_name]
        use_skill_tool = _make_use_skill_tool(preset_names)
        orchestrator_agent = create_harness(
            name=node_id,
            agent_id=node_id,
            model=_resolve_model(),
            instructions=f"{stage_skill.instructions}{depth_note}{JOURNAL_DIRECTIVE}",
            skills=AgentSkills(skills=[stage_skill]),
            tools=[use_skill_tool],
            builtin_tools=[],
            builtin_plugins=["todos"],
            caching=False,
            session=False,
            memory=MemoryManager(stores=agent_memory(clean_user_id, "deep-research")),
            background_tasks=False,
            storage=resolved_storage,
            plugins=[ContextOffloader(storage=resolved_storage)],
            callback_handler=None,
        )
        return _track_agent(orchestrator_agent)

    # Shared native SnapshotSessionManager and MultiAgentPlugin across all 6 unique orchestrator IDs.
    session_manager = SnapshotSessionManager(
        session_id=clean_session_id,
        storage=resolved_storage,
        multi_agent_save_latest_on="node",
    )
    multiagent_plugin = DeepResearchMultiAgentPlugin(cancel_event=cancel_event)

    # ── Formation 1: Planning Formation (Nested Graph) ──────────────────────
    problem_framing = _make_orchestrator_agent(
        node_id="problem_framing",
        skill_name="research-problem-framing",
        preset_names=("domain-landscape-scan", "question-decomposition", "research"),
    )
    research_blueprint = _make_orchestrator_agent(
        node_id="research_blueprint",
        skill_name="research-blueprint-design",
        preset_names=("methodology-design", "source-rubric", "statistical-analysis"),
    )

    planning_builder = GraphBuilder()
    planning_builder.set_graph_id("deep_research_planning")
    planning_builder.reset_on_revisit(True)
    planning_builder.add_node(problem_framing, "problem_framing")
    planning_builder.add_node(research_blueprint, "research_blueprint")
    planning_builder.add_edge("problem_framing", "research_blueprint")
    planning_builder.set_entry_point("problem_framing")
    planning_builder.set_execution_timeout(execution_timeout)
    planning_builder.set_node_timeout(node_timeout)
    planning_builder.set_max_node_executions(8)
    planning_builder.set_session_manager(session_manager)
    planning_builder.set_plugins([multiagent_plugin])
    planning_formation = planning_builder.build()

    # ── Formation 2: Investigation Formation (Nested Graph + Nested Swarm) ──
    web_intelligence = _make_orchestrator_agent(
        node_id="web_intelligence",
        skill_name="web-intelligence-director",
        preset_names=("broad-web-discovery", "deep-source-extraction", "research"),
    )
    news_data_intelligence = _make_orchestrator_agent(
        node_id="news_data_intelligence",
        skill_name="news-data-director",
        preset_names=(
            "temporal-news-analysis",
            "quantitative-fact-lookup",
            "exploratory-data-analysis",
            "statistical-analysis",
            "analytics",
        ),
    )

    hypothesis_explorer = _make_orchestrator_agent(
        node_id="hypothesis_explorer",
        skill_name="hypothesis-explorer",
        preset_names=("hypothesis-probing", "counterevidence-search", "scientific-critical-thinking"),
    )
    contrarian_examiner = _make_orchestrator_agent(
        node_id="contrarian_examiner",
        skill_name="contrarian-examiner",
        preset_names=("counterevidence-search", "hypothesis-probing", "scientific-critical-thinking"),
    )
    adversarial_swarm = Swarm(
        [hypothesis_explorer, contrarian_examiner],
        entry_point=hypothesis_explorer,
        id="deep_research_adversarial_swarm",
        max_handoffs=4,
        max_iterations=5,
        execution_timeout=execution_timeout,
        node_timeout=node_timeout,
        session_manager=session_manager,
        plugins=[multiagent_plugin],
    )

    evidence_ledger = _make_orchestrator_agent(
        node_id="evidence_ledger",
        skill_name="evidence-ledger-curator",
        preset_names=("evidence-triangulation", "validate-data", "statistical-analysis"),
    )

    investigation_builder = GraphBuilder()
    investigation_builder.set_graph_id("deep_research_investigation")
    investigation_builder.reset_on_revisit(True)
    investigation_builder.add_node(web_intelligence, "web_intelligence")
    investigation_builder.add_node(news_data_intelligence, "news_data_intelligence")
    investigation_builder.add_node(adversarial_swarm, "adversarial_swarm")
    investigation_builder.add_node(evidence_ledger, "evidence_ledger")
    for branch_id in INVESTIGATION_PARALLEL_BRANCHES:
        investigation_builder.add_edge(
            branch_id,
            "evidence_ledger",
            condition=all_investigation_branches_completed,
        )
        investigation_builder.set_entry_point(branch_id)
    investigation_builder.set_execution_timeout(execution_timeout)
    investigation_builder.set_node_timeout(node_timeout)
    investigation_builder.set_max_node_executions(12)
    investigation_builder.set_session_manager(session_manager)
    investigation_builder.set_plugins([multiagent_plugin])
    investigation_formation = investigation_builder.build()

    # ── Formation 3: Verification Swarm (Nested Swarm) ──────────────────────
    citation_verifier = _make_orchestrator_agent(
        node_id="citation_verifier",
        skill_name="citation-verifier",
        preset_names=(
            "source-verification",
            "gap-targeted-search",
            "validate-data",
            "verification-before-completion",
        ),
    )
    analytical_critic = _make_orchestrator_agent(
        node_id="analytical_critic",
        skill_name="analytical-critic",
        preset_names=(
            "claim-stress-test",
            "gap-targeted-search",
            "source-verification",
            "peer-review",
            "verification-before-completion",
        ),
    )
    verification_swarm = Swarm(
        [citation_verifier, analytical_critic],
        entry_point=citation_verifier,
        id="deep_research_verification_swarm",
        max_handoffs=4,
        max_iterations=5,
        execution_timeout=execution_timeout,
        node_timeout=node_timeout,
        session_manager=session_manager,
        plugins=[multiagent_plugin],
    )

    # ── Formation 4: Synthesis Formation (Nested Graph) ─────────────────────
    report_drafter = _make_orchestrator_agent(
        node_id="report_drafter",
        skill_name="report-drafter",
        preset_names=(
            "structured-synthesis",
            "citation-weaving",
            "scientific-writing",
            "data-visualization",
            "scientific-visualization",
            "theme-factory",
        ),
    )
    executive_editor = _make_orchestrator_agent(
        node_id="executive_editor",
        skill_name="executive-editor",
        preset_names=(
            "editorial-polish",
            "humanizer",
            "stop-slop",
            "no-ai-slop",
            "copy-editing",
            "theme-factory",
        ),
    )
    pdf_publisher = _make_orchestrator_agent(
        node_id="pdf_publisher",
        skill_name="scholarly-pdf-publisher",
        preset_names=(
            "pdf",
            "academic-paper",
            "openai-pdf",
            "canvas-design",
            "theme-factory",
        ),
    )
    slidev_producer = _make_orchestrator_agent(
        node_id="slidev_producer",
        skill_name="slidev-deck-producer",
        preset_names=(
            "build-agent-slidev",
            "slidev",
            "scientific-slides",
            "theme-factory",
        ),
    )

    synthesis_builder = GraphBuilder()
    synthesis_builder.set_graph_id("deep_research_synthesis")
    synthesis_builder.reset_on_revisit(True)
    synthesis_builder.add_node(report_drafter, "report_drafter")
    synthesis_builder.add_node(executive_editor, "executive_editor")
    synthesis_builder.add_node(pdf_publisher, "pdf_publisher")
    synthesis_builder.add_node(slidev_producer, "slidev_producer")
    synthesis_builder.add_edge("report_drafter", "executive_editor")
    synthesis_builder.add_edge("executive_editor", "pdf_publisher")
    synthesis_builder.add_edge("executive_editor", "slidev_producer")
    synthesis_builder.set_entry_point("report_drafter")
    synthesis_builder.set_execution_timeout(execution_timeout)
    synthesis_builder.set_node_timeout(node_timeout)
    synthesis_builder.set_max_node_executions(12)
    synthesis_builder.set_session_manager(session_manager)
    synthesis_builder.set_plugins([multiagent_plugin])
    synthesis_formation = synthesis_builder.build()
    synthesis_box["graph"] = synthesis_formation

    # ── Top-Level Formation Graph ───────────────────────────────────────────
    root_builder = GraphBuilder()
    root_builder.set_graph_id("deep_research_graph")
    root_builder.reset_on_revisit(True)
    root_builder.add_node(planning_formation, "planning_formation")
    root_builder.add_node(investigation_formation, "investigation_formation")
    root_builder.add_node(verification_swarm, "verification_swarm")
    root_builder.add_node(synthesis_formation, "synthesis_formation")

    root_builder.add_edge("planning_formation", "investigation_formation")
    root_builder.add_edge("investigation_formation", "verification_swarm")
    root_builder.add_edge("verification_swarm", "investigation_formation", condition=should_refine)
    root_builder.add_edge("verification_swarm", "synthesis_formation", condition=should_synthesize)

    root_builder.set_entry_point("planning_formation")
    root_builder.set_execution_timeout(execution_timeout)
    root_builder.set_node_timeout(node_timeout)
    root_builder.set_max_node_executions(max_node_executions)
    root_builder.set_session_manager(session_manager)
    root_builder.set_plugins([multiagent_plugin])

    root_graph = root_builder.build()
    setattr(root_graph, "_deep_research_plugin", multiagent_plugin)
    setattr(root_graph, "_deep_research_session_manager", session_manager)
    setattr(root_graph, "_deep_research_owned_agents", agents_sink)
    return root_graph


# ─────────────────────────────────────────────────────────────────────────────
# Citation Extraction & Preview Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _clean_public_url(raw_url: Any) -> str | None:
    if not isinstance(raw_url, str):
        return None
    candidate = raw_url.strip().rstrip(".,;:)>'\"")
    if not candidate:
        return None
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return candidate


def _domain_source(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host or "web"


def _extract_citations_from_payload(payload: Any, fallback_source: str = "") -> list[dict[str, str]]:
    discovered: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    def _add(url_val: Any, title_val: Any = "", snippet_val: Any = "", src_val: Any = "") -> None:
        clean_u = _clean_public_url(url_val)
        if not clean_u or clean_u in seen_urls:
            return
        seen_urls.add(clean_u)
        domain = _domain_source(clean_u)
        title_str = str(title_val or "").strip() or domain
        snippet_str = re.sub(r"\s+", " ", str(snippet_val or "").strip())[:320]
        source_str = str(src_val or "").strip() or fallback_source or domain
        discovered.append(
            {
                "url": clean_u,
                "title": title_str[:300],
                "snippet": snippet_str,
                "source": source_str[:160],
            }
        )

    def _walk(item: Any, depth: int = 0) -> None:
        if depth > 6 or item is None:
            return
        if isinstance(item, str):
            stripped = item.strip()
            if stripped.startswith(("{", "[")):
                try:
                    parsed = json.loads(stripped)
                except Exception:
                    parsed = None
                if parsed is not None:
                    _walk(parsed, depth + 1)
                    return
            for match in _MARKDOWN_LINK_RE.finditer(item):
                _add(match.group(2), match.group(1), "", fallback_source)
            return
        if isinstance(item, Mapping):
            if "url" in item:
                _add(
                    item.get("url"),
                    item.get("title") or item.get("name"),
                    item.get("snippet") or item.get("description") or item.get("text", "")[:280],
                    item.get("source") or item.get("profile", {}).get("name")
                    if isinstance(item.get("profile"), Mapping)
                    else item.get("source"),
                )
            for val in item.values():
                if isinstance(val, (Mapping, list, tuple, str)):
                    _walk(val, depth + 1)
            return
        if isinstance(item, (list, tuple)):
            for sub in item:
                _walk(sub, depth + 1)

    _walk(payload)
    return discovered


def _preview_json_or_text(value: Any, max_chars: int = 300) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        compact = re.sub(r"\s+", " ", value).strip()
        return compact[:max_chars]
    if isinstance(value, Mapping):
        for preferred in ("query", "url", "task", "text", "summary", "error"):
            if preferred in value and isinstance(value[preferred], str) and value[preferred].strip():
                return re.sub(r"\s+", " ", value[preferred]).strip()[:max_chars]
    try:
        dumped = json.dumps(value, ensure_ascii=False)
    except Exception:
        dumped = str(value)
    return re.sub(r"\s+", " ", dumped).strip()[:max_chars]


def _extract_tool_result_text(tool_result: Mapping[str, Any]) -> str:
    content = tool_result.get("content")
    if isinstance(content, Sequence) and not isinstance(content, (str, bytes)):
        parts: list[str] = []
        for block in content:
            if isinstance(block, Mapping):
                if isinstance(block.get("text"), str):
                    parts.append(block["text"])
                elif "json" in block:
                    parts.append(_preview_json_or_text(block["json"], max_chars=2000))
        return "\n".join(p for p in parts if p).strip()
    if isinstance(content, str):
        return content.strip()
    return ""


def _tool_output_text(tool_result: Mapping[str, Any]) -> tuple[str, bool]:
    """A leaf tool result as the transcript keeps it: whole text and JSON blocks, cut at the configured length."""
    content = tool_result.get("content")
    parts: list[str] = []
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, Sequence) and not isinstance(content, (str, bytes)):
        for block in content:
            if not isinstance(block, Mapping):
                continue
            if isinstance(block.get("text"), str):
                parts.append(block["text"])
            elif "json" in block:
                try:
                    parts.append(json.dumps(block["json"], ensure_ascii=False, indent=2))
                except (TypeError, ValueError):
                    parts.append(str(block["json"]))
    text = "\n".join(part for part in parts if part).strip()
    limit = max(0, int(app_config.RON_DEEP_RESEARCH_TOOL_OUTPUT_CHARS))
    return text[:limit], len(text) > limit


def _append_transcript_text(parts: list[dict[str, Any]], kind: str, delta: str, sequence: int) -> None:
    """Add streamed text to a transcript: it continues the last part when that part is the same kind."""
    if parts and parts[-1].get("kind") == kind:
        parts[-1]["text"] = str(parts[-1].get("text") or "") + delta
    else:
        parts.append({"id": f"p{sequence}", "kind": kind, "text": delta})


def _without_transcripts(snapshot: dict[str, Any]) -> dict[str, Any]:
    """A run snapshot for lists: status and previews only, without transcripts or tool payloads."""

    def slim_skill(skill: Any) -> Any:
        if not isinstance(skill, dict):
            return skill
        slim = {key: value for key, value in skill.items() if key != "steps"}
        slim["tools"] = [
            {key: value for key, value in tool_item.items() if key not in _TOOL_PAYLOAD_KEYS}
            if isinstance(tool_item, dict)
            else tool_item
            for tool_item in skill.get("tools") or ()
        ]
        return slim

    nodes = snapshot.get("nodes")
    if isinstance(nodes, dict):
        snapshot["nodes"] = {
            key: (
                {
                    **{field: value for field, value in node.items() if field != "activity"},
                    "skill_invocations": [slim_skill(skill) for skill in node.get("skill_invocations") or ()],
                }
                if isinstance(node, dict)
                else node
            )
            for key, node in nodes.items()
        }
    if isinstance(snapshot.get("skill_invocations"), list):
        snapshot["skill_invocations"] = [slim_skill(skill) for skill in snapshot["skill_invocations"]]
    return snapshot


def _summarize_markdown(markdown: str, fallback: str = "") -> str:
    if not markdown.strip():
        return fallback
    lines = [
        line.strip()
        for line in markdown.splitlines()
        if line.strip() and not line.lstrip().startswith("#") and not line.lstrip().startswith("|")
    ]
    summary = re.sub(r"\s+", " ", " ".join(lines[:3])).strip()
    if not summary:
        summary = re.sub(r"\s+", " ", markdown).strip()
    return summary[:420]


# ─────────────────────────────────────────────────────────────────────────────
# DeepResearchRunState & DeepResearchRuntime
# ─────────────────────────────────────────────────────────────────────────────


class _DeepResearchRun:
    """In-memory state, bounded SSE replay buffer, and lifecycle synchronization for one run."""

    def __init__(
        self,
        *,
        session_id: str,
        user_id: str,
        query: str,
        context: str | None,
        depth: ResearchDepth,
        selection: dict[str, str | None],
        max_events: int = 4096,
    ) -> None:
        now = _utc_now_iso()
        self.session_id = session_id
        self.user_id = user_id
        self.query = query
        self.context = (context or "").strip()
        self.title = _derive_title(query)
        self.depth: ResearchDepth = depth
        self.status: str = "executing"
        self.active: bool = True
        self.created_at = now
        self.updated_at = now
        self.completed_at: str | None = None
        self.selection = dict(selection)

        self.sequence: int = 0
        self._max_events = max(16, int(max_events))
        self._events: deque[dict[str, Any]] = deque()
        self._lock = asyncio.Lock()
        self._changed = asyncio.Event()
        self._done = asyncio.Event()

        self.active_node_path: list[str] = []
        self.completed_nodes: list[str] = []
        self.failed_nodes: list[str] = []
        self.execution_order: list[str] = []
        self.nodes: dict[str, dict[str, Any]] = {}
        self.handoffs: list[dict[str, Any]] = []
        self.citations: list[dict[str, str]] = []
        self._citation_urls: set[str] = set()
        self.skill_invocations: list[dict[str, Any]] = []
        self._skills_by_id: dict[str, dict[str, Any]] = {}
        self.usage: dict[str, int] = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
        self.execution_time_ms: int = 0
        self.report_markdown: str = ""
        self._report_source_node: str | None = None
        self.slidev_markdown: str = ""
        self.artifacts: dict[str, str] = {}
        self.summary: str = ""
        self.error: str | None = None
        self.refinement_count: int = 0

        self.cancel_event = threading.Event()
        self.cancel_requested: bool = False
        self.task: asyncio.Task[None] | None = None
        self._started_monotonic = time.monotonic()

    @property
    def replay_after(self) -> int:
        if not self._events:
            return self.sequence
        return max(0, int(self._events[0]["sequence"]) - 1)

    def _ensure_node(
        self,
        node_path: Sequence[str],
        timestamp: str,
        node_type_hint: str | None = None,
    ) -> str:
        path_list = [seg for seg in node_path if seg]
        for idx in range(1, len(path_list) + 1):
            prefix = path_list[:idx]
            key = "/".join(prefix)
            node_id = prefix[-1]
            is_leaf = idx == len(path_list)
            resolved_kind = _resolve_node_kind(node_id, node_type_hint if is_leaf else None)
            existing = self.nodes.get(key)
            if existing is None:
                self.nodes[key] = {
                    "node_id": node_id,
                    "node_path": list(prefix),
                    "node_type": resolved_kind,
                    "status": "executing" if not is_leaf else "pending",
                    "started_at": timestamp,
                    "completed_at": None,
                    "execution_time_ms": None,
                    "execution_count": 1 if not is_leaf else 0,
                    "skills_used": [],
                    "skill_invocations": [],
                    "output_preview": "",
                    # The agent's own work in order: text, reasoning, each use_skill call, repeat passes.
                    "activity": [],
                    "error": None,
                }
            elif is_leaf and node_type_hint:
                existing["node_type"] = resolved_kind
        return "/".join(path_list)

    def _sync_node_skills(self, node_key: str) -> None:
        node = self.nodes.get(node_key)
        if node is None:
            return
        # The node's copies are summaries: the transcript (`steps`, tool input/output) is kept once,
        # in the run's `skill_invocations`.
        matching = [
            {
                **{key: copy.deepcopy(value) for key, value in sk.items() if key not in ("steps", "tools")},
                "tools": [
                    {key: value for key, value in tool_item.items() if key not in _TOOL_PAYLOAD_KEYS}
                    for tool_item in sk.get("tools") or ()
                ],
            }
            for sk in self.skill_invocations
            if sk.get("node_key") == node_key
        ]
        names: list[str] = list(node.get("skills_used") or [])
        for sk in matching:
            sk_name = str(sk.get("skill_name") or "")
            if sk_name and sk_name not in names:
                names.append(sk_name)
        node["skills_used"] = names
        node["skill_invocations"] = matching

    def add_citations(self, items: Sequence[Mapping[str, str]]) -> list[dict[str, str]]:
        added: list[dict[str, str]] = []
        for raw in items:
            url = _clean_public_url(raw.get("url"))
            if not url or url in self._citation_urls:
                continue
            self._citation_urls.add(url)
            entry = {
                "url": url,
                "title": str(raw.get("title") or _domain_source(url))[:300],
                "snippet": str(raw.get("snippet") or "")[:320],
                "source": str(raw.get("source") or _domain_source(url))[:160],
            }
            self.citations.append(entry)
            added.append(copy.deepcopy(entry))
        return added

    async def emit(
        self,
        event_type: str,
        *,
        node_path: Sequence[str] = (),
        **fields: Any,
    ) -> dict[str, Any]:
        async with self._lock:
            self.sequence += 1
            timestamp = _utc_now_iso()
            self.updated_at = timestamp
            path_list = [str(seg) for seg in node_path if seg]
            event: dict[str, Any] = {
                "version": 1,
                "sequence": self.sequence,
                "session_id": self.session_id,
                "type": event_type,
                "node_path": path_list,
                "timestamp": timestamp,
                **fields,
            }
            self._apply_event_locked(event)
            self._events.append(event)
            while len(self._events) > self._max_events:
                self._events.popleft()
            self._changed.set()
            return copy.deepcopy(event)

    def _apply_event_locked(self, event: Mapping[str, Any]) -> None:
        ev_type = str(event["type"])
        timestamp = str(event["timestamp"])
        node_path = list(event.get("node_path") or [])

        if ev_type == "run_started":
            self.status = "executing"
            self.active = True
            return

        if ev_type == "node_start" and node_path:
            key = self._ensure_node(node_path, timestamp, cast(str | None, event.get("node_type")))
            node = self.nodes[key]
            exec_count = int(node.get("execution_count") or 0) + 1
            if exec_count > 1:
                prefix = f"{key}/"
                for other_key, other_node in self.nodes.items():
                    if other_key.startswith(prefix):
                        other_node["status"] = "pending"
                        other_node["completed_at"] = None
            node["status"] = "executing"
            node["started_at"] = timestamp
            node["completed_at"] = None
            node["execution_count"] = exec_count
            node["error"] = None
            activity: list[dict[str, Any]] = node.setdefault("activity", [])
            if exec_count > 1 and activity:
                activity.append({"id": f"p{event['sequence']}", "kind": "pass", "pass": exec_count})
            self.active_node_path = list(node_path)
            self.execution_order.append(key)
            if key == "investigation_formation" and exec_count > 1:
                self.refinement_count = max(self.refinement_count, exec_count - 1)
            return

        if ev_type == "node_stop" and node_path:
            key = self._ensure_node(node_path, timestamp, cast(str | None, event.get("node_type")))
            node = self.nodes[key]
            node_status = str(event.get("status") or "completed").lower()
            node["status"] = node_status
            node["completed_at"] = timestamp
            if event.get("execution_time_ms") is not None:
                node["execution_time_ms"] = int(event["execution_time_ms"])
            node["execution_count"] = max(1, int(node.get("execution_count") or 0))
            preview = str(event.get("output_preview") or "").strip()
            if preview:
                node["output_preview"] = preview[:400]
            if node_status == "failed" and event.get("error"):
                node["error"] = str(event["error"])
            if node_status == "completed" and key not in self.completed_nodes:
                self.completed_nodes.append(key)
            elif node_status == "failed" and key not in self.failed_nodes:
                self.failed_nodes.append(key)
            if "/".join(self.active_node_path) == key:
                self.active_node_path = node_path[:-1]
            usage_delta = event.get("usage")
            if isinstance(usage_delta, Mapping):
                in_tok = int(usage_delta.get("inputTokens") or 0)
                out_tok = int(usage_delta.get("outputTokens") or 0)
                tot_tok = int(usage_delta.get("totalTokens") or (in_tok + out_tok))
                self.usage["inputTokens"] += in_tok
                self.usage["outputTokens"] += out_tok
                self.usage["totalTokens"] += tot_tok
            return

        if ev_type == "node_handoff":
            handoff_record = {
                "id": str(event.get("handoff_id") or f"handoff-{event['sequence']}"),
                "from_node": str(event.get("from_node") or "agent"),
                "to_node": str(event.get("to_node") or "agent"),
                "from_node_ids": list(event.get("from_node_ids") or []),
                "to_node_ids": list(event.get("to_node_ids") or []),
                "message": str(event.get("message") or ""),
                "node_path": list(node_path),
                "timestamp": timestamp,
            }
            self.handoffs.append(handoff_record)
            return

        if ev_type == "node_cancel" and node_path:
            key = self._ensure_node(node_path, timestamp)
            self.nodes[key]["status"] = "cancelled"
            self.nodes[key]["completed_at"] = timestamp
            self.nodes[key]["error"] = str(event.get("reason") or event.get("message") or "Node cancelled")
            return

        if ev_type == "node_interrupt":
            if node_path:
                key = self._ensure_node(node_path, timestamp)
                self.nodes[key]["status"] = "interrupted"
                self.nodes[key]["error"] = str(event.get("reason") or "Interrupted")
            self.status = "interrupted"
            return

        if ev_type == "skill_start":
            effective_path = node_path or list(self.active_node_path)
            node_key = self._ensure_node(effective_path, timestamp) if effective_path else ""
            skill_id = str(event.get("skill_id") or f"skill-{event['sequence']}")
            skill_name = str(event.get("skill_name") or "use_skill")
            record: dict[str, Any] = {
                "id": skill_id,
                "skill_name": skill_name,
                "task": str(event.get("task") or ""),
                "node_path": effective_path,
                "node_key": node_key,
                "status": "running",
                "started_at": timestamp,
                "completed_at": None,
                "duration_ms": None,
                "tools": [],
                "output_text": "",
                "summary": "",
                # The sub-agent's work in order: text, reasoning, each tool call.
                "steps": [],
            }
            if skill_id in self._skills_by_id:
                self._skills_by_id[skill_id].update(record)
            else:
                self._skills_by_id[skill_id] = record
                self.skill_invocations.append(record)
            if node_key:
                node_activity: list[dict[str, Any]] = self.nodes[node_key].setdefault("activity", [])
                if not any(part.get("kind") == "skill" and part.get("skill_id") == skill_id for part in node_activity):
                    node_activity.append({"id": f"p{event['sequence']}", "kind": "skill", "skill_id": skill_id})
                self._sync_node_skills(node_key)
            return

        if ev_type == "skill_tool":
            skill_id = str(event.get("skill_id") or "")
            target = self._skills_by_id.get(skill_id)
            if target is not None:
                tool_id = str(event.get("tool_use_id") or f"tool-{event['sequence']}")
                tools_list: list[dict[str, Any]] = target["tools"]
                existing_idx = next((i for i, item in enumerate(tools_list) if item["id"] == tool_id), -1)
                previous: dict[str, Any] = tools_list[existing_idx] if existing_idx >= 0 else {}
                # A result event names neither the tool nor its input: both stay as the call set them.
                tool_entry = {
                    "id": tool_id,
                    "tool_name": str(event.get("tool_name") or previous.get("tool_name") or "research_tool"),
                    "input_preview": str(event.get("input_preview") or previous.get("input_preview") or ""),
                    "status": str(event.get("status") or "running"),
                    "output_preview": str(event.get("output_preview") or previous.get("output_preview") or ""),
                    "timestamp": timestamp,
                    "input": copy.deepcopy(event["input"]) if "input" in event else previous.get("input"),
                    "output": str(event["output"]) if "output" in event else str(previous.get("output") or ""),
                    "output_truncated": bool(
                        event["output_truncated"] if "output_truncated" in event else previous.get("output_truncated")
                    ),
                }
                if existing_idx >= 0:
                    tools_list[existing_idx] = tool_entry
                else:
                    tools_list.append(tool_entry)
                    target.setdefault("steps", []).append(
                        {"id": f"p{event['sequence']}", "kind": "tool", "tool_id": tool_id}
                    )
                if target.get("node_key"):
                    self._sync_node_skills(str(target["node_key"]))
            return

        if ev_type == "skill_delta":
            skill_id = str(event.get("skill_id") or "")
            delta = str(event.get("delta") or "")
            target = self._skills_by_id.get(skill_id)
            if target is not None and delta:
                target["output_text"] = str(target.get("output_text") or "") + delta
                target["summary"] = str(target["output_text"]).strip()[:320]
                _append_transcript_text(target.setdefault("steps", []), "text", delta, int(event["sequence"]))
                if target.get("node_key"):
                    self._sync_node_skills(str(target["node_key"]))
            return

        if ev_type == "reasoning_delta":
            delta = str(event.get("delta") or "")
            if not delta:
                return
            skill_id = str(event.get("skill_id") or "")
            if skill_id:
                target = self._skills_by_id.get(skill_id)
                if target is not None:
                    _append_transcript_text(target.setdefault("steps", []), "reasoning", delta, int(event["sequence"]))
                return
            if node_path:
                key = self._ensure_node(node_path, timestamp)
                _append_transcript_text(
                    self.nodes[key].setdefault("activity", []), "reasoning", delta, int(event["sequence"])
                )
            return

        if ev_type == "skill_stop":
            skill_id = str(event.get("skill_id") or "")
            target = self._skills_by_id.get(skill_id)
            final_status = "failed" if str(event.get("status") or "").lower() in ("failed", "error") else "completed"
            if target is not None:
                target["status"] = final_status
                target["completed_at"] = timestamp
                if event.get("duration_ms") is not None:
                    target["duration_ms"] = int(event["duration_ms"])
                summary_text = str(event.get("summary") or "").strip()
                if summary_text:
                    target["summary"] = summary_text[:320]
                for tool_item in target.get("tools", ()):
                    if tool_item.get("status") == "running":
                        tool_item["status"] = final_status
                if target.get("node_key"):
                    self._sync_node_skills(str(target["node_key"]))
            return

        if ev_type == "text_delta":
            delta = str(event.get("delta") or "")
            if not delta:
                return
            if node_path:
                key = self._ensure_node(node_path, timestamp)
                prev_preview = str(self.nodes[key].get("output_preview") or "")
                if len(prev_preview) < 400:
                    self.nodes[key]["output_preview"] = (prev_preview + delta).strip()[:400]
                _append_transcript_text(
                    self.nodes[key].setdefault("activity", []), "text", delta, int(event["sequence"])
                )
            leaf_id = node_path[-1] if node_path else ""
            if event.get("is_slidev") is True or leaf_id == "slidev_producer":
                self.slidev_markdown += delta
                return
            if node_path and node_path[0] == "synthesis_formation" and leaf_id in SYNTHESIS_PROSE_NODES:
                if (
                    leaf_id == "executive_editor"
                    and self._report_source_node is not None
                    and self._report_source_node != "executive_editor"
                ):
                    self.report_markdown = delta
                    self._report_source_node = "executive_editor"
                elif leaf_id == "report_drafter" and self._report_source_node == "executive_editor":
                    pass
                else:
                    self.report_markdown += delta
                    self._report_source_node = leaf_id
            return

        if ev_type == "artifact_ready":
            incoming_artifacts = event.get("artifacts")
            if isinstance(incoming_artifacts, Mapping):
                for k, v in incoming_artifacts.items():
                    if isinstance(k, str) and isinstance(v, str) and v:
                        self.artifacts[k] = v
            if isinstance(event.get("slidev_markdown"), str) and event["slidev_markdown"]:
                self.slidev_markdown = str(event["slidev_markdown"])
            if isinstance(event.get("report_markdown"), str) and event["report_markdown"]:
                self.report_markdown = str(event["report_markdown"])
            return

        if ev_type == "error":
            self.error = str(event.get("error") or event.get("message") or "Deep Research error")
            return

        if ev_type == "run_finished":
            final_status = str(event.get("status") or "completed")
            self.status = final_status
            self.active = False
            self.completed_at = str(event.get("completed_at") or timestamp)
            self.active_node_path = []
            if event.get("execution_time_ms") is not None:
                self.execution_time_ms = int(event["execution_time_ms"])
            if isinstance(event.get("report_markdown"), str) and event["report_markdown"]:
                self.report_markdown = str(event["report_markdown"])
            if isinstance(event.get("slidev_markdown"), str) and event["slidev_markdown"]:
                self.slidev_markdown = str(event["slidev_markdown"])
            incoming_artifacts = event.get("artifacts")
            if isinstance(incoming_artifacts, Mapping):
                for k, v in incoming_artifacts.items():
                    if isinstance(k, str) and isinstance(v, str) and v:
                        self.artifacts[k] = v
            if isinstance(event.get("summary"), str) and event["summary"]:
                self.summary = str(event["summary"])
            if event.get("error") is not None:
                self.error = str(event["error"]) if event["error"] else None
            terminal_node_status = (
                "cancelled"
                if final_status == "cancelled"
                else "failed"
                if final_status == "failed"
                else "interrupted"
                if final_status == "interrupted"
                else "completed"
            )
            for node in self.nodes.values():
                if node.get("status") == "executing":
                    node["status"] = terminal_node_status
                    node["completed_at"] = node.get("completed_at") or timestamp
            for sk in self.skill_invocations:
                if sk.get("status") == "running":
                    sk["status"] = "completed" if final_status == "completed" else "failed"
                    sk["completed_at"] = timestamp
            self._done.set()

    def snapshot(self, *, include_report: bool = True, include_transcripts: bool = True) -> dict[str, Any]:
        elapsed_ms = (
            int((time.monotonic() - self._started_monotonic) * 1000)
            if self.active
            else int(self.execution_time_ms)
        )
        snap = self._snapshot_fields(elapsed_ms, include_report)
        return snap if include_transcripts else _without_transcripts(snap)

    def _snapshot_fields(self, elapsed_ms: int, include_report: bool) -> dict[str, Any]:
        return {
            "version": 1,
            "session_id": self.session_id,
            "user_id": self.user_id,
            "query": self.query,
            "context": self.context,
            "title": self.title,
            "depth": self.depth,
            "status": self.status,
            "active": self.active,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
            "selection": copy.deepcopy(self.selection),
            "sequence": self.sequence,
            "replay_after": self.replay_after,
            "active_node_path": list(self.active_node_path),
            "completed_nodes": list(self.completed_nodes),
            "failed_nodes": list(self.failed_nodes),
            "execution_order": list(self.execution_order),
            "nodes": copy.deepcopy(self.nodes),
            "handoffs": copy.deepcopy(self.handoffs),
            "citations": copy.deepcopy(self.citations),
            "usage": dict(self.usage),
            "execution_time_ms": elapsed_ms,
            "report_markdown": self.report_markdown if include_report else None,
            "slidev_markdown": self.slidev_markdown if include_report else None,
            "artifacts": copy.deepcopy(self.artifacts),
            "summary": self.summary,
            "error": self.error,
            "skill_invocations": copy.deepcopy(self.skill_invocations),
            "refinement_count": self.refinement_count,
        }

    def check_cursor(self, after: int) -> None:
        if after < 0:
            raise ValueError("after cursor must be >= 0")
        if self._events:
            earliest = int(self._events[0]["sequence"])
            if after < earliest - 1:
                raise ReplayOverflow(after, earliest, self.sequence)
        elif self.sequence > 0 and after < self.sequence:
            raise ReplayOverflow(after, self.sequence + 1, self.sequence)


class DeepResearchRuntime:
    """Server-owned manager for asynchronous Deep Research formation runs, SSE replay, and storage."""

    def __init__(
        self,
        *,
        storage_factory: Callable[[str], Storage] | None = None,
        model_builder: Callable[..., Any] | None = None,
        extra_leaf_tools: Sequence[Any] = (),
        artifacts_dir: Path | str | None = None,
        max_events_per_run: int = 4096,
        execution_timeout: float | None = None,
        node_timeout: float | None = None,
        max_node_executions: int | None = None,
    ) -> None:
        self._storage_factory = storage_factory or get_user_session_storage
        self._model_builder = model_builder
        self._extra_leaf_tools = tuple(extra_leaf_tools)
        self._artifacts_dir: Path = (
            Path(artifacts_dir).expanduser().resolve()
            if artifacts_dir is not None
            else default_artifacts_dir()
        )
        self._max_events_per_run = max(16, int(max_events_per_run))
        self._execution_timeout = (
            float(execution_timeout)
            if execution_timeout is not None
            else float(getattr(app_config, "RON_DEEP_RESEARCH_EXECUTION_TIMEOUT", 1200.0))
        )
        self._node_timeout = (
            float(node_timeout)
            if node_timeout is not None
            else float(getattr(app_config, "RON_DEEP_RESEARCH_NODE_TIMEOUT", 300.0))
        )
        self._max_node_executions = (
            int(max_node_executions)
            if max_node_executions is not None
            else int(getattr(app_config, "RON_DEEP_RESEARCH_MAX_NODE_EXECUTIONS", 16))
        )
        self._runs: dict[tuple[str, str], _DeepResearchRun] = {}
        self._index_locks: dict[str, asyncio.Lock] = {}
        self._closed = False

    @property
    def artifacts_dir(self) -> Path:
        return self._artifacts_dir

    def _session_artifact_dir(self, session_id: str) -> Path:
        return self._artifacts_dir / session_id

    def _ensure_session_artifact_dir(self, session_id: str, user_id: str) -> Path:
        target = self._session_artifact_dir(session_id)
        target.mkdir(parents=True, exist_ok=True)
        owner_file = target / _OWNER_META_FILENAME
        owner_payload = {
            "user_id": (user_id or "").strip() or "default",
            "session_id": session_id,
        }
        owner_file.write_text(json.dumps(owner_payload, ensure_ascii=False), encoding="utf-8")
        return target

    def resolve_artifact_path(
        self,
        *,
        session_id: str,
        relative_path: str,
        user_id: str | None = None,
    ) -> Path | None:
        """Safely resolve a run artifact file inside ``<artifacts_dir>/<session_id>/``.

        Enforces strict ``session_id`` format, rejects NUL bytes, backslashes, absolute paths,
        dotfiles, and ``..`` traversal, verifies ``os.path.realpath`` containment via
        ``os.path.commonpath``, and checks run ownership when a non-``"default"`` ``user_id`` is
        supplied while allowing ``user_id=None`` or ``"default"`` for embedded Slidev sub-assets.
        """
        clean_sid = (session_id or "").strip()
        if not clean_sid or not _SESSION_ID_SAFE_RE.fullmatch(clean_sid):
            return None

        raw_rel = (relative_path or "").strip()
        if not raw_rel or "\x00" in raw_rel or "\\" in raw_rel:
            return None
        if raw_rel.startswith(("/", "~")):
            return None

        parts = [seg for seg in raw_rel.split("/") if seg]
        if not parts:
            return None
        for seg in parts:
            if seg in (".", "..") or seg.startswith("."):
                return None

        try:
            base_real = os.path.realpath(self._artifacts_dir)
            session_real = os.path.realpath(os.path.join(base_real, clean_sid))
            if os.path.commonpath([base_real, session_real]) != base_real or session_real == base_real:
                return None
            if not os.path.isdir(session_real):
                return None

            candidate_real = os.path.realpath(os.path.join(session_real, *parts))
            if (
                os.path.commonpath([session_real, candidate_real]) != session_real
                or candidate_real == session_real
            ):
                return None
            if not os.path.isfile(candidate_real):
                return None
        except (OSError, ValueError):
            return None

        req_user = (user_id or "").strip()
        if req_user and req_user != "default":
            matched_owner: str | None = None
            if (req_user, clean_sid) in self._runs:
                matched_owner = req_user
            else:
                for (live_uid, live_sid) in list(self._runs.keys()):
                    if live_sid == clean_sid:
                        matched_owner = live_uid
                        break
            if matched_owner is None:
                owner_meta_path = os.path.join(session_real, _OWNER_META_FILENAME)
                if os.path.isfile(owner_meta_path):
                    try:
                        with open(owner_meta_path, encoding="utf-8") as fh:
                            owner_data = json.load(fh)
                        if isinstance(owner_data, Mapping) and isinstance(owner_data.get("user_id"), str):
                            matched_owner = owner_data["user_id"].strip() or "default"
                    except Exception:
                        matched_owner = None
            if matched_owner != req_user:
                return None

        return Path(candidate_real)

    def _user_storage(self, user_id: str) -> Storage:
        return self._storage_factory((user_id or "").strip() or "default")

    def _index_lock(self, user_id: str) -> asyncio.Lock:
        clean = (user_id or "").strip() or "default"
        lock = self._index_locks.get(clean)
        if lock is None:
            lock = asyncio.Lock()
            self._index_locks[clean] = lock
        return lock

    @staticmethod
    def _snapshot_key(session_id: str) -> str:
        return f"{_RUNS_STORAGE_PREFIX}/{session_id}/snapshot.json"

    @staticmethod
    def _events_key(session_id: str) -> str:
        return f"{_RUNS_STORAGE_PREFIX}/{session_id}/events.json"

    async def _persist_run(self, run: _DeepResearchRun, *, include_events: bool = False) -> None:
        storage = self._user_storage(run.user_id)
        snap = run.snapshot(include_report=True)
        await storage.write(
            self._snapshot_key(run.session_id),
            json.dumps(snap, ensure_ascii=False).encode("utf-8"),
        )
        if include_events:
            events_payload = list(run._events)
            await storage.write(
                self._events_key(run.session_id),
                json.dumps(events_payload, ensure_ascii=False).encode("utf-8"),
            )

        index_entry = {
            "session_id": run.session_id,
            "user_id": run.user_id,
            "title": run.title,
            "query": run.query,
            "depth": run.depth,
            "status": run.status,
            "active": run.active,
            "created_at": run.created_at,
            "updated_at": run.updated_at,
            "completed_at": run.completed_at,
        }
        async with self._index_lock(run.user_id):
            raw_index = await storage.read(_RUNS_INDEX_KEY)
            entries: list[dict[str, Any]] = []
            if raw_index is not None:
                try:
                    decoded = json.loads(raw_index.decode("utf-8"))
                    if isinstance(decoded, list):
                        entries = [item for item in decoded if isinstance(item, dict)]
                except Exception:
                    entries = []
            entries = [item for item in entries if item.get("session_id") != run.session_id]
            entries.insert(0, index_entry)
            entries.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
            await storage.write(
                _RUNS_INDEX_KEY,
                json.dumps(entries[:250], ensure_ascii=False).encode("utf-8"),
            )

    async def _read_stored_snapshot(
        self,
        *,
        user_id: str,
        session_id: str,
        include_report: bool = True,
        include_transcripts: bool = True,
    ) -> dict[str, Any] | None:
        storage = self._user_storage(user_id)
        raw = await storage.read(self._snapshot_key(session_id))
        if raw is None:
            return None
        try:
            snap = json.loads(raw.decode("utf-8"))
        except Exception:
            return None
        if not isinstance(snap, dict):
            return None
        snap["active"] = False
        if snap.get("status") in ("pending", "executing"):
            snap["status"] = "interrupted"
        snap["artifacts"] = collect_session_artifact_urls(
            session_id,
            self._session_artifact_dir(session_id),
        )
        if not include_report:
            snap["report_markdown"] = None
            snap["slidev_markdown"] = None
        else:
            snap.setdefault("slidev_markdown", "")
        return snap if include_transcripts else _without_transcripts(snap)

    async def _read_stored_events(self, *, user_id: str, session_id: str) -> list[dict[str, Any]] | None:
        storage = self._user_storage(user_id)
        raw = await storage.read(self._events_key(session_id))
        if raw is None:
            return None
        try:
            decoded = json.loads(raw.decode("utf-8"))
            if isinstance(decoded, list):
                return [item for item in decoded if isinstance(item, dict)]
        except Exception:
            return None
        return None

    def _make_model_factory(
        self,
        *,
        provider: str | None,
        model_id: str | None,
        reasoning_effort: str | None,
    ) -> Callable[[], Any]:
        if self._model_builder is not None:
            builder_fn = self._model_builder
            return lambda: builder_fn(
                provider=provider,
                model_id=model_id,
                reasoning_effort=reasoning_effort,
            )
        return lambda: _build_default_model(
            provider=provider,
            model_id=model_id,
            reasoning_effort=reasoning_effort,
        )

    async def start_run(
        self,
        *,
        user_id: str,
        query: str,
        session_id: str | None = None,
        context: str | None = None,
        depth: ResearchDepth = "deep",
        provider: str | None = None,
        model_id: str | None = None,
        reasoning_effort: str | None = None,
    ) -> dict[str, Any]:
        """Launch a new asynchronous Deep Research formation run and return its initial snapshot."""
        if self._closed:
            raise RuntimeError("DeepResearchRuntime is closed")
        clean_user = (user_id or "").strip() or "default"
        clean_query = (query or "").strip()
        if not clean_query:
            raise ValueError("query must not be empty")
        normalized_depth = _normalize_depth(depth)
        resolved_session_id = (
            _validate_session_id(session_id)
            if session_id is not None and session_id.strip()
            else f"dr-{uuid.uuid4().hex[:16]}"
        )
        key = (clean_user, resolved_session_id)
        existing = self._runs.get(key)
        if existing is not None and existing.active:
            raise ValueError(f"Deep Research session {resolved_session_id!r} is already running")

        sel_provider, sel_model, sel_effort = _resolve_default_selection(
            provider=provider,
            model_id=model_id,
            reasoning_effort=reasoning_effort,
        )
        # Validate model factory eagerly when no custom test builder is injected so invalid
        # provider/model errors surface synchronously as HTTP 422.
        model_factory = self._make_model_factory(
            provider=sel_provider,
            model_id=sel_model,
            reasoning_effort=sel_effort,
        )
        initial_model = model_factory()

        selection_dict: dict[str, str | None] = {
            "provider": sel_provider,
            "model_id": sel_model,
            "reasoning_effort": sel_effort,
        }
        run = _DeepResearchRun(
            session_id=resolved_session_id,
            user_id=clean_user,
            query=clean_query,
            context=context,
            depth=normalized_depth,
            selection=selection_dict,
            max_events=self._max_events_per_run,
        )
        self._ensure_session_artifact_dir(resolved_session_id, clean_user)
        self._runs[key] = run

        await run.emit(
            "run_started",
            node_path=[],
            query=clean_query,
            title=run.title,
            depth=normalized_depth,
            selection=selection_dict,
        )
        await self._persist_run(run, include_events=False)

        first_used = False

        def _reuse_first_then_factory() -> Any:
            nonlocal first_used
            if not first_used:
                first_used = True
                return initial_model
            return model_factory()

        run.task = asyncio.create_task(
            self._execute_run(run, model_factory=_reuse_first_then_factory),
            name=f"deep-research-{resolved_session_id}",
        )
        return run.snapshot(include_report=True)

    async def _execute_run(
        self,
        run: _DeepResearchRun,
        *,
        model_factory: Callable[[], Any],
    ) -> None:
        owned_agents: list[Agent] = []
        storage = self._user_storage(run.user_id)
        session_artifact_dir = self._ensure_session_artifact_dir(run.session_id, run.user_id)
        seen_skill_ids: set[str] = set()
        skill_meta: dict[str, tuple[str, float]] = {}
        completed_skill_ids: set[str] = set()
        seen_leaf_tool_completions: set[tuple[str, str]] = set()
        # (skill id, tool use id) -> tool name, for every leaf tool call the stream has announced.
        leaf_tool_names: dict[tuple[str, str], str] = {}
        final_graph_result: Any = None

        prompt_parts = [f"# Deep Research Inquiry\n{run.query}"]
        if run.context:
            prompt_parts.append(f"## Additional User Context & Constraints\n{run.context}")
        prompt_parts.append(
            f"## Execution Parameters\n"
            f"- Research Depth: `{run.depth}`\n"
            f"- Session ID: `{run.session_id}`"
        )
        full_prompt = "\n\n".join(prompt_parts)
        invocation_state: dict[str, Any] = {
            "session_id": run.session_id,
            "user_id": run.user_id,
            "depth": run.depth,
            "max_refinements": _max_refinements_for_depth(run.depth),
        }

        async def _emit_new_citations(raw_citations: Sequence[Mapping[str, str]], path: Sequence[str]) -> None:
            fresh = run.add_citations(raw_citations)
            for cit in fresh:
                await run.emit("citation", node_path=path, citation=cit, **cit)

        async def _on_leaf_artifact_compiled(kind: str, compiled: dict[str, Any]) -> None:
            current_artifacts = collect_session_artifact_urls(run.session_id, session_artifact_dir)
            if not current_artifacts:
                return
            default_node = (
                ["synthesis_formation", "pdf_publisher"]
                if kind == "report_pdf"
                else ["synthesis_formation", "slidev_producer"]
            )
            url_key = "report_pdf_url" if kind == "report_pdf" else "slidev_preview_url"
            extra_fields: dict[str, Any] = {}
            if isinstance(compiled.get("slidev_markdown"), str) and compiled["slidev_markdown"]:
                extra_fields["slidev_markdown"] = str(compiled["slidev_markdown"])
            await run.emit(
                "artifact_ready",
                node_path=list(run.active_node_path) or default_node,
                kind=kind,
                artifact_kind=kind,
                artifact_type=kind,
                artifacts=current_artifacts,
                url=current_artifacts.get(url_key),
                label="Scholarly PDF report ready" if kind == "report_pdf" else "Slidev presentation deck ready",
                **extra_fields,
            )

        async def _handle_agent_event(agent_ev: Mapping[str, Any], path: list[str]) -> None:
            # 1. Child subagent stream events emitted by `make_subagent(name="use_skill", ...)`.
            if agent_ev.get("type") == "tool_stream" or "tool_stream_event" in agent_ev:
                tse = agent_ev.get("tool_stream_event")
                if not isinstance(tse, Mapping):
                    return
                tool_use = tse.get("tool_use")
                if not isinstance(tool_use, Mapping) or tool_use.get("name") != "use_skill":
                    return
                skill_id = str(tool_use.get("toolUseId") or "")
                raw_input = tool_use.get("input")
                inp = raw_input if isinstance(raw_input, Mapping) else {}
                skill_name = str(inp.get("agent_type") or inp.get("preset") or "use_skill")
                task_text = str(inp.get("task") or inp.get("prompt") or "")

                if skill_id and skill_id not in seen_skill_ids:
                    seen_skill_ids.add(skill_id)
                    skill_meta[skill_id] = (skill_name, time.monotonic())
                    await run.emit(
                        "skill_start",
                        node_path=path,
                        skill_id=skill_id,
                        tool_use_id=skill_id,
                        skill_name=skill_name,
                        task=task_text,
                    )

                child_data = tse.get("data")
                if not isinstance(child_data, Mapping):
                    return

                # Text chunks produced by the leaf subagent.
                if isinstance(child_data.get("data"), str) and "tool_stream_event" not in child_data:
                    delta_str = child_data["data"]
                    if delta_str:
                        await run.emit(
                            "skill_delta",
                            node_path=path,
                            skill_id=skill_id,
                            skill_name=skill_name,
                            delta=delta_str,
                        )
                        cits = _extract_citations_from_payload(delta_str, fallback_source=skill_name)
                        if cits:
                            await _emit_new_citations(cits, path)

                # Reasoning produced by the leaf subagent (native `ReasoningTextStreamEvent`).
                child_reasoning = child_data.get("reasoningText")
                if isinstance(child_reasoning, str) and child_reasoning and "tool_stream_event" not in child_data:
                    await run.emit(
                        "reasoning_delta",
                        node_path=path,
                        skill_id=skill_id,
                        skill_name=skill_name,
                        delta=child_reasoning,
                    )

                # A leaf tool call the subagent has begun streaming (native `ToolUseStreamEvent`): it is
                # named here, before its input is complete; the message boundary below adds the input.
                streaming_tool = child_data.get("current_tool_use")
                if isinstance(streaming_tool, Mapping):
                    st_name = str(streaming_tool.get("name") or "")
                    st_id = str(streaming_tool.get("toolUseId") or "")
                    if (
                        st_id
                        and st_name
                        and st_name not in FRAMEWORK_PLUGIN_TOOL_NAMES
                        and (skill_id, st_id) not in leaf_tool_names
                    ):
                        leaf_tool_names[(skill_id, st_id)] = st_name
                        await run.emit(
                            "skill_tool",
                            node_path=path,
                            skill_id=skill_id,
                            tool_use_id=st_id,
                            tool_name=st_name,
                            status="running",
                        )

                # Leaf tool invocations & results inside the leaf subagent.
                child_msg = child_data.get("message")
                if isinstance(child_msg, Mapping):
                    role = child_msg.get("role")
                    blocks = child_msg.get("content")
                    if role == "assistant" and isinstance(blocks, Sequence):
                        for block in blocks:
                            if not isinstance(block, Mapping) or not isinstance(block.get("toolUse"), Mapping):
                                continue
                            tu = block["toolUse"]
                            t_name = str(tu.get("name") or "")
                            if not t_name or t_name in FRAMEWORK_PLUGIN_TOOL_NAMES:
                                continue
                            t_id = str(tu.get("toolUseId") or "")
                            t_inp = tu.get("input")
                            leaf_tool_names[(skill_id, t_id)] = t_name
                            await run.emit(
                                "skill_tool",
                                node_path=path,
                                skill_id=skill_id,
                                tool_use_id=t_id,
                                tool_name=t_name,
                                input=t_inp if isinstance(t_inp, Mapping) else {},
                                input_preview=_preview_json_or_text(t_inp),
                                status="running",
                            )
                    elif role == "user" and isinstance(blocks, Sequence):
                        for block in blocks:
                            if not isinstance(block, Mapping) or not isinstance(block.get("toolResult"), Mapping):
                                continue
                            tr = block["toolResult"]
                            t_id = str(tr.get("toolUseId") or "")
                            dedup_key = (skill_id, t_id)
                            if t_id and dedup_key in seen_leaf_tool_completions:
                                continue
                            if t_id:
                                seen_leaf_tool_completions.add(dedup_key)
                            tr_text = _extract_tool_result_text(tr)
                            # A result whose call was never announced belongs to a framework plugin tool:
                            # it is not a tool row, but its text is still read for citations.
                            if dedup_key in leaf_tool_names:
                                tr_status = "failed" if str(tr.get("status") or "").lower() == "error" else "completed"
                                tr_output, tr_truncated = _tool_output_text(tr)
                                await run.emit(
                                    "skill_tool",
                                    node_path=path,
                                    skill_id=skill_id,
                                    tool_use_id=t_id,
                                    tool_name=leaf_tool_names[dedup_key],
                                    status=tr_status,
                                    output_preview=_preview_json_or_text(tr_text),
                                    output=tr_output,
                                    output_truncated=tr_truncated,
                                )
                            cits = _extract_citations_from_payload(tr_text, fallback_source=skill_name)
                            if cits:
                                await _emit_new_citations(cits, path)

                if isinstance(child_data.get("tool_result"), Mapping):
                    tr = child_data["tool_result"]
                    t_id = str(tr.get("toolUseId") or "")
                    dedup_key = (skill_id, t_id)
                    if not t_id or dedup_key not in seen_leaf_tool_completions:
                        if t_id:
                            seen_leaf_tool_completions.add(dedup_key)
                        tr_text = _extract_tool_result_text(tr)
                        if dedup_key in leaf_tool_names:
                            tr_status = "failed" if str(tr.get("status") or "").lower() == "error" else "completed"
                            tr_output, tr_truncated = _tool_output_text(tr)
                            await run.emit(
                                "skill_tool",
                                node_path=path,
                                skill_id=skill_id,
                                tool_use_id=t_id,
                                tool_name=leaf_tool_names[dedup_key],
                                status=tr_status,
                                output_preview=_preview_json_or_text(tr_text),
                                output=tr_output,
                                output_truncated=tr_truncated,
                            )
                        cits = _extract_citations_from_payload(tr_text, fallback_source=skill_name)
                        if cits:
                            await _emit_new_citations(cits, path)
                return

            # 2. Orchestrator message boundaries (catch `use_skill` start/stop even when 0 stream chunks fired).
            orch_msg = agent_ev.get("message")
            if isinstance(orch_msg, Mapping):
                role = orch_msg.get("role")
                blocks = orch_msg.get("content")
                if role == "assistant" and isinstance(blocks, Sequence):
                    for block in blocks:
                        if not isinstance(block, Mapping) or not isinstance(block.get("toolUse"), Mapping):
                            continue
                        tu = block["toolUse"]
                        if tu.get("name") != "use_skill":
                            continue
                        skill_id = str(tu.get("toolUseId") or "")
                        inp = tu.get("input") if isinstance(tu.get("input"), Mapping) else {}
                        skill_name = str(inp.get("agent_type") or inp.get("preset") or "use_skill")
                        task_text = str(inp.get("task") or inp.get("prompt") or "")
                        if skill_id and skill_id not in seen_skill_ids:
                            seen_skill_ids.add(skill_id)
                            skill_meta[skill_id] = (skill_name, time.monotonic())
                            await run.emit(
                                "skill_start",
                                node_path=path,
                                skill_id=skill_id,
                                tool_use_id=skill_id,
                                skill_name=skill_name,
                                task=task_text,
                            )
                elif role == "user" and isinstance(blocks, Sequence):
                    for block in blocks:
                        if not isinstance(block, Mapping) or not isinstance(block.get("toolResult"), Mapping):
                            continue
                        tr = block["toolResult"]
                        skill_id = str(tr.get("toolUseId") or "")
                        if skill_id in seen_skill_ids and skill_id not in completed_skill_ids:
                            completed_skill_ids.add(skill_id)
                            sk_name, started_t = skill_meta.get(skill_id, ("use_skill", time.monotonic()))
                            dur_ms = max(0, int((time.monotonic() - started_t) * 1000))
                            tr_text = _extract_tool_result_text(tr)
                            sk_status = "failed" if str(tr.get("status") or "").lower() == "error" else "completed"
                            cits = _extract_citations_from_payload(tr_text, fallback_source=sk_name)
                            if cits:
                                await _emit_new_citations(cits, path)
                            await run.emit(
                                "skill_stop",
                                node_path=path,
                                skill_id=skill_id,
                                tool_use_id=skill_id,
                                skill_name=sk_name,
                                status=sk_status,
                                duration_ms=dur_ms,
                                summary=_preview_json_or_text(tr_text, max_chars=320),
                            )

            if isinstance(agent_ev.get("tool_result"), Mapping):
                tr = agent_ev["tool_result"]
                skill_id = str(tr.get("toolUseId") or "")
                if skill_id in seen_skill_ids and skill_id not in completed_skill_ids:
                    completed_skill_ids.add(skill_id)
                    sk_name, started_t = skill_meta.get(skill_id, ("use_skill", time.monotonic()))
                    dur_ms = max(0, int((time.monotonic() - started_t) * 1000))
                    tr_text = _extract_tool_result_text(tr)
                    sk_status = "failed" if str(tr.get("status") or "").lower() == "error" else "completed"
                    cits = _extract_citations_from_payload(tr_text, fallback_source=sk_name)
                    if cits:
                        await _emit_new_citations(cits, path)
                    await run.emit(
                        "skill_stop",
                        node_path=path,
                        skill_id=skill_id,
                        tool_use_id=skill_id,
                        skill_name=sk_name,
                        status=sk_status,
                        duration_ms=dur_ms,
                        summary=_preview_json_or_text(tr_text, max_chars=320),
                    )

            # 3. Direct orchestrator reasoning and text streaming.
            orch_reasoning = agent_ev.get("reasoningText")
            if isinstance(orch_reasoning, str) and orch_reasoning:
                await run.emit("reasoning_delta", node_path=path, delta=orch_reasoning)

            if isinstance(agent_ev.get("data"), str):
                delta = agent_ev["data"]
                if delta:
                    leaf_node_id = path[-1] if path else ""
                    is_report_stream = bool(
                        path and path[0] == "synthesis_formation" and leaf_node_id in SYNTHESIS_PROSE_NODES
                    )
                    is_slidev_stream = bool(
                        path and path[0] == "synthesis_formation" and leaf_node_id == "slidev_producer"
                    )
                    await run.emit(
                        "text_delta",
                        node_path=path,
                        delta=delta,
                        is_report=is_report_stream,
                        is_slidev=is_slidev_stream,
                    )
                    cits = _extract_citations_from_payload(delta, fallback_source="/".join(path))
                    if cits:
                        await _emit_new_citations(cits, path)

        async def _handle_multiagent_event(raw_ev: Mapping[str, Any], parent_path: list[str]) -> None:
            nonlocal final_graph_result
            ev_type = str(raw_ev.get("type") or "")

            if ev_type == "multiagent_node_start":
                node_id = str(raw_ev.get("node_id") or "")
                full_path = [*parent_path, node_id]
                node_kind = _resolve_node_kind(node_id, raw_ev.get("node_type"))
                await run.emit(
                    "node_start",
                    node_path=full_path,
                    node_id=node_id,
                    node_type=node_kind,
                )
                return

            if ev_type == "multiagent_node_stream":
                node_id = str(raw_ev.get("node_id") or "")
                inner = raw_ev.get("event")
                if not isinstance(inner, Mapping):
                    return
                child_path = [*parent_path, node_id]
                inner_type = str(inner.get("type") or "")
                if inner_type.startswith("multiagent_"):
                    await _handle_multiagent_event(inner, child_path)
                else:
                    await _handle_agent_event(inner, child_path)
                return

            if ev_type == "multiagent_handoff":
                from_ids = [str(x) for x in (raw_ev.get("from_node_ids") or [])]
                to_ids = [str(x) for x in (raw_ev.get("to_node_ids") or [])]
                await run.emit(
                    "node_handoff",
                    node_path=parent_path,
                    from_node_ids=from_ids,
                    to_node_ids=to_ids,
                    from_node=from_ids[0] if from_ids else "agent",
                    to_node=to_ids[0] if to_ids else "agent",
                    message=str(raw_ev.get("message") or ""),
                )
                return

            if ev_type == "multiagent_node_cancel":
                node_id = str(raw_ev.get("node_id") or "")
                msg = str(raw_ev.get("message") or "Node cancelled")
                await run.emit(
                    "node_cancel",
                    node_path=[*parent_path, node_id] if node_id else parent_path,
                    node_id=node_id,
                    reason=msg,
                    message=msg,
                )
                return

            if ev_type == "multiagent_node_interrupt":
                node_id = str(raw_ev.get("node_id") or "")
                interrupts = raw_ev.get("interrupts") or []
                reason = f"Interrupted ({len(interrupts)} interrupt(s))" if isinstance(interrupts, Sequence) else "Interrupted"
                await run.emit(
                    "node_interrupt",
                    node_path=[*parent_path, node_id] if node_id else parent_path,
                    node_id=node_id,
                    reason=reason,
                )
                return

            if ev_type == "multiagent_node_stop":
                node_id = str(raw_ev.get("node_id") or "")
                full_path = [*parent_path, node_id]
                node_kind = _resolve_node_kind(node_id)
                node_res = raw_ev.get("node_result")
                raw_status = getattr(node_res, "status", Status.COMPLETED)
                status_str = str(getattr(raw_status, "value", raw_status)).lower()
                if run.cancel_event.is_set() and status_str in ("failed", "cancelled", "canceled"):
                    status_str = "cancelled"
                exec_ms = int(getattr(node_res, "execution_time", 0) or 0)
                full_node_text = _extract_node_result_text(node_res) if isinstance(node_res, NodeResult) else ""
                preview_text = full_node_text[:400]
                if full_path == ["synthesis_formation", "executive_editor"] and full_node_text:
                    run.report_markdown = full_node_text
                    run._report_source_node = "executive_editor"
                elif (
                    full_path == ["synthesis_formation", "slidev_producer"]
                    and full_node_text
                    and "---" in full_node_text
                    and not (session_artifact_dir / "slides.md").is_file()
                ):
                    run.slidev_markdown = full_node_text
                usage_payload: dict[str, int] | None = None
                if node_kind == "agent":
                    acc = getattr(node_res, "accumulated_usage", None)
                    if isinstance(acc, Mapping):
                        in_t = int(acc.get("inputTokens") or 0)
                        out_t = int(acc.get("outputTokens") or 0)
                        tot_t = int(acc.get("totalTokens") or (in_t + out_t))
                        if tot_t > 0:
                            usage_payload = {
                                "inputTokens": in_t,
                                "outputTokens": out_t,
                                "totalTokens": tot_t,
                            }
                await run.emit(
                    "node_stop",
                    node_path=full_path,
                    node_id=node_id,
                    node_type=node_kind,
                    status=status_str,
                    execution_time_ms=exec_ms,
                    output_preview=preview_text,
                    **({"usage": usage_payload} if usage_payload is not None else {}),
                )
                await self._persist_run(run, include_events=False)
                return

            if ev_type == "multiagent_result" and not parent_path:
                final_graph_result = raw_ev.get("result")

        try:
            graph = build_deep_research_graph(
                session_id=run.session_id,
                user_id=run.user_id,
                storage=storage,
                model_factory=model_factory,
                depth=run.depth,
                execution_timeout=self._execution_timeout,
                node_timeout=self._node_timeout,
                max_node_executions=self._max_node_executions,
                cancel_event=run.cancel_event,
                owned_agents=owned_agents,
                extra_leaf_tools=self._extra_leaf_tools,
                artifacts_dir=self._artifacts_dir,
                default_report_getter=lambda: run.report_markdown,
                default_title_getter=lambda: run.title,
                default_query_getter=lambda: run.query,
                default_citations_getter=lambda: run.citations,
                on_artifact_compiled=_on_leaf_artifact_compiled,
            )

            async for stream_event in graph.stream_async(full_prompt, invocation_state=invocation_state):
                if isinstance(stream_event, Mapping):
                    await _handle_multiagent_event(stream_event, [])

            elapsed_ms = max(1, int((time.monotonic() - run._started_monotonic) * 1000))

            # Extract authoritative final report from synthesis_formation when available.
            extracted_report = run.report_markdown.strip()
            if final_graph_result is not None:
                results_dict = getattr(final_graph_result, "results", None)
                if isinstance(results_dict, Mapping) and "synthesis_formation" in results_dict:
                    syn_node_res = results_dict["synthesis_formation"]
                    syn_inner = getattr(syn_node_res, "result", None)
                    syn_inner_results = getattr(syn_inner, "results", None)
                    if isinstance(syn_inner_results, Mapping) and "executive_editor" in syn_inner_results:
                        ed_text = _extract_node_result_text(syn_inner_results["executive_editor"])
                        if ed_text:
                            extracted_report = ed_text
                    elif isinstance(syn_node_res, NodeResult):
                        fallback_syn = _extract_node_result_text(syn_node_res)
                        if fallback_syn and not extracted_report:
                            extracted_report = fallback_syn

            if extracted_report:
                cits = _extract_citations_from_payload(extracted_report, fallback_source="report")
                if cits:
                    await _emit_new_citations(cits, ["synthesis_formation", "executive_editor"])

            raw_graph_status = getattr(final_graph_result, "status", Status.COMPLETED)
            graph_status_str = str(getattr(raw_graph_status, "value", raw_graph_status)).lower()
            if run.cancel_requested or run.cancel_event.is_set():
                final_status = "cancelled"
            elif graph_status_str == "interrupted":
                final_status = "interrupted"
            elif graph_status_str == "failed":
                final_status = "failed"
            else:
                final_status = "completed"

            # Runtime guarantee: materialize report.pdf + Slidev deck before run_finished even if
            # a scripted test model returned Markdown prose directly without calling leaf build tools.
            if final_status == "completed" and not (run.cancel_requested or run.cancel_event.is_set()):
                effective_report_body = extracted_report or f"# {run.title}\n\n{run.query}"
                if not (session_artifact_dir / "report.pdf").is_file() or not (
                    session_artifact_dir / "report.md"
                ).is_file():
                    try:
                        compiled_pdf = await compile_scholarly_pdf_files(
                            artifact_dir=session_artifact_dir,
                            markdown_content=effective_report_body,
                            title=run.title,
                            query=run.query,
                            depth=run.depth,
                            citations=run.citations,
                        )
                        await _on_leaf_artifact_compiled("report_pdf", compiled_pdf)
                    except Exception as pdf_exc:
                        logger.warning(
                            "Fallback report.pdf compilation failed for %s: %s",
                            run.session_id,
                            pdf_exc,
                        )

                if (
                    not (session_artifact_dir / "slides.md").is_file()
                    or not (session_artifact_dir / "slides" / "index.html").is_file()
                    or not (session_artifact_dir / "slides.pdf").is_file()
                ):
                    try:
                        candidate_slides_md = (
                            run.slidev_markdown.strip()
                            if "---" in run.slidev_markdown
                            else synthesize_slidev_markdown(
                                report_markdown=effective_report_body,
                                title=run.title,
                                query=run.query,
                                citations=run.citations,
                            )
                        )
                        compiled_slides = await compile_slidev_deck_files(
                            artifact_dir=session_artifact_dir,
                            slides_markdown=candidate_slides_md,
                            title=run.title,
                            query=run.query,
                        )
                        await _on_leaf_artifact_compiled("slidev_deck", compiled_slides)
                    except Exception as slidev_exc:
                        logger.warning(
                            "Fallback Slidev compilation failed for %s: %s",
                            run.session_id,
                            slidev_exc,
                        )

            final_slides_md = run.slidev_markdown
            slides_disk_path = session_artifact_dir / "slides.md"
            if slides_disk_path.is_file():
                try:
                    final_slides_md = slides_disk_path.read_text(encoding="utf-8")
                except OSError:
                    pass
            final_artifacts = collect_session_artifact_urls(run.session_id, session_artifact_dir)

            summary_text = _summarize_markdown(
                extracted_report,
                fallback=f"Deep Research {final_status} ({len(run.citations)} citations).",
            )
            error_msg = (
                "Research run cancelled"
                if final_status == "cancelled"
                else (run.error or "Deep Research formation failed")
                if final_status == "failed"
                else None
            )

            await run.emit(
                "run_finished",
                node_path=[],
                status=final_status,
                execution_time_ms=elapsed_ms,
                report_markdown=extracted_report,
                slidev_markdown=final_slides_md,
                artifacts=final_artifacts,
                summary=summary_text,
                citations=copy.deepcopy(run.citations),
                usage=dict(run.usage),
                error=error_msg,
            )
            await self._persist_run(run, include_events=True)

        except asyncio.CancelledError:
            run.cancel_requested = True
            run.cancel_event.set()
            elapsed_ms = max(1, int((time.monotonic() - run._started_monotonic) * 1000))
            if run.active:
                await run.emit(
                    "run_finished",
                    node_path=[],
                    status="cancelled",
                    execution_time_ms=elapsed_ms,
                    report_markdown=run.report_markdown,
                    slidev_markdown=run.slidev_markdown,
                    artifacts=collect_session_artifact_urls(run.session_id, session_artifact_dir),
                    summary=run.summary or "Research run cancelled.",
                    citations=copy.deepcopy(run.citations),
                    usage=dict(run.usage),
                    error="Research run cancelled",
                )
                await self._persist_run(run, include_events=True)
        except Exception as exc:
            logger.exception("Deep Research run %s failed: %s", run.session_id, exc)
            elapsed_ms = max(1, int((time.monotonic() - run._started_monotonic) * 1000))
            final_status = "cancelled" if (run.cancel_requested or run.cancel_event.is_set()) else "failed"
            err_str = "Research run cancelled" if final_status == "cancelled" else str(exc)
            if final_status == "failed":
                await run.emit("error", node_path=list(run.active_node_path), error=err_str, message=err_str)
            if run.active:
                await run.emit(
                    "run_finished",
                    node_path=[],
                    status=final_status,
                    execution_time_ms=elapsed_ms,
                    report_markdown=run.report_markdown,
                    slidev_markdown=run.slidev_markdown,
                    artifacts=collect_session_artifact_urls(run.session_id, session_artifact_dir),
                    summary=run.summary or err_str[:240],
                    citations=copy.deepcopy(run.citations),
                    usage=dict(run.usage),
                    error=err_str,
                )
                await self._persist_run(run, include_events=True)
        finally:
            run._done.set()
            if owned_agents:
                await asyncio.to_thread(_cleanup_agents_sync, owned_agents)

    async def get_run(
        self,
        *,
        user_id: str,
        session_id: str,
        include_report: bool = True,
    ) -> dict[str, Any] | None:
        """Return the live or persisted snapshot for ``(user_id, session_id)``, or ``None``."""
        clean_user = (user_id or "").strip() or "default"
        clean_sid = (session_id or "").strip()
        if not clean_sid:
            return None
        live = self._runs.get((clean_user, clean_sid))
        if live is not None:
            return live.snapshot(include_report=include_report)
        return await self._read_stored_snapshot(
            user_id=clean_user,
            session_id=clean_sid,
            include_report=include_report,
        )

    async def list_runs(
        self,
        *,
        user_id: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List active and persisted Deep Research runs for ``user_id``, newest first."""
        clean_user = (user_id or "").strip() or "default"
        bounded = max(1, min(200, int(limit)))
        merged: dict[str, dict[str, Any]] = {}

        for (u_id, s_id), live_run in list(self._runs.items()):
            if u_id == clean_user:
                merged[s_id] = live_run.snapshot(include_report=False, include_transcripts=False)

        storage = self._user_storage(clean_user)
        raw_index = await storage.read(_RUNS_INDEX_KEY)
        if raw_index is not None:
            try:
                index_items = json.loads(raw_index.decode("utf-8"))
            except Exception:
                index_items = []
            if isinstance(index_items, list):
                for entry in index_items:
                    if not isinstance(entry, dict):
                        continue
                    sid = str(entry.get("session_id") or "").strip()
                    if not sid or sid in merged:
                        continue
                    stored = await self._read_stored_snapshot(
                        user_id=clean_user,
                        session_id=sid,
                        include_report=False,
                        include_transcripts=False,
                    )
                    if stored is not None:
                        merged[sid] = stored

        ordered = sorted(
            merged.values(),
            key=lambda item: str(item.get("created_at") or ""),
            reverse=True,
        )
        return ordered[:bounded]

    async def cancel_run(
        self,
        *,
        user_id: str,
        session_id: str,
    ) -> dict[str, Any] | None:
        """Cooperatively and immediately cancel an active Deep Research run."""
        clean_user = (user_id or "").strip() or "default"
        clean_sid = (session_id or "").strip()
        if not clean_sid:
            return None
        live = self._runs.get((clean_user, clean_sid))
        if live is None:
            return await self._read_stored_snapshot(
                user_id=clean_user,
                session_id=clean_sid,
                include_report=False,
            )
        if not live.active:
            return live.snapshot(include_report=False)

        live.cancel_requested = True
        live.cancel_event.set()
        if live.task is not None and not live.task.done():
            # Give cooperative BeforeNodeCallEvent cancellation a brief window, then cancel the task
            # if blocked inside a slow model/tool await.
            try:
                await asyncio.wait_for(asyncio.shield(live.task), timeout=0.15)
            except asyncio.TimeoutError:
                live.task.cancel()
                try:
                    await asyncio.wait_for(asyncio.shield(live.task), timeout=3.0)
                except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                    pass
            except (asyncio.CancelledError, Exception):
                pass
        return live.snapshot(include_report=False)

    async def delete_run(
        self,
        *,
        user_id: str,
        session_id: str,
    ) -> bool:
        """Cancel (if active) and delete all snapshots, event logs, and session state for ``session_id``."""
        clean_user = (user_id or "").strip() or "default"
        clean_sid = (session_id or "").strip()
        if not clean_sid:
            return False

        existed = False
        live = self._runs.get((clean_user, clean_sid))
        if live is not None:
            existed = True
            if live.active:
                await self.cancel_run(user_id=clean_user, session_id=clean_sid)
            self._runs.pop((clean_user, clean_sid), None)

        storage = self._user_storage(clean_user)
        snap_key = self._snapshot_key(clean_sid)
        if await storage.read(snap_key) is not None:
            existed = True

        for key in (snap_key, self._events_key(clean_sid)):
            try:
                await storage.delete(key)
            except Exception:
                pass

        async with self._index_lock(clean_user):
            raw_index = await storage.read(_RUNS_INDEX_KEY)
            if raw_index is not None:
                try:
                    decoded = json.loads(raw_index.decode("utf-8"))
                except Exception:
                    decoded = None
                if isinstance(decoded, list):
                    filtered = [
                        item for item in decoded if isinstance(item, dict) and item.get("session_id") != clean_sid
                    ]
                    if len(filtered) != len(decoded):
                        existed = True
                    await storage.write(
                        _RUNS_INDEX_KEY,
                        json.dumps(filtered, ensure_ascii=False).encode("utf-8"),
                    )

        if _SESSION_ID_SAFE_RE.fullmatch(clean_sid):
            try:
                sm = SnapshotSessionManager(session_id=clean_sid, storage=storage)
                await sm.delete_session()
            except Exception:
                logger.debug("SnapshotSessionManager cleanup skipped for %s", clean_sid, exc_info=True)

            artifact_dir = self._session_artifact_dir(clean_sid)
            if artifact_dir.is_dir():
                owner_ok = True
                owner_file = artifact_dir / _OWNER_META_FILENAME
                if owner_file.is_file():
                    try:
                        owner_data = json.loads(owner_file.read_text(encoding="utf-8"))
                        owner_uid = str(owner_data.get("user_id") or "default").strip() or "default"
                        if owner_uid != clean_user:
                            owner_ok = False
                    except Exception:
                        pass
                if owner_ok:
                    existed = True
                    shutil.rmtree(artifact_dir, ignore_errors=True)

        return existed

    async def events(
        self,
        *,
        user_id: str,
        session_id: str,
        after: int = 0,
    ) -> AsyncIterator[dict[str, Any]]:
        """Replay retained events strictly after ``after`` and follow live updates until ``run_finished``."""
        if after < 0:
            raise ValueError("after cursor must be >= 0")
        clean_user = (user_id or "").strip() or "default"
        clean_sid = (session_id or "").strip()
        live = self._runs.get((clean_user, clean_sid))

        if live is None:
            stored_snap = await self._read_stored_snapshot(
                user_id=clean_user,
                session_id=clean_sid,
                include_report=True,
            )
            if stored_snap is None:
                raise KeyError(f"Unknown Deep Research session: {clean_sid!r}")
            stored_events = await self._read_stored_events(user_id=clean_user, session_id=clean_sid)
            latest_seq = int(stored_snap.get("sequence") or 0)
            if stored_events:
                earliest_seq = int(stored_events[0].get("sequence") or 1)
                if after < earliest_seq - 1:
                    raise ReplayOverflow(after, earliest_seq, latest_seq)
                for ev in stored_events:
                    if int(ev.get("sequence") or 0) > after:
                        yield ev
                return
            if latest_seq > 0 and after < latest_seq:
                raise ReplayOverflow(after, latest_seq + 1, latest_seq)
            return

        cursor = int(after)
        while True:
            async with live._lock:
                live.check_cursor(cursor)
                batch = [copy.deepcopy(ev) for ev in live._events if int(ev["sequence"]) > cursor]
                ended = not live.active
                live._changed.clear()

            for ev in batch:
                cursor = int(ev["sequence"])
                yield ev
                if ev.get("type") == "run_finished":
                    return

            if ended:
                return
            await live._changed.wait()

    async def sse(
        self,
        *,
        user_id: str,
        session_id: str,
        after: int = 0,
    ) -> AsyncIterator[str]:
        """Format :meth:`events` as versioned Server-Sent Event frames (``id: <seq>\\ndata: <json>\\n\\n``)."""
        async for event in self.events(user_id=user_id, session_id=session_id, after=after):
            seq = int(event["sequence"])
            payload = json.dumps(event, ensure_ascii=False)
            yield f"id: {seq}\ndata: {payload}\n\n"

    async def wait_run(
        self,
        *,
        user_id: str,
        session_id: str,
        timeout: float | None = None,
    ) -> dict[str, Any] | None:
        """Wait for a run to finish (shielding the background task) and return its final snapshot."""
        clean_user = (user_id or "").strip() or "default"
        clean_sid = (session_id or "").strip()
        live = self._runs.get((clean_user, clean_sid))
        if live is None:
            return await self._read_stored_snapshot(
                user_id=clean_user,
                session_id=clean_sid,
                include_report=True,
            )
        if live.active:
            if timeout is not None:
                await asyncio.wait_for(live._done.wait(), timeout=timeout)
            else:
                await live._done.wait()
        if live.task is not None and live.task.done():
            try:
                await live.task
            except (asyncio.CancelledError, Exception):
                pass
        return live.snapshot(include_report=True)

    async def aclose(self) -> None:
        """Cancel all active runs and release runtime resources cleanly during app shutdown."""
        self._closed = True
        active_runs = [run for run in self._runs.values() if run.active]
        for run in active_runs:
            run.cancel_requested = True
            run.cancel_event.set()
            if run.task is not None and not run.task.done():
                run.task.cancel()
        if active_runs:
            await asyncio.gather(
                *(run.task for run in active_runs if run.task is not None),
                return_exceptions=True,
            )


def _cleanup_agents_sync(agents: Sequence[Agent]) -> None:
    seen: set[int] = set()
    for agent in agents:
        obj_id = id(agent)
        if obj_id in seen:
            continue
        seen.add(obj_id)
        try:
            agent.cleanup()
        except Exception:
            logger.debug("Agent cleanup error ignored", exc_info=True)


_runtime_lock = threading.Lock()
_default_runtime: DeepResearchRuntime | None = None


def get_deep_research_runtime() -> DeepResearchRuntime:
    """Return the process-wide singleton :class:`DeepResearchRuntime`."""
    global _default_runtime
    with _runtime_lock:
        if _default_runtime is None:
            _default_runtime = DeepResearchRuntime()
        return _default_runtime


def set_deep_research_runtime(runtime: DeepResearchRuntime | None) -> None:
    """Install or clear the process-wide :class:`DeepResearchRuntime` (used by FastAPI lifespan & tests)."""
    global _default_runtime
    with _runtime_lock:
        _default_runtime = runtime


__all__ = [
    "DEEP_RESEARCH_SKILLS_DIR",
    "FORMATION_TOPOLOGY",
    "ORCHESTRATOR_IDS",
    "ReplayOverflow",
    "ResearchDepth",
    "VALID_DEPTHS",
    "DeepResearchMultiAgentPlugin",
    "DeepResearchRuntime",
    "all_investigation_branches_completed",
    "build_deep_research_graph",
    "build_leaf_tool_pool",
    "collect_session_artifact_urls",
    "compile_scholarly_pdf_files",
    "compile_slidev_deck_files",
    "default_artifacts_dir",
    "ensure_slidev_headmatter",
    "get_deep_research_runtime",
    "get_formation_topology",
    "load_deep_research_skills",
    "set_deep_research_runtime",
    "should_refine",
    "should_synthesize",
    "synthesize_slidev_markdown",
]
