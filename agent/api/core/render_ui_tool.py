"""``render_ui``: the agent builds an interactive view and the Agent Panel renders it.

A core tool on every Ron agent (text, Live, learned-skill and specialist children). The result
is a native tool result whose content holds one ``json`` block ``{"ui": {...}}``: the panel
runtime forwards ``content`` verbatim (``panel_runtime._tool_result``) and the SDK stores it in
the thread, so the view renders live and again from history with no side channel.

Two formats:

* ``html`` — a complete document shown in a sandboxed iframe (``srcdoc``). Scripts run inside
  the sandbox, so the view can use the YouTube IFrame Player API, fetch public JSON, keep local
  state, and so on. ``window.parent.postMessage({type: "ron:ui_action", action, payload}, "*")``
  from the document reaches the agent as a user turn ``[ui_action <view_id>] ...``.
* ``jsx`` — a JSX fragment rendered in the panel with the AI Elements kit (Card, Carousel, Workflow,
  Button, Badge, …). Expressions are not executed: it is markup only, for static layouts.

The tool validates size and shape only; the renderer is the sandbox.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Literal

from strands import tool

MAX_BYTES = 400_000
_FORMATS = ("html", "jsx")
_HTML_HINT = re.compile(r"<\s*(html|body|div|section|main|iframe|script|style)\b", re.IGNORECASE)

_RENDER_UI_GUIDE = """
When the outcome of a task is something the user looks at or interacts with (a list of videos
to watch, a comparison, a ranked set of options, a form, a dashboard, a gallery), do not describe
it in prose: build it with render_ui. Prefer format="html" with a complete, self-contained
document (inline CSS and JS, dark/light friendly, responsive, full width). Embedded players and
third-party widgets (YouTube IFrame Player API, maps, charts) belong in the html document. Add
controls that collect the user's judgement (thumbs up/down, ranking, free-text feedback) and
send them with window.parent.postMessage({type: "ron:ui_action", action, payload}, "*"); you
receive each action as a user turn "[ui_action <view_id>] action=<action> payload=<json>".
Record what the user liked and disliked with add_memory so the next run starts from their
preferences. Use render_ui again to update the view; the newest render replaces the previous
one with the same view_id.
When the answer is a process, plan, pipeline, approval path or decision flow (what happens first,
what follows, where it branches, how it ends), call render_workflow so the user sees a flowchart
instead of a numbered list. Pick the shape that says what each step is (start/end, step, decision,
delay, subprocess, manual, automation, io, document, data) and label the arrows out of decisions.
"""

_ACTION_LABEL = re.compile(r"^[a-z][a-z0-9_:-]{0,63}$")
_STEP_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$")
_EDGE_TYPES = ("animated", "temporary")
_STEP_TEXT = {"description": 300, "content": 2000, "footer": 300}
#: Flowchart shapes the renderer draws (src/lib/workflow.ts WORKFLOW_STEP_KINDS). "step" is the AI Elements Node card.
STEP_KINDS = ("start", "end", "step", "decision", "delay", "subprocess", "manual", "automation", "io", "document", "data")
#: Other names models use for the same symbols (mirrors KIND_ALIASES in src/lib/workflow.ts).
_KIND_ALIASES = {
    "begin": "start", "trigger": "start", "terminator": "start", "finish": "end", "stop": "end", "done": "end",
    "process": "step", "task": "step", "action": "step", "activity": "step",
    "condition": "decision", "gateway": "decision", "choice": "decision", "branch": "decision",
    "wait": "delay", "timer": "delay", "pause": "delay",
    "predefined": "subprocess", "sub-process": "subprocess", "subroutine": "subprocess", "call": "subprocess",
    "human": "manual", "manual-task": "manual", "manual_task": "manual", "approval": "manual",
    "automated": "automation", "system": "automation", "ai": "automation", "agent": "automation", "script": "automation",
    "input": "io", "output": "io", "input/output": "io", "input-output": "io", "data_io": "io", "form": "io",
    "doc": "document", "report": "document", "file": "document",
    "database": "data", "datastore": "data", "data-store": "data", "data_store": "data", "storage": "data", "store": "data",
}
MAX_EDGE_LABEL = 40


def workflow_kind(value: Any) -> str | None:
    """A shape name or alias -> its canonical kind; anything else -> None (the renderer infers it)."""
    if not isinstance(value, str):
        return None
    name = value.strip().lower()
    return name if name in STEP_KINDS else _KIND_ALIASES.get(name)
MAX_STEPS = 60
MAX_CONNECTIONS = 200


@tool
async def render_ui(format: Literal["html", "jsx"], source: str, title: str = "",
                    view_id: str = "", height: int = 520) -> dict[str, Any]:
    """Render an interactive view in the Agent Panel from HTML or JSX that you write.

    Use this for anything the user should see or interact with instead of describing it:
    carousels of videos with embedded players, ranked lists with thumbs up/down, comparison
    tables, forms, dashboards, galleries. ``html`` is a complete self-contained document shown
    in a sandboxed iframe where scripts run (YouTube IFrame Player API, fetch to public JSON,
    local state). Interactions call ``window.parent.postMessage({type:"ron:ui_action", action,
    payload}, "*")`` and arrive back to you as a user turn ``[ui_action <view_id>] ...``. ``jsx``
    is static markup rendered with the panel's component kit (Card, CardHeader, CardTitle,
    CardContent, Badge, Button, Carousel, CarouselContent, CarouselItem, CarouselPrevious,
    CarouselNext, the workflow kit Workflow / WorkflowNode / WorkflowEdge, plus plain HTML tags); JSX
    expressions are not executed. For a diagram of steps, prefer render_workflow.

    Args:
        format: "html" for a complete document in a sandboxed iframe, "jsx" for static markup.
        source: The full HTML document or the JSX fragment (at most 400 KB).
        title: Short caption shown above the view.
        view_id: Reuse the id of an earlier render to replace that view in place; leave empty for a new view.
        height: Initial iframe height in CSS pixels for html views (240–2000); the view may request more by posting {type:"ron:ui_resize", height}.
    """
    if format not in _FORMATS:
        raise ValueError(f"format must be one of {_FORMATS}")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("source must be a non-empty string")
    if len(source.encode("utf-8")) > MAX_BYTES:
        raise ValueError(f"source exceeds {MAX_BYTES} bytes; split the view or load data at runtime")
    if format == "html" and not _HTML_HINT.search(source):
        raise ValueError("html source must be a document or fragment containing HTML elements")
    view = _view(format, source, title, view_id, height)
    return {"status": "success", "content": [
        {"json": {"ui": view}},
        {"text": f"Rendered {format} view {view['view_id']}" + (f": {view['title']}" if view["title"] else "") + ". "
                 "The user can see it now; interactions arrive as [ui_action] turns."},
    ]}


def _view(format: str, source: str, title: str, view_id: str, height: int) -> dict[str, Any]:
    identifier = view_id.strip() if isinstance(view_id, str) and view_id.strip() else "v" + uuid.uuid4().hex[:11]
    if not _ACTION_LABEL.match(identifier):
        raise ValueError("view_id must match ^[a-z][a-z0-9_:-]{0,63}$")
    return {"view_id": identifier, "format": format, "title": (title or "").strip()[:200],
            "source": source, "height": max(240, min(int(height), 2000))}


def _jsx_value(value: Any) -> str:
    """A JSX attribute as an expression container holding a JSON literal (quotes and braces stay inert)."""
    return "{" + json.dumps(value, ensure_ascii=False) + "}"


def _workflow_steps(steps: Any) -> list[dict[str, str]]:
    if not isinstance(steps, list) or not steps:
        raise ValueError("steps must be a non-empty list of {id, label, ...}")
    if len(steps) > MAX_STEPS:
        raise ValueError(f"a workflow holds at most {MAX_STEPS} steps; split it into stages")
    result, seen = [], set()
    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            raise ValueError(f"steps[{index}] must be an object with id and label")
        step_id, label = step.get("id"), step.get("label")
        if not isinstance(step_id, str) or not _STEP_ID.match(step_id):
            raise ValueError(f"steps[{index}].id must match ^[A-Za-z0-9][A-Za-z0-9_.:-]{{0,63}}$")
        if step_id in seen:
            raise ValueError(f"duplicate step id {step_id!r}")
        if not isinstance(label, str) or not label.strip() or len(label) > 120:
            raise ValueError(f"steps[{index}].label must be 1-120 characters")
        seen.add(step_id)
        clean = {"id": step_id, "label": label.strip()}
        kind = workflow_kind(step.get("kind"))
        if kind:
            clean["kind"] = kind
        for field, limit in _STEP_TEXT.items():
            value = step.get(field)
            if value is None or value == "":
                continue
            if not isinstance(value, str) or len(value) > limit:
                raise ValueError(f"steps[{index}].{field} must be text of at most {limit} characters")
            clean[field] = value.strip()
        result.append(clean)
    return result


def _workflow_connections(connections: Any, step_ids: list[str]) -> list[dict[str, str]]:
    if connections is None:
        return [{"source": a, "target": b, "type": "animated"} for a, b in zip(step_ids, step_ids[1:])]
    if not isinstance(connections, list) or len(connections) > MAX_CONNECTIONS:
        raise ValueError(f"connections must be a list of at most {MAX_CONNECTIONS} {{source, target, type}}")
    known, result, seen = set(step_ids), [], set()
    for index, connection in enumerate(connections):
        if not isinstance(connection, dict):
            raise ValueError(f"connections[{index}] must be an object with source and target")
        source, target = connection.get("source"), connection.get("target")
        kind = connection.get("type") or "animated"
        if source not in known or target not in known:
            raise ValueError(f"connections[{index}] must join two step ids from steps")
        if source == target:
            raise ValueError(f"connections[{index}] cannot connect a step to itself")
        if kind not in _EDGE_TYPES:
            raise ValueError(f"connections[{index}].type must be one of {_EDGE_TYPES}")
        if (source, target) in seen:
            continue
        seen.add((source, target))
        clean = {"source": source, "target": target, "type": kind}
        label = connection.get("label")
        if isinstance(label, str) and label.strip():
            clean["label"] = label.strip()[:MAX_EDGE_LABEL]
        result.append(clean)
    return result


def workflow_jsx(title: str, steps: list[dict[str, str]], connections: list[dict[str, str]]) -> str:
    """The JSX the panel's JSX Preview renders with the AI Elements workflow kit (Workflow, WorkflowNode, WorkflowEdge)."""
    lines = [f"<Workflow title={_jsx_value(title)}>"]
    for step in steps:
        attributes = " ".join(f"{key}={_jsx_value(value)}" for key, value in step.items())
        lines.append(f"  <WorkflowNode {attributes} />")
    for connection in connections:
        attributes = " ".join(f"{key}={_jsx_value(value)}" for key, value in connection.items())
        lines.append(f"  <WorkflowEdge {attributes} />")
    lines.append("</Workflow>")
    return "\n".join(lines)


