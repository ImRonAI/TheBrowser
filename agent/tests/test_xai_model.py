"""xAI encrypted-state pruning and overflow mapping (agent.api.core.xai_model).

Regression for the 2026-10-09 ``[input_too_large] ... (2152382 tokens > 500000
tokens)`` failure: strands_xai appends the whole encrypted protobuf history to
every assistant turn, only ever reads the newest copy, and does not recognise
xAI's overflow message, so a 68-turn grok-4.7 thread grew quadratically (47 MB of
state for 0.3 MB of transcript) and died without the SDK summarizer running.
"""

from __future__ import annotations

import base64
import json
from typing import Any

import pytest
from strands.types.exceptions import ContextWindowOverflowException
from strands_xai import xai as _xai

from agent.api.core import config as app_config
from agent.api.core import panel_agent
from agent.api.core.xai_model import (
    EXTRA_CONTEXT_WINDOW_LIMITS,
    RonXAIModel,
    XAIStatePruner,
    is_xai_state_block,
    prune_superseded_xai_state,
    without_superseded_xai_state,
)


def _state_blob(turn: int, size: int = 1000) -> dict[str, Any]:
    payload = base64.b64encode(json.dumps({"messages": ["x" * size] * turn}).encode()).decode()
    text = f"{_xai.XAI_STATE_MARKER}{payload}{_xai.XAI_STATE_MARKER_END}"
    return {"reasoningContent": {"redactedContent": text.encode("utf-8")}}


def _turn(turn: int) -> list[dict[str, Any]]:
    return [
        {"role": "user", "content": [{"text": f"question {turn}"}]},
        {"role": "assistant", "content": [{"text": f"answer {turn}"}, _state_blob(turn)]},
    ]


def test_state_block_detection_handles_bytes_and_str():
    assert is_xai_state_block(_state_blob(1))
    text = _state_blob(1)["reasoningContent"]["redactedContent"].decode()
    assert is_xai_state_block({"reasoningContent": {"redactedContent": text}})
    assert not is_xai_state_block({"reasoningContent": {"reasoningText": {"text": "thinking"}}})
    assert not is_xai_state_block({"reasoningContent": {"redactedContent": b"opaque-provider-bytes"}})
    assert not is_xai_state_block({"text": "hello"})


def test_prune_keeps_only_newest_blob_and_all_transcript():
    messages = [block for turn in range(1, 6) for block in _turn(turn)]
    removed = prune_superseded_xai_state(messages)
    assert removed == 4
    blobs = [(i, j) for i, m in enumerate(messages) for j, b in enumerate(m["content"]) if is_xai_state_block(b)]
    assert blobs == [(9, 1)]  # last assistant message keeps its blob
    # Every answer/question text survives, in order.
    assert [b["text"] for m in messages for b in m["content"] if "text" in b] == [
        t for turn in range(1, 6) for t in (f"question {turn}", f"answer {turn}")
    ]
    assert prune_superseded_xai_state(messages) == 0


def test_without_superseded_state_is_a_non_mutating_view():
    messages = [block for turn in range(1, 4) for block in _turn(turn)]
    before = json.dumps(messages, default=repr)
    view = without_superseded_xai_state(messages)
    assert json.dumps(messages, default=repr) == before
    assert sum(is_xai_state_block(b) for m in view for b in m["content"]) == 1
    assert is_xai_state_block(view[-1]["content"][-1])
    single = [block for block in _turn(1)]
    assert without_superseded_xai_state(single) is single


def test_pruner_hook_trims_agent_messages_as_turns_are_added():
    class FakeAgent:
        def __init__(self) -> None:
            self.messages: list[dict[str, Any]] = []

    class FakeEvent:
        def __init__(self, agent: FakeAgent, message: dict[str, Any]) -> None:
            self.agent, self.message = agent, message

    agent = FakeAgent()
    pruner = XAIStatePruner()
    for turn in range(1, 8):
        for message in _turn(turn):
            agent.messages.append(message)
            pruner._on_message_added(FakeEvent(agent, message))  # noqa: SLF001
        blobs = sum(is_xai_state_block(b) for m in agent.messages for b in m["content"])
        assert blobs == 1, f"turn {turn} kept {blobs} blobs"
    # Linear, not quadratic: the serialized history grows by one blob of the latest size only.
    size = len(json.dumps(agent.messages, default=lambda b: b.decode() if isinstance(b, bytes) else repr(b)))
    assert size < len(json.dumps(_state_blob(7), default=lambda b: b.decode())) + 4000


@pytest.mark.asyncio
async def test_stream_sends_single_state_blob_and_maps_input_too_large(monkeypatch):
    monkeypatch.setattr(app_config, "XAI_API_KEY", "xai-test")
    monkeypatch.setattr(panel_agent, "XAI_NATIVE_TOOLS_ENABLED", False)
    model = panel_agent.build_model("xai", "grok-4.7")
    assert isinstance(model, RonXAIModel)

    seen: dict[str, Any] = {}

    async def fake_parent_stream(self, messages, tool_specs=None, system_prompt=None, tool_choice=None, **kwargs):
        seen["blobs"] = sum(is_xai_state_block(b) for m in messages for b in m["content"])
        seen["messages"] = len(messages)
        if seen.get("explode"):
            raise RuntimeError(
                "<AioRpcError of RPC that terminated with: status = StatusCode.INVALID_ARGUMENT details = "
                '"Failed to start sampling: [input_too_large] The prompt is too long for this model\'s context '
                'window (2152382 tokens > 500000 tokens)">'
            )
        yield {"messageStart": {"role": "assistant"}}

    monkeypatch.setattr(_xai.xAIModel, "stream", fake_parent_stream)

    history = [block for turn in range(1, 6) for block in _turn(turn)]
    history.append({"role": "user", "content": [{"text": "next"}]})
    events = [e async for e in model.stream(history)]
    assert events == [{"messageStart": {"role": "assistant"}}]
    assert seen["blobs"] == 1 and seen["messages"] == len(history)

    seen["explode"] = True
    with pytest.raises(ContextWindowOverflowException, match="input_too_large"):
        async for _ in model.stream(history):
            pass


def test_grok_4_7_context_window_is_registered():
    assert EXTRA_CONTEXT_WINDOW_LIMITS["grok-4.7"] == 500_000
    assert _xai._resolve_context_window_limit("grok-4.7") == 500_000
    assert _xai._resolve_context_window_limit("xai/grok-4.7") == 500_000
