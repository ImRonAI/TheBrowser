"""Native async Strands ``@tool`` functions for Ren's Deep Research formation.

Registered across all 8 Ren agent composition roots (Agent Panel, Gemini Live ``BidiAgent``,
specialist/harness agents + Context Agent, Project Agent, Issue Chat Agent, Autonomous Issue
Agent, Build Agent, and Browser Search Agent).

Every tool returns a plain JSON-serializable ``dict`` (never image blocks and never
``tool_context.interrupt``), making the toolset 100% compatible with Gemini Live ``BidiAgent``,
unattended cloud takeover (``UnattendedRunGuard``), A2A specialists, and foreground/background
Strands ``Agent`` loops. ``deep_research_start`` launches the nested Strands formation on
``DeepResearchRuntime`` and returns immediately without blocking the caller turn.
"""

from __future__ import annotations

import re
from typing import Any, cast

from strands import tool
from strands.types.tools import AgentTool

from agent.api.core import config as app_config

DEEP_RESEARCH_TOOL_NAMES: frozenset[str] = frozenset(
    {
        "deep_research_start",
        "deep_research_status",
        "deep_research_cancel",
    }
)


def is_deep_research_tool(name: str) -> bool:
    """True when ``name`` is one of the parent-only Deep Research orchestration tools."""
    return name in DEEP_RESEARCH_TOOL_NAMES


DEEP_RESEARCH_DIRECTIVE: str = (
    "\n\n## Deep Research (Asynchronous Formation)\n"
    "- For complex, multi-faceted investigations requiring literature review, multi-source triangulation, "
    "adversarial verification, a scholarly PDF report, and a Slidev presentation deck, call "
    "`deep_research_start(query, context=\"\", depth=\"deep\")` (`depth`: `\"standard\"` | `\"deep\"` | `\"exhaustive\"`).\n"
    "- `deep_research_start` launches the Deep Research formation asynchronously in the background and returns "
    "`session_id` and `ron://research/<session_id>` immediately without blocking — share the `ron://research/<session_id>` "
    "link or continue other work.\n"
    "- Call `deep_research_status(session_id=...)` to check live formation stage progress, citations, completed "
    "`report_markdown`, and `artifacts` URLs (`report.pdf` + `Slidev` deck), or omit `session_id` to list recent runs; "
    "call `deep_research_cancel(session_id=...)` to stop an active run."
)

_SLIDEV_HEADING_RE = re.compile(r"^#{1,2}\s+(.+)$", re.MULTILINE)
_SLIDEV_DIVIDER_RE = re.compile(r"(?m)^---\s*$")


def _summarize_slidev_markdown(slidev_md: str) -> dict[str, Any]:
    """Extract a compact summary (slide count + top slide titles) from Slidev markdown."""
    cleaned = slidev_md.strip()
    if not cleaned:
        return {"present": False, "slide_count": 0, "headings": []}
    # Strip optional leading YAML frontmatter block (`--- ... ---`) before counting slide dividers.
    body = cleaned
    if body.startswith("---"):
        parts = _SLIDEV_DIVIDER_RE.split(body, maxsplit=2)
        if len(parts) >= 3:
            body = parts[2].strip()
    slides = [chunk.strip() for chunk in _SLIDEV_DIVIDER_RE.split(body) if chunk.strip()]
    headings = [m.group(1).strip() for m in _SLIDEV_HEADING_RE.finditer(body) if m.group(1).strip()]
    return {
        "present": True,
        "slide_count": max(1, len(slides)),
        "headings": headings[:12],
    }


