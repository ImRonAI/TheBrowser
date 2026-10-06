"""Teach Ron observe socket: observation ticks, graceful stop, SOP seed, refusals, silence markup."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent.api.core.live_io import OBSERVATION_TICK, STOP_REQUEST, LessonStopped, TeachingObserveInput
from agent.api.core.teaching import TeachingService
from agent.api.endpoints import teaching_observe


class FakeSocket:
    def __init__(self, frames: list[dict]) -> None:
        self.frames = [json.dumps(frame) for frame in frames]
        self.sent: list[dict] = []

    async def receive_text(self) -> str:
        return self.frames.pop(0)

    async def send_text(self, text: str) -> None:
        self.sent.append(json.loads(text))


JPEG = base64.b64encode(b"\xff\xd8jpeg").decode()


@pytest.mark.asyncio
async def test_frames_add_one_realtime_observation_tick_per_interval():
    now = [0.0]
    socket = FakeSocket([{"type": "frame", "data": JPEG}] * 3)
    stream = TeachingObserveInput(socket, tick_seconds=8, clock=lambda: now[0])  # type: ignore[arg-type]
    await stream.start(object())
    assert socket.sent == [{"type": "ready", "audio": True}]

    now[0] = 5
    first = await stream()
    assert first["realtime_input"]["video"]["source"]["bytes"] == b"\xff\xd8jpeg"
    now[0] = 9
    assert "video" in (await stream())["realtime_input"]
    assert await stream() == {"realtime_input": {"text": OBSERVATION_TICK}}
    now[0] = 10
    assert "video" in (await stream())["realtime_input"]
    assert stream.counts == {"frames": 3, "audio": 0, "notes": 0, "ticks": 1}


@pytest.mark.asyncio
async def test_stop_asks_for_finish_observation_then_ends_the_run_after_grace():
    socket = FakeSocket([{"type": "stop"}])
    stream = TeachingObserveInput(socket, stop_grace_seconds=0, clock=lambda: 0.0)  # type: ignore[arg-type]
    await stream.start(object())
    assert await stream() == {"text": STOP_REQUEST}
    assert stream.stop_requested
    with pytest.raises(LessonStopped):
        await stream()


def test_seed_puts_the_native_sop_before_the_untrusted_brief():
    session = {"title": "Watch later", "objective": "Save a video", "context": "", "journal": []}
    seed = teaching_observe.initial_seed(session, "Run this SOP: <agent-sop name=\"learning-a-new-skill\">")
    assert seed[0]["content"][0]["text"].startswith("Run this SOP:")
    assert "untrusted data" in seed[1]["content"][0]["text"]
    assert len(teaching_observe.initial_seed(session)) == 1


def test_silence_markup_is_not_speech():
    assert teaching_observe.spoken_text("<no speech>{pause}") == ""
    assert teaching_observe.spoken_text(" Got it. ") == "Got it."


def _client(monkeypatch, service: TeachingService) -> TestClient:
    monkeypatch.setattr(teaching_observe, "get_teaching_service", lambda: service)
    app = FastAPI()
    app.include_router(teaching_observe.router)
    return TestClient(app)


@pytest.mark.asyncio
async def test_extended_thinking_is_refused_with_an_error_frame(tmp_path: Path, monkeypatch):
    service = TeachingService(tmp_path)
    session = await service.create_session("u", "panel", "Title", "Objective")
    with _client(monkeypatch, service).websocket_connect(
        f"/teaching/sessions/{session['id']}/observe?user_id=u&agent_id=panel&model=gemini-3.8-live-extended-thinking"
    ) as websocket:
        frame = websocket.receive_json()
    assert frame["type"] == "error" and frame["code"] == "invalid_settings"
    assert (await service.get_session("u", "panel", session["id"]))["status"] == "created"


@pytest.mark.asyncio
async def test_busy_lesson_is_refused_with_an_error_frame_not_a_crash(tmp_path: Path, monkeypatch):
    service = TeachingService(tmp_path)
    session = await service.create_session("u", "panel", "Title", "Objective")
    await service.begin_observation("u", "panel", session["id"])
    with _client(monkeypatch, service).websocket_connect(
        f"/teaching/sessions/{session['id']}/observe?user_id=u&agent_id=panel"
    ) as websocket:
        frame = websocket.receive_json()
    assert frame == {"type": "error", "code": "lesson_unavailable",
                     "message": "This lesson cannot be observed in its current state."}
