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
])
def test_stalled_stream_is_surfaced_as_retryable_throttle(monkeypatch, error):
    model, _ = _model(monkeypatch, [_StallingStream(error)])

    async def run():
        with pytest.raises(ModelThrottledException, match="stalled"):
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
