"""Loopback inspection of a user's memory.

Consolidation is the SDK's: native extraction on the user's ``FileMemoryStore`` distills the
conversation in the background (``panel_storage.create_memory_config``); no endpoint drives it.
Loopback only: never add this route to the ngrok allowlist.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


def _require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "memory inspection is a loopback-only surface")


@router.get("/memory/entries")
async def memory_entries(request: Request, user_id: str = "default", agent_scope: str = "panel",
                         query: str = "", topic: str | None = None, tags: str | None = None,
                         since: str | None = None, until: str | None = None, subject: str | None = None,
                         order: str | None = None, max_results: int = 20) -> dict[str, Any]:
    """Loopback inspection of the user's journal memories through the same nested filters the
    agents use (``order`` and ``tags`` are comma-separated)."""
    _require_loopback(request)
    from strands.tools.decorator import DecoratedFunctionTool

    from agent.api.core.panel_agent import user_memory_config
    from agent.api.core.panel_storage import SerializedFileMemoryStore

    kwargs: dict[str, Any] = {"query": query, "max_results": max_results}
    for name, value in (("topic", topic), ("since", since), ("until", until), ("subject", subject)):
        if value:
            kwargs[name] = value
    if tags:
        kwargs["tags"] = [t.strip() for t in tags.split(",") if t.strip()]
    if order:
        kwargs["order"] = [o.strip() for o in order.split(",") if o.strip()]
    results: list[dict[str, Any]] = []
    # Each store publishes its own search_memories through MemoryStore.get_tools(); the decorated
    # tool's public __call__ runs the bound search directly.
    for store in user_memory_config(user_id, agent_scope, extraction=False)["stores"]:
        if isinstance(store, SerializedFileMemoryStore):
            for tool_instance in store.get_tools():
                if isinstance(tool_instance, DecoratedFunctionTool):
                    results.extend(await tool_instance(**kwargs))
    return {"user_id": user_id, "results": results[:max_results]}
