"""Opt-in paid-provider smoke test; never records microphone or screen content."""

import asyncio
import os
import time

import pytest
from strands import tool
from strands.bidi import BidiAgent
from strands.bidi.models.google import GoogleGeminiLiveModel

from agent.api.core import config


@pytest.mark.skipif(os.getenv("RON_TEST_LIVE_BIDI") != "1", reason="Set RON_TEST_LIVE_BIDI=1 for provider acceptance")
@pytest.mark.parametrize("model_id", ["gemini-3.8-live", "gemini-3.8-live-extended-thinking"])
@pytest.mark.asyncio
async def test_live_audio_with_native_delayed_function(model_id):
    started = asyncio.Event()
    finished = asyncio.Event()
    result_received = asyncio.Event()
    completion = asyncio.Event()
    audio_during_tool = []
    audio_received = []
    tool_calls = []
    statuses = []

    @tool
    async def delayed_check() -> dict:
        """Run a harmless three-second diagnostic and return its verification word."""
        tool_calls.append(time.monotonic())
        started.set()
        await asyncio.sleep(3)
        finished.set()
        return {"status": "success", "retryable": False, "message": "Verification word: blueberry."}

    agent = BidiAgent(
        model=GoogleGeminiLiveModel(
            model_id=model_id,
            client_args={"api_key": config.GEMINI_API_KEY, "http_options": {"api_version": "v1beta"}},
            params={"thinking_config": {"thinking_level": "HIGH"}}
            if model_id.endswith("extended-thinking") else {},
        ),
        tools=[delayed_check],
        system_prompt=(
            "You are a voice integration test. Call delayed_check exactly once when requested. "
            "While it runs, speak a short explanation of what you are waiting for. "
            "When it returns, speak its verification word and finish. No other tasks."
        ),
    )

    async def receive():
        async for event in agent.receive():
            kind = event.get("type")
            if kind == "bidi_audio_delta":
                audio_received.append(time.monotonic())
                if started.is_set() and not finished.is_set():
                    audio_during_tool.append(time.monotonic())
            if kind == "tool_result":
                result_received.set()
            if kind == "bidi_interaction_status":
                statuses.append(event.get("status"))
                if event.get("status") == "idle" and result_received.is_set():
                    completion.set()
            if kind == "bidi_response_stop" and model_id == "gemini-3.8-live" and result_received.is_set():
                completion.set()

    reader = None
    try:
        await asyncio.wait_for(agent.start(), timeout=25)
        reader = asyncio.create_task(receive())
        await agent.send("Please run the diagnostic now and keep speaking briefly while it runs.")
        waiter = asyncio.create_task(completion.wait())
        try:
            done, _ = await asyncio.wait([reader, waiter], timeout=90, return_when=asyncio.FIRST_COMPLETED)
            if reader in done:
                reader.result()
            assert waiter in done, (
                f"Live interaction did not finish: calls={len(tool_calls)}, "
                f"result_received={result_received.is_set()}, statuses={statuses}"
            )
        finally:
            waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)
        assert len(tool_calls) == 1, "Expected exactly one native diagnostic tool invocation"
        assert audio_received, "No native speech received"
        if model_id.endswith("extended-thinking"):
            assert audio_during_tool, "No audio arrived during the delayed asynchronous function"
            assert "idle" in statuses, "Extended Thinking never signalled completion"
    finally:
        if reader is not None:
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)
        await asyncio.wait_for(agent.stop(), timeout=10)
