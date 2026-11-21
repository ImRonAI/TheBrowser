"""The second brain for agents that run outside this process, as an MCP server: the memory tool over the user's
whole brain, writing the agent's own folder, the agent's journal, and the brain to search.

OpenCode on Ren's workspace computer and ren mobile's ElevenLabs agents reach it over MCP. Each names itself in the
``X-Ren-Agent`` header (its folder, ``dreaming.folder``) and the user in ``X-Ren-User``: OpenCode's config sends
``opencode`` and the ``REN_USER_ID`` the Context Agent starts it with (``deploy/vm/laptop/opencode.json`` in ren
mobile), and the ElevenLabs agents send their own name and their ``user_id`` dynamic variable (``core/dreaming.py``).
Mounted at ``/memory/mcp``; loopback-only like the rest of the API.
"""

from __future__ import annotations

from typing import Literal

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_headers

from agent.api.core.dreaming import JOURNAL_TOOL, MEMORY_PROTOCOL, MEMORY_TOOL, Journal, agent_memory, folder, memory_command
from agent.api.core.memory import people_store

server = FastMCP("ren-memory", instructions=MEMORY_PROTOCOL.strip())


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
    return [entry.content for entry in await agent_memory(user, agent)[0].search(query)]


@server.tool
async def remember_person(name: str, relationship: str = "", contact: str = "",
                          notes: str = "", applies_to: str = "") -> str:
    """Remember or update a person in the user's life: friendship/relationship, contact info, notes, and what
    interests, projects or plans they connect to."""
    user, _ = _caller()
    clean, _ = await people_store(user).remember(name=name, relationship=relationship, contact=contact,
                                                 notes=notes, applies_to=applies_to)
    return f"Remembered {clean}."


@server.tool(description=MEMORY_TOOL.format(own="/memories/<your folder>"))
async def memory(command: Literal["view", "create", "str_replace", "insert", "delete", "rename"], path: str = "",
                 file_text: str | None = None, view_range: list[int] | None = None, old_str: str | None = None,
                 new_str: str | None = None, insert_line: int | None = None, insert_text: str | None = None,
                 old_path: str = "", new_path: str = "") -> str:
    try:
        return await memory_command(*_caller(), command, path, file_text=file_text, view_range=view_range,
                                    old_str=old_str, new_str=new_str, insert_line=insert_line,
                                    insert_text=insert_text, old_path=old_path, new_path=new_path)
    except ValueError as error:
        raise ToolError(str(error)) from error


@server.tool(description=JOURNAL_TOOL)
async def journal(entry: str = "") -> str:
    return await Journal(*_caller()).jot(entry)
