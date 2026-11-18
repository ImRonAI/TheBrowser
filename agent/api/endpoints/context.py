"""Context widget HTTP surface: the user's context items and their specialist agents.

Items are Markdown files in the user's native ``context`` memory store (``core/context_agent.py``);
binary captures (screenshots, screen recordings, uploaded images/videos/files) sit beside them on the
same user storage. ``/context/profile`` keeps a signed-in account's interview and interest graph on that
storage too, so the account brings them to every device it signs in on (desktop and ren mobile). Like ``/chat`` and ``/sessions`` the caller names ``user_id`` and the routes are
loopback-only: never add ``/context`` to the ngrok allowlist.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, Path, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from agent.api.core import context_agent
from agent.api.core.agent_schedules import AgentBusy, AgentScheduler, Cadence
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
async def list_agents(request: Request, user_id: Identifier = "default") -> dict[str, Any]:
    """The user's saved specialists (``harness_agents``), newest first, each with its schedule. Guests must sign in."""
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
    schedules: dict[str, Any] = {}
    scheduler = getattr(request.app.state, "agent_scheduler", None)
    if scheduler is not None and rows:
        try:
            schedules = await scheduler.schedules(owner)
        except Exception as error:  # the agents still list; their schedules show as unset
            logger.warning("owner=<%s>, error=<%s> | agent schedules could not be read", owner, error)
    return {"agents": [{**_listing(row), "schedule": schedules.get(row["id"])} for row in rows], "sign_in_required": False}


# ----------------------------------------------------------------------------- scheduled runs (core/agent_schedules.py)


class ScheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier = "default"
    #: None removes the schedule.
    cadence: Cadence | None = None
    #: What to do on each run; empty = the specialist's own description of its recurring work.
    task: str = Field(default="", max_length=4000)
    enabled: bool = True


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier = "default"
    task: str = Field(default="", max_length=4000)


class RunSeen(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier = "default"


def _scheduler(request: Request) -> AgentScheduler:
    scheduler = getattr(request.app.state, "agent_scheduler", None)
    if scheduler is None:
        raise HTTPException(503, "Agent schedules have not started")
    return scheduler


def _owner(user_id: str) -> str:
    from agent.api.core.harness_agents import SignInRequired, owner_uuid

    try:
        return owner_uuid(user_id)
    except SignInRequired as error:
        raise HTTPException(401, str(error)) from error


@router.put("/agents/{agent_id}/schedule")
async def set_agent_schedule(agent_id: UUID, body: ScheduleRequest, request: Request) -> dict[str, Any]:
    """Run this specialist at ``cadence`` (in the user's time zone); a null cadence stops its schedule."""
    owner, scheduler = _owner(body.user_id), _scheduler(request)
    try:
        if body.cadence is None:
            await scheduler.clear_schedule(owner, str(agent_id))
            return {"schedule": None}
        return {"schedule": await scheduler.set_schedule(owner, str(agent_id), body.cadence, task=body.task,
                                                         enabled=body.enabled)}
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error


@router.post("/agents/{agent_id}/run")
async def run_agent_now(agent_id: UUID, body: RunRequest, request: Request) -> dict[str, Any]:
    """Start one run of this specialist now, exactly as its schedule would (a new panel session)."""
    owner, scheduler = _owner(body.user_id), _scheduler(request)
    try:
        # Without a task of its own, Run now does what the schedule's runs do.
        task = body.task or ((await scheduler.schedules(owner)).get(str(agent_id)) or {}).get("task") or ""
        return {"run": await scheduler.run(owner, str(agent_id), trigger="manual", task=task)}
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except AgentBusy as error:
        raise HTTPException(409, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error


@router.get("/runs")
async def list_runs(request: Request, user_id: Identifier = "default",
                    limit: Annotated[int, Query(ge=1, le=100)] = 30) -> dict[str, Any]:
    """The user's specialist runs, newest first: the Context widget's notifications. Guests have none."""
    from agent.api.core.harness_agents import SignInRequired, owner_uuid

    try:
        owner = owner_uuid(user_id)
    except SignInRequired:
        return {"runs": [], "sign_in_required": True}
    try:
        return {"runs": await _scheduler(request).runs(owner, limit=limit), "sign_in_required": False}
    except RuntimeError as error:
        raise HTTPException(503, str(error)) from error


@router.post("/runs/{run_id}/seen")
async def mark_run_seen(run_id: UUID, body: RunSeen, request: Request) -> dict[str, Any]:
    if not await _scheduler(request).mark_seen(_owner(body.user_id), str(run_id)):
        raise HTTPException(404, "Unknown run")
    return {"seen": str(run_id)}


class TopicReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=r"^memory/brain/[^/]+/[^/]+\.md$", max_length=400)
    right: bool
    comment: str = Field(default="", max_length=2000)


class DreamReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier = "default"
    #: Empty dismisses the notice without a review.
    topics: list[TopicReview] = Field(default_factory=list, max_length=200)


@router.get("/dream")
async def newest_dream(user_id: Identifier = "default") -> dict[str, Any]:
    """The newest dream the user has not reviewed or dismissed: each topic it changed, as it reads now (null when
    the dream deleted it). The Context widget's notification; null when there is none."""
    from agent.api.core.dreaming import SEEN
    from agent.api.core.panel_storage import get_user_session_storage

    storage = get_user_session_storage(user_id)
    versions = sorted(key for key in await storage.list("memory/dreams/") if key.endswith(".json"))
    if not versions:
        return {"dream": None}
    version = versions[-1].rsplit("/", 1)[-1].removesuffix(".json")
    if (await storage.read(SEEN) or b"").decode() == version:
        return {"dream": None}
    keys = list(json.loads(await storage.read(versions[-1]) or b"{}"))
    texts = await asyncio.gather(*(storage.read(key) for key in keys))
    return {"dream": {"version": version, "topics": [
        {"key": key, "text": None if text is None else text.decode("utf-8", "replace")}
        for key, text in zip(keys, texts, strict=True)]}}


@router.post("/dream/{version}")
async def review_dream(version: Annotated[str, Path(pattern=r"^\d{8}T\d{12}$")], body: DreamReview) -> dict[str, Any]:
    """Close the notification. A review goes to the dreaming agent, which applies it in the background with its
    next dream and keeps what it teaches for every dream after (``dreaming.dream_feedback``)."""
    from agent.api.core.dreaming import SEEN, dream_feedback
    from agent.api.core.panel_storage import get_user_session_storage

    if body.topics:
        await dream_feedback(body.user_id, version,
                             [(topic.key, topic.right, topic.comment) for topic in body.topics])
    await get_user_session_storage(body.user_id).write(SEEN, version.encode("ascii"))
    return {"reviewed": version}


class ProfileAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(max_length=1000)
    answer: str = Field(max_length=4000)
    timestamp: float = 0


class ProfileOnboarding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answers: list[ProfileAnswer] = Field(default_factory=list, max_length=50)
    isComplete: bool = False


InterestCategory = Literal["technology", "design", "ai", "privacy", "productivity", "learning", "entertainment", "news", "other"]


class ProfileInterest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=200)
    label: str = Field(max_length=200)
    weight: float = Field(ge=0, le=1)
    category: InterestCategory
    source: Literal["onboarding", "browsing"]
    reason: str | None = Field(default=None, max_length=1000)
    lastUpdated: float


