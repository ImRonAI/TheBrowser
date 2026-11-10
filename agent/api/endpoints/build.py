"""Build Agent workbench: the Build destination's project directory over HTTP (contract: ``docs/build-agent.md``).

File tree, file read/write/delete, git history and a live static preview of ``core/build_workspace.py``'s
per-(user, session) workspace. Every route is loopback-only, like ``/memory``, ``/teaching`` and ``/a2a``: they read
and write files on the host. Never add ``/build`` to the ngrok allowlist (``RON_NGROK_ALLOW_PATHS``).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

from agent.api.core import build_workspace as workspace


def require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "build is a loopback-only surface")


router = APIRouter(prefix="/build", dependencies=[Depends(require_loopback)])

#: The panel's identifiers (``chat.Identifier``): a workspace is keyed by exactly what ``/chat`` received, and
#: ``user_id`` defaults to ``"default"`` there too.
_IDENTIFIER = r"^[A-Za-z0-9][A-Za-z0-9_.-]*$"
UserId = Annotated[str, Query(min_length=1, max_length=128, pattern=_IDENTIFIER)]
SessionId = Annotated[str, Query(min_length=1, max_length=128, pattern=_IDENTIFIER)]
WorkspacePath = Annotated[str, Query(min_length=1, max_length=4096)]

#: The preview is the user's own project: scripts run, but in a sandbox with an opaque origin (no cookies, storage or
#: same-origin access to Ren); ``*`` lets that opaque origin fetch the project's own files.
PREVIEW_HEADERS = {
    "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
}


class FileWrite(BaseModel):
    user_id: str = Field(default="default", min_length=1, max_length=128, pattern=_IDENTIFIER)
    session_id: str = Field(min_length=1, max_length=128, pattern=_IDENTIFIER)
    path: str = Field(min_length=1, max_length=4096)
    #: UTF-8 text, at most ``build_workspace.MAX_WRITE_BYTES`` (2 MiB) encoded, else 413.
    content: str
    #: The ``sha256`` the client last read; null or empty creates only (409 when the file exists).
    base_sha256: str | None = None


@contextmanager
def _http_errors() -> Iterator[None]:
    try:
        yield
    except workspace.WorkspacePathError as exc:
        raise HTTPException(400, str(exc)) from exc
    except workspace.ContentTooLarge as exc:
        raise HTTPException(413, str(exc)) from exc
    except workspace.WriteConflict as exc:
        raise HTTPException(409, {"message": str(exc), "sha256": exc.current}) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, "No such file in the workspace") from exc
    except IsADirectoryError as exc:
        raise HTTPException(400, "path is a directory") from exc
    except (NotADirectoryError, FileExistsError) as exc:
        raise HTTPException(400, "a parent of path is a file, not a directory") from exc


@router.get("/workspace")
def get_workspace(session_id: SessionId, user_id: UserId = "default") -> dict[str, Any]:
    """The workspace's tree and facts; read-only (a workspace that does not exist yet reports ``exists: false``)."""
    root = workspace.workspace_root(user_id, session_id)
    exists = root.is_dir()
    listing = workspace.list_workspace(root) if exists else workspace.empty_listing()
    return {"workspace_id": root.name, "root": str(root), "exists": exists, **listing,
            "preview_url": f"/build/preview/{root.name}/" if listing["has_index"] else None}


@router.get("/file")
def get_file(session_id: SessionId, path: WorkspacePath, user_id: UserId = "default") -> dict[str, Any]:
    with _http_errors():
        return workspace.read_file(workspace.workspace_root(user_id, session_id), path)


@router.put("/file")
def put_file(body: FileWrite) -> dict[str, Any]:
    with _http_errors():
        return workspace.write_file(workspace.workspace_root(body.user_id, body.session_id), body.path,
                                    body.content, body.base_sha256)


@router.delete("/file", status_code=204)
def delete_file(session_id: SessionId, path: WorkspacePath, user_id: UserId = "default") -> Response:
    with _http_errors():
        workspace.delete_file(workspace.workspace_root(user_id, session_id), path)
    return Response(status_code=204)


@router.get("/git")
async def get_git(session_id: SessionId, user_id: UserId = "default",
                  limit: Annotated[int, Query(ge=1, le=200)] = 30) -> dict[str, Any]:
    try:
        return await workspace.git_summary(workspace.workspace_root(user_id, session_id), limit)
    except workspace.GitTimeout as exc:
        raise HTTPException(504, str(exc)) from exc


@router.get("/preview/{workspace_id}/{path:path}")
def preview(workspace_id: str, path: str, request: Request) -> Response:
    """A workspace file for the preview pane; a directory (or the empty path) serves its ``index.html``."""
    target, directory = workspace.preview_target(workspace_id, path)
    if target is None:
        raise HTTPException(404, "Not found")
    if directory and path and not path.endswith("/"):
        # A directory is served at its slash URL, so the page's relative links resolve inside it.
        location = quote(path.rsplit("/", 1)[-1]) + "/"
        return RedirectResponse(f"{location}?{request.url.query}" if request.url.query else location, status_code=307)
    return FileResponse(target, headers=PREVIEW_HEADERS, media_type=workspace.preview_media_type(target))
