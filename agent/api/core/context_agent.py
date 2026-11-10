"""Context Agent: the agent behind the Context widget (bottom-right Ron orb).

It runs on the panel runtime as ``ChatRequest.destination="context"`` (``chat._create_runtime_agent``),
one native session per user, with the panel composition's tools plus the two tools below. The renderer
drives it with prompt turns:

* ``[browsing]`` — pages the user visited (title + URL). The agent revises the interest graph with
  :func:`update_interest_graph` and, when an interest is strong and recurring, proposes one specialist
  agent with :func:`recommend_agent`.
* ``[context added]`` — an item the user collected (see below).
* ``[approve_agent <id>]`` — the user approved a recommendation: the agent writes the specialist's
  system prompt (``instructions``), assigns tools and Agent Skills, and saves it with the existing
  ``create_harness`` tool (strands_harness portable agent config, stored in Supabase ``harness_agents``).

Both tools return a native tool result whose first block is ``{"json": {...}}``. The panel runtime
forwards ``content`` verbatim and the SDK keeps it in the session, so the renderer applies the graph and
shows the recommendation from the run's own events, with no side channel (same as ``render_ui``).

Context items: every item the user adds (a search, a Discover article, a link, an image or video, a
highlighted passage, a chat thread, a project document, a screenshot or a screen recording) is one
Markdown file in the user's native ``FileMemoryStore`` named ``context`` (``memory.user_stores``), on
the user's panel storage. So every Ron agent reads it with the native ``search_memory`` tool and gets
relevant items through memory injection, and specialists get a read-only ``search_context`` tool over
the same store (``harness_agents.build_specialist``). Binary captures are stored beside it on the same
storage under ``context-files/<id>``.

Agent tools MCP server: ``RON_AGENT_TOOLS_MCP_URL`` names the MCP server that will supply specialist
tools. When it is set the prompt tells the agent to add it to the specialist's ``mcpServers`` (native
``MCPServerConfig`` with ``toolFilters.allowed``); until then specialists get Ron's tool library tools.
"""

from __future__ import annotations

import os
import re
import secrets
import time
from datetime import UTC, datetime
from typing import Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field
from strands import tool
from strands.storage import Storage
from strands.vended_memory_stores.file_memory_store import FileMemoryStore

from agent.api.core.panel_storage import get_user_session_storage

CONTEXT_STORE: Final = "context"
CONTEXT_STORE_DESCRIPTION: Final = (
    "Context the user collected for Ren, one Markdown file per item: searches, articles, links, images, "
    "videos, highlighted passages, chat threads, project documents, screenshots and screen recordings."
)
FILES_PREFIX: Final = "context-files"
MAX_MARKDOWN_CHARS: Final = 200_000
MAX_FILE_BYTES: Final = 100 * 1024 * 1024
MAX_INTERESTS: Final = 10

ContextKind = Literal["search", "article", "link", "image", "video", "selection", "thread", "document",
                      "screenshot", "recording", "file", "note"]
CONTEXT_KINDS: Final[tuple[str, ...]] = ("search", "article", "link", "image", "video", "selection", "thread",
                                         "document", "screenshot", "recording", "file", "note")
InterestCategory = Literal["technology", "design", "ai", "privacy", "productivity", "learning",
                           "entertainment", "news", "other"]

_ID = re.compile(r"^ctx-[0-9a-f]{11}[0-9a-f]{4}$")
_META = re.compile(r"^- (kind|source|title|added|file): (.*)$")


def agent_tools_mcp_url() -> str:
    return os.getenv("RON_AGENT_TOOLS_MCP_URL", "").strip()


