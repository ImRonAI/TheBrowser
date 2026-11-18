"""The second brain for agents that run outside this process, as an MCP server: each agent's journal in its own
folder and the user's whole brain to search.

OpenCode on Ren's workspace computer and ren mobile's ElevenLabs agents reach it over MCP. Each names itself in the
``X-Ren-Agent`` header (its folder, ``dreaming.folder``) and the user in ``X-Ren-User``: OpenCode's config sends
``opencode`` and the ``REN_USER_ID`` the Context Agent starts it with (``deploy/vm/laptop/opencode.json`` in ren
mobile), and the ElevenLabs agents send their own name and their ``user_id`` dynamic variable. The dream files each
journal into ``brain/<agent>`` like every other agent's (``core/dreaming.py``). Mounted at ``/memory/mcp``;
loopback-only like the rest of the API.
"""

from __future__ import annotations

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_headers

from agent.api.core.dreaming import JOURNAL_DIRECTIVE, JOURNAL_TOOL, Journal, agent_memory, folder
from agent.api.core.memory import people_store, save_person

server = FastMCP("ren-memory", instructions=JOURNAL_DIRECTIVE.strip())


def _caller() -> tuple[str, str]:
    """The user and the calling agent's folder, from the request's headers."""
    headers = get_http_headers()
    agent = headers.get("x-ren-agent", "")
    if not agent:
        raise ToolError("The X-Ren-Agent header names the agent's memory folder and is required.")
    return headers.get("x-ren-user") or "default", folder(agent)


@server.tool
async def search_memory(query: str) -> list[str]:
    """Search the user's long-term memory, which all of Ren's agents share: who the user is, the people in their
    life, their preferences, projects and decisions, and what each agent has learned."""
    user, agent = _caller()
    people = [entry.content for entry in await people_store(user).search(query)]
    brain = [entry.content for entry in await agent_memory(user, agent)[0].search(query)]
    return [*people, *(item for item in brain if item not in people)]


@server.tool
async def remember_person(name: str, relationship: str = "", contact: str = "",
                          notes: str = "", applies_to: str = "") -> str:
    """Remember or update a person in the user's life: friendship/relationship, contact info, notes, and what
    interests, projects or plans they connect to."""
    user, _ = _caller()
    clean, _ = await save_person(user, name=name, relationship=relationship, contact=contact,
                                 notes=notes, applies_to=applies_to)
    return f"Remembered {clean}."


@server.tool(description=JOURNAL_TOOL)
async def journal(entry: str = "") -> str:
    store = Journal(*_caller())
    if entry.strip():
        await store.add(entry.strip())
        return "Noted."
    return await store.notes() or "Nothing jotted yet."