class ProfileConnection(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    id: str = Field(max_length=500)
    from_: str = Field(alias="from", max_length=200)
    to: str = Field(max_length=200)
    strength: float = Field(ge=0, le=1)


class ProfileInterests(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nodes: list[ProfileInterest] = Field(default_factory=list, max_length=200)
    connections: list[ProfileConnection] = Field(default_factory=list, max_length=2000)
    isInitialized: bool = False


class Profile(BaseModel):
    """What the interview and the interest graph keep (``onboardingStore`` and ``interestsStore``), minus the
    graph's on-screen layout, with when the device that wrote it last changed it (ms since the epoch)."""

    model_config = ConfigDict(extra="forbid")
    onboarding: ProfileOnboarding
    interests: ProfileInterests
    updated_at: float = Field(ge=0)


class ProfileSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: Identifier
    profile: Profile


PROFILE_KEY = "profile.json"


@router.get("/profile")
async def read_profile(user_id: Identifier = "default") -> dict[str, Any]:
    """The account's interview and interest graph, or null before any device saved them. Guests have none."""
    _owner(user_id)
    data = await context_agent.get_user_session_storage(user_id).read(PROFILE_KEY)
    return {"profile": Profile.model_validate_json(data).model_dump(by_alias=True, exclude_none=True) if data else None}


@router.put("/profile")
async def save_profile(body: ProfileSave) -> dict[str, Any]:
    """Keeps the newer profile: a save older than the stored one returns the stored one unchanged."""
    _owner(body.user_id)
    storage = context_agent.get_user_session_storage(body.user_id)
    stored = await storage.read(PROFILE_KEY)
    if stored:
        current = Profile.model_validate_json(stored)
        if current.updated_at > body.profile.updated_at:
            return {"profile": current.model_dump(by_alias=True, exclude_none=True)}
    await storage.write(PROFILE_KEY, body.profile.model_dump_json(by_alias=True, exclude_none=True).encode())
    return {"profile": body.profile.model_dump(by_alias=True, exclude_none=True)}


@router.get("/applications")
async def list_applications(user_id: Identifier = "default") -> dict[str, Any]:
    """The apps OpenCode built for the account (the Context Agent's ``register_application``), newest first."""
    _owner(user_id)
    return {"applications": [item.model_dump() for item in await context_agent.read_applications(user_id)]}


@router.get("/applications/{application_id}/apk")
async def application_apk(application_id: str, user_id: Identifier = "default") -> FileResponse:
    """An Android app's APK, for ren mobile to install. Served where the workspace computer's home is mounted (the VM)."""
    _owner(user_id)
    application = next((item for item in await context_agent.read_applications(user_id) if item.id == application_id), None)
    if application is None or application.kind != "android":
        raise HTTPException(404, "No such Android app")
    path = os.path.realpath(application.location)
    if not path.startswith(context_agent.APPS_DIR + "/") or not path.endswith(".apk") or not os.path.isfile(path):
        raise HTTPException(404, f"{application.name}'s APK is not on this server")
    safe = "".join(char if char.isalnum() or char in "-_" else "-" for char in application.name) or "app"
    return FileResponse(path, media_type="application/vnd.android.package-archive", filename=f"{safe}.apk")


@router.delete("/applications/{application_id}")
async def remove_application(application_id: str, user_id: Identifier = "default") -> dict[str, Any]:
    """Takes an app off the list; the app itself stays where OpenCode put it."""
    _owner(user_id)
    applications = await context_agent.read_applications(user_id)
    kept = [item for item in applications if item.id != application_id]
    if len(kept) == len(applications):
        raise HTTPException(404, "No such application")
    await context_agent.write_applications(user_id, kept)
    return {"applications": [item.model_dump() for item in kept]}


@router.get("/status")
async def status() -> dict[str, Any]:
    return {"kinds": list(context_agent.CONTEXT_KINDS), "max_file_bytes": context_agent.MAX_FILE_BYTES,
            "agent_tools_mcp": bool(context_agent.agent_tools_mcp_url())}
