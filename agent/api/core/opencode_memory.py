"""OpenCode's second brain: the user's whole brain to search and OpenCode's own journal, as an MCP server.

OpenCode runs on Ren's workspace computer, outside this process, so it reaches its memory over MCP. The Context
Agent starts it with ``REN_USER_ID=<user>`` and OpenCode's config sends that as the ``X-Ren-User`` header
(``deploy/vm/laptop/opencode.json`` in ren mobile). The journal is filed into ``brain/opencode`` by the dream
like every other agent's (``core/dreaming.py``). Mounted at ``/opencode/mcp``; loopback-only like the rest of the API.
"""

from __future__ import annotations

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers

from agent.api.core.dreaming import JOURNAL_DIRECTIVE, JOURNAL_TOOL, Journal, agent_memory

FOLDER = "opencode"
server = FastMCP("ren-memory", instructions=JOURNAL_DIRECTIVE.strip())


def _user() -> str:
    return get_http_headers().get("x-ren-user") or "default"


@server.tool
async def search_memory(query: str) -> list[str]:
    """Search the user's long-term memory, which all of Ren's agents share, by meaning: who the user is, their
    preferences, projects and decisions, and what each agent has learned."""
    return [entry.content for entry in await agent_memory(_user(), FOLDER)[0].search(query)]


@server.tool(description=JOURNAL_TOOL)
async def journal(entry: str = "") -> str:
    store = Journal(_user(), FOLDER)
    if entry.strip():
        await store.add(entry.strip())
        return "Noted."
    return await store.notes() or "Nothing jotted yet."
