"""Per-user tool repair surface (CAT-50/51). Loopback only: never add to the ngrok allowlist —
an investigation runs the fixer's isolated containers on this host and activation reloads live tools.

Investigations start from the native tool-failure hook (``ToolRepairTrigger`` -> ``RepairService``),
not from a click. This surface lets the panel observe and decide:

- ``GET /tools/repairs/active?user_id=`` lists this user's running investigations.
- ``POST /tools/repairs {user_id, session_id, tool_name}`` starts an investigation of a tool the user
  names (the same path the hook uses; the session must be idle).
- ``POST /tools/repairs/{tool}/approve {user_id, rev, approval_token}`` answers the fixer's parked
  ``apply_repair`` interrupt: the token must match the verified artifact exactly; the fixer then
  activates the revision and the owner's live sessions reload it (next invocation).
- ``POST /tools/repairs/{tool}/decline {user_id, rev}`` answers the interrupt negatively; nothing is applied.
- ``POST /tools/repairs/{tool}/cancel {user_id}`` stops a running investigation.
- ``GET /tools/repairs?user_id=`` lists this user's revisions (manifests; ``active`` flag).
- ``POST /tools/repairs/{tool}/activate {user_id, rev, approval_token}`` re-checks owner, base sha,
  artifact digest and token (409/403 on drift), writes ``active.json`` and swaps the tool in every
  live session of that user. A token survives a restart only together with the stored artifact it
  was computed from; a changed artifact invalidates it.
- ``POST /tools/repairs/{tool}/rollback {user_id}`` removes ``active.json`` and swaps back.

The requesting user is the only authority; nothing here touches another user's sessions or data.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from agent.api.core import tool_repair
from agent.api.endpoints.chat import Identifier

router = APIRouter()


def _require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "tool repair is a loopback-only surface")


def _service(request: Request) -> tool_repair.RepairService:
    service = getattr(request.app.state, "tool_repairs", None)
    if service is None:
        raise HTTPException(503, "Tool repair has not started")
    return service


def _manager(request: Request) -> Any:
    manager = getattr(request.app.state, "panel_runtime", None)
    if manager is None:
        raise HTTPException(503, "Panel runtime has not started")
    return manager


class RepairStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier = "default"
    session_id: Identifier
    tool_name: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_]+$")


class RepairApprove(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier = "default"
    rev: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    approval_token: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


class RepairDecline(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier = "default"
    rev: str | None = Field(default=None, min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")


class RepairActivate(RepairApprove):
    pass


class RepairUser(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier = "default"


@router.post("/tools/repairs")
async def start_repair(body: RepairStart, request: Request) -> dict[str, Any]:
    _require_loopback(request)
    manager = _manager(request)
    session = await manager.get(body.user_id, body.session_id)
    if session is None or session.agent is None:
        raise HTTPException(404, "Unknown session")
    if session.active:
        raise HTTPException(409, "Finish or cancel the current run before starting a repair")
    try:
        return await _service(request).start(
            user_id=body.user_id, session_id=body.session_id, tool_name=body.tool_name,
            session_messages=list(session.agent.messages), agent=session.agent,
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/tools/repairs/active")
async def active_repairs(request: Request, user_id: Identifier = "default") -> dict[str, Any]:
    _require_loopback(request)
    return {"user_id": user_id, "investigations": _service(request).active(user_id)}


@router.get("/tools/repairs")
async def list_repairs(request: Request, user_id: Identifier = "default", tool: str | None = None) -> dict[str, Any]:
    _require_loopback(request)
    try:
        revisions = await tool_repair.list_repairs(user_id, tool)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    # The token is server-side proof the panel must echo; the manifest list is the panel's source.
    return {"user_id": user_id, "revisions": revisions}


@router.post("/tools/repairs/{tool}/approve")
async def approve_repair(tool: str, body: RepairApprove, request: Request) -> dict[str, Any]:
    _require_loopback(request)
    try:
        return _service(request).approve(body.user_id, tool, body.rev, body.approval_token)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except PermissionError as error:
        raise HTTPException(403, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/tools/repairs/{tool}/decline")
async def decline_repair(tool: str, body: RepairDecline, request: Request) -> dict[str, Any]:
    _require_loopback(request)
    try:
        return _service(request).decline(body.user_id, tool, body.rev)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/tools/repairs/{tool}/cancel")
async def cancel_repair(tool: str, body: RepairUser, request: Request) -> dict[str, Any]:
    _require_loopback(request)
    try:
        return await _service(request).cancel(body.user_id, tool)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


async def reload_live_sessions(manager: Any, user_id: str, tool_name: str, revision_file: Any,
                               repair_kind: str, *, rollback: bool = False) -> list[str]:
    """Apply (or undo) a revision in every live session of this user. ``file``/``adapter`` go through
    the catalog -> native ``ToolRegistry.replace`` (next invocation). ``server`` restarts this user's
    browser MCP server in each live session (``PanelToolCatalog.restart_mcp_server``): the old stdio
    process is stopped, a new one is spawned with the user's current ``PYTHONPATH`` (repaired package
    or none after rollback) and its tools are re-published at the next invocation boundary."""
    from pathlib import Path

    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR
    from agent.api.core.panel_tools import PanelToolCatalog

    swapped: list[str] = []
    for (owner, session_id), session in list(manager._sessions.items()):
        if owner != user_id or session.agent is None:
            continue
        registered = session.agent.tool_registry.registry.get(tool_name)
        if registered is None:
            continue
        owner_catalog = PanelToolCatalog.for_agent(session.agent)
        if owner_catalog is None:
            continue
        try:
            if repair_kind == "adapter":
                if rollback:
                    done = await owner_catalog.replace_tool(tool_name, agent=session.agent, build=lambda base: base)
                else:
                    adapter = tool_repair.load_adapter(Path(revision_file))
                    rev = (await tool_repair.read_active(user_id, tool_name) or {}).get("revision", "")
                    done = await owner_catalog.replace_tool(
                        tool_name, agent=session.agent, build=lambda base: tool_repair._AdaptedTool(base, adapter, str(rev)))
            elif repair_kind == "file":
                source = tool_repair.tool_source(registered)
                relative = source["path"] if source is not None else None
                if relative is None or Path(relative).is_absolute():
                    active = await tool_repair.read_active(user_id, tool_name)
                    manifests = await tool_repair.list_repairs(user_id, tool_name)
                    relative = (active or {}).get("source_path") or next((m["source_path"] for m in manifests if m.get("source_path")), None)
                if relative is None:
                    continue
                done = await owner_catalog.reload_tool(tool_name, agent=session.agent, root=PROJECT_TOOLS_DIR,
                                                       path=PROJECT_TOOLS_DIR / relative,
                                                       revision_file=Path(revision_file) if revision_file else None)
            else:
                from agent.api.core.panel_browser import is_browser_tool, server_name

                prefix = next((server_name(b) for b in ("user", "cloud") if tool_name.startswith(f"{server_name(b)}_")), None)
                if prefix is None or not is_browser_tool(tool_name):
                    continue
                done = bool(await owner_catalog.restart_mcp_server(prefix, agent=session.agent))
        except Exception as error:
            raise RuntimeError(f"reload failed in session {session_id}: {error}") from error
        if done:
            swapped.append(session_id)
    return swapped


@router.post("/tools/repairs/{tool}/activate")
async def activate_repair(tool: str, body: RepairActivate, request: Request) -> dict[str, Any]:
    _require_loopback(request)
    try:
        active = await tool_repair.activate(body.user_id, tool, body.rev, approval_token_=body.approval_token)
    except tool_repair.RevisionConflict as error:
        raise HTTPException(409, str(error)) from error
    except PermissionError as error:
        raise HTTPException(403, str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    try:
        swapped = await reload_live_sessions(_manager(request), body.user_id, tool, active["revision_file"], active["repair_kind"])
    except RuntimeError as error:
        raise HTTPException(500, str(error)) from error
    return {**active, "live_sessions_reloaded": swapped}


@router.post("/tools/repairs/{tool}/rollback")
async def rollback_repair(tool: str, body: RepairUser, request: Request) -> dict[str, Any]:
    _require_loopback(request)
    try:
        result = await tool_repair.rollback(body.user_id, tool)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    previous = result.get("previous") or {}
    try:
        swapped = await reload_live_sessions(_manager(request), body.user_id, tool, None, str(previous.get("repair_kind", "file")), rollback=True)
    except RuntimeError as error:
        raise HTTPException(500, str(error)) from error
    return {**result, "live_sessions_reloaded": swapped}
