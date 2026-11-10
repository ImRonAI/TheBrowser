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


class _StubFunction:
    def __init__(self, name: str, arguments: str) -> None:
        self.name = name
        self.arguments = arguments


class _StubToolCall:
    def __init__(self, call_id: str, tool_type: str, name: str, arguments: str, status: str = "") -> None:
        self.id = call_id
        self.type = tool_type
        self.function = _StubFunction(name, arguments)
        self.status = status
        self.error_message = ""


class _StubCitation:
    def __init__(
        self,
        cit_id: str,
        *,
        web_url: str = "",
        x_url: str = "",
        start_index: int = 0,
        end_index: int = 0,
    ) -> None:
        self.id = cit_id
        self.web_citation = type("WebCit", (), {"url": web_url})() if web_url else None
        self.x_citation = type("XCit", (), {"url": x_url})() if x_url else None
        self.start_index = start_index
        self.end_index = end_index


class _StubToolOutputChunk:
    def __init__(self, tool_calls: list[_StubToolCall], citations: list[_StubCitation]) -> None:
        self.tool_calls = tool_calls
        self.proto = type("Proto", (), {"delta": type("Delta", (), {"citations": citations})()})()
        self.content = ""


class _StubChunk:
    def __init__(
        self,
        *,
        reasoning_content: str = "",
        content: str = "",
        tool_calls: list[_StubToolCall] | None = None,
        tool_outputs: list[_StubToolOutputChunk] | None = None,
        inline_citations: list[_StubCitation] | None = None,
    ) -> None:
        self.reasoning_content = reasoning_content
        self.content = content
        self.tool_calls = tool_calls or []
        self.tool_outputs = tool_outputs or []
        self.inline_citations = inline_citations or []


