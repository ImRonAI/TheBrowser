"""Native provider request ordering with separate runtime context messages."""

import copy

import pytest
from strands.models.mistral import MistralModel
from strands.models.openai_responses import OpenAIResponsesModel

from agent.api.core.panel_agent import build_model


@pytest.mark.parametrize("tool_count", [1, 2])
@pytest.mark.parametrize("context", [None, "Browser context for this request", "User steering note"])
def test_tool_results_precede_injected_user_text(monkeypatch, tool_count, context):
    monkeypatch.setenv("MISTRAL_API_KEY", "offline-test-key")
    model = build_model("mistral", "mistral-large-latest")
    ids = [f"call0000{i}" for i in range(tool_count)]
    messages = [
        {"role": "user", "content": [{"text": "Check the browser"}]},
        {"role": "assistant", "content": [
            {"toolUse": {"toolUseId": id, "name": "inspect", "input": {}}} for id in ids
        ]},
        {"role": "user", "content": [
            {"toolResult": {"toolUseId": id, "status": "success", "content": [{"text": "done"}]}}
            for id in ids
        ]},
        *([{"role": "user", "content": [{"text": context}]}] if context else []),
    ]
    original = copy.deepcopy(messages)
    assert type(model) is MistralModel
    request = model.format_request(messages, system_prompt="Be helpful")
    formatted = request["messages"]
    assert [message["role"] for message in formatted] == [
        "system", "user", "assistant", *(["tool"] * tool_count), *(["user"] if context else [])
    ]
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