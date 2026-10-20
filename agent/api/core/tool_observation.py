"""Tool observation (CAT-49): record each tool call's outcome through native SDK surfaces.

The SDK already emits an OpenTelemetry ``execute_tool`` span per call (``telemetry/tracer.py``,
with ``gen_ai.tool.name``/``gen_ai.tool.call.id`` and, under
``OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental``, the arguments and result) and the
panel Agent's ``trace_attributes`` (``session.id``/``user.id``) land on every one of them. That
span is closed before ``AfterToolCallEvent`` fires, so this hook adds a span *event* with the
outcome (``status``, ``exception``, ``duration``, ``retry``) to the enclosing cycle span and
flags failures in ``agent.state`` so the runtime, evals and a future repair flow can find them
without new types.

``RON_TOOL_OBSERVATION=1`` additionally wires ``strands_evals``'
``StrandsEvalsTelemetry().setup_in_memory_exporter()`` once per process so spans can be mapped
back to sessions (``StrandsInMemorySessionMapper``) for diagnosis.

Provenance (CAT-50 prerequisite): each outcome also names the registered tool's
``implementation`` class, the ``wrapped`` chain (only ``tool_repair._AdaptedTool`` exposes
``.wrapped``: a user's active adapter revision around the registered tool) and the ``source``
file of the innermost callable (vendored path relative to ``PROJECT_TOOLS_DIR`` plus its
``sha256``), so a repair can tell an adapter defect from a library defect.
"""

from __future__ import annotations

import hashlib
import inspect
import logging
import os
import threading
from pathlib import Path
from typing import Any

from opentelemetry import trace as trace_api
from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry

logger = logging.getLogger(__name__)

#: ``agent.state`` key: ``{"count": int, "last": {...}}`` for failed tool calls in this session.
TOOL_FAILURES_STATE_KEY = "panel.tool_failures"
#: Hook order after the runtime's own hooks (``panel_runtime._HOOK_ORDER`` = 200).
OBSERVATION_HOOK_ORDER = 300
#: Span event name on the enclosing (cycle) span.
TOOL_OUTCOME_EVENT = "ron.tool.outcome"
#: Attribute stamped by ``PanelToolCatalog.stage_tool`` (and the repair loader) on adapted tools:
#: ``(absolute file path, sha256)`` of the file actually imported.
SOURCE_ATTRIBUTE = "__ron_source__"
_MAX_EXCEPTION_CHARS = 500
_MAX_WRAPPED = 8

_exporter_lock = threading.Lock()
_exporter: Any = None


def observation_enabled() -> bool:
    return os.getenv("RON_TOOL_OBSERVATION", "").strip().lower() in {"1", "true", "yes"}


def trace_attributes(*, session_id: str, user_id: str) -> dict[str, str]:
    """``Agent(trace_attributes=)`` for the panel agent: the SDK copies these onto every span."""
    return {"session.id": session_id, "user.id": user_id}


def file_sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _tools_dir() -> Path:
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR

    return PROJECT_TOOLS_DIR


def wrapped_chain(tool: Any) -> list[Any]:
    """``[outermost, ..., innermost]`` following ``.wrapped`` (``tool_repair._AdaptedTool``)."""
    chain: list[Any] = []
    current = tool
    while current is not None and len(chain) < _MAX_WRAPPED:
        chain.append(current)
        current = getattr(current, "wrapped", None)
        if any(current is seen for seen in chain):
            break
    return chain


def _innermost_callable(tool: Any) -> Any:
    """The Python function a native function tool wraps, or ``None`` for MCP/agent/opaque tools."""
    # DecoratedFunctionTool applies functools.update_wrapper, so __wrapped__ is public API;
    # PythonAgentTool (TOOL_SPEC modules) exposes only _tool_func.
    for name in ("__wrapped__", "_tool_func"):
        function = getattr(tool, name, None)
        if callable(function):
            return function
    return None


def tool_source(tool: Any) -> dict[str, Any] | None:
    """``{"path": <relative or absolute>, "sha256": ...}`` for the innermost implementation file.

    A ``__ron_source__`` stamp (set by the catalog loader / repair loader) wins because dynamically
    loaded revisions may live outside the library tree; otherwise ``inspect.getsourcefile`` of the
    innermost callable is used. Paths under ``PROJECT_TOOLS_DIR`` are made relative to it.
    """
    chain = wrapped_chain(tool)
    for item in chain:
        stamp = getattr(item, SOURCE_ATTRIBUTE, None)
        if isinstance(stamp, tuple) and len(stamp) == 2:
            return {"path": _relative(Path(str(stamp[0]))), "sha256": str(stamp[1])}
    inner = chain[-1] if chain else None
    function = _innermost_callable(inner)
    if function is None:
        return None
    try:
        filename = inspect.getsourcefile(function) or inspect.getfile(function)
    except (TypeError, OSError):
        return None
    if not filename:
        return None
    path = Path(filename)
    try:
        digest = file_sha256(path)
    except OSError:
        return None
    return {"path": _relative(path), "sha256": digest}


def _relative(path: Path) -> str:
    try:
        resolved = path.resolve()
        root = _tools_dir().resolve()
        if resolved.is_relative_to(root):
            return resolved.relative_to(root).as_posix()
        return str(resolved)
    except Exception:  # pragma: no cover - defensive: provenance must never break a tool call
        return str(path)


