"""PerplexityResponsesModel: stalled-stream handling and retry integration.

Observed live (Sept 2026): a meaningful fraction of Perplexity Agent API
streams that involve function tools stop emitting after the first output_text
deltas and never close. With the OpenAI client's 600s default read timeout that
presented as an indefinite hang. The adapter now bounds stream reads and maps
the resulting timeout to ModelThrottledException so the native
ModelRetryStrategy re-issues the model call and the turn completes.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import openai
import pytest
from strands import Agent, ModelRetryStrategy
from strands.types.exceptions import ModelThrottledException

from agent.api.core import panel_agent
from agent.api.core.perplexity_model import PerplexityResponsesModel


class _Event:
    def __init__(self, type_, **fields):
        self.type = type_
        self.__dict__.update(fields)


class _StallingStream:
    """Yields a text delta, then raises the given transport error mid-iteration."""

    def __init__(self, error):
        self.error = error
        self.sent = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        self.sent += 1
        if self.sent == 1:
            return _Event("response.created", response=SimpleNamespace(id="resp-1"))
        if self.sent == 2:
            return _Event("response.output_text.delta", delta="partial ")
        raise self.error


class _Responses:
    def __init__(self, streams):
        self.streams = list(streams)
        self.calls = 0

    async def create(self, **kwargs):
        self.calls += 1
        return self.streams.pop(0)


class _Client:
    def __init__(self, responses):
        self.responses = responses

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None


def _model(monkeypatch, streams):
    responses = _Responses(streams)
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda **kwargs: _Client(responses))
    model = PerplexityResponsesModel(client_args={"api_key": "k", "base_url": "u"}, model_id="xai/grok-4.5", stateful=False)
    return model, responses


def _completed_stream(text="done"):
    events = [
        _Event("response.created", response=SimpleNamespace(id="resp-2")),
        _Event("response.output_text.delta", delta=text),
        _Event("response.completed", response=SimpleNamespace(usage=None)),
    ]

    async def gen():
        for event in events:
            yield event

    return gen()


@pytest.mark.parametrize("error", [
    httpx.ReadTimeout("stalled"),
    openai.APITimeoutError(request=httpx.Request("POST", "https://api.perplexity.ai/v1/responses")),
    # Observed live 2026-09-22: a transient connect failure on the first request of a turn
    # ("Connection error."); the next request one second later succeeded. Retry, don't fail.
    openai.APIConnectionError(request=httpx.Request("POST", "https://api.perplexity.ai/v1/responses")),
    # Observed live 2026-09-21: the Agent API closes the SSE body mid-stream
    # ("peer closed connection without sending complete message body (incomplete
    # chunked read)"). Same transient class as a stall: retry, don't fail the turn.
    httpx.RemoteProtocolError("peer closed connection without sending complete message body (incomplete chunked read)"),
])
def test_stalled_stream_is_surfaced_as_retryable_throttle(monkeypatch, error):
    model, _ = _model(monkeypatch, [_StallingStream(error)])

    async def run():
        with pytest.raises(ModelThrottledException, match="stalled|closed|Connection"):
            async for _ in model.stream([{"role": "user", "content": [{"text": "hi"}]}]):
                pass

    asyncio.run(run())


def test_upstream_overloaded_stream_failure_is_retryable(monkeypatch):
    """Observed live 2026-09-21: `response.failed` with error.message 'upstream model is overloaded,
    please try again later' (no HTTP 429, so Strands' classifier sees a plain APIError)."""
    class _FailingStream(_StallingStream):
        async def __anext__(self):
            self.sent += 1
            if self.sent == 1:
                return _Event("response.created", response=SimpleNamespace(id="resp-o"))
            if self.sent == 2:
                return _Event("response.failed", response=SimpleNamespace(
                    error=SimpleNamespace(message="upstream model is overloaded, please try again later", code="server_error")))
            raise StopAsyncIteration

    model, _ = _model(monkeypatch, [_FailingStream(None)])

    async def run():
        with pytest.raises(ModelThrottledException, match="overloaded"):
            async for _ in model.stream([{"role": "user", "content": [{"text": "hi"}]}]):
                pass

    asyncio.run(run())


def test_generic_stream_error_event_is_retryable(monkeypatch):
    """Observed live 2026-09-22: SSE `event: error` -> openai.APIError("Stream error from backend")
    with no status/code. Like the reference adapter, only an explicit permanent set fails the turn;
    every other stream-level error is transient and retried."""
    class _ErrorEventStream(_StallingStream):
        async def __anext__(self):
            self.sent += 1
            if self.sent == 1:
                return _Event("response.created", response=SimpleNamespace(id="resp-e"))
            raise openai.APIError(message="Stream error from backend",
                                  request=httpx.Request("POST", "https://api.perplexity.ai/v1/responses"), body={"message": "Stream error from backend"})

    model, _ = _model(monkeypatch, [_ErrorEventStream(None)])

    async def run():
        with pytest.raises(ModelThrottledException, match="Stream error from backend"):
            async for _ in model.stream([{"role": "user", "content": [{"text": "hi"}]}]):
                pass

    asyncio.run(run())


@pytest.mark.parametrize("code", ["invalid_request", "invalid_request_error", "external_connector_error"])
def test_permanent_api_error_codes_are_not_retried(monkeypatch, code):
    """A client-side/permanent error must surface as-is so the turn fails fast instead of retrying six times."""
    class _PermanentStream(_StallingStream):
        async def __anext__(self):
            self.sent += 1
            if self.sent == 1:
                return _Event("response.created", response=SimpleNamespace(id="resp-p"))
            return _Event("response.failed", response=SimpleNamespace(error=SimpleNamespace(message="bad request", code=code)))

    model, _ = _model(monkeypatch, [_PermanentStream(None)])

    async def run():
        with pytest.raises(Exception) as exc:
            async for _ in model.stream([{"role": "user", "content": [{"text": "hi"}]}]):
                pass
        assert not isinstance(exc.value, ModelThrottledException), type(exc.value)

    asyncio.run(run())


def test_stream_ending_without_terminal_event_is_retryable(monkeypatch):
    """Observed live 2026-09-21: the SSE body ends after text deltas with no response.completed /
    response.incomplete / response.failed. Treat like a stall so the turn is retried, not left half-done."""
    class _TruncatedStream(_StallingStream):
        async def __anext__(self):
            self.sent += 1
            if self.sent == 1:
                return _Event("response.created", response=SimpleNamespace(id="resp-t"))
            if self.sent == 2:
                return _Event("response.output_text.delta", delta="partial")
            raise StopAsyncIteration

    model, _ = _model(monkeypatch, [_TruncatedStream(None)])

    async def run():
        with pytest.raises(ModelThrottledException, match="terminal event"):
            async for _ in model.stream([{"role": "user", "content": [{"text": "hi"}]}]):
                pass

    asyncio.run(run())


def test_native_retry_strategy_recovers_from_one_stall(monkeypatch):
    model, responses = _model(monkeypatch, [_StallingStream(httpx.ReadTimeout("stalled")), _completed_stream("recovered")])
    agent = Agent(model=model, callback_handler=None,
                  retry_strategy=ModelRetryStrategy(max_attempts=3, initial_delay=0, max_delay=0))
    result = asyncio.run(agent.invoke_async("hi"))
    assert result.stop_reason == "end_turn"
    assert responses.calls == 2
    assert "recovered" in str(result)
    # The discarded partial delta from the stalled attempt is not in history.
    assert "partial" not in str(agent.messages)


def test_build_model_bounds_perplexity_stream_reads(monkeypatch):
    from agent.api.core import config as app_config

    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "test-key")
    monkeypatch.setenv("PERPLEXITY_READ_TIMEOUT", "7")
    model = panel_agent.build_model("perplexity", "xai/grok-4.5")
    timeout = model.client_args["timeout"]
    assert isinstance(timeout, httpx.Timeout) and timeout.read == 7.0
    assert model.client_args["max_retries"] == 0  # retries are owned by ModelRetryStrategy


# --- Perplexity-only native tool events (server-side tools) -----------------------------------

def _sse(*payloads):
    import json as _json
    return "".join(f"event: {p['type']}\ndata: {_json.dumps(p)}\n\n" for p in payloads).encode()


_SANDBOX_ITEM = {
    "type": "sandbox_results", "call_id": "call_sb1", "container_id": "c1", "language": "python",
    "code": "print(2+2)", "status": "completed",
    "results": [{"stdout": "4\n", "stderr": "", "exit_code": 0, "duration_ms": 12, "status": "completed"}],
}
_SEARCH_ITEM = {"type": "search_results", "id": "sr1", "queries": ["x"], "results": [{"id": 1, "title": "T", "url": "https://e.test", "snippet": "s"}]}
_FUNCTION_ITEM = {"type": "function_call", "id": "fc1", "call_id": "call_fn1", "name": "tool_catalog", "arguments": "{\"action\":\"list\"}", "status": "completed"}


def _agent_api_body():
    """One Perplexity Agent API turn: reasoning step, search item, sandbox item, function call, message text."""
    resp = {"id": "resp_1", "object": "response", "status": "in_progress", "output": []}
    return _sse(
        {"type": "response.created", "sequence_number": 0, "response": resp},
        {"type": "response.reasoning.search_web", "sequence_number": 1, "queries": ["x"]},
        {"type": "response.output_item.added", "sequence_number": 2, "output_index": 0, "item": _SEARCH_ITEM},
        {"type": "response.output_item.done", "sequence_number": 3, "output_index": 0, "item": _SEARCH_ITEM},
        {"type": "response.output_item.done", "sequence_number": 4, "output_index": 1, "item": _SANDBOX_ITEM},
        {"type": "response.output_item.added", "sequence_number": 5, "output_index": 2, "item": _FUNCTION_ITEM},
        {"type": "response.output_item.done", "sequence_number": 6, "output_index": 2, "item": _FUNCTION_ITEM},
        {"type": "response.output_text.delta", "sequence_number": 7, "item_id": "msg1", "output_index": 3, "content_index": 0, "delta": "four"},
        {"type": "response.completed", "sequence_number": 8, "response": {**resp, "status": "completed", "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}},
    )


def _mock_model(body: bytes, capture: list | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if capture is not None:
            import json as _json
            capture.append(_json.loads(request.content))
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    return PerplexityResponsesModel(
        client_args={"api_key": "k", "base_url": "https://api.perplexity.ai/v1",
                     "http_client": httpx.AsyncClient(transport=httpx.MockTransport(handler))},
        model_id="openai/gpt-5.6-sol", stateful=False,
    )


def test_native_tool_items_surface_as_perplexity_stream_events():
    model = _mock_model(_agent_api_body())

    async def run():
        events = []
        async for event in model.stream([{"role": "user", "content": [{"text": "hi"}]}]):
            events.append(event)
        return events

    events = asyncio.run(run())
    native = [e["perplexity"] for e in events if "perplexity" in e]
    kinds = [n["type"] for n in native]
    # reasoning step + each server-side output item exactly once (from .done, never .added)
    assert kinds == ["response.reasoning.search_web", "response.output_item.done", "response.output_item.done"]
    items = [n["item"]["type"] for n in native if n["type"] == "response.output_item.done"]
    assert items == ["search_results", "sandbox_results"]
    sandbox = next(n["item"] for n in native if n.get("item", {}).get("type") == "sandbox_results")
    assert sandbox["results"][0]["stdout"] == "4\n" and sandbox["code"] == "print(2+2)"
    # the function_call item is NOT a native event; it becomes a normal toolUse with its arguments
    starts = [e["contentBlockStart"]["start"]["toolUse"] for e in events if "contentBlockStart" in e and "toolUse" in e["contentBlockStart"].get("start", {})]
    assert [s["name"] for s in starts] == ["tool_catalog"]
    deltas = [e["contentBlockDelta"]["delta"]["toolUse"]["input"] for e in events if "contentBlockDelta" in e and "toolUse" in e["contentBlockDelta"]["delta"]]
    assert deltas == ['{"action":"list"}']
    text = "".join(e["contentBlockDelta"]["delta"].get("text", "") for e in events if "contentBlockDelta" in e)
    assert text == "four"
    assert [e["messageStop"]["stopReason"] for e in events if "messageStop" in e] == ["tool_use"]


def test_function_tool_schemas_get_object_properties_and_native_tools_pass_through():
    captured: list = []
    model = _mock_model(_sse({"type": "response.created", "response": {"id": "r", "object": "response", "status": "in_progress", "output": []}},
                             {"type": "response.completed", "response": {"id": "r", "object": "response", "status": "completed", "output": [], "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}}),
                        capture=captured)
    model.config["params"] = {"tools": [{"type": "sandbox"}, {"type": "web_search"}], "max_steps": 40}
    spec = {"name": "mcp_client", "description": "d", "inputSchema": {"json": {
        "type": "object", "properties": {"server_config": {"type": "object"}}, "required": []}}}

    async def run():
        async for _ in model.stream([{"role": "user", "content": [{"text": "hi"}]}], tool_specs=[spec]):
            pass

    asyncio.run(run())
    req = captured[0]
    fn = [t for t in req["tools"] if t["type"] == "function"][0]
    # The Agent API rejects `{"type":"object"}` without `properties` (400 invalid request).
    assert fn["parameters"]["properties"]["server_config"] == {"type": "object", "properties": {}}
    assert [t["type"] for t in req["tools"]] == ["sandbox", "web_search", "function"]
    assert req["max_steps"] == 40