def deep_research_tools(
    *,
    user_id: str = "default",
    provider: str | None = None,
    model_id: str | None = None,
) -> list[AgentTool]:
    """Build user-bound async Deep Research tools (empty when ``RON_DEEP_RESEARCH_ENABLED`` is disabled)."""
    if not app_config.deep_research_enabled():
        return []

    resolved_user_id = (user_id or "").strip() or "default"
    resolved_provider = (provider or "").strip() or app_config.RON_DEEP_RESEARCH_PROVIDER
    resolved_model_id = (model_id or "").strip() or app_config.RON_DEEP_RESEARCH_MODEL

    @tool
    async def deep_research_start(
        query: str,
        context: str = "",
        depth: str = "deep",
    ) -> dict[str, Any]:
        """Start a multi-stage Deep Research formation run asynchronously in the background.

        Launches the nested planning, parallel investigation, adversarial verification, and synthesis
        formations (producing a cited scholarly PDF report and Slidev presentation deck) without
        blocking the current turn. Returns immediately with ``session_id`` and a
        ``ron://research/<session_id>`` link that opens the live research view.

        Args:
            query: The primary research question or investigation brief.
            context: Optional background constraints, scope notes, or prior findings.
            depth: Research depth preset: "standard", "deep" (default), or "exhaustive".
        """
        if not app_config.deep_research_enabled():
            return {
                "status": "disabled",
                "available": False,
                "error": "Deep Research is currently disabled.",
            }

        clean_query = (query or "").strip()
        if not clean_query:
            return {
                "status": "invalid_argument",
                "error": "query must not be empty.",
            }

        from agent.api.core.deep_research import VALID_DEPTHS, ResearchDepth, get_deep_research_runtime

        clean_depth = (depth or "deep").strip().lower()
        if clean_depth not in VALID_DEPTHS:
            return {
                "status": "invalid_argument",
                "error": f"depth must be one of {list(VALID_DEPTHS)}.",
            }

        runtime = get_deep_research_runtime()
        snapshot = await runtime.start_run(
            user_id=resolved_user_id,
            query=clean_query,
            context=(context or "").strip() or None,
            depth=cast(ResearchDepth, clean_depth),
            provider=resolved_provider,
            model_id=resolved_model_id,
        )
        sid = str(snapshot["session_id"])
        actual_depth = str(snapshot.get("depth") or clean_depth)
        return {
            "session_id": sid,
            "status": snapshot.get("status", "executing"),
            "title": snapshot.get("title") or clean_query[:80],
            "depth": actual_depth,
            "url": f"ron://research/{sid}",
            "active_node_path": list(snapshot.get("active_node_path") or []),
            "message": (
                f"Deep Research run '{sid}' started in the background (depth={actual_depth}). "
                f"Open ron://research/{sid} for live progress or call deep_research_status(session_id='{sid}')."
            ),
        }

    @tool
    async def deep_research_status(
        session_id: str = "",
        include_report: bool = True,
    ) -> dict[str, Any]:
        """Inspect live progress, citations, artifacts, or final report of a Deep Research run without blocking.

        When ``session_id`` is omitted or blank, lists the user's 20 most recent Deep Research runs.
        When ``session_id`` is provided, returns the run's current formation status, active stage path,
        completed/failed nodes, citations, token usage, ``artifacts`` URLs (scholarly ``report.pdf`` and
        Slidev deck), ``slidev_summary``, and ``report_markdown`` once completed.

        Args:
            session_id: Run identifier returned by ``deep_research_start`` (omit to list recent runs).
            include_report: Include full ``report_markdown`` and ``slidev_markdown`` when completed (default True).
        """
        if not app_config.deep_research_enabled():
            return {
                "status": "disabled",
                "available": False,
                "error": "Deep Research is currently disabled.",
            }

        from agent.api.core.deep_research import get_deep_research_runtime

        runtime = get_deep_research_runtime()
        clean_id = (session_id or "").strip()
        if not clean_id:
            runs = await runtime.list_runs(user_id=resolved_user_id, limit=20)
            return {"runs": runs}

        snapshot = await runtime.get_run(
            user_id=resolved_user_id,
            session_id=clean_id,
            include_report=include_report,
        )
        if snapshot is None:
            return {"status": "not_found", "session_id": clean_id}

        resolved_sid = str(snapshot.get("session_id") or clean_id)
        artifacts = dict(snapshot.get("artifacts") or {})
        raw_slidev = snapshot.get("slidev_markdown")
        slidev_text = raw_slidev if isinstance(raw_slidev, str) else ""
        slidev_info = _summarize_slidev_markdown(slidev_text)

        result: dict[str, Any] = {
            "session_id": resolved_sid,
            "title": snapshot.get("title") or "",
            "query": snapshot.get("query") or "",
            "depth": snapshot.get("depth") or "deep",
            "url": f"ron://research/{resolved_sid}",
            "status": snapshot.get("status", "unknown"),
            "active": bool(snapshot.get("active", False)),
            "active_node_path": list(snapshot.get("active_node_path") or []),
            "completed_nodes": list(snapshot.get("completed_nodes") or []),
            "failed_nodes": list(snapshot.get("failed_nodes") or []),
            "execution_order": list(snapshot.get("execution_order") or []),
            "nodes": dict(snapshot.get("nodes") or {}),
            "handoffs": list(snapshot.get("handoffs") or []),
            "citations": list(snapshot.get("citations") or []),
            "usage": dict(snapshot.get("usage") or {}),
            "execution_time_ms": snapshot.get("execution_time_ms", 0),
            "summary": snapshot.get("summary"),
            "error": snapshot.get("error"),
            "artifacts": artifacts,
            "has_slidev_markdown": bool(
                slidev_info["present"]
                or artifacts.get("slidev_markdown_url")
                or artifacts.get("slidev_preview_url")
            ),
            "slidev_summary": slidev_info,
        }
        if include_report and (
            snapshot.get("status") == "completed" or snapshot.get("report_markdown") is not None
        ):
            result["report_markdown"] = snapshot.get("report_markdown")
        if include_report and slidev_text:
            result["slidev_markdown"] = slidev_text
        return result

    @tool
    async def deep_research_cancel(session_id: str) -> dict[str, Any]:
        """Cancel an active Deep Research formation run.

        Args:
            session_id: Run identifier returned by ``deep_research_start``.
        """
        if not app_config.deep_research_enabled():
            return {
                "status": "disabled",
                "available": False,
                "error": "Deep Research is currently disabled.",
            }

        clean_id = (session_id or "").strip()
        if not clean_id:
            return {
                "status": "invalid_argument",
                "session_id": "",
                "cancelled": False,
                "error": "session_id must not be empty.",
            }

        from agent.api.core.deep_research import get_deep_research_runtime

        runtime = get_deep_research_runtime()
        snapshot = await runtime.cancel_run(user_id=resolved_user_id, session_id=clean_id)
        if snapshot is None:
            return {
                "status": "not_found",
                "session_id": clean_id,
                "cancelled": False,
            }
        return {
            "session_id": str(snapshot.get("session_id") or clean_id),
            "status": snapshot.get("status", "cancelled"),
            "active": bool(snapshot.get("active", False)),
            "cancelled": True,
        }

    return [deep_research_start, deep_research_status, deep_research_cancel]
