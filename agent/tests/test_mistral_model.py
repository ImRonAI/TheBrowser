"""Native provider request ordering with separate runtime context messages."""

import copy

import pytest
from strands.models.mistral import MistralModel
from strands.models.openai_responses import OpenAIResponsesModel

from agent.api.core.panel_agent import build_model


@pytest.mark.parametrize("tool_count", [1, 2])
@pytest.mark.parametrize("inline_context", [False, True])
@pytest.mark.parametrize("context", [None, "Browser context for this request", "User steering note"])
def test_tool_results_precede_injected_user_text(monkeypatch, tool_count, inline_context, context):
    monkeypatch.setenv("MISTRAL_API_KEY", "offline-test-key")
    model = build_model("mistral", "mistral-vibe-cli-latest", "high")
    ids = [f"call0000{i}" for i in range(tool_count)]
    tool_result_blocks = [
        {"toolResult": {"toolUseId": id, "status": "success", "content": [{"text": "done"}]}}
        for id in ids
    ]
    if context and inline_context:
        # SDK dynamic_trailing_blocks (ContextInjector, memory injection) appends text to the trailing
        # user toolResult message itself rather than creating a second user message.
        trailing = [{"role": "user", "content": [*tool_result_blocks, {"text": context}]}]
    else:
        trailing = [
            {"role": "user", "content": tool_result_blocks},
            *([{"role": "user", "content": [{"text": context}]}] if context else []),
        ]
    messages = [
        {"role": "user", "content": [{"text": "Check the browser"}]},
        {"role": "assistant", "content": [
            {"reasoningContent": {"reasoningText": {"text": "Inspecting first"}}},
            *[{"toolUse": {"toolUseId": id, "name": "inspect", "input": {}}} for id in ids],
        ]},
        *trailing,
    ]
    original = copy.deepcopy(messages)
    assert isinstance(model, MistralModel)  # RonMistralModel subclass keeps the vended formatter
    request = model.format_request(messages, system_prompt="Be helpful")
    formatted = request["messages"]
    assert [message["role"] for message in formatted] == [
        "system", "user", "assistant", *(["tool"] * tool_count), *(["user"] if context else [])
    ]
    assert formatted[2]["content"] == [{"type": "thinking", "thinking": [{"type": "text", "text": "Inspecting first"}]}]
    assert [message["tool_call_id"] for message in formatted if message["role"] == "tool"] == ids
    if context:
        assert formatted[-1]["content"] == context
    assert messages == original


@pytest.mark.parametrize("provider", ["openai", "perplexity"])
@pytest.mark.parametrize("tool_count", [1, 2])
def test_responses_function_outputs_precede_injected_context(monkeypatch, provider, tool_count):
    monkeypatch.setenv(f"{provider.upper()}_API_KEY", "offline-test-key")
    model = build_model(provider, "gpt-5" if provider == "openai" else "xai/grok-4.5")
    messages = [
        {"role": "user", "content": [{"text": "Check"}]},
        {"role": "assistant", "content": [
            {"toolUse": {"toolUseId": f"call{i}", "name": "inspect", "input": {}}}
            for i in range(tool_count)
        ]},
        {"role": "user", "content": [
            {"toolResult": {"toolUseId": f"call{i}", "content": [{"text": "done"}], "status": "success"}}
            for i in range(tool_count)
        ]},
        {"role": "user", "content": [{"text": "Browser context and steering"}]},
    ]
    original = copy.deepcopy(messages)
    if provider == "openai":
        assert type(model) is OpenAIResponsesModel
    else:
        assert type(model).__bases__ == (OpenAIResponsesModel,)
    formatted = model._format_request_messages(messages)
    assert [m.get("type", m.get("role")) for m in formatted] == [
        "user", *(["function_call"] * tool_count), *(["function_call_output"] * tool_count), "user",
    ]
    assert messages == original

# --- reasoning_effort + thinking chunks (agent.api.core.mistral_model) -------------------


class _Chunk:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _event(content=None, finish_reason=None, usage=None, tool_calls=None):
    delta = _Chunk(content=content, tool_calls=tool_calls)
    choice = _Chunk(delta=delta, finish_reason=finish_reason)
    return _Chunk(data=_Chunk(choices=[choice], usage=usage))


class _FakeStream:
    def __init__(self, events):
        self._events = list(events)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._events:
            raise StopAsyncIteration
        return self._events.pop(0)


