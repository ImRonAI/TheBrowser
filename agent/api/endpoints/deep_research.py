"""Deep Research HTTP + SSE + Artifact endpoints (loopback-only).

Exposes formation topology/status, background run launch, run history, live/replay SSE streaming,
compiled scholarly PDF & Slidev deck artifact serving, cancellation, and deletion over
``agent.api.core.deep_research.DeepResearchRuntime``.

Like ``/build``, ``/memory``, ``/teaching``, and ``/tools/repairs``, every ``/deep-research`` route
is strictly loopback-only and MUST NEVER be added to ``RON_NGROK_ALLOW_PATHS``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
import json
import mimetypes
from pathlib import Path, PurePosixPath
from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from agent.api.core import config as app_config


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
    session_id: str | None = None
    context: str | None = None
    depth: Literal["standard", "deep", "exhaustive"] = "deep"
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


class CancelDeepResearchRequest(BaseModel):
    user_id: str | None = Field(default=None)


def _clean_user_id(user_id: str | None) -> str:
    cleaned = (user_id or "").strip()
    return cleaned or "default"


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


async def _aclose_stream(stream: Any) -> None:
    aclose: Callable[[], Awaitable[Any]] | None = getattr(stream, "aclose", None)
    if aclose is not None:
        await aclose()


def _runtime(request: Request) -> Any:
    state_runtime = getattr(request.app.state, "deep_research", None)
    if state_runtime is not None:
        return state_runtime
    from agent.api.core.deep_research import get_deep_research_runtime

    return get_deep_research_runtime()


def _default_selection_info() -> dict[str, str | None]:
    from agent.api.core.panel_agent import (
        PROVIDERS,
        default_selection,
        infer_provider,
        provider_default_model,
    )

    cfg_provider = _clean_optional(app_config.RON_DEEP_RESEARCH_PROVIDER)
    cfg_model = _clean_optional(app_config.RON_DEEP_RESEARCH_MODEL)

    if cfg_provider and cfg_provider in PROVIDERS:
        return {
            "provider": cfg_provider,
            "model_id": cfg_model or provider_default_model(cfg_provider),  # type: ignore[arg-type]
        }
    if cfg_model:
        inferred = infer_provider(cfg_model)
        return {
            "provider": inferred,
            "model_id": cfg_model,
        }
    selected = default_selection()
    if selected is not None:
        provider, model_id = selected
        return {"provider": provider, "model_id": model_id}
    return {"provider": None, "model_id": None}


@router.get("/status")
async def get_deep_research_status() -> dict[str, Any]:
    """Return Deep Research availability, default model selection, valid depths, and formation topology."""
    from agent.api.core.deep_research import VALID_DEPTHS, get_formation_topology

    return {
        "available": app_config.deep_research_enabled(),
        "default_selection": _default_selection_info(),
        "depths": list(VALID_DEPTHS),
        "topology": get_formation_topology(),
    }


@router.post("/runs")
async def start_deep_research_run(
    body: StartDeepResearchRequest,
    request: Request,
) -> dict[str, Any]:
    """Launch a new Deep Research formation run asynchronously and return its initial snapshot."""
    if not app_config.deep_research_enabled():
        raise HTTPException(status_code=503, detail="Deep Research is disabled")

    runtime = _runtime(request)
    try:
        return await runtime.start_run(
            user_id=_clean_user_id(body.user_id),
            query=body.query,
            session_id=_clean_optional(body.session_id),
            context=_clean_optional(body.context),
            depth=body.depth,
            provider=_clean_optional(body.provider) or app_config.RON_DEEP_RESEARCH_PROVIDER,
            model_id=_clean_optional(body.model_id) or app_config.RON_DEEP_RESEARCH_MODEL,
            reasoning_effort=_clean_optional(body.reasoning_effort),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/runs")
async def list_deep_research_runs(
    request: Request,
    user_id: str = "default",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    """List active and historical Deep Research runs for ``user_id``, newest first."""
    runtime = _runtime(request)
    runs = await runtime.list_runs(user_id=_clean_user_id(user_id), limit=limit)
    return {"runs": runs}


@router.get("/runs/{session_id}")
async def get_deep_research_run(
    session_id: str,
    request: Request,
    user_id: str = "default",
    include_report: bool = True,
) -> dict[str, Any]:
    """Fetch a Deep Research run snapshot (404 when unknown)."""
    runtime = _runtime(request)
    snapshot = await runtime.get_run(
        user_id=_clean_user_id(user_id),
        session_id=session_id,
        include_report=include_report,
    )
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Deep Research run not found")
    return snapshot


@router.get("/runs/{session_id}/artifacts/{artifact_path:path}")
async def get_deep_research_artifact(
    session_id: str,
    artifact_path: str,
    request: Request,
    user_id: str | None = None,
    download: bool = False,
) -> Response:
    """Serve a compiled Deep Research artifact (``report.pdf``, ``slides/index.html``, sub-assets, etc.).

    Inline by default so ``<iframe src="...">`` renders PDFs and the static Slidev SPA natively;
    pass ``?download=true`` for ``Content-Disposition: attachment``.
    """
    if (
        not artifact_path
        or "\x00" in artifact_path
        or "\\" in artifact_path
        or artifact_path.startswith("/")
        or ".." in PurePosixPath(artifact_path).parts
    ):
        raise HTTPException(status_code=404, detail="Deep Research artifact not found")

    runtime = _runtime(request)
    resolve_fn: Callable[..., Path | str | None] | None = getattr(runtime, "resolve_artifact_path", None)
    if resolve_fn is None:
        raise HTTPException(status_code=404, detail="Deep Research artifact not found")

    cleaned_user = _clean_optional(user_id)
    normalized_rel = artifact_path
    if normalized_rel.endswith("/"):
        normalized_rel = f"{normalized_rel}index.html"

    resolved_raw = resolve_fn(
        session_id=session_id,
        relative_path=normalized_rel,
        user_id=cleaned_user,
    )
    if resolved_raw is None:
        # Support bare directory path `/artifacts/slides` -> redirect to `slides/` so relative `./assets/*` works.
        index_probe = resolve_fn(
            session_id=session_id,
            relative_path=f"{artifact_path.rstrip('/')}/index.html",
            user_id=cleaned_user,
        )
        if index_probe is not None and Path(index_probe).is_file():
            tail = quote(artifact_path.rsplit("/", 1)[-1]) + "/"
            location = f"{tail}?{request.url.query}" if request.url.query else tail
            return RedirectResponse(location, status_code=307)
        raise HTTPException(status_code=404, detail="Deep Research artifact not found")

    resolved = Path(resolved_raw)
    if resolved.is_dir():
        if not artifact_path.endswith("/"):
            tail = quote(artifact_path.rsplit("/", 1)[-1]) + "/"
            location = f"{tail}?{request.url.query}" if request.url.query else tail
            return RedirectResponse(location, status_code=307)
        resolved = resolved / "index.html"

    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="Deep Research artifact not found")

    headers: dict[str, str] = {"Cache-Control": "no-cache"}
    if download:
        headers["Content-Disposition"] = _content_disposition_attachment(resolved.name)

    return FileResponse(
        resolved,
        media_type=_artifact_media_type(resolved),
        headers=headers,
    )


@router.get("/runs/{session_id}/events")
async def stream_deep_research_events(
    session_id: str,
    request: Request,
    user_id: str = "default",
    after: Annotated[int | None, Query(ge=0)] = None,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    """Stream SSE formation events for ``session_id`` starting strictly after sequence ``after``."""
    from agent.api.core.deep_research import ReplayOverflow

    if after is not None:
        cursor = after
    elif last_event_id and last_event_id.strip():
        try:
            cursor = int(last_event_id.strip())
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid Last-Event-ID header") from exc
        if cursor < 0:
            raise HTTPException(status_code=422, detail="after cursor must be >= 0")
    else:
        cursor = 0

    resolved_user = _clean_user_id(user_id)
    runtime = _runtime(request)
    snapshot = await runtime.get_run(
        user_id=resolved_user,
        session_id=session_id,
        include_report=False,
    )
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Deep Research run not found")

    stream = runtime.sse(user_id=resolved_user, session_id=session_id, after=cursor)
    should_prime = (
        (not snapshot.get("active", False))
        or ("sequence" not in snapshot)
        or (cursor < int(snapshot.get("sequence") or 0))
    )
    first_chunk: str | None = None
    if should_prime:
        try:
            first_chunk = await anext(stream, None)  # type: ignore[arg-type]
        except ReplayOverflow as exc:
            await _aclose_stream(stream)
            raise HTTPException(
                status_code=410,
                detail={
                    "code": "replay_overflow",
                    "requested": getattr(exc, "requested", cursor),
                    "earliest": getattr(exc, "earliest", 0),
                    "latest": getattr(exc, "latest", snapshot.get("sequence", 0)),
                    "resync_required": True,
                },
            ) from exc
        except KeyError as exc:
            await _aclose_stream(stream)
            raise HTTPException(status_code=404, detail="Deep Research run not found") from exc

    async def generate():
        try:
            if first_chunk is not None:
                yield first_chunk
                async for chunk in stream:
                    yield chunk
            elif not should_prime:
                async for chunk in stream:
                    yield chunk
        except ReplayOverflow as exc:
            payload = {
                "code": "replay_overflow",
                "requested": getattr(exc, "requested", cursor),
                "earliest": getattr(exc, "earliest", 0),
                "latest": getattr(exc, "latest", 0),
                "resync_required": True,
            }
            yield f"event: replay_overflow\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
        finally:
            await _aclose_stream(stream)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/runs/{session_id}/cancel")
async def cancel_deep_research_run(
    session_id: str,
    request: Request,
    user_id: str | None = Query(default=None),
    body: CancelDeepResearchRequest | None = Body(default=None),
) -> dict[str, Any]:
    """Cancel an active Deep Research run (404 when unknown)."""
    resolved_user = _clean_user_id((body.user_id if body and body.user_id else None) or user_id)
    runtime = _runtime(request)
    snapshot = await runtime.cancel_run(user_id=resolved_user, session_id=session_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Deep Research run not found")
    return snapshot


@router.delete("/runs/{session_id}")
async def delete_deep_research_run(
    session_id: str,
    request: Request,
    user_id: str = "default",
) -> dict[str, Any]:
    """Delete a Deep Research run and its stored snapshot (404 when unknown)."""
    runtime = _runtime(request)
    deleted = await runtime.delete_run(user_id=_clean_user_id(user_id), session_id=session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Deep Research run not found")
    return {"deleted": True, "session_id": session_id}
