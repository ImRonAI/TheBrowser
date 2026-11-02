"""Tool-failure guidance for the agent whose tool failed.

The repair itself is owned by :mod:`agent.api.core.tool_repair`: ``ToolRepairTrigger`` (a native
``AfterToolCallEvent`` hook) records every failure here and starts one bounded background
investigation per ``(user, tool)`` through :class:`~agent.api.core.tool_repair.RepairService`.
This module only renders what the *originating* agent should do next through a native
``ContextInjector`` (``everyTurn``): never repeat a side-effecting action on the live browser,
never claim a tool is fixed before it has been called again, and leave approval to the user
(the fixer parks its ``apply_repair`` call on a native HumanInTheLoop interrupt that the panel
resolves; nothing here contacts another agent or asks for approval).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from strands.hooks.events import AfterToolCallEvent
from strands.vended_plugins.context_injector import ContextInjector, InjectionContext

logger = logging.getLogger(__name__)

FAILURE_STATE_KEY = "panel.tool_failure"

#: Guidance phases written by :func:`observe_tool` / :func:`note_repair`.
PHASES = ("retry", "investigating", "approval", "confirm", "done", "failed", "blocked", "declined")


def _input_visible(tool_use: dict[str, Any]) -> bool:
    raw = tool_use.get("input")
    return isinstance(raw, dict) and len(raw) > 0


def _guidance(agent: Any) -> dict[str, Any]:
    current = agent.state.get(FAILURE_STATE_KEY)
    return dict(current) if isinstance(current, dict) else {}


def observe_tool(event: AfterToolCallEvent, outcome: dict[str, Any], *, count: int | None,
                 escalate: bool = False, side_effecting: bool = False) -> None:
    """Record the native hook outcome the context injector reads.

    ``count is None`` means the call did not fail: a success of the tool under repair after an
    applied revision closes the loop (``confirm`` -> ``done``). A failure records the error and
    the phase: ``retry`` when the agent may safely call the tool once more with reviewed
    parameters (idempotent tool, parameters visible, below the threshold), else
    ``investigating`` — the trigger has started the background fixer.
    """
    name = str(outcome.get("tool_name") or "")
    guide = _guidance(event.agent)
    if count is None:
        if outcome.get("status") == "success" and guide.get("phase") == "confirm" and guide.get("tool_name") == name:
            guide["phase"] = "done"
            event.agent.state.set(FAILURE_STATE_KEY, guide)
        return
    if outcome.get("cancelled") or outcome.get("retry"):
        return
    visible = _input_visible(dict(event.tool_use))
    errors = [str(item) for item in (guide.get("errors") or []) if guide.get("tool_name") == name]
    errors.append(str(outcome.get("exception") or outcome.get("status") or "error")[:500])
    phase = "investigating" if escalate or not visible or side_effecting else "retry"
    record: dict[str, Any] = {
        "tool_name": name,
        "count": count,
        "input_visible": visible,
        "side_effecting": side_effecting,
        "errors": errors[-4:],
        "input": event.tool_use.get("input") if visible else None,
        "failing_tool_use_id": outcome.get("toolUseId"),
        "phase": phase,
    }
    # A later guidance update (ready / applied / failed) keeps the revision it refers to.
    if guide.get("tool_name") == name and guide.get("revision"):
        record["revision"] = guide["revision"]
    event.agent.state.set(FAILURE_STATE_KEY, record)


def note_repair(agent: Any, tool_name: str, *, phase: str, revision: str | None = None,
                summary: str | None = None) -> None:
    """The repair service reports the investigation's state back into the originating agent.

    ``approval``: a verified revision awaits the user's decision in the panel. ``confirm``: the
    user approved and the revision is live from the next invocation; the agent must call the
    tool again before saying it is fixed. ``failed`` / ``blocked`` / ``declined``: tell the user.
    """
    if phase not in PHASES:
        raise ValueError(f"phase must be one of {PHASES}")
    guide = _guidance(agent)
    if guide.get("tool_name") != tool_name:
        guide = {"tool_name": tool_name, "errors": [], "input": None}
    guide["phase"] = phase
    if revision:
        guide["revision"] = revision
    if summary is not None:
        guide["summary"] = summary[:500]
    agent.state.set(FAILURE_STATE_KEY, guide)


def failure_guidance(context: InjectionContext) -> str | None:
    """``ContextInjector`` render. Empty when there is nothing for the agent to do."""
    record = context.state.get(FAILURE_STATE_KEY)
    if not isinstance(record, dict):
        return None
    phase = record.get("phase")
    name = record.get("tool_name") or "the tool"
    revision = record.get("revision") or ""
    rev = f" (revision {revision})" if revision else ""
    if phase == "retry":
        return (
            f"The tool {name} failed ({record.get('errors', [''])[-1]}). "
            "You may call it once more after reviewing its parameters against the tool specification. "
            f"Parameters from the failed call: {json.dumps(record.get('input'), ensure_ascii=False)}. "
            "If it fails again, an investigation starts automatically; do not keep retrying."
        )
    if phase == "investigating":
        return (
            f"The tool {name} failed ({record.get('errors', [''])[-1]}). Ron's fixer is investigating it in an "
            "isolated environment; the user will see the result in the panel and decide whether to apply a repair. "
            "Do not call this tool again now"
            + (" — it has side effects on the user's browser or data" if record.get("side_effecting") else "")
            + ". Continue the user's request another way where possible, otherwise tell the user what failed."
        )
    if phase == "approval":
        return (
            f"The fixer verified a repair of {name}{rev}; it waits for the user's approval in the panel. "
            "Do not tell the user the tool is fixed and do not apply anything yourself."
        )
    if phase == "confirm":
        return (
            f"The repair of {name}{rev} was approved and is active from this invocation. Call {name} again now "
            f"with the same request as the failure ({json.dumps(record.get('input'), ensure_ascii=False)}) "
            "before you tell the user it is fixed. If that call fails, it is not fixed."
        )
    if phase == "declined":
        return f"The user declined the repair of {name}{rev}. Do not retry the tool; tell the user it remains unavailable."
    if phase in ("failed", "blocked"):
        return (
            f"The fixer could not verify a repair of {name}{rev}"
            + (f": {record['summary']}" if record.get("summary") else "")
            + ". Tell the user. Do not say the tool is fixed."
        )
    return None


def failure_guidance_injector() -> ContextInjector:
    """Native every-turn injector. The text is not written into the session."""
    return ContextInjector(failure_guidance, trigger="everyTurn", name="ron:tool-failure")


__all__ = ["FAILURE_STATE_KEY", "PHASES", "failure_guidance", "failure_guidance_injector", "note_repair", "observe_tool"]
