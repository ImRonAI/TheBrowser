"""Context windows come from each provider's own model metadata (no hardcoded table)."""
from __future__ import annotations

import httpx

from agent.api.core import config as app_config
from agent.api.core import context_windows, panel_agent

# Response shapes from the providers' documented model endpoints.
XAI_MODELS = {"data": [
    {"id": "grok-4.7", "aliases": ["grok-4.7-latest"], "context_length": 500000},
    {"id": "grok-4.3", "aliases": [], "context_length": 1000000},
]}
MISTRAL_MODELS = {"object": "list", "data": [
    {"id": "zai-glm-5-3", "aliases": ["zai-glm-latest"], "max_context_length": 1048576},
    {"id": "codestral-latest", "aliases": [], "max_context_length": 256000},
]}
GEMINI_MODEL = {"name": "models/gemini-3.5-flash", "inputTokenLimit": 1048576, "outputTokenLimit": 65536}


def _install(monkeypatch, seen: list[str], *, fail: bool = False) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if fail:
            return httpx.Response(500, request=request)
        if request.url.host == "api.x.ai":
            assert request.headers["authorization"] == "Bearer xai-key"
            return httpx.Response(200, json=XAI_MODELS, request=request)
        if request.url.host == "api.mistral.ai":
            assert request.headers["authorization"] == "Bearer mistral-key"
            return httpx.Response(200, json=MISTRAL_MODELS, request=request)
        assert request.url.path == "/v1beta/models/gemini-3.5-flash"
        assert request.url.params["key"] == "gemini-key"
        return httpx.Response(200, json=GEMINI_MODEL, request=request)

    monkeypatch.setattr(context_windows, "HTTP_TRANSPORT", httpx.MockTransport(handler))
    monkeypatch.setattr(app_config, "XAI_API_KEY", "xai-key")
    monkeypatch.setattr(app_config, "MISTRAL_API_KEY", "mistral-key")
    monkeypatch.setattr(app_config, "GEMINI_API_KEY", "gemini-key")


def test_windows_come_from_each_providers_metadata(monkeypatch):
    seen: list[str] = []
    _install(monkeypatch, seen)
    assert context_windows.provider_context_window("xai", "grok-4.7") == 500000
    assert context_windows.provider_context_window("xai", "grok-4.7-latest") == 500000
    assert context_windows.provider_context_window("mistral", "zai-glm-latest") == 1048576
    assert context_windows.provider_context_window("gemini", "gemini-3.5-flash") == 1048576
    # Perplexity Agent API ids resolve through the upstream vendor's metadata.
    assert context_windows.provider_context_window("perplexity", "xai/grok-4.3") == 1000000
    # Unpublished ids and providers without a window field leave the SDK's own resolution.
    assert context_windows.provider_context_window("xai", "grok-unknown") is None
    assert context_windows.provider_context_window("openai", "gpt-6.1") is None
    assert context_windows.provider_context_window("perplexity", "openai/gpt-6.1-sol") is None
    # One catalogue fetch per provider, one per Gemini model.
    assert sum("api.x.ai" in url for url in seen) == 1
    assert sum("api.mistral.ai" in url for url in seen) == 1


def test_failed_metadata_is_not_cached(monkeypatch):
    seen: list[str] = []
    _install(monkeypatch, seen, fail=True)
    assert context_windows.provider_context_window("xai", "grok-4.7") is None
    _install(monkeypatch, seen)
    assert context_windows.provider_context_window("xai", "grok-4.7") == 500000


def test_build_model_sets_the_real_window(monkeypatch):
    _install(monkeypatch, [])
    monkeypatch.setattr(panel_agent, "XAI_NATIVE_TOOLS_ENABLED", False)
    model = panel_agent.build_model("xai", "grok-4.7")
    assert model.context_window_limit == 500000
    assert model.estimate_utilization(250000) == 0.5
