"""Live socket input: the documented Strands inputs (TextBlock, ImageBlock, AudioDelta) and nothing else."""

import base64
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import WebSocket, WebSocketDisconnect
from google.genai import types
from strands.bidi import BidiAgent
from strands.bidi.models.google import GoogleGeminiLiveModel
from strands.bidi.types import AudioDelta
from strands.types.content import TextBlock
from strands.types.media import ImageBlock

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
    assert await LiveSocketInput(socket)() == TextBlock("Still connected")
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
async def test_shared_screen_reaches_gemini_as_image_turns_and_audio_as_realtime(monkeypatch):
    """Starlette -> BidiAgent -> Google: the first frame after sharing starts is an image turn, later
    frames ride with the next typed message, audio is realtime input (strands.bidi.models.google)."""
    session = AsyncMock()
    model = GoogleGeminiLiveModel(model_id="gemini-3.8-live", client_args={"api_key": "test"})
    model._connection_id = "test"
    model._live_session = session
    monkeypatch.setattr(model, "start", AsyncMock())
    monkeypatch.setattr(model, "stop", AsyncMock())
    agent = BidiAgent(model=model)
    first, second = b"\xff\xd8first\xff\xd9", b"\xff\xd8second\xff\xd9"

    def video(data: bytes) -> dict:
        return {"realtime_input": {"video": {"format": "jpeg", "source": {"bytes": base64.b64encode(data).decode()}}}}

    socket, _ = await socket_with(*[
        {"type": "websocket.receive", "text": json.dumps(frame)}
        for frame in (
            {"type": "video_start", "source": "screen"}, video(first),
            video(second), {"realtime_input": {"audio_stream_end": True}}, {"text": "What is this?"},
            {"audio_delta": {"format": "pcm", "source": {"bytes": "AAA="}}},
        )
    ])
    stream = LiveSocketInput(socket)
    try:
        await agent.start()
        await stream.start(agent)
        inputs = [await stream() for _ in range(3)]
        assert inputs[0] == ImageBlock(format="jpeg", source={"bytes": first})
        assert inputs[1] == [TextBlock("What is this?"), ImageBlock(format="jpeg", source={"bytes": second})]
        assert inputs[2] == AudioDelta(format="pcm", source={"bytes": b"\0\0"})
        for value in inputs:
            await agent.send(value)
        turns = [call.kwargs["turns"] for call in session.send_client_content.await_args_list]
        assert [part.inline_data.data if part.inline_data else part.text for turn in turns for part in turn.parts] == [
            first, "What is this?", second,
        ]
        assert [call.kwargs for call in session.send_realtime_input.await_args_list] == [
            {"audio": types.Blob(data=b"\0\0", mime_type="audio/pcm;rate=16000")},
        ]
        assert len(agent.messages) == 2
    finally:
        await agent.stop()


@pytest.mark.asyncio
async def test_context_frame_is_a_text_turn():
    socket, _ = await socket_with({"type": "websocket.receive", "text": json.dumps(
        {"type": "context", "context": {"page_url": "https://example.com"}})})
    value = await LiveSocketInput(socket)()
    assert isinstance(value, TextBlock) and "page_url: https://example.com" in value.text