@pytest.mark.asyncio
async def test_native_web_search_x_search_and_image_results_stream_without_text_pollution(monkeypatch):
    monkeypatch.setattr(app_config, "XAI_API_KEY", "xai-test")
    monkeypatch.setattr(panel_agent, "XAI_NATIVE_TOOLS_ENABLED", True)
    model = panel_agent.build_model("xai", "grok-4.6")
    assert isinstance(model, RonXAIModel)

    markdown_body = (
        "Here is Starship: ![SpaceX Starship on pad](https://img.example.com/starship.jpg) "
        "and updates from X."
    )
    img_start = markdown_body.index("![SpaceX")
    img_end = markdown_body.index(".jpg)") + 5

    chunks = [
        _StubChunk(reasoning_content="**Searching** Checking sources. "),
        _StubChunk(
            tool_calls=[
                _StubToolCall("call-web-1", "web_search_tool", "web_search", '{"query": "SpaceX Starship launch"}'),
                _StubToolCall("call-x-1", "x_search_tool", "x_keyword_search", '{"query": "Starship from:elonmusk"}'),
                _StubToolCall(
                    "call-img-1",
                    "web_search_tool",
                    "search_images",
                    '{"image_description": "SpaceX Starship rocket", "number_of_images": 1}',
                ),
            ]
        ),
        _StubChunk(
            tool_outputs=[
                _StubToolOutputChunk(
                    [
                        _StubToolCall(
                            "call-web-1",
                            "web_search_tool",
                            "web_search",
                            '{"query": "SpaceX Starship launch"}',
                            status="TOOL_CALL_STATUS_COMPLETED",
                        )
                    ],
                    [_StubCitation("1", web_url="https://www.spacex.com/vehicles/starship")],
                ),
                _StubToolOutputChunk(
                    [
                        _StubToolCall(
                            "call-x-1",
                            "x_search_tool",
                            "x_keyword_search",
                            '{"query": "Starship from:elonmusk"}',
                            status="TOOL_CALL_STATUS_COMPLETED",
                        )
                    ],
                    [_StubCitation("2", x_url="https://x.com/i/status/2115634093949911506")],
                ),
                _StubToolOutputChunk(
                    [
                        _StubToolCall(
                            "call-img-1",
                            "web_search_tool",
                            "search_images",
                            '{"image_description": "SpaceX Starship rocket", "number_of_images": 1}',
                            status="TOOL_CALL_STATUS_COMPLETED",
                        )
                    ],
                    [],
                ),
            ]
        ),
        _StubChunk(reasoning_content="Synthesizing findings."),
        _StubChunk(
            content=markdown_body,
            inline_citations=[
                _StubCitation(
                    "img-1",
                    web_url="https://img.example.com/starship.jpg",
                    start_index=img_start,
                    end_index=img_end,
                ),
                _StubCitation("2", x_url="https://x.com/elonmusk/status/2115634093949911506"),
            ],
        ),
    ]

    class _FakeResponse:
        def __init__(self) -> None:
            self.content = ""
            self.citations = ["https://www.spacex.com/vehicles/starship", "https://x.com/elonmusk/status/2115634093949911506"]
            self.inline_citations = chunks[-1].inline_citations
            self.encrypted_content = "enc-state"
            self.usage = type("Usage", (), {"prompt_tokens": 10, "completion_tokens": 20, "reasoning_tokens": 5, "cached_prompt_text_tokens": 0})()

    class _FakeChat:
        def __init__(self) -> None:
            self.messages: list[Any] = []

        def append(self, msg: Any) -> None:
            pass

        async def stream(self):
            resp = _FakeResponse()
            for ch in chunks:
                if ch.content:
                    resp.content += ch.content
                yield resp, ch

    monkeypatch.setattr(model, "_get_client", lambda: object())
    monkeypatch.setattr(model, "_build_chat", lambda client, tool_specs=None, tool_choice=None: _FakeChat())
    monkeypatch.setattr(model, "_append_messages_to_chat", lambda chat, messages, system_prompt: None)
    monkeypatch.setattr(model, "_capture_xai_state", lambda chat, response: ["proto-msg-1"])

    events = [e async for e in model.stream([{"role": "user", "content": [{"text": "Starship update"}]}])]

    # 1. No [xAI Tool: ...] string is injected into assistant text blocks.
    text_deltas = [
        e["contentBlockDelta"]["delta"]["text"]
        for e in events
        if "contentBlockDelta" in e and "text" in e["contentBlockDelta"]["delta"]
    ]
    assert "".join(text_deltas) == markdown_body
    assert "[xAI Tool:" not in "".join(text_deltas)

    # 2. Reasoning deltas remain contiguous and unbroken by server-side tool calls.
    reasoning_deltas = [
        e["contentBlockDelta"]["delta"]["reasoningContent"]["text"]
        for e in events
        if "contentBlockDelta" in e
        and "reasoningContent" in e["contentBlockDelta"]["delta"]
        and "text" in e["contentBlockDelta"]["delta"]["reasoningContent"]
    ]
    assert "".join(reasoning_deltas) == "**Searching** Checking sources. Synthesizing findings."

    # 3. Native tool events are emitted for web_search, x_search, and image_search_results.
    native_events = [e["xai"] for e in events if "xai" in e]
    by_type: dict[str, list[dict[str, Any]]] = {}
    for payload in native_events:
        item = payload["item"]
        by_type.setdefault(item["type"], []).append(item)

    assert "search_results" in by_type
    assert by_type["search_results"][0]["status"] == "in_progress"
    assert by_type["search_results"][-1]["status"] == "completed"
    assert by_type["search_results"][-1]["queries"] == ["SpaceX Starship launch"]
    assert by_type["search_results"][-1]["results"] == [
        {"url": "https://www.spacex.com/vehicles/starship", "title": "spacex.com · starship", "source": "web"}
    ]

    assert "x_search_results" in by_type
    assert by_type["x_search_results"][0]["status"] == "in_progress"
    assert by_type["x_search_results"][-1]["status"] == "completed"
    assert by_type["x_search_results"][-1]["queries"] == ["Starship from:elonmusk"]
    # /i/status/<id> is enriched in-place with @elonmusk when the assistant inline citation arrives.
    assert by_type["x_search_results"][-1]["results"] == [
        {
            "url": "https://x.com/elonmusk/status/2115634093949911506",
            "title": "@elonmusk · 2115634093949911506",
            "source": "x",
        }
    ]

    assert "image_search_results" in by_type
    assert by_type["image_search_results"][0]["status"] == "in_progress"
    assert by_type["image_search_results"][-1]["status"] == "completed"
    assert by_type["image_search_results"][-1]["queries"] == ["SpaceX Starship rocket"]
    assert by_type["image_search_results"][-1]["results"] == [
        {
            "image_url": "https://img.example.com/starship.jpg",
            "origin_url": "https://img.example.com/starship.jpg",
            "title": "SpaceX Starship on pad",
        }
    ]


