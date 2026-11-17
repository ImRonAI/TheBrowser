"""The tools Ren's agents start, check and cancel a Deep Research run with.

Each returns a plain JSON ``dict``. ``deep_research_start`` returns as soon as the run has started.
"""

from __future__ import annotations


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
    "\n\n## Deep Research\n"
    "- For an investigation that needs many sources, fact checks, charts, a cited PDF report and a Slidev deck, "
    "call `deep_research_start(query, context=\"\", depth=\"deep\")` (`depth`: `\"standard\"`, `\"deep\"` or "
    "`\"exhaustive\"`). It runs in the background and returns `session_id` and `ron://research/<session_id>` at once.\n"
    "- `deep_research_status(session_id=...)` says how the run stands and lists its workspace files (omit "
    "`session_id` to list recent runs); `deep_research_cancel(session_id=...)` stops it."
)


def deep_research_tools(*, user_id: str = "default") -> list[AgentTool]:
    """The three Deep Research tools for ``user_id`` (none while ``RON_DEEP_RESEARCH_ENABLED`` is off)."""
    if not app_config.deep_research_enabled():
        return []
    owner = (user_id or "").strip() or "default"

    @tool
    async def deep_research_start(query: str, context: str = "", depth: str = "deep") -> dict[str, object]:
        """Start a Deep Research run in the background: research, charts, a cited PDF report and a Slidev deck.

        Args:
            query: The research question.
            context: Background, constraints or prior findings.
            depth: "standard", "deep" (default) or "exhaustive".
        """
        from agent.api.core import deep_research

        chosen = next((value for value in deep_research.VALID_DEPTHS if value == depth.strip().lower()), None)
        if not query.strip() or chosen is None:
            return {"status": "invalid_argument", "error": f"query is required and depth is one of {list(deep_research.VALID_DEPTHS)}."}
        try:
            meta = await deep_research.start_run(user_id=owner, query=query.strip(), context=context.strip(), depth=chosen)
        except ValueError as error:
            return {"status": "unavailable", "error": str(error)}
        session_id = meta["session_id"]
        return {**meta, "url": f"ron://research/{session_id}"}

    @tool
    async def deep_research_status(session_id: str = "") -> dict[str, object]:
        """How a Deep Research run stands and its workspace files; without ``session_id``, the 20 latest runs.

        Args:
            session_id: The run's id from ``deep_research_start``.
        """
        from agent.api.core import deep_research

        if not session_id.strip():
            return {"runs": await deep_research.list_runs(user_id=owner, limit=20)}
        run = await deep_research.get_run(user_id=owner, session_id=session_id.strip())
        if run is None:
            return {"status": "not_found", "session_id": session_id}
        run.pop("events", None)
        return {**run, "url": f"ron://research/{session_id.strip()}", "workspace": str(deep_research.artifacts_dir(session_id.strip()))}

    @tool
    async def deep_research_cancel(session_id: str) -> dict[str, object]:
        """Cancel a Deep Research run.

        Args:
            session_id: The run's id from ``deep_research_start``.
        """
        from agent.api.core import deep_research

        meta = await deep_research.cancel_run(user_id=owner, session_id=session_id.strip())
        if meta is None:
            return {"status": "not_found", "session_id": session_id}
        return {**meta}

    return [deep_research_start, deep_research_status, deep_research_cancel]