@tool
async def render_workflow(title: str, steps: list[dict[str, Any]], connections: list[dict[str, Any]] | None = None,
                          view_id: str = "") -> dict[str, Any]:
    """Draw a flowchart (shapes joined by arrows) the user can see; project documents and issues save it as a workflow block.

    Use this whenever a process, plan, pipeline, approval path or decision flow is easier to grasp as a
    diagram: what happens first, what follows, where it branches and how it ends. It is drawn with the AI
    Elements workflow components (Canvas, Node, Edge), laid out left to right in dependency order.

    Args:
        title: Caption shown above the workflow.
        steps: The workflow steps in reading order. Each is {"id": "short-unique-id", "label": "Step name",
            "kind": "<shape>", "description": "one-line summary", "content": "what happens in this step",
            "footer": "owner, duration or status"}; only id and label are required. Shapes ("kind"):
            "start" / "end" (rounded terminators: the trigger and the finish), "step" (a card for work with
            details), "decision" (diamond: a question; label its outgoing arrows, e.g. "Yes" / "No"),
            "delay" (waiting on someone, a date or a timer), "subprocess" (a process defined elsewhere),
            "manual" (done by a person by hand), "automation" (done by a system, script or Ren),
            "io" (input or output: a form, an email, a request), "document" (a document or report),
            "data" (a database, spreadsheet or system of record). Without a kind, a step with no incoming
            arrow is drawn as a start, one with no outgoing arrow as an end, anything else as a step.
        connections: Arrows between steps, each {"source": "<step id>", "target": "<step id>",
            "type": "animated" | "temporary", "label": "short text"}. "animated" (default) is the main path;
            "temporary" (dashed) is a conditional, optional or error path; "label" (up to 40 characters) names
            the branch. Omit connections to join the steps one after another in the order given.
        view_id: Reuse the id of an earlier render to replace that workflow in place; leave empty for a new view.
    """
    clean_title = (title or "").strip()
    if not clean_title:
        raise ValueError("title must be a short caption for the workflow")
    clean_steps = _workflow_steps(steps)
    clean_connections = _workflow_connections(connections, [step["id"] for step in clean_steps])
    source = workflow_jsx(clean_title[:200], clean_steps, clean_connections)
    if len(source.encode("utf-8")) > MAX_BYTES:
        raise ValueError(f"workflow exceeds {MAX_BYTES} bytes; shorten step content")
    view = _view("jsx", source, clean_title, view_id, 520)
    return {"status": "success", "content": [
        {"json": {"ui": view}},
        {"text": f"Rendered workflow {view['view_id']}: {view['title']} ({len(clean_steps)} steps, "
                 f"{len(clean_connections)} connections). The user can see it now."},
    ]}


