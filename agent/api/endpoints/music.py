"""Live Music library and deck transport (loopback-only).

The Lyria RealTime stream itself lives on the Live socket (``core.live_music`` tools). This surface
lets the renderer's music deck (a) drive the same session's playback controls and take recorder
that the agent's tools use, and (b) list, sign and delete saved songs for the signed-in user.
Identity is the Projects path (``project_identity``) and every route requires a signed-in user:
the Live socket binds its music session to the Supabase ``user_id`` it was opened with, and a guest
workspace resolves to a derived id that can never match it. Never add these routes to the ngrok
allowlist.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from agent.api.core import live_music, live_tools
from agent.api.core.projects import ProjectIdentity, project_identity

router = APIRouter()
Identity = Annotated[ProjectIdentity, Depends(project_identity)]


def _require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "music is a loopback-only surface")


def _signed_in(identity: ProjectIdentity) -> None:
    if identity.guest:
        raise HTTPException(401, "Sign in to Ren to use the music deck (guest sessions cannot).")


def _session_for(agent_id: str, identity: ProjectIdentity) -> live_music.LiveMusicSession:
    """The caller's own Live music session: the random per-socket ``agent_id`` must exist AND belong
    to the signed-in identity (the Live socket's ``user_id``); anything else is a 404."""
    _signed_in(identity)
    tools = live_tools.LIVE_MUSIC_SESSIONS.get(agent_id)
    if tools is None or tools.user_id != identity.user_id:
        raise HTTPException(404, "No live music session for that Live agent")
    return tools.session


class ControlBody(BaseModel):
    agent_id: str = Field(min_length=1, max_length=128)
    action: Literal["play", "pause", "stop", "reset_context"]


class SaveBody(BaseModel):
    agent_id: str = Field(min_length=1, max_length=128)
    title: str = Field(default="", max_length=120)


class PlaylistCreateBody(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    kind: Literal["playlist", "album"] = "playlist"
    description: str = Field(default="", max_length=2000)
    song_ids: list[str] = Field(default_factory=list, max_length=500)


class PlaylistUpdateBody(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    kind: Literal["playlist", "album"] | None = None


class PlaylistSongsBody(BaseModel):
    song_ids: list[str] = Field(min_length=1, max_length=500)


def _library_errors(error: Exception) -> HTTPException:
    if isinstance(error, live_music.SignInRequired):
        return HTTPException(401, str(error))
    if isinstance(error, LookupError):
        return HTTPException(404, str(error))
    if isinstance(error, ValueError):
        return HTTPException(422, str(error))
    return HTTPException(502, f"{type(error).__name__}: {error}")


@router.post("/music/control")
async def control(request: Request, body: ControlBody, identity: Identity) -> dict:
    """Deck transport: the same ``playback_control`` the agent's ``music_playback_control`` tool calls."""
    _require_loopback(request)
    session = _session_for(body.agent_id, identity)
    try:
        await session.playback_control(body.action)
    except Exception as error:
        raise HTTPException(502, f"{type(error).__name__}: {error}") from error
    return {"action": body.action, "playback": session.playback}


@router.get("/music/take")
async def take(request: Request, agent_id: str, identity: Identity) -> dict:
    _require_loopback(request)
    return _session_for(agent_id, identity).take()


@router.post("/music/take/discard")
async def discard_take(request: Request, body: SaveBody, identity: Identity) -> dict:
    _require_loopback(request)
    session = _session_for(body.agent_id, identity)
    session.recorder.clear()
    take = session.take()
    await session.emit({"type": "music_take", **take})
    return take


@router.post("/music/save")
async def save(request: Request, body: SaveBody, identity: Identity) -> dict:
    _require_loopback(request)
    session = _session_for(body.agent_id, identity)
    try:
        return await live_music.save_take(session, identity.user_id, body.title)
    except live_music.SignInRequired as error:
        raise HTTPException(401, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    except Exception as error:
        raise HTTPException(502, f"{type(error).__name__}: {error}") from error


@router.get("/music/songs")
async def songs(request: Request, identity: Identity) -> dict:
    _require_loopback(request)
    if identity.guest:
        return {"songs": [], "sign_in_required": True}
    try:
        return {"songs": await live_music.list_songs(identity.user_id), "sign_in_required": False}
    except live_music.SignInRequired:
        return {"songs": [], "sign_in_required": True}
    except Exception as error:
        raise HTTPException(502, f"{type(error).__name__}: {error}") from error


@router.delete("/music/songs/{song_id}")
async def delete_song(request: Request, song_id: str, identity: Identity) -> dict:
    _require_loopback(request)
    if identity.guest:
        raise HTTPException(401, "Sign in to Ren to manage saved music.")
    try:
        deleted = await live_music.delete_song(identity.user_id, song_id)
    except live_music.SignInRequired as error:
        raise HTTPException(401, str(error)) from error
    except Exception as error:
        raise HTTPException(502, f"{type(error).__name__}: {error}") from error
    if not deleted:
        raise HTTPException(404, "Song not found")
    return {"deleted": True}


# ─── Playlists / albums ──────────────────────────────────────────────────────

@router.get("/music/playlists")
async def playlists(request: Request, identity: Identity) -> dict:
    _require_loopback(request)
    if identity.guest:
        return {"playlists": [], "sign_in_required": True}
    try:
        return {"playlists": await live_music.list_playlists(identity.user_id), "sign_in_required": False}
    except Exception as error:
        raise _library_errors(error) from error


@router.post("/music/playlists")
async def create_playlist(request: Request, body: PlaylistCreateBody, identity: Identity) -> dict:
    _require_loopback(request)
    _signed_in(identity)
    try:
        return await live_music.create_playlist(identity.user_id, body.title, kind=body.kind, description=body.description, song_ids=body.song_ids)
    except Exception as error:
        raise _library_errors(error) from error


@router.get("/music/playlists/{playlist_id}")
async def get_playlist(request: Request, playlist_id: str, identity: Identity) -> dict:
    _require_loopback(request)
    _signed_in(identity)
    try:
        return await live_music.get_playlist(identity.user_id, playlist_id)
    except Exception as error:
        raise _library_errors(error) from error


@router.patch("/music/playlists/{playlist_id}")
async def update_playlist(request: Request, playlist_id: str, body: PlaylistUpdateBody, identity: Identity) -> dict:
    _require_loopback(request)
    _signed_in(identity)
    try:
        return await live_music.update_playlist(identity.user_id, playlist_id, title=body.title, description=body.description, kind=body.kind)
    except Exception as error:
        raise _library_errors(error) from error


@router.delete("/music/playlists/{playlist_id}")
async def delete_playlist(request: Request, playlist_id: str, identity: Identity) -> dict:
    _require_loopback(request)
    _signed_in(identity)
    try:
        deleted = await live_music.delete_playlist(identity.user_id, playlist_id)
    except Exception as error:
        raise _library_errors(error) from error
    if not deleted:
        raise HTTPException(404, "Playlist not found")
    return {"deleted": True}


@router.post("/music/playlists/{playlist_id}/songs")
async def add_playlist_songs(request: Request, playlist_id: str, body: PlaylistSongsBody, identity: Identity) -> dict:
    _require_loopback(request)
    _signed_in(identity)
    try:
        return await live_music.add_playlist_songs(identity.user_id, playlist_id, body.song_ids)
    except Exception as error:
        raise _library_errors(error) from error


@router.put("/music/playlists/{playlist_id}/songs")
async def reorder_playlist(request: Request, playlist_id: str, body: PlaylistSongsBody, identity: Identity) -> dict:
    _require_loopback(request)
    _signed_in(identity)
    try:
        return await live_music.reorder_playlist(identity.user_id, playlist_id, body.song_ids)
    except Exception as error:
        raise _library_errors(error) from error


@router.delete("/music/playlists/{playlist_id}/songs/{song_id}")
async def remove_playlist_song(request: Request, playlist_id: str, song_id: str, identity: Identity) -> dict:
    _require_loopback(request)
    _signed_in(identity)
    try:
        return await live_music.remove_playlist_song(identity.user_id, playlist_id, song_id)
    except Exception as error:
        raise _library_errors(error) from error
