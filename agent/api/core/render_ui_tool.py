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
* ``jsx`` — a JSX fragment rendered in the panel with the AI Elements kit (Card, Carousel,
  Button, Badge, …). Expressions are not executed: it is markup only, for static layouts.

The tool validates size and shape only; the renderer is the sandbox.
"""
from __future__ import annotations

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
"""

_ACTION_LABEL = re.compile(r"^[a-z][a-z0-9_:-]{0,63}$")


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
    CarouselNext, plus plain HTML tags); JSX expressions are not executed.

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
    identifier = view_id.strip() if isinstance(view_id, str) and view_id.strip() else "v" + uuid.uuid4().hex[:11]
    if not _ACTION_LABEL.match(identifier):
        raise ValueError("view_id must match ^[a-z][a-z0-9_:-]{0,63}$")
    height = max(240, min(int(height), 2000))
    view = {"view_id": identifier, "format": format, "title": (title or "").strip()[:200],
            "source": source, "height": height}
    return {"status": "success", "content": [
        {"json": {"ui": view}},
        {"text": f"Rendered {format} view {identifier}" + (f": {view['title']}" if view["title"] else "") + ". "
                 "The user can see it now; interactions arrive as [ui_action] turns."},
    ]}


def render_ui_tools() -> list[Any]:
    """The tools this module contributes to every agent."""
    return [render_ui]


def render_ui_directive() -> str:
    """System-prompt text that tells an agent when and how to use ``render_ui``."""
    return _RENDER_UI_GUIDE


def ui_action_text(view_id: str, action: str, payload: Any) -> str:
    """The user-turn text the renderer sends for one ``ron:ui_action`` message."""
    import json

    label = action if isinstance(action, str) and _ACTION_LABEL.match(action) else "action"
    body = json.dumps(payload, ensure_ascii=False, default=str) if payload is not None else "null"
    return f"[ui_action {view_id}] action={label} payload={body[:4000]}"