CONTEXT_AGENT_PROMPT: Final = """
You are Context Agent. You are Ren living in the Context widget (the Ren orb at the bottom right of every
page), not in the Agent Panel. You keep a picture of what the user cares about and turn it into help.

Turns you receive:
- "[browsing]" lists pages the user just visited (title and URL) and the current interest graph. Revise the
  graph with update_interest_graph: send the COMPLETE revised graph (at most 10 interests), keep stable
  labels for interests that persist, raise the weight of interests the pages reinforce, add an interest only
  when several pages or a clearly deliberate visit support it, let one-off visits fade, and give each interest
  a one-line reason. Labels are short topics a news search understands ("Formula 1", "Home espresso",
  "Rust programming"), never site names or page titles. The Discover feed is built from these labels.
- "[context added]" describes an item the user saved to their context. Fold it into the graph the same way.
- When an interest is strong (weight >= 0.6) and recurring, and the user has no agent for it yet (check
  list_harness_agents and your earlier recommendations), call recommend_agent ONCE for a specialist that
  would do real recurring work for that interest. At most one recommendation per turn; never repeat one.
- "[approve_agent <id>]" means the user approved that recommendation. Build it now: write the specialist's
  system prompt as `instructions` (who it serves, what it does, how it works step by step, which sources it
  trusts, how it reports, what it must never do; specific to this user's interest, at least 150 words),
  choose its tools (library tools from tool_catalog describe as {"module": "./<path>", "export": "<name>"},
  plus "user_browser" in mcpServers only when it must browse), choose Agent Skills from list_learned_skills
  when one fits, then call create_harness with the portable config (name, description, instructions, tools,
  skills, mcpServers). Every specialist already gets Brave search (brave_web_search, brave_news_search,
  brave_image_search, brave_video_search, brave_local_search, brave_answer, brave_rich_answer), the A2A
  tools and search_context (the user's saved context): do not list those, and name them in the
  instructions as its research tools. Brave is the configured search provider, so never pick another
  search provider's library tools (tavily, exa, …): they need API keys this host does not have and fail
  when the agent runs. Add library tools only for capabilities those lack. When create_harness reports an
  error (a missing field, a tool that cannot load), fix the config and call it again.
  Report the saved agent's name and what it will do in two sentences.
- Anything else is the user talking to you about their interests, context or agents: answer briefly.

Use search_memory to read the user's saved context (store "context"). Reply in at most two short sentences
after tool calls; the widget shows the graph and recommendations itself.
"""


def context_agent_prompt() -> str:
    url = agent_tools_mcp_url()
    if not url:
        return CONTEXT_AGENT_PROMPT
    return CONTEXT_AGENT_PROMPT + (
        "\nAgent tools come from Ren's agent tools MCP server. When you build a specialist, add "
        f'"mcpServers": {{"ron_tools": {{"url": "{url}", "toolFilters": {{"allowed": [<tool names>]}}}}}} '
        "listing only the tools that specialist needs.\n"
    )


class Interest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=60, description="Short topic a news search understands.")
    weight: float = Field(ge=0, le=1, description="Strength of the interest, 0-1.")
    category: InterestCategory = Field(description="Closest category.")
    reason: str = Field(default="", max_length=300, description="One line: what supports this interest.")


@tool
async def update_interest_graph(interests: list[Interest]) -> dict[str, Any]:
    """Replace the user's interest graph with the complete revised graph.

    The Context widget draws it and the Discover feed searches news for the strongest labels.

    Args:
        interests: Every interest the user has after this revision (at most 10), strongest first.
    """
    parsed = [Interest.model_validate(item) for item in interests]
    if len(parsed) > MAX_INTERESTS:
        raise ValueError(f"An interest graph holds at most {MAX_INTERESTS} interests; keep the strongest.")
    seen: set[str] = set()
    graph: list[dict[str, Any]] = []
    for item in sorted(parsed, key=lambda value: value.weight, reverse=True):
        key = item.label.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        graph.append({**item.model_dump(), "label": item.label.strip(), "weight": round(item.weight, 3)})
    return {"status": "success", "content": [
        {"json": {"interests": graph}},
        {"text": f"Interest graph updated: {', '.join(item['label'] for item in graph) or 'empty'}."},
    ]}


