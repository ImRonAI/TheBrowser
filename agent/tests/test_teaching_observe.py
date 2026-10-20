"""Teach Ron observe socket: frames pass through untouched, graceful stop, SOP seed, refusals, silence markup."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent.api.core.live_io import DEBRIEF_REQUEST, STOP_REQUEST, LessonStopped, TeachingObserveInput
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
async def test_frames_are_forwarded_as_realtime_video_with_no_synthetic_turns():
    """The model watches the stream itself: no text is ever injected between frames."""
    socket = FakeSocket([{"type": "frame", "data": JPEG}] * 3 + [{"type": "note", "text": " hi "}])
    stream = TeachingObserveInput(socket)  # type: ignore[arg-type]
    await stream.start(object())
    assert socket.sent == [{"type": "ready", "audio": True}]

    for _ in range(3):
        frame = await stream()
        assert frame == {"realtime_input": {"video": {"format": "jpeg", "source": {"bytes": b"\xff\xd8jpeg"}}}}
    assert await stream() == {"text": "hi"}
    assert stream.counts == {"frames": 3, "audio": 0, "notes": 1}


def test_observer_is_silent_during_the_demo_and_talks_in_the_debrief():
    prompt = teaching_observe._OBSERVER_PROMPT
    assert "stay completely silent" in prompt and "Speak only when they speak to you" in prompt
    assert "talk back" not in prompt
    # The debrief: understanding -> corrections -> questions -> implementation plan -> finish_observation.
    assert "[demonstration finished]" in prompt
    for phrase in ("your understanding", "ask every question", "implementation plan", "render_ui", "add_memory", "finish_observation last"):
        assert phrase in prompt, phrase
    # The goal is the outcome, re-implemented with Ron's own tools, not a click replay.
    assert "learning the OUTCOME" in prompt and "not memorising clicks" in prompt


@pytest.mark.asyncio
async def test_finish_demo_starts_the_spoken_debrief_without_a_timer_and_drops_late_frames():
    socket = FakeSocket([{"type": "frame", "data": JPEG}, {"type": "finish_demo"}, {"type": "frame", "data": JPEG},
                         {"type": "finish_demo"}, {"type": "note", "text": "five to eight videos"}, {"type": "stop"}])
    stream = TeachingObserveInput(socket, stop_grace_seconds=0)  # type: ignore[arg-type]
    await stream.start(object())
    assert "video" in (await stream())["realtime_input"]
    assert await stream() == {"text": DEBRIEF_REQUEST}
    assert stream.debriefing and not stream.stop_requested
    assert socket.sent[-1] == {"type": "debrief"}
    # A frame still in flight and a repeated finish_demo are ignored; the user's answer reaches the model.
    assert await stream() == {"text": "five to eight videos"}
    assert stream.counts == {"frames": 1, "audio": 0, "notes": 1}
    # Only "End conversation" (stop) arms the grace timer.
    assert await stream() == {"text": STOP_REQUEST}
    assert stream.stop_requested
    with pytest.raises(LessonStopped):
        await stream()


def test_debrief_request_orders_understanding_questions_then_plan():
    text = DEBRIEF_REQUEST
    assert text.index("understanding") < text.index("every question") < text.index("implementation plan") < text.index("finish_observation")
    for tool in ("http_request", "render_ui", "add_memory", "search_memory"):
        assert tool in text


@pytest.mark.asyncio
async def test_stop_asks_for_finish_observation_then_ends_the_run_after_grace():
    socket = FakeSocket([{"type": "stop"}])
    stream = TeachingObserveInput(socket, stop_grace_seconds=0)  # type: ignore[arg-type]
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