def is_library_tool(tool: Any) -> bool:
    """True when the innermost implementation file is in ``agent/tools/strands_tools``."""
    source = tool_source(tool)
    return source is not None and not Path(source["path"]).is_absolute()


def tool_provenance(tool: Any) -> dict[str, Any]:
    chain = wrapped_chain(tool)
    return {
        "implementation": type(tool).__name__ if tool is not None else None,
        "wrapped": [type(item).__name__ for item in chain[1:]],
        "source": tool_source(tool) if tool is not None else None,
    }


def tool_outcome(event: AfterToolCallEvent) -> dict[str, Any]:
    """The compact, JSON-safe record of one tool call's outcome (plus provenance)."""
    result = event.result if isinstance(event.result, dict) else {}
    exception = event.exception
    return {
        "tool_name": str(event.tool_use.get("name", "")),
        "toolUseId": str(event.tool_use.get("toolUseId", "")),
        "status": str(result.get("status", "error" if exception is not None else "")),
        "exception": (f"{type(exception).__name__}: {exception}"[:_MAX_EXCEPTION_CHARS] if exception is not None else None),
        "duration": event.duration,
        "retry": bool(event.retry),
        "cancelled": event.cancel_message is not None,
        **tool_provenance(event.selected_tool),
    }


def redact_outcome(outcome: dict[str, Any], tool_use: dict[str, Any] | None = None) -> dict[str, Any]:
    """What may leave the user's session for diagnosis: tool name, argument **keys and types**,
    exception class/message, status, duration and provenance. Argument values and result text
    are dropped."""
    inputs = (tool_use or {}).get("input") if isinstance(tool_use, dict) else None
    arg_types = {str(key): type(value).__name__ for key, value in (inputs or {}).items()} if isinstance(inputs, dict) else {}
    exception = outcome.get("exception")
    exception_class = exception.split(":", 1)[0] if isinstance(exception, str) and exception else None
    return {
        "tool_name": outcome.get("tool_name"),
        "status": outcome.get("status"),
        "exception_class": exception_class,
        "exception": exception,
        "duration": outcome.get("duration"),
        "retry": outcome.get("retry"),
        "arg_types": arg_types,
        "implementation": outcome.get("implementation"),
        "wrapped": list(outcome.get("wrapped") or []),
        "source": outcome.get("source"),
    }


class ToolObservation(HookProvider):
    """One ``AfterToolCallEvent`` callback: outcome -> span event + ``agent.state`` failure flag."""

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(AfterToolCallEvent, self.after_tool_call, order=OBSERVATION_HOOK_ORDER)

    def after_tool_call(self, event: AfterToolCallEvent) -> None:
        outcome = tool_outcome(event)
        span = trace_api.get_current_span()
        if span.is_recording():
            attributes = {f"ron.tool.{key}": value for key, value in outcome.items()
                          if value is not None and key not in ("wrapped", "source")}
            # OTEL attributes are scalars or homogeneous sequences: flatten provenance.
            attributes["ron.tool.wrapped"] = ",".join(outcome["wrapped"])
            if outcome["source"] is not None:
                attributes["ron.tool.source"] = outcome["source"]["path"]
                attributes["ron.tool.source_sha256"] = outcome["source"]["sha256"]
            attributes.update(getattr(event.agent, "trace_attributes", None) or {})  # BidiAgent has none
            span.add_event(TOOL_OUTCOME_EVENT, attributes=attributes)  # type: ignore[arg-type]
        failed = outcome["status"] != "success" or outcome["exception"] is not None
        if not failed:
            return
        previous = event.agent.state.get(TOOL_FAILURES_STATE_KEY) or {}
        event.agent.state.set(TOOL_FAILURES_STATE_KEY, {
            "count": int(previous.get("count", 0)) + 1,
            "last": outcome,
        })
        logger.warning("tool_name=<%s>, tool_use_id=<%s>, status=<%s>, exception=<%s> | tool call failed",
                       outcome["tool_name"], outcome["toolUseId"], outcome["status"], outcome["exception"])


def setup_evals_exporter() -> Any:
    """Wire ``strands_evals``' in-memory span exporter once per process (``RON_TOOL_OBSERVATION=1``).

    Returns the exporter, or ``None`` when observation is off or the package is not installed.
    """
    global _exporter
    if not observation_enabled():
        return None
    with _exporter_lock:
        if _exporter is not None:
            return _exporter
        try:
            from strands_evals.telemetry import StrandsEvalsTelemetry
        except ImportError:
            logger.warning("RON_TOOL_OBSERVATION=1 but strands-agents-evals is not installed; spans are not retained")
            return None
        telemetry = StrandsEvalsTelemetry()
        _exporter = telemetry.setup_in_memory_exporter()
        logger.info("in-memory span exporter configured for tool observation")
        return _exporter


__all__ = [
    "OBSERVATION_HOOK_ORDER", "SOURCE_ATTRIBUTE", "TOOL_FAILURES_STATE_KEY", "TOOL_OUTCOME_EVENT",
    "ToolObservation", "file_sha256", "is_library_tool", "observation_enabled", "redact_outcome",
    "setup_evals_exporter", "tool_outcome", "tool_provenance", "tool_source", "trace_attributes", "wrapped_chain",
]