@tool
async def recommend_agent(name: str, description: str, interest: str, rationale: str,
                          tools: list[str] | None = None, skills: list[str] | None = None) -> dict[str, Any]:
    """Recommend one specialist agent the user could approve for one of their interests.

    The widget shows it with Build and Dismiss buttons; approval arrives as "[approve_agent <id>]".

    Args:
        name: Agent name, 2-5 words (e.g. "Espresso Gear Scout").
        description: One sentence: what it does for the user, recurring and concrete.
        interest: The interest label it serves.
        rationale: One sentence: why now, from what the user did.
        tools: Tool names it would need (library tool names or "user_browser").
        skills: Learned skill names it would use, if any.
    """
    clean = {"name": name.strip(), "description": description.strip(), "interest": interest.strip(),
             "rationale": rationale.strip()}
    if not 1 <= len(clean["name"]) <= 80 or not clean["description"] or not clean["interest"]:
        raise ValueError("A recommendation needs a name (1-80 characters), a description and an interest.")
    recommendation = {"id": "rec-" + secrets.token_hex(5), **clean,
                      "tools": [value for value in (tools or []) if isinstance(value, str)][:20],
                      "skills": [value for value in (skills or []) if isinstance(value, str)][:10]}
    return {"status": "success", "content": [
        {"json": {"agent_recommendation": recommendation}},
        {"text": f"Recommended {recommendation['name']} ({recommendation['id']}); the user decides."},
    ]}


def context_agent_tools() -> list[Any]:
    return [update_interest_graph, recommend_agent]


# --------------------------------------------------------------------------- context items


def context_store(user_id: str, storage: Storage | None = None) -> FileMemoryStore:
    """The user's ``context`` store (the same native store ``memory.user_stores`` registers)."""
    return FileMemoryStore(name=CONTEXT_STORE, description=CONTEXT_STORE_DESCRIPTION,
                           storage=storage or get_user_session_storage(user_id))


def _entries(storage: Storage) -> Storage:
    return storage.namespace(f"memory/{CONTEXT_STORE}")


def new_item_id() -> str:
    """Time-ordered: the hex millisecond clock first, so keys sort oldest to newest."""
    return f"ctx-{int(time.time() * 1000):011x}{secrets.token_hex(2)}"


def _one_line(value: str, limit: int) -> str:
    return " ".join((value or "").split())[:limit]


def item_markdown(item_id: str, *, kind: str, title: str, body: str = "", source: str = "",
                  file: dict[str, Any] | None = None, added: str | None = None) -> str:
    """One context item as the Markdown file agents read."""
    lines = [f"# {item_id} {_one_line(title, 200) or kind}", "", f"- kind: {kind}",
             f"- title: {_one_line(title, 300)}", f"- added: {added or datetime.now(UTC).isoformat(timespec='seconds')}"]
    if source:
        lines.append(f"- source: {_one_line(source, 4096)}")
    if file:
        lines.append(f"- file: {file['media_type']} {int(file['size'])} {_one_line(file.get('name', ''), 200)}".rstrip())
    text = (body or "").strip()
    if len(text) > MAX_MARKDOWN_CHARS:
        text = text[:MAX_MARKDOWN_CHARS] + "\n\n[truncated]"
    return "\n".join(lines) + ("\n\n" + text if text else "") + "\n"


def parse_item(key: str, data: bytes) -> dict[str, Any] | None:
    text = data.decode("utf-8", errors="replace")
    first, _, rest = text.partition("\n")
    heading = first.removeprefix("# ").strip()
    item_id = heading.split(" ", 1)[0]
    if not _ID.match(item_id):
        return None
    meta: dict[str, str] = {}
    body_lines: list[str] = []
    in_meta = True
    for line in rest.split("\n"):
        match = _META.match(line) if in_meta else None
        if match:
            meta[match.group(1)] = match.group(2)
            continue
        if in_meta and not line.strip() and not meta:
            continue
        in_meta = False
        body_lines.append(line)
    file = None
    if "file" in meta:
        media_type, _, remainder = meta["file"].partition(" ")
        size, _, name = remainder.partition(" ")
        file = {"media_type": media_type, "size": int(size) if size.isdigit() else 0, "name": name}
    body = "\n".join(body_lines).strip()
    return {"id": item_id, "key": key, "kind": meta.get("kind", "note"), "title": meta.get("title", ""),
            "source": meta.get("source", ""), "added": meta.get("added", ""), "file": file,
            "preview": body[:400], "chars": len(body)}


