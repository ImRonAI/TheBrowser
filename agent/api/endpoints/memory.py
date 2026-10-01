"""Dreaming: idle-gated consolidation of the journal into long-term memory.

``POST /memory/dream`` is driven by a crontab line (vendored strands_tools ``cron``)
every minute; it only runs the shared Memory Agent's dream prompt once the user has
been idle for ``RON_MEMORY_IDLE_SECONDS`` (default 300). Loopback only: the memory
agent runs host tools, so this route must never join the ngrok allowlist.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from agent.api.core.memory_agent import memory_agent_for
from agent.api.core.panel_agent import user_memory_manager

router = APIRouter()
_dreaming: dict[str, asyncio.Lock] = {}


def idle_threshold() -> float:
    return float(os.getenv("RON_MEMORY_IDLE_SECONDS", "300"))


class DreamRequest(BaseModel):
    user_id: str = Field(default="default", min_length=1, max_length=256)
    agent_scope: str = Field(default="panel", min_length=1, max_length=256)
    force: bool = False


def _require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "dreaming is a loopback-only surface")


def _idle(request: Request, user_id: str) -> float | None:
    runtime = getattr(request.app.state, "panel_runtime", None)
    return runtime.idle_seconds(user_id) if runtime is not None else None


@router.get("/memory/status")
async def memory_status(request: Request, user_id: str = "default") -> dict[str, Any]:
    _require_loopback(request)
    idle = _idle(request, user_id)
    return {"user_id": user_id, "idle_seconds": idle, "idle_threshold": idle_threshold(),
            "dreaming": user_id in _dreaming and _dreaming[user_id].locked()}


@router.post("/memory/dream")
async def memory_dream(body: DreamRequest, request: Request) -> Any:
    _require_loopback(request)
    idle = _idle(request, body.user_id)
    if idle is None and not body.force:
        return {"status": "skipped", "reason": "no_activity", "user_id": body.user_id}
    if idle is not None and idle < idle_threshold() and not body.force:
        return JSONResponse(status_code=202, content={"status": "skipped", "reason": "active",
                                                      "idle_seconds": idle, "user_id": body.user_id})
    lock = _dreaming.setdefault(body.user_id, asyncio.Lock())
    if lock.locked():
        return JSONResponse(status_code=202, content={"status": "skipped", "reason": "dreaming", "user_id": body.user_id})
    async with lock:
        agent = await asyncio.to_thread(
            memory_agent_for, body.user_id, lambda: user_memory_manager(body.user_id, body.agent_scope))
        result = await agent.dream()
    return {**result, "idle_seconds": idle}


@router.get("/memory/entries")
async def memory_entries(request: Request, user_id: str = "default", agent_scope: str = "panel",
                         query: str = "", topic: str | None = None, tags: str | None = None,
                         since: str | None = None, until: str | None = None, subject: str | None = None,
                         order: str | None = None, max_results: int = 20) -> dict[str, Any]:
    """Loopback inspection of the user's journal memories through the same nested filters the
    agents use (``order`` and ``tags`` are comma-separated)."""
    _require_loopback(request)
    from agent.api.core.panel_agent import user_memory_config
    from agent.api.core.panel_storage import create_search_memories_tool

    tool_instance = create_search_memories_tool(user_memory_config(user_id, agent_scope)["stores"])
    kwargs: dict[str, Any] = {"query": query, "max_results": max_results}
    for name, value in (("topic", topic), ("since", since), ("until", until), ("subject", subject)):
        if value:
            kwargs[name] = value
    if tags:
        kwargs["tags"] = [t.strip() for t in tags.split(",") if t.strip()]
    if order:
        kwargs["order"] = [o.strip() for o in order.split(",") if o.strip()]
    return {"user_id": user_id, "results": await tool_instance._tool_func(**kwargs)}