@pytest.mark.asyncio
async def test_state_blob_excludes_the_per_call_context_the_model_saw(monkeypatch):
    """The blob is durable history; ContextInjector text arrives as dynamic_trailing_blocks."""
    monkeypatch.setattr(app_config, "XAI_API_KEY", "xai-test")
    monkeypatch.setattr(panel_agent, "XAI_NATIVE_TOOLS_ENABLED", False)
    model = panel_agent.build_model("xai", "grok-4.7")

    class _Response:
        content, citations, inline_citations, encrypted_content, usage = "done", None, None, "enc", None

    class _Chat:
        def __init__(self) -> None:
            self.messages: list[Any] = []

        async def stream(self):
            yield _Response(), _StubChunk(content="done")

    sent: list[list[Any]] = []

    def append(chat, messages, system_prompt):
        chat.messages = [block.get("text") for message in messages for block in message["content"]]
        sent.append(chat.messages)

    monkeypatch.setattr(model, "_get_client", lambda: object())
    monkeypatch.setattr(model, "_build_chat", lambda client, tool_specs=None, tool_choice=None: _Chat())
    monkeypatch.setattr(model, "_append_messages_to_chat", append)
    monkeypatch.setattr(model, "_capture_xai_state", lambda chat, response: [*chat.messages, response.content])

    messages = [{"role": "user", "content": [{"text": "question"}, {"text": "BROWSER CONTEXT"}]}]
    events = [e async for e in model.stream(messages, dynamic_trailing_blocks=1)]

    assert sent[0] == ["question", "BROWSER CONTEXT"]  # the model saw the context
    blob = next(e["contentBlockDelta"]["delta"]["reasoningContent"]["redactedContent"] for e in events
                if "redactedContent" in e.get("contentBlockDelta", {}).get("delta", {}).get("reasoningContent", {}))
    payload = blob.decode()[len(_xai.XAI_STATE_MARKER):-len(_xai.XAI_STATE_MARKER_END)]
    assert json.loads(base64.b64decode(payload))["messages"] == ["question", "done"]


def test_pruner_drops_the_blob_and_retries_when_it_overflows():
    class FakeAgent:
        def __init__(self) -> None:
            self.messages = [block for turn in range(1, 3) for block in _turn(turn)]
            prune_superseded_xai_state(self.messages)

    class FakeEvent:
        def __init__(self, agent: FakeAgent, exception: Exception | None) -> None:
            self.agent, self.exception, self.retry = agent, exception, False

    pruner = XAIStatePruner()
    agent = FakeAgent()
    other = FakeEvent(agent, RuntimeError("unavailable"))
    pruner._on_after_model_call(other)  # noqa: SLF001
    assert other.retry is False and any(is_xai_state_block(b) for m in agent.messages for b in m["content"])

    overflow = FakeEvent(agent, ContextWindowOverflowException("input_too_large"))
    pruner._on_after_model_call(overflow)  # noqa: SLF001
    assert overflow.retry is True
    assert not any(is_xai_state_block(b) for m in agent.messages for b in m["content"])
    assert [b["text"] for m in agent.messages for b in m["content"] if "text" in b] == [
        "question 1", "answer 1", "question 2", "answer 2"]

    again = FakeEvent(agent, ContextWindowOverflowException("input_too_large"))
    pruner._on_after_model_call(again)  # noqa: SLF001
    assert again.retry is False  # nothing left to drop: the conversation manager takes over
