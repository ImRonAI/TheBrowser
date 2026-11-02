"""Live media transport: image frames are realtime input, not recorded user turns."""

import base64
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import WebSocket, WebSocketDisconnect
from google.genai import types
from strands.bidi import BidiAgent
from strands.bidi.models.google import GoogleGeminiLiveModel

from agent.api.core.live_io import LiveSocketInput


async def socket_with(*messages):
    receive = AsyncMock(side_effect=[{"type": "websocket.connect"}, *messages])
    send = AsyncMock()
    socket = WebSocket({"type": "websocket"}, receive, send)
    await socket.accept()
    return socket, send


@pytest.mark.asyncio
async def test_binary_video_warns_once_without_ending_live_input():
    socket, send = await socket_with(
        {"type": "websocket.receive", "text": json.dumps({"type": "video_start", "mime": "video/webm"})},
        {"type": "websocket.receive", "bytes": b"\x1a\x45\xdf\xa3"},
        {"type": "websocket.receive", "bytes": b"another container chunk"},
        {"type": "websocket.receive", "text": json.dumps({"text": "Still connected"})},
    )
    assert await LiveSocketInput(socket)() == {"text": "Still connected"}
    warnings = [json.loads(call.args[0]["text"]) for call in send.await_args_list
                if call.args[0]["type"] == "websocket.send"]
    assert len(warnings) == 1
    assert warnings[0]["type"] == "warning"
    assert warnings[0]["code"] == "unsupported_video"


@pytest.mark.asyncio
async def test_live_input_preserves_disconnect_code():
    socket, _ = await socket_with({"type": "websocket.disconnect", "code": 1000, "reason": "finished"})
    with pytest.raises(WebSocketDisconnect) as error:
        await LiveSocketInput(socket)()
    assert error.value.code == 1000
    assert error.value.reason == "finished"


@pytest.mark.asyncio
async def test_camera_and_screen_frames_reach_native_google_realtime_api(monkeypatch):
    """The renderer's JSON envelope survives Starlette -> BidiAgent -> Google unchanged."""
    session = AsyncMock()
    model = GoogleGeminiLiveModel(model_id="gemini-3.8-live", client_args={"api_key": "test"})
    model._connection_id = "test"
    model._live_session = session
    monkeypatch.setattr(model, "start", AsyncMock())
    monkeypatch.setattr(model, "stop", AsyncMock())
    agent = BidiAgent(model=model)
    jpeg = b"\xff\xd8synthetic image\xff\xd9"
    video = {"realtime_input": {"video": {"format": "jpeg", "source": {
        "bytes": base64.b64encode(jpeg).decode(),
    }}}}
    socket, _ = await socket_with(*[
        {"type": "websocket.receive", "text": json.dumps(frame)}
        for frame in (
            {"type": "video_start", "source": "camera"}, video,
            {"type": "video_stop"}, {"type": "video_start", "source": "screen"}, video,
            {"type": "video_stop"}, {"audio_delta": {"format": "pcm", "source": {"bytes": "AAA="}}},
        )
    ])
    stream = LiveSocketInput(socket)
    try:
        await agent.start()
        await stream.start(agent)
        for _ in range(3):
            await agent.send(await stream())
        assert [call.kwargs for call in session.send_realtime_input.await_args_list] == [
            {"video": types.Blob(data=jpeg, mime_type="image/jpeg")},
            {"video": types.Blob(data=jpeg, mime_type="image/jpeg")},
            {"audio": types.Blob(data=b"\0\0", mime_type="audio/pcm;rate=16000")},
        ]
        session.send_client_content.assert_not_awaited()
        assert agent.messages == []
    finally:
        await agent.stop()