async def add_item(user_id: str, *, kind: str, title: str, body: str = "", source: str = "",
                   data: bytes | None = None, media_type: str = "", file_name: str = "",
                   storage: Storage | None = None) -> dict[str, Any]:
    if kind not in CONTEXT_KINDS:
        raise ValueError(f"kind must be one of {CONTEXT_KINDS}")
    storage = storage or get_user_session_storage(user_id)
    item_id = new_item_id()
    file = None
    if data is not None:
        if len(data) > MAX_FILE_BYTES:
            raise ValueError(f"Context files are limited to {MAX_FILE_BYTES // (1024 * 1024)} MB")
        await storage.write(f"{FILES_PREFIX}/{item_id}", data)
        file = {"media_type": media_type or "application/octet-stream", "size": len(data), "name": file_name}
    markdown = item_markdown(item_id, kind=kind, title=title, body=body, source=source, file=file)
    key = await context_store(user_id, storage).add(markdown)
    parsed = parse_item(key, markdown.encode())
    assert parsed is not None
    return parsed


async def _keys(storage: Storage) -> list[str]:
    return sorted((key for key in await _entries(storage).list("") if key.endswith(".md")
                   and _ID.match(key.rsplit("/", 1)[-1][:19])), reverse=True)


async def list_items(user_id: str, *, limit: int = 100, storage: Storage | None = None) -> list[dict[str, Any]]:
    import asyncio

    entries = _entries(storage or get_user_session_storage(user_id))
    keys = (await _keys(storage or get_user_session_storage(user_id)))[:limit]
    blobs = await asyncio.gather(*(entries.read(key) for key in keys))
    return [item for key, blob in zip(keys, blobs, strict=True) if blob and (item := parse_item(key, blob))]


async def _find_key(storage: Storage, item_id: str) -> str | None:
    if not _ID.match(item_id):
        raise ValueError("Unknown context item id")
    return next((key for key in await _keys(storage) if key.rsplit("/", 1)[-1].startswith(item_id)), None)


async def read_item(user_id: str, item_id: str, storage: Storage | None = None) -> tuple[dict[str, Any], str] | None:
    storage = storage or get_user_session_storage(user_id)
    key = await _find_key(storage, item_id)
    data = await _entries(storage).read(key) if key else None
    if not data:
        return None
    item = parse_item(key, data)  # type: ignore[arg-type]
    return (item, data.decode("utf-8", errors="replace")) if item else None


async def read_file(user_id: str, item_id: str, storage: Storage | None = None) -> bytes | None:
    if not _ID.match(item_id):
        raise ValueError("Unknown context item id")
    return await (storage or get_user_session_storage(user_id)).read(f"{FILES_PREFIX}/{item_id}")


async def delete_item(user_id: str, item_id: str, storage: Storage | None = None) -> bool:
    storage = storage or get_user_session_storage(user_id)
    key = await _find_key(storage, item_id)
    data = await _entries(storage).read(key) if key else None
    if key is None or data is None:
        return False
    item = parse_item(key, data)
    await _entries(storage).delete(key)
    if item and item["file"]:
        await storage.delete(f"{FILES_PREFIX}/{item_id}")
    return True


def thread_markdown(messages: list[dict[str, Any]]) -> str:
    """A native session's messages as a readable transcript (text, reasoning skipped, tools by name)."""
    parts: list[str] = []
    for message in messages:
        role = message.get("role")
        lines: list[str] = []
        for block in message.get("content") or []:
            if not isinstance(block, dict):
                continue
            if isinstance(block.get("text"), str) and block["text"].strip():
                lines.append(block["text"].strip())
            elif isinstance(block.get("toolUse"), dict):
                lines.append(f"_Used tool `{block['toolUse'].get('name', 'tool')}`._")
        if not lines:
            continue
        speaker = "User" if role == "user" else "Ren"
        parts.append(f"**{speaker}:** " + "\n\n".join(lines))
    return "\n\n".join(parts)


def interest_graph_from_result(content: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """The graph inside an ``update_interest_graph`` tool result (used by tests and callers)."""
    for block in content:
        payload = block.get("json") if isinstance(block, dict) else None
        if isinstance(payload, dict) and isinstance(payload.get("interests"), list):
            return payload["interests"]
    return None


__all__ = ["CONTEXT_AGENT_PROMPT", "CONTEXT_KINDS", "CONTEXT_STORE", "CONTEXT_STORE_DESCRIPTION", "Interest",
           "add_item", "agent_tools_mcp_url", "context_agent_prompt", "context_agent_tools", "context_store",
           "delete_item", "interest_graph_from_result", "item_markdown", "list_items", "new_item_id", "parse_item",
           "read_file", "read_item", "recommend_agent", "thread_markdown", "update_interest_graph"]

