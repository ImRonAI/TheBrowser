"""Deep Research endpoints (loopback-only): status, runs, their events as SSE, workspace files.

Like ``/build``, ``/memory``, ``/teaching``, and ``/tools/repairs``, every ``/deep-research`` route
is strictly loopback-only and MUST NEVER be added to ``RON_NGROK_ALLOW_PATHS``.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path, PurePosixPath
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, field_validator

from agent.api.core import config as app_config
from agent.api.core import deep_research


def require_loopback(request: Request) -> None:
    """Reject any non-loopback caller with HTTP 403."""
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(status_code=403, detail="deep-research is a loopback-only surface")


router = APIRouter(prefix="/deep-research", dependencies=[Depends(require_loopback)])

_ARTIFACT_MEDIA_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".cjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".txt": "text/plain; charset=utf-8",
}


def _artifact_media_type(file_path: Path) -> str:
    ext = file_path.suffix.lower()
    if ext in _ARTIFACT_MEDIA_TYPES:
        return _ARTIFACT_MEDIA_TYPES[ext]
    guessed, _ = mimetypes.guess_type(file_path.name)
    return guessed or "application/octet-stream"


def _content_disposition_attachment(filename: str) -> str:
    ascii_safe = "".join(ch if 32 <= ord(ch) < 127 and ch not in ('"', "\\") else "_" for ch in filename) or "artifact"
    encoded = quote(filename, safe="")
    if encoded == ascii_safe:
        return f'attachment; filename="{ascii_safe}"'
    return f"attachment; filename=\"{ascii_safe}\"; filename*=UTF-8''{encoded}"


class StartDeepResearchRequest(BaseModel):
    query: str
    user_id: str = "default"
    context: str = ""
    depth: deep_research.ResearchDepth = deep_research.DEFAULT_DEPTH
    outcome: deep_research.Outcome = deep_research.DEFAULT_OUTCOME
    provider: str | None = None
    model_id: str | None = None
    reasoning_effort: str | None = None

    @field_validator("query")
    @classmethod
    def _validate_query(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("query must not be empty")
        return cleaned


@router.get("/status")
async def get_deep_research_status() -> dict[str, object]:
    """Whether Squad is on, the default model, the depths, the outcomes and each outcome's formation."""
    selection = deep_research.resolve_selection()
    return {
        "available": app_config.deep_research_enabled(),
        "default_selection": {
            "provider": selection[0] if selection else None,
            "model_id": selection[1] if selection else None,
            "reasoning_effort": None,
        },
        "depths": list(deep_research.VALID_DEPTHS),
        "topology": deep_research.FORMATION_TOPOLOGY,
        "outcomes": list(deep_research.available_outcomes()),
        "topologies": {outcome: deep_research.outcome_topology(outcome) for outcome in deep_research.available_outcomes()},
    }


@router.post("/runs")
async def start_deep_research_run(body: StartDeepResearchRequest) -> deep_research.RunMeta:
    """Start a run in the background and return its meta."""
    if not app_config.deep_research_enabled():
        raise HTTPException(status_code=503, detail="Squad is disabled")
    try:
        return await deep_research.start_run(
            user_id=body.user_id.strip() or "default",
            query=body.query,
            context=body.context.strip(),
            depth=body.depth,
            outcome=body.outcome,
            provider=body.provider or None,
            model_id=body.model_id or None,
            reasoning_effort=body.reasoning_effort or None,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/runs")
async def list_deep_research_runs(
    user_id: str = "default",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, list[deep_research.RunMeta]]:
    """The user's runs, newest first."""
    return {"runs": await deep_research.list_runs(user_id=user_id, limit=limit)}


@router.get("/runs/{session_id}")
async def get_deep_research_run(session_id: str, user_id: str = "default") -> dict[str, object]:
    """The run's meta, its events and its workspace files (404 when unknown)."""
    run = await deep_research.get_run(user_id=user_id, session_id=session_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Deep Research run not found")
    return run


@router.get("/runs/{session_id}/artifacts/{artifact_path:path}")
async def get_deep_research_artifact(session_id: str, artifact_path: str, download: bool = False) -> FileResponse:
    """A file from the run's workspace, inline unless ``download`` is set; a folder serves its index.html."""
    root = deep_research.artifacts_dir(session_id).resolve()
    if "\\" in artifact_path or ".." in PurePosixPath(artifact_path).parts:
        raise HTTPException(status_code=404, detail="Deep Research artifact not found")
    resolved = (root / artifact_path).resolve()
    if resolved.is_dir():
        resolved = resolved / "index.html"
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Deep Research artifact not found")
    headers = {"Cache-Control": "no-cache"}
    if download:
        headers["Content-Disposition"] = _content_disposition_attachment(resolved.name)
    return FileResponse(resolved, media_type=_artifact_media_type(resolved), headers=headers)


@router.get("/runs/{session_id}/events")
async def stream_deep_research_events(
    session_id: str,
    user_id: str = "default",
    after: Annotated[int | None, Query(ge=0)] = None,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    """The run's events as SSE, from position ``after`` (or ``Last-Event-ID``), then ``event: run``."""
    if await deep_research.get_run(user_id=user_id, session_id=session_id) is None:
        raise HTTPException(status_code=404, detail="Deep Research run not found")
    cursor = after if after is not None else int(last_event_id) if last_event_id and last_event_id.isdigit() else 0
    return StreamingResponse(
        deep_research.stream_events(user_id=user_id, session_id=session_id, after=cursor),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/runs/{session_id}/document")
async def get_deep_research_document(session_id: str, user_id: str = "default") -> dict[str, object]:
    """report.md as a Document's title and content, and the Document it was saved as (404 without a report)."""
    document = await deep_research.report_document(user_id=user_id, session_id=session_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Deep Research report not found")
    return document


class ReportDocument(BaseModel):
    document_id: str


@router.post("/runs/{session_id}/document")
async def set_deep_research_document(
    session_id: str, body: ReportDocument, user_id: str = "default"
) -> deep_research.RunMeta:
    """Record the Document the renderer saved the report as."""
    meta = await deep_research.set_report_document(user_id=user_id, session_id=session_id,
                                                   document_id=body.document_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Deep Research run not found")
    return meta


@router.post("/runs/{session_id}/cancel")
async def cancel_deep_research_run(session_id: str, user_id: str = "default") -> deep_research.RunMeta:
    """Cancel an active run (404 when unknown)."""
    meta = await deep_research.cancel_run(user_id=user_id, session_id=session_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Deep Research run not found")
    return meta


@router.delete("/runs/{session_id}")
async def delete_deep_research_run(session_id: str, user_id: str = "default") -> dict[str, object]:
    """Delete a run, its events and its workspace (404 when unknown)."""
    if not await deep_research.delete_run(user_id=user_id, session_id=session_id):
        raise HTTPException(status_code=404, detail="Deep Research run not found")
    return {"deleted": True, "session_id": session_id}