def workflow_graph(steps: Any, connections: Any) -> dict[str, Any]:
    """Validated steps/connections -> the graph a saved workflow block holds (src/lib/workflow.ts WorkflowGraph)."""
    clean_steps = _workflow_steps(steps)
    clean_connections = _workflow_connections(connections, [step["id"] for step in clean_steps])
    return {"steps": clean_steps,
            "connections": [{"id": f"{c['source']}->{c['target']}", **c} for c in clean_connections]}


def workflow_block_html(title: str, graph: dict[str, Any]) -> str:
    """A workflow block as the rich-text editor saves it (WorkflowBlockExtension.renderHTML): the graph in
    ``data-graph`` and an ordered list of the step names as the plain-text fallback."""
    import html

    block_id = uuid.uuid4().hex[:10]
    items = "".join(f"<li>{html.escape(step['label'])}</li>" for step in graph["steps"])
    return (f'<workflow-block data-id="{block_id}" data-title="{html.escape(title, quote=True)}" '
            f'data-graph="{html.escape(json.dumps(graph, ensure_ascii=False), quote=True)}"><ol>{items}</ol></workflow-block>')


def render_ui_tools() -> list[Any]:
    """The tools this module contributes to every agent."""
    return [render_ui, render_workflow]


def render_ui_directive() -> str:
    """System-prompt text that tells an agent when and how to use ``render_ui``."""
    return _RENDER_UI_GUIDE


def ui_action_text(view_id: str, action: str, payload: Any) -> str:
    """The user-turn text the renderer sends for one ``ron:ui_action`` message."""
    import json

    label = action if isinstance(action, str) and _ACTION_LABEL.match(action) else "action"
    body = json.dumps(payload, ensure_ascii=False, default=str) if payload is not None else "null"
    return f"[ui_action {view_id}] action={label} payload={body[:4000]}"
