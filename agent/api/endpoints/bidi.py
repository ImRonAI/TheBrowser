"""Panel Live: the documented ``strands.bidi.BidiAgent`` on ``GoogleGeminiLiveModel``.

https://strandsagents.com/docs/user-guide/sdk/bidi/models/google/ : the model is built with
``model_id``, ``voice`` and ``client_args``, nothing else. The tool set is ``core.live_tools``: the
text agent's tools minus those ``BidiAgent`` cannot run or Gemini Live cannot declare. The browser is
the Electron MCP server (``electron-playwright-mcp``) for the selected target, a native ``MCPClient``
passed in ``tools``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from strands.bidi.models.google import GoogleGeminiLiveModel

from agent.api.core import config
from agent.api.core.dreaming import index_block
from agent.api.core.live_io import LiveSocketInput, WebSocketOutput, context_text, local_origin
from agent.api.core.live_takeover import pending_work, start_takeover
from agent.api.core.live_tools import close_live_music, create_live_agent, live_id_of

logger = logging.getLogger(__name__)

router = APIRouter()

MODELS = ("gemini-3.8-live",)
DEFAULT_MODEL = MODELS[0]
VOICES = ("Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr")


@router.get("/bidi/settings")
async def live_settings() -> dict:
    return {"models": list(MODELS), "voices": list(VOICES), "efforts": []}


def live_model(model: str, voice: str) -> GoogleGeminiLiveModel:
    return GoogleGeminiLiveModel(model_id=model, voice=voice, client_args={"api_key": config.GEMINI_API_KEY})


async def _read_frame(websocket: WebSocket) -> Any:
    return json.loads(await asyncio.wait_for(websocket.receive_text(), 15))


async def _handshake(websocket: WebSocket) -> tuple[str, list[dict[str, Any]]]:
    """Consume the renderer's opening auth/context frames. Anything else is model input."""
    frame = await _read_frame(websocket)
    pending: list[dict[str, Any]] = []
    if isinstance(frame, dict) and frame.get("type") == "auth":
        frame = await _read_frame(websocket)
    if isinstance(frame, dict) and frame.get("type") == "context":
        context = frame.get("context") if isinstance(frame.get("context"), dict) else {}
        return context_text(context), pending
    if isinstance(frame, dict):
        pending.append(frame)
    return "", pending


async def _send(websocket: WebSocket, payload: dict[str, Any]) -> None:
    await websocket.send_text(json.dumps(payload))


def _music_emitter(websocket: WebSocket) -> Any:
    """Live Music frames (``music_audio_delta`` etc.) ride the same socket as the native ``bidi_*`` events.

    A frame that cannot be sent (socket already closed) is dropped: the music session is closed by the
    socket's ``finally`` and must not fail a tool call over a renderer that went away.
    """
    async def emit(frame: dict[str, Any]) -> None:
        try:
            await websocket.send_text(json.dumps(frame))
        except Exception:
            logger.debug("music frame dropped: socket closed")
    return emit


@router.websocket("/bidi")
async def bidi(
    websocket: WebSocket,
    model: str = DEFAULT_MODEL,
    voice: str = "Kore",
    browser: Literal["user", "cloud"] = "user",
    user_id: str = "default",
    agent_scope: str = "panel",
    session_id: str = "",
    conversation_id: str = "",
) -> None:
    if not local_origin(websocket):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    if model not in MODELS or voice not in VOICES:
        await _send(websocket, {"type": "error", "code": "invalid_settings", "message": "Unsupported Live model or voice."})
        await websocket.close(code=1008)
        return
    # The thread this Live session belongs to (`conversation_id` is the renderer's older name for it).
    # With a thread the BidiAgent carries a native SnapshotSessionManager over the same key as Chat.
    thread_id = (session_id or conversation_id or "").strip()
    agent = None
    end_reason = "the Live socket closed"
    try:
        try:
            context, pending = await _handshake(websocket)
        except (TimeoutError, asyncio.TimeoutError):
            await _send(websocket, {"type": "error", "code": "handshake_timeout", "message": "Live handshake timed out."})
            await websocket.close(code=1008)
            return
        agent, prefix = create_live_agent(
            live_model(model, voice), user_id or "default", agent_scope or "panel", browser,
            emit=_music_emitter(websocket), session_id=thread_id or None,
            context="\n\n".join(part for part in (context, await index_block(user_id or "default")) if part),
        )
        restored = len(agent.messages)
        names = list(agent.tool_names)
        await _send(websocket, {
            "type": "ready",
            "model": model,
            "voice": voice,
            "effort": None,
            "conversation_id": thread_id,
            "session_id": thread_id,
            "tools": names,
            # `snapshot`: the native session manager restored this thread's messages on construction.
            "history_source": "snapshot" if restored else ("client" if context else "none"),
            "restored_messages": restored,
            "music": any(name.startswith("music_") for name in names),
            "music_max_seconds": config.LIVE_MUSIC_RECORD_SECONDS,
            "agent_id": live_id_of(agent),
        })
        if not any(name.startswith(f"{prefix}_") for name in names):
            await _send(websocket, {
                "type": "warning",
                "code": "browser_tools_unavailable",
                "message": f"The Electron MCP server ({prefix}) connected but published no tools.",
            })
        await agent.run(
            inputs=[LiveSocketInput(websocket, pending)],
            outputs=[WebSocketOutput(websocket)],
        )
    except WebSocketDisconnect:
        end_reason = "the app disconnected"
    except Exception as error:
        logger.exception("Live session failed")
        end_reason = f"the Live session failed: {type(error).__name__}"
        try:
            await _send(websocket, {"type": "error", "code": "live_failed", "message": str(error)})
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        if agent is not None:
            try:
                await close_live_music(agent)
            except Exception:
                logger.exception("Live music cleanup failed")
            try:
                agent.tool_registry.cleanup()
            except Exception:
                logger.exception("Live tool cleanup failed")
            await _maybe_take_over(websocket, agent, thread_id, user_id or "default", agent_scope or "panel", end_reason)


async def _maybe_take_over(websocket: WebSocket, agent: Any, thread_id: str, user_id: str, agent_scope: str, reason: str) -> None:
    """Live ended with work pending -> the Chat agent finishes the thread on the cloud browser.

    Only for threads (a ``session_id`` was given, so the BidiAgent persisted natively) and only when
    the recorded thread ends on unfinished work. The runtime is the one ``main.py`` started; a thread
    that already has a reserved run is left alone (409 inside ``start``).
    """
    if not thread_id or not config.LIVE_TAKEOVER_ENABLED or not pending_work(list(agent.messages)):
        return
    manager = getattr(websocket.app.state, "panel_runtime", None)
    if manager is None:
        return
    from agent.api.core.panel_agent import configured_providers, provider_default_model

    providers = configured_providers()
    if not providers:
        logger.warning("session=<%s> | live takeover skipped: no Chat provider configured", thread_id)
        return
    provider = providers[0]
    try:
        await start_takeover(manager, user_id=user_id, session_id=thread_id, destination=agent_scope if agent_scope in ("panel", "search", "build") else "panel",
                             provider=provider, model_id=provider_default_model(provider), reason=reason)
    except Exception:
        logger.exception("session=<%s> | live takeover could not start", thread_id)