class _FakeClient:
    """Stands in for ``mistralai.client.Mistral`` inside ``RonMistralModel._client``."""

    captured: dict = {}
    events: list = []

    def __init__(self, **kwargs):
        _FakeClient.captured["client_args"] = kwargs
        self.chat = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def stream_async(self, **request):
        _FakeClient.captured["request"] = request
        return _FakeStream(_FakeClient.events)


def test_reasoning_effort_rides_on_the_chat_completion_request(monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", "offline-test-key")
    model = build_model("mistral", "mistral-small-latest", "high")
    request = model.format_request([{"role": "user", "content": [{"text": "hi"}]}])
    assert request["reasoning_effort"] == "high"
    assert "reasoning_effort" not in build_model("mistral", "mistral-small-latest").format_request(
        [{"role": "user", "content": [{"text": "hi"}]}]
    )


def test_stored_reasoning_is_replayed_as_thinking_chunks(monkeypatch):
    # https://docs.mistral.ai/studio/conversations/reasoning: replay the full assistant
    # message including ThinkChunk; dropping it degrades the next turn.
    monkeypatch.setenv("MISTRAL_API_KEY", "offline-test-key")
    model = build_model("mistral", "mistral-medium-3-5", "high")
    request = model.format_request([
        {"role": "user", "content": [{"text": "17*23?"}]},
        {"role": "assistant", "content": [
            {"reasoningContent": {"reasoningText": {"text": "17*20=340, 17*3=51"}}},
            {"text": "391"},
        ]},
        {"role": "user", "content": [{"text": "times 3"}]},
    ])
    assert request["messages"][1] == {
        "role": "assistant",
        "content": [
            {"type": "thinking", "thinking": [{"type": "text", "text": "17*20=340, 17*3=51"}]},
            {"type": "text", "text": "391"},
        ],
    }


@pytest.mark.asyncio
async def test_think_chunks_stream_as_reasoning_content(monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", "offline-test-key")
    from agent.api.core import mistral_model

    think = _Chunk(type="thinking", thinking=[_Chunk(type="text", text="let me think")])
    text_chunk = _Chunk(type="text", text="The answer")
    usage = _Chunk(prompt_tokens=3, completion_tokens=5, total_tokens=8)
    _FakeClient.events = [
        _event(content=[think]),
        _event(content=[_Chunk(type="thinking", thinking=[], closed=True), text_chunk]),
        _event(content=" is 391."),
        _event(finish_reason="stop", usage=usage),
    ]
    monkeypatch.setattr(mistral_model, "Mistral", _FakeClient)

    model = build_model("mistral", "mistral-small-latest", "high")
    events = [e async for e in model.stream([{"role": "user", "content": [{"text": "17*23?"}]}])]

    assert _FakeClient.captured["request"]["reasoning_effort"] == "high"
    reasoning = "".join(
        e["contentBlockDelta"]["delta"]["reasoningContent"]["text"]
        for e in events if "contentBlockDelta" in e and "reasoningContent" in e["contentBlockDelta"]["delta"]
    )
    text = "".join(
        e["contentBlockDelta"]["delta"]["text"]
        for e in events if "contentBlockDelta" in e and "text" in e["contentBlockDelta"]["delta"]
    )
    assert reasoning == "let me think"
    assert text == "The answer is 391."
    # one reasoning block, then one text block, each opened and closed
    assert sum(1 for e in events if "contentBlockStart" in e) == 2
    assert sum(1 for e in events if "contentBlockStop" in e) == 2
    assert events[-2] == {"messageStop": {"stopReason": "end_turn"}}
    assert events[-1]["metadata"]["usage"]["totalTokens"] == 8


def test_max_effort_is_reinserted_on_the_wire():
    # mistralai 2.10.1's ReasoningEffort literal has no "max": the marshaller drops it,
    # so the hook puts it back for zai-glm-5-3 (documented low/high/max).
    import json

    import httpx

    from agent.api.core.mistral_model import _MistralReasoningEffortHook

    hook = _MistralReasoningEffortHook("max")
    ctx = type("Ctx", (), {"operation_id": "stream_chat"})()
    request = httpx.Request(
        "POST", "https://api.mistral.ai/v1/chat/completions",
        headers={"content-type": "application/json", "content-length": "20"},
        content=json.dumps({"model": "zai-glm-5-3", "messages": []}).encode(),
    )
    patched = hook.before_request(ctx, request)
    assert json.loads(patched.content)["reasoning_effort"] == "max"
    assert "content-length" not in {k.lower() for k in patched.headers} or int(patched.headers["content-length"]) == len(patched.content)
    other = httpx.Request("GET", "https://api.mistral.ai/v1/models")
    assert hook.before_request(type("Ctx", (), {"operation_id": "list_models"})(), other) is other
