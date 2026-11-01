"""Mistral streamed tool-call assembly through the real SDK and the native Agent.

Every test here drives ``RonMistralModel.stream`` with the **installed** ``mistralai`` client
parsing real SSE bytes (``httpx.MockTransport``), so the fragments the adapter sees carry the
SDK's actual defaults: a ``ToolCall`` without ``id`` parses as ``id="null"``, ``index`` defaults
to ``0``, ``model_fields_set`` tells an omitted field from a supplied one. The native ``Agent``
then runs a harmless recording tool with a **required** parameter, so a lost argument surfaces
exactly as the incident did (``Validation failed for input parameters`` / ``{}`` input) instead
of being masked by a permissive fake.

Wire shapes follow the official chat-completions schema (``ToolCall.id`` optional with default
``"null"``, ``ToolCall.index`` identifies fragments, ``FunctionCall.arguments`` object or string,
finish reasons ``stop|length|error|tool_calls``).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest
from strands import Agent, tool
from strands.types.exceptions import ModelThrottledException

from agent.api.core.mistral_model import RonMistralModel

MODEL = "zai-glm-5-3"


# --- SSE fixtures over the real SDK --------------------------------------------------------------

def _chunk(delta: dict[str, Any], finish_reason: str | None = None, usage: dict[str, int] | None = None) -> str:
    body: dict[str, Any] = {
        "id": "cmpl-test", "object": "chat.completion.chunk", "model": MODEL,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    if usage is not None:
        body["usage"] = usage
    return f"data: {json.dumps(body)}\n\n"


def _tool_call(*, index: int | None, id: str | None, name: str | None, arguments: Any) -> dict[str, Any]:
    """One wire ``ToolCall`` fragment. ``None`` omits the field (so the SDK applies its default)."""
    call: dict[str, Any] = {"function": {"arguments": arguments}}
    if name is not None:
        call["function"]["name"] = name
    elif isinstance(arguments, str):
        call["function"]["name"] = ""  # the SDK requires ``name``; the API sends "" on continuations
    if index is not None:
        call["index"] = index
    if id is not None:
        call["id"] = id
    return call


USAGE = {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}


FINAL_TEXT = _chunk({"content": "Done."}, "stop", USAGE)


class Wire:
    """Serves one SSE body per model call (or an HTTP error) to the real ``Mistral`` client and
    records every request. Once the scripted bodies are exhausted the model ends the turn with
    plain text, so a tool turn is followed by a normal final answer."""

    def __init__(self, *bodies: str, status: int = 200, error_body: str | None = None) -> None:
        self.bodies = list(bodies)
        self.status = status
        self.error_body = error_body
        self.requests: list[dict[str, Any]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        if self.status != 200:
            return httpx.Response(self.status, headers={"content-type": "application/json"},
                                  content=(self.error_body or "{}").encode())
        sse = self.bodies.pop(0) if self.bodies else FINAL_TEXT
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content=(sse + "data: [DONE]\n\n").encode())

    def model(self, **kwargs: Any) -> RonMistralModel:
        client = httpx.AsyncClient(transport=httpx.MockTransport(self.handler))
        return RonMistralModel(model_id=MODEL, client_args={"api_key": "offline", "async_client": client}, **kwargs)


def _recorder():
    calls: list[dict[str, Any]] = []

    @tool
    def tool_catalog(action: str, name: str | None = None) -> str:
        """Harmless recording stand-in for a required-parameter tool."""
        calls.append({"action": action, "name": name})
        return "loaded"

    return tool_catalog, calls


def _history_tool_results(agent: Agent) -> list[dict[str, Any]]:
    return [block["toolResult"] for message in agent.messages for block in message["content"] if "toolResult" in block]


def _history_tool_uses(agent: Agent) -> list[dict[str, Any]]:
    return [block["toolUse"] for message in agent.messages for block in message["content"] if "toolUse" in block]


# --- The incident: identity only in the first fragment, index-only continuations ------------------

def test_id_bearing_first_fragment_and_index_only_continuations_deliver_the_arguments():
    """The reported shape: fragment 0 carries id/name with empty arguments, the following fragments
    carry the same ``index`` but no ``id`` (the SDK fills ``"null"``). Exactly one call reaches the
    tool with the complete arguments; no phantom ``"null"`` call exists."""
    wire = Wire(
        _chunk({"role": "assistant", "content": ""})
        + _chunk({"tool_calls": [_tool_call(index=0, id="abc123def", name="tool_catalog", arguments="")]})
        + _chunk({"tool_calls": [_tool_call(index=0, id=None, name=None, arguments='{"action":"load",')]})
        + _chunk({"tool_calls": [_tool_call(index=0, id=None, name=None, arguments='"name":"user_browser"}')]}, "tool_calls", USAGE)
    )
    tool_catalog, calls = _recorder()
    agent = Agent(model=wire.model(), tools=[tool_catalog], callback_handler=None)
    asyncio.run(agent.invoke_async("load the browser"))

    assert calls == [{"action": "load", "name": "user_browser"}]
    uses = _history_tool_uses(agent)
    assert [u["toolUseId"] for u in uses] == ["abc123def"]
    assert uses[0]["input"] == {"action": "load", "name": "user_browser"}
    results = _history_tool_results(agent)
    assert [r["status"] for r in results] == ["success"]
    assert "null" not in {u["toolUseId"] for u in uses}


def test_two_parallel_calls_with_index_only_continuations_stay_separate():
    """Parallel calls (default ``parallel_tool_calls``) whose continuations omit ``id`` must not merge
    into one ``"null"`` bucket: index 0 and index 1 each get their own complete arguments."""
    wire = Wire(
        _chunk({"tool_calls": [
            _tool_call(index=0, id="aaaaaaaaa", name="tool_catalog", arguments=""),
            _tool_call(index=1, id="bbbbbbbbb", name="tool_catalog", arguments=""),
        ]})
        + _chunk({"tool_calls": [_tool_call(index=1, id=None, name=None, arguments='{"action":"load","name":"B"}')]})
        + _chunk({"tool_calls": [_tool_call(index=0, id=None, name=None, arguments='{"action":"load",')]})
        + _chunk({"tool_calls": [_tool_call(index=0, id=None, name=None, arguments='"name":"A"}')]}, "tool_calls", USAGE)
    )
    tool_catalog, calls = _recorder()
    agent = Agent(model=wire.model(), tools=[tool_catalog], callback_handler=None)
    asyncio.run(agent.invoke_async("load both"))
    assert sorted(c["name"] for c in calls) == ["A", "B"]
    uses = _history_tool_uses(agent)
    assert {u["toolUseId"]: u["input"] for u in uses} == {
        "aaaaaaaaa": {"action": "load", "name": "A"},
        "bbbbbbbbb": {"action": "load", "name": "B"},
    }


def test_repeated_full_identity_on_every_fragment_is_one_call():
    """Some servers repeat ``id``/``name`` on every fragment: still exactly one call."""
    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=0, id="rep000000", name="tool_catalog", arguments='{"action":')]})
        + _chunk({"tool_calls": [_tool_call(index=0, id="rep000000", name="tool_catalog", arguments='"load","name":"x"}')]}, "tool_calls", USAGE)
    )
    tool_catalog, calls = _recorder()
    agent = Agent(model=wire.model(), tools=[tool_catalog], callback_handler=None)
    asyncio.run(agent.invoke_async("go"))
    assert calls == [{"action": "load", "name": "x"}]
    assert [u["toolUseId"] for u in _history_tool_uses(agent)] == ["rep000000"]


def test_single_complete_fragment_without_index_is_one_call():
    """A non-streaming-style single fragment (no ``index`` on the wire -> SDK default 0) with a full
    identity and complete arguments is accepted; index zero is never treated as 'absent'."""
    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=None, id="one000000", name="tool_catalog",
                                          arguments='{"action":"load","name":"user_browser"}')]}, "tool_calls", USAGE)
    )
    tool_catalog, calls = _recorder()
    agent = Agent(model=wire.model(), tools=[tool_catalog], callback_handler=None)
    asyncio.run(agent.invoke_async("go"))
    assert calls == [{"action": "load", "name": "user_browser"}]


def test_object_valued_arguments_are_delivered_as_one_json_document():
    """``FunctionCall.arguments`` may be an object (documented). It must reach the native stream as
    serialized JSON, not as a dict concatenated onto a string."""
    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=0, id="obj000000", name="tool_catalog",
                                          arguments={"action": "load", "name": "user_browser"})]}, "tool_calls", USAGE)
    )
    tool_catalog, calls = _recorder()
    agent = Agent(model=wire.model(), tools=[tool_catalog], callback_handler=None)
    asyncio.run(agent.invoke_async("go"))
    assert calls == [{"action": "load", "name": "user_browser"}]


def test_genuine_zero_argument_call_still_dispatches_with_empty_input():
    """A tool with only optional parameters called with empty arguments gets ``{}``, unchanged."""
    seen: list[dict[str, Any]] = []

    @tool
    def ping(note: str | None = None) -> str:
        """Optional-only."""
        seen.append({"note": note})
        return "pong"

    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=0, id="zero00000", name="ping", arguments="")]}, "tool_calls", USAGE)
    )
    agent = Agent(model=wire.model(), tools=[ping], callback_handler=None)
    asyncio.run(agent.invoke_async("go"))
    assert seen == [{"note": None}]
    assert _history_tool_uses(agent)[0]["input"] == {}


# --- Streams that must NOT dispatch a tool body ---------------------------------------------------

def _no_dispatch(wire: Wire) -> tuple[list[dict[str, Any]], Exception | None, Agent]:
    tool_catalog, calls = _recorder()
    agent = Agent(model=wire.model(), tools=[tool_catalog], callback_handler=None)
    error: Exception | None = None
    try:
        asyncio.run(agent.invoke_async("go"))
    except Exception as exc:  # noqa: BLE001 - the test asserts the class below
        error = exc
    return calls, error, agent


def test_truncated_argument_json_never_runs_the_tool():
    """``finish_reason: tool_calls`` with arguments that do not parse: this is a provider/stream
    defect. The tool body is not called and nothing is synthesized to satisfy required fields."""
    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=0, id="trunc0000", name="tool_catalog", arguments='{"action":"load",')]}, "tool_calls", USAGE)
    )
    calls, error, _agent = _no_dispatch(wire)
    assert calls == []
    assert error is not None and "tool_catalog" in str(error) and "argument" in str(error).lower()


def test_error_finish_reason_never_dispatches_buffered_tool_calls():
    """The provider reports ``finish_reason: error`` after streaming a complete-looking call: the call
    is not executable. Nothing runs and the failure is surfaced, not mapped to ``end_turn``."""
    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=0, id="err000000", name="tool_catalog",
                                          arguments='{"action":"load","name":"user_browser"}')]})
        + _chunk({}, "error", USAGE)
    )
    calls, error, _agent = _no_dispatch(wire)
    assert calls == []
    assert error is not None and "error" in str(error).lower()


def test_stream_ending_without_finish_reason_is_incomplete_not_a_turn():
    """EOF before any ``finish_reason`` (connection cut mid-call): the buffered call must not run."""
    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=0, id="eof000000", name="tool_catalog",
                                          arguments='{"action":"load","name":"user_browser"}')]})
    )
    calls, error, _agent = _no_dispatch(wire)
    assert calls == []
    assert error is not None


def test_length_finish_reason_is_truncation_not_a_tool_call():
    """``finish_reason: length`` keeps the native ``max_tokens`` semantics; a buffered partial call is
    not executed."""
    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=0, id="len000000", name="tool_catalog", arguments='{"action":"lo')]}, "length", USAGE)
    )
    calls, error, _agent = _no_dispatch(wire)
    assert calls == []
    from strands.types.exceptions import MaxTokensReachedException
    assert isinstance(error, MaxTokensReachedException)


def test_conflicting_identities_on_one_index_are_rejected():
    """Two different real ids on the same stream index is an ambiguous association: refuse to guess."""
    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=0, id="first0000", name="tool_catalog", arguments='{"action":"load",')]})
        + _chunk({"tool_calls": [_tool_call(index=0, id="second000", name="tool_catalog", arguments='"name":"x"}')]}, "tool_calls", USAGE)
    )
    calls, error, _agent = _no_dispatch(wire)
    assert calls == []
    assert error is not None


def test_continuation_without_any_identity_is_rejected():
    """Argument fragments whose index never received a real id/name cannot be attributed."""
    wire = Wire(
        _chunk({"tool_calls": [_tool_call(index=0, id=None, name=None, arguments='{"action":"load","name":"x"}')]}, "tool_calls", USAGE)
    )
    calls, error, _agent = _no_dispatch(wire)
    assert calls == []
    assert error is not None


# --- Everything else the adapter already did must keep working ----------------------------------

def test_thinking_then_text_then_tool_in_one_stream(monkeypatch):
    """Reasoning chunks, text and a tool call in one response: reasoning streams, text streams, the
    tool runs once, the usage metadata is reported, and the request carried ``reasoning_effort``."""
    think = {"type": "thinking", "thinking": [{"type": "text", "text": "I should load it"}]}
    wire = Wire(
        _chunk({"role": "assistant", "content": [think]})
        + _chunk({"content": [{"type": "thinking", "thinking": [], "closed": True}, {"type": "text", "text": "Loading"}]})
        + _chunk({"tool_calls": [_tool_call(index=0, id="mix000000", name="tool_catalog", arguments="")]})
        + _chunk({"tool_calls": [_tool_call(index=0, id=None, name=None, arguments='{"action":"load","name":"user_browser"}')]}, "tool_calls", USAGE)
    )
    tool_catalog, calls = _recorder()
    model = wire.model(reasoning_effort="high")
    agent = Agent(model=model, tools=[tool_catalog], callback_handler=None)
    result = asyncio.run(agent.invoke_async("load the browser"))
    assert calls == [{"action": "load", "name": "user_browser"}]
    assert wire.requests[0]["reasoning_effort"] == "high"
    first = agent.messages[1]["content"]
    assert first[0] == {"reasoningContent": {"reasoningText": {"text": "I should load it"}}}
    assert first[1] == {"text": "Loading"}
    assert "toolUse" in first[2]
    assert str(result) .strip() == "Done."
    assert result.metrics.accumulated_usage["totalTokens"] >= 18


@pytest.mark.asyncio
async def test_max_effort_reaches_the_wire_through_the_real_sdk():
    """mistralai 2.10.1 drops ``reasoning_effort="max"`` (not in its literal); the adapter's hook must
    put it back on the actual serialized request. Verified against the installed SDK, not a hand-built
    httpx.Request."""
    wire = Wire(_chunk({"content": "ok"}, "stop", USAGE))
    model = wire.model(reasoning_effort="max")
    events = [e async for e in model.stream([{"role": "user", "content": [{"text": "hi"}]}])]
    assert wire.requests[0]["reasoning_effort"] == "max"
    assert events[-2] == {"messageStop": {"stopReason": "end_turn"}}


@pytest.mark.asyncio
async def test_http_errors_are_classified_by_status_code_not_message_text():
    wire = Wire(status=429, error_body='{"message":"Requests rate limit exceeded"}')
    with pytest.raises(ModelThrottledException):
        async for _ in wire.model().stream([{"role": "user", "content": [{"text": "hi"}]}]):
            pass
    # A 400 whose message happens to contain the word "rate" is not throttling.
    wire = Wire(status=400, error_body='{"message":"invalid field: sample_rate"}')
    with pytest.raises(Exception) as info:
        async for _ in wire.model().stream([{"role": "user", "content": [{"text": "hi"}]}]):
            pass
    assert not isinstance(info.value, ModelThrottledException)


# --- tool_choice, non-streaming, structured output, reasoning replay --------------------------------

def _completion(message: dict[str, Any], finish_reason: str = "stop") -> str:
    return json.dumps({
        "id": "cmpl-1", "object": "chat.completion", "model": MODEL, "created": 1,
        "usage": USAGE, "choices": [{"index": 0, "message": {"role": "assistant", **message}, "finish_reason": finish_reason}],
    })


class JsonWire(Wire):
    """Non-streaming: serve one JSON ``ChatCompletionResponse`` per call."""

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        if self.status != 200:
            return httpx.Response(self.status, headers={"content-type": "application/json"},
                                  content=(self.error_body or "{}").encode())
        body = self.bodies.pop(0) if self.bodies else _completion({"content": "Done."})
        return httpx.Response(200, headers={"content-type": "application/json"}, content=body.encode())


@pytest.mark.asyncio
async def test_native_tool_choice_is_translated_onto_the_documented_field():
    wire = Wire(FINAL_TEXT, FINAL_TEXT, FINAL_TEXT)
    model = wire.model()
    spec = {"name": "tool_catalog", "description": "d", "inputSchema": {"json": {"type": "object", "properties": {}}}}
    msgs = [{"role": "user", "content": [{"text": "hi"}]}]
    for choice in ({"auto": {}}, {"any": {}}, {"tool": {"name": "tool_catalog"}}):
        async for _ in model.stream(msgs, [spec], tool_choice=choice):  # type: ignore[arg-type]
            pass
    assert [r.get("tool_choice") for r in wire.requests] == [
        "auto", "any", {"type": "function", "function": {"name": "tool_catalog"}},
    ]
    with pytest.raises(ValueError):
        async for _ in model.stream(msgs, [spec], tool_choice={"tool": {}}):  # type: ignore[arg-type]
            pass


def test_non_streaming_mode_uses_the_same_client_content_and_tool_validation():
    """``stream=False``: chunk-list content (ThinkChunk + TextChunk) renders as reasoning + text, the
    tool call is validated like the streaming path, and ``max`` still reaches the wire."""
    wire = JsonWire(_completion({
        "content": [
            {"type": "thinking", "thinking": [{"type": "text", "text": "plan"}], "signature": "sig-1"},
            {"type": "text", "text": "Loading"},
        ],
        "tool_calls": [{"id": "ns0000000", "index": 0, "function": {"name": "tool_catalog", "arguments": {"action": "load", "name": "user_browser"}}}],
    }, "tool_calls"))
    tool_catalog, calls = _recorder()
    model = wire.model(reasoning_effort="max", stream=False)
    agent = Agent(model=model, tools=[tool_catalog], callback_handler=None)
    asyncio.run(agent.invoke_async("go"))
    assert calls == [{"action": "load", "name": "user_browser"}]
    assert wire.requests[0]["reasoning_effort"] == "max" and wire.requests[0].get("stream") is False
    first = agent.messages[1]["content"]
    assert first[0] == {"reasoningContent": {"reasoningText": {"text": "plan", "signature": "sig-1"}}}
    assert first[1] == {"text": "Loading"} and first[2]["toolUse"]["input"] == {"action": "load", "name": "user_browser"}
    # The second request replays the thinking block with its signature, in order, before the text.
    replayed = wire.requests[1]["messages"][1]
    assert replayed["role"] == "assistant"
    assert replayed["content"][0] == {"type": "thinking", "thinking": [{"type": "text", "text": "plan"}], "signature": "sig-1"}
    assert replayed["content"][1] == {"type": "text", "text": "Loading"}


def test_non_streaming_malformed_arguments_never_run_the_tool():
    wire = JsonWire(_completion({
        "tool_calls": [{"id": "ns0000001", "index": 0, "function": {"name": "tool_catalog", "arguments": '{"action":'}}],
    }, "tool_calls"))
    tool_catalog, calls = _recorder()
    agent = Agent(model=wire.model(stream=False), tools=[tool_catalog], callback_handler=None)
    with pytest.raises(Exception):
        asyncio.run(agent.invoke_async("go"))
    assert calls == []


@pytest.mark.asyncio
async def test_structured_output_goes_through_rons_client_and_validation():
    from pydantic import BaseModel

    class Pick(BaseModel):
        action: str
        name: str

    wire = JsonWire(_completion({
        "tool_calls": [{"id": "so0000000", "index": 0, "function": {"name": "extract_pick", "arguments": '{"action":"load","name":"x"}'}}],
    }, "tool_calls"))
    model = wire.model(reasoning_effort="max")
    outputs = [e async for e in model.structured_output(Pick, [{"role": "user", "content": [{"text": "pick"}]}])]
    assert outputs == [{"output": Pick(action="load", name="x")}]
    sent = wire.requests[0]
    assert sent["tool_choice"] == "any" and sent["parallel_tool_calls"] is False and sent["reasoning_effort"] == "max"

    wire = JsonWire(_completion({
        "tool_calls": [{"id": "so0000001", "index": 0, "function": {"name": "extract_pick", "arguments": '{"action":'}}],
    }, "tool_calls"))
    with pytest.raises(ValueError):
        async for _ in wire.model().structured_output(Pick, [{"role": "user", "content": [{"text": "pick"}]}]):
            pass


def test_reasoning_only_assistant_message_is_replayed_and_others_keep_their_thinking():
    """The vended formatter drops an assistant message that holds only reasoning; the request then
    had fewer assistant messages than the history and the old count guard disabled replay for
    every assistant message. Each message now keeps its own thinking at its own position."""
    model = RonMistralModel(model_id=MODEL, client_args={"api_key": "offline"}, reasoning_effort="high")
    request = model.format_request([
        {"role": "user", "content": [{"text": "a"}]},
        {"role": "assistant", "content": [{"reasoningContent": {"reasoningText": {"text": "only thinking"}}}]},
        {"role": "user", "content": [{"text": "b"}]},
        {"role": "assistant", "content": [
            {"text": "first"},
            {"reasoningContent": {"reasoningText": {"text": "mid", "signature": "s2"}}},
            {"text": "second"},
            {"toolUse": {"toolUseId": "t1", "name": "tool_catalog", "input": {"action": "list"}}},
        ]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": "t1", "status": "success", "content": [{"text": "ok"}]}}]},
        {"role": "user", "content": [{"text": "c"}]},
    ])
    roles = [m["role"] for m in request["messages"]]
    assert roles == ["user", "assistant", "user", "assistant", "tool", "user"]
    assert request["messages"][1]["content"] == [{"type": "thinking", "thinking": [{"type": "text", "text": "only thinking"}]}]
    assert request["messages"][3]["content"] == [
        {"type": "text", "text": "first"},
        {"type": "thinking", "thinking": [{"type": "text", "text": "mid"}], "signature": "s2"},
        {"type": "text", "text": "second"},
    ]
    assert request["messages"][3]["tool_calls"][0]["id"] == "t1"
    assert request["messages"][4] == {"role": "tool", "name": "t1", "content": "ok", "tool_call_id": "t1"}
