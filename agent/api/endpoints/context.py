"""Context widget HTTP surface: the user's context items and their specialist agents.

Items are Markdown files in the user's native ``context`` memory store (``core/context_agent.py``);
binary captures (screenshots, screen recordings, uploaded images/videos/files) sit beside them on the
same user storage. Like ``/chat`` and ``/sessions`` the caller names ``user_id`` and the routes are
loopback-only: never add ``/context`` to the ngrok allowlist.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from agent.api.core import context_agent
from agent.api.endpoints.chat import Identifier

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/context")

TextKind = Literal["search", "article", "link", "image", "video", "selection", "thread", "document", "note"]
FileKind = Literal["screenshot", "recording", "image", "video", "file"]
_CHUNK = 1024 * 1024


class ItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier = "default"
    kind: TextKind
    title: str = Field(default="", max_length=1000)
    text: str = Field(default="", max_length=context_agent.MAX_MARKDOWN_CHARS)
    url: str = Field(default="", max_length=4096)
    #: kind=thread: the panel session whose messages become the item's Markdown transcript.
    session_id: Identifier | None = None


async def _thread_messages(request: Request, user_id: str, session_id: str) -> list[dict[str, Any]]:
    from agent.api.endpoints.chat import _manager, _native_thread_snapshot

    try:
        snapshot = await _manager(request).snapshot(user_id, session_id)
    except KeyError:
        snapshot = await _native_thread_snapshot(user_id, session_id)
    if not snapshot:
        raise HTTPException(404, "Unknown thread")
    return snapshot.get("messages") or []


async def _readable_text(url: str) -> str:
    from agent.api.core.articles import extract_article

    if not url.startswith("https://"):
        return ""
    try:
        return (await extract_article(url))["text"]
    except Exception as error:  # the item keeps its URL; the page text is a bonus
        logger.info("url=<%s>, error=<%s> | context item saved without page text", url, error)
        return ""


@router.post("/items")
async def create_item(body: ItemCreate, request: Request) -> dict[str, Any]:
    text, title = body.text, body.title.strip()
    if body.kind == "thread":
        if not body.session_id:
            raise HTTPException(422, "A thread item needs session_id")
        text = context_agent.thread_markdown(await _thread_messages(request, body.user_id, body.session_id))
        if not text:
            raise HTTPException(422, "That thread has no messages yet")
    elif body.kind in ("link", "article") and not text.strip():
        text = await _readable_text(body.url)
    if not title:
        heading = text.strip().split("\n", 1)[0].strip()
        if body.kind in ("link", "article") and body.url and heading and len(heading) <= 120:
            title = f"{heading} — {urlsplit(body.url).hostname or body.url}"  # the page's own first heading
        else:
            title = body.url or heading[:120] or body.kind
    if not text.strip() and not body.url:
        raise HTTPException(422, "Context needs text or a URL")
    item = await context_agent.add_item(body.user_id, kind=body.kind, title=title, body=text, source=body.url)
    return {"item": item}


@router.post("/files")
async def upload_file(
    file: Annotated[UploadFile, File()],
    user_id: Annotated[str, Form(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")] = "default",
    kind: Annotated[FileKind, Form()] = "file",
    title: Annotated[str, Form(max_length=1000)] = "",
    source: Annotated[str, Form(max_length=4096)] = "",
    text: Annotated[str, Form(max_length=20_000)] = "",
) -> dict[str, Any]:
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(_CHUNK):
        size += len(chunk)
        if size > context_agent.MAX_FILE_BYTES:
            raise HTTPException(413, f"Context files are limited to {context_agent.MAX_FILE_BYTES // _CHUNK} MB")
        chunks.append(chunk)
    if not size:
        raise HTTPException(422, "The file is empty")
    name = file.filename or kind
    item = await context_agent.add_item(
        user_id, kind=kind, title=title.strip() or name, body=text, source=source, data=b"".join(chunks),
        media_type=file.content_type or "application/octet-stream", file_name=name,
    )
    return {"item": item}


@router.get("/items")
async def list_items(user_id: Identifier = "default", limit: Annotated[int, Query(ge=1, le=500)] = 100) -> dict[str, Any]:
    return {"items": await context_agent.list_items(user_id, limit=limit)}


@router.get("/items/{item_id}")
async def get_item(item_id: str, user_id: Identifier = "default") -> dict[str, Any]:
    try:
        found = await context_agent.read_item(user_id, item_id)
    except ValueError as error:
        raise HTTPException(404, str(error)) from error
    if found is None:
        raise HTTPException(404, "Unknown context item")
    item, markdown = found
    return {"item": item, "markdown": markdown}


@router.get("/items/{item_id}/file")
async def get_item_file(item_id: str, user_id: Identifier = "default") -> Response:
    try:
        found = await context_agent.read_item(user_id, item_id)
        data = await context_agent.read_file(user_id, item_id) if found else None
    except ValueError as error:
        raise HTTPException(404, str(error)) from error
    if not found or data is None or not found[0]["file"]:
        raise HTTPException(404, "This context item has no file")
    file = found[0]["file"]
    name = (file.get("name") or item_id).replace('"', "").replace("\r", "").replace("\n", "")
    media_type = str(file["media_type"])
    # Uploaded bytes come from the user's machine or a web page: only media renders inline, and nothing
    # served here may run script on this origin (it hosts /chat, which runs host tools).
    inline = media_type.split("/", 1)[0] in ("image", "video", "audio") and media_type != "image/svg+xml"
    return Response(data, media_type=media_type, headers={
        "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{name}"',
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600", "Vary": "Origin",
    })


@router.delete("/items/{item_id}")
async def delete_item(item_id: str, user_id: Identifier = "default") -> dict[str, Any]:
    try:
        deleted = await context_agent.delete_item(user_id, item_id)
    except ValueError as error:
        raise HTTPException(404, str(error)) from error
    if not deleted:
        raise HTTPException(404, "Unknown context item")
    return {"deleted": item_id}


@router.get("/agents")
async def list_agents(user_id: Identifier = "default") -> dict[str, Any]:
    """The user's saved specialists (``harness_agents``), newest first. Guests must sign in."""
    from agent.api.core.harness_agents import SignInRequired, _listing, harness_table, owner_uuid

    try:
        owner = owner_uuid(user_id)
    except SignInRequired:
        return {"agents": [], "sign_in_required": True}
    try:
        rows = (await (await harness_table()).select("id,name,description,config,updated_at")
                .eq("owner_id", owner).order("updated_at", desc=True).execute()).data
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error
    return {"agents": [_listing(row) for row in rows], "sign_in_required": False}


@router.get("/status")
async def status() -> dict[str, Any]:
    return {"kinds": list(context_agent.CONTEXT_KINDS), "max_file_bytes": context_agent.MAX_FILE_BYTES,
            "agent_tools_mcp": bool(context_agent.agent_tools_mcp_url())}
