"""``ToolCallRecovery``: re-prompt extended-thinking when it drops a tool call (python-genai#3015)."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from agent.api.core.live_io import TOOL_NUDGE, ToolCallRecovery


class FakeAgent:
    def __init__(self) -> None:
        self.sent: list[Any] = []

    async def send(self, data: Any) -> None:
        self.sent.append(data)


def status(state: str, *, turn_complete: bool = True) -> dict[str, Any]:
    return {"type": "bidi_interaction_status", "status": state, "turn_complete": turn_complete}


def said(text: str, role: str = "assistant") -> dict[str, Any]:
    return {"type": "bidi_transcript_delta", "role": role, "delta": text, "content_id": "c"}


async def feed(stream: ToolCallRecovery, *events: dict[str, Any]) -> None:
    for event in events:
        await stream(event)


@pytest.fixture
def recovery() -> tuple[ToolCallRecovery, FakeAgent, list[dict[str, Any]]]:
    reports: list[dict[str, Any]] = []

    async def report(frame: dict[str, Any]) -> None:
        reports.append(frame)

    stream = ToolCallRecovery(report, stall_seconds=0.05, max_per_turn=2)
    agent = FakeAgent()
    return stream, agent, reports


@pytest.mark.asyncio
async def test_apology_without_tool_call_is_nudged_once(recovery) -> None:
    stream, agent, reports = recovery
    await stream.start(agent)
    await feed(stream, said("Play lofi", "user"), said("Let me set that mood for you."), status("in_progress"),
               said("I'm sorry, but a system error occurred."), status("idle"))
    assert agent.sent == [{"realtime_input": {"text": TOOL_NUDGE}}]
    assert len(reports) == 1
    assert reports[0]["type"] == "warning" and reports[0]["code"] == "tool_call_recovered"
    assert reports[0]["reason"] == "apology" and reports[0]["attempt"] == 1
    assert "dropped a tool call" in reports[0]["message"]


@pytest.mark.asyncio
async def test_turn_with_a_real_tool_call_is_never_nudged(recovery) -> None:
    stream, agent, _ = recovery
    await stream.start(agent)
    await feed(stream, said("Play lofi", "user"), said("Setting that up."), status("in_progress"),
               {"type": "bidi_tool_use_blocks", "tool_uses": [{"name": "music_set_weighted_prompts"}]},
               said("A system error occurred in the tool output."), status("idle"))
    await asyncio.sleep(0.1)
    assert agent.sent == []


@pytest.mark.asyncio
async def test_in_progress_stall_without_tool_call_is_nudged(recovery) -> None:
    stream, agent, reports = recovery
    await stream.start(agent)
    await feed(stream, said("Find a flight", "user"), said("Let me check the options."), status("in_progress"))
    await asyncio.sleep(0.12)
    assert agent.sent == [{"realtime_input": {"text": TOOL_NUDGE}}]
    assert reports[0]["reason"] == "stall"


@pytest.mark.asyncio
async def test_tool_call_during_stall_window_cancels_the_nudge(recovery) -> None:
    stream, agent, _ = recovery
    await stream.start(agent)
    await feed(stream, said("Find a flight", "user"), status("in_progress"))
    await asyncio.sleep(0.01)
    await stream({"type": "bidi_tool_use_blocks", "tool_uses": [{"name": "search_flights"}]})
    await asyncio.sleep(0.1)
    assert agent.sent == []


@pytest.mark.asyncio
async def test_nudges_are_bounded_per_user_turn_and_reset_by_the_next_one(recovery) -> None:
    stream, agent, _ = recovery
    await stream.start(agent)
    await feed(stream, said("Play lofi", "user"))
    for _ in range(3):
        await feed(stream, said("A system error occurred."), status("idle"))
    assert len(agent.sent) == 2
    await feed(stream, said("Try again", "user"), said("System error occurred."), status("idle"))
    assert len(agent.sent) == 3
    await stream.stop()


@pytest.mark.asyncio
async def test_clean_idle_turn_is_left_alone(recovery) -> None:
    stream, agent, _ = recovery
    await stream.start(agent)
    await feed(stream, said("Hello", "user"), said("Hi there, how can I help?"), status("idle"))
    assert agent.sent == [] and stream.nudges == 0
