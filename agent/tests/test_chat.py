"""Tests for the Agent Panel API surface.

Covers the model picker contract (/models catalogue proxy, per-model effort
validation) and the /chat agent turn endpoint's key-guard behavior.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft7Validator

from agent.api.core import config as app_config
from agent.api.core import panel_agent
from agent.api.main import app
from agent.api.endpoints import chat as chat_endpoint
from strands.experimental.agent_config import AGENT_CONFIG_SCHEMA

client = TestClient(app)
CONFIG_DIR = Path(__file__).resolve().parents[1] / "api" / "configs"


def _clear_provider_keys(monkeypatch):
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "")
    monkeypatch.setattr(app_config, "MISTRAL_API_KEY", "")
    monkeypatch.setattr(app_config, "XAI_API_KEY", "")
    monkeypatch.setattr(app_config, "GEMINI_API_KEY", "")
    for name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(name, raising=False)
        monkeypatch.setattr(app_config, name, "", raising=False)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200


def test_chat_route_exists(monkeypatch):
    """POST /chat is the agent turn endpoint (SSE stream).

    The prior expectation (route absent) encoded the deleted-agent state; the
    replacement agent was built on explicit instruction. Without a key the
    route must refuse with 503 rather than 404/405.
    """
    _clear_provider_keys(monkeypatch)
    res = client.post(
        "/chat", json={"session_id": "s", "user_id": "u", "message": "hi"}
    )
    assert res.status_code == 503


def test_chat_503_when_selected_provider_missing_key(monkeypatch):
    _clear_provider_keys(monkeypatch)
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "pplx-test")
    res = client.post(
        "/chat",
        json={
            "session_id": "s",
            "user_id": "u",
            "message": "hi",
            "provider": "mistral",
            "model": "mistral-large-latest",
        },
    )
    assert res.status_code == 503
    assert "MISTRAL_API_KEY" in res.json()["detail"]


def test_chat_400_for_unknown_provider(monkeypatch):
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "pplx-test")
    res = client.post(
        "/chat",
        json={"session_id": "s", "user_id": "u", "message": "hi", "provider": "bedrock"},
    )
    assert res.status_code == 400


class FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, payload):
        self._payload = payload

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, *args, **kwargs):
        return FakeResponse(self._payload)


def test_models_endpoint_is_pure_catalogue_proxy(monkeypatch):
    """GET /models returns exactly the Agent API catalogue -- nothing prepended."""
    catalogue = {
        "object": "list",
        "data": [
            {"id": "anthropic/claude-opus-4-8", "object": "model", "owned_by": "anthropic"},
            {"id": "xai/grok-4.5", "object": "model", "owned_by": "xai"},
        ],
    }
    _clear_provider_keys(monkeypatch)
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(chat_endpoint.httpx, "AsyncClient", FakeClient(catalogue))

    res = client.get("/models")

    assert res.status_code == 200
    body = res.json()
    assert body["default_model"] == panel_agent.PERPLEXITY_DEFAULT_MODEL
    assert body["default_provider"] == "perplexity"
    assert body["data"] == [
        {"id": "anthropic/claude-opus-4-8", "owned_by": "anthropic", "provider": "perplexity"},
        {"id": "xai/grok-4.5", "owned_by": "xai", "provider": "perplexity"},
    ]
    assert body["errors"] == {}


class FailingClient(FakeClient):
    async def get(self, *args, **kwargs):
        raise RuntimeError("catalogue offline")


def test_models_endpoint_isolates_one_provider_failure(monkeypatch):
    """A Perplexity catalogue outage still lists the other configured providers."""
    _clear_provider_keys(monkeypatch)
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(app_config, "XAI_API_KEY", "xai-test")
    monkeypatch.setattr(chat_endpoint.httpx, "AsyncClient", FailingClient({}))
    monkeypatch.setattr(
        chat_endpoint, "list_provider_models",
        lambda provider: [{"id": "grok-4.3", "owned_by": "xai", "provider": provider}],
    )

    res = client.get("/models")

    assert res.status_code == 200
    body = res.json()
    assert body["data"] == [{"id": "grok-4.3", "owned_by": "xai", "provider": "xai"}]
    assert set(body["errors"]) == {"perplexity"}
    assert "catalogue offline" in body["errors"]["perplexity"]


def test_models_endpoint_502_when_every_provider_fails(monkeypatch):
    _clear_provider_keys(monkeypatch)
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(chat_endpoint.httpx, "AsyncClient", FailingClient({}))

    res = client.get("/models")

    assert res.status_code == 502
    assert "perplexity" in res.json()["detail"]


def test_models_endpoint_503_without_key(monkeypatch):
    _clear_provider_keys(monkeypatch)

    res = client.get("/models")

    assert res.status_code == 503
    assert "provider" in res.json()["detail"]


def test_efforts_endpoint_probes_and_caches(monkeypatch):
    """Efforts come from live validation probes and are cached per model."""
    probed: list[tuple[str, str]] = []

    async def fake_probe(client_, model_id, effort):
        probed.append((model_id, effort))
        return effort in ("low", "medium", "high")

    _clear_provider_keys(monkeypatch)
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(chat_endpoint, "_probe_effort", fake_probe)
    chat_endpoint._EFFORTS_CACHE.clear()

    res = client.get("/models/perplexity/sonar/efforts?provider=perplexity")
    assert res.status_code == 200
    assert res.json()["efforts"] == ["low", "medium", "high"]
    assert res.json()["provider"] == "perplexity"
    assert len(probed) == len(chat_endpoint.REASONING_EFFORTS)

    # Second call is served from cache: no new probes.
    res2 = client.get("/models/perplexity/sonar/efforts?provider=perplexity")
    assert res2.status_code == 200
    assert len(probed) == len(chat_endpoint.REASONING_EFFORTS)


def test_efforts_endpoint_does_not_cache_all_failures(monkeypatch):
    """An all-False probe round (network flake) must not be cached as truth."""

    async def fake_probe(client_, model_id, effort):
        return False

    _clear_provider_keys(monkeypatch)
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "pplx-test")
    monkeypatch.setattr(chat_endpoint, "_probe_effort", fake_probe)
    chat_endpoint._EFFORTS_CACHE.clear()

    res = client.get("/models/openai/gpt-5.2/efforts?provider=perplexity")
    assert res.status_code == 200
    assert res.json() == {"model": "openai/gpt-5.2", "provider": "perplexity", "efforts": []}
    assert "openai/gpt-5.2" not in chat_endpoint._EFFORTS_CACHE


def test_efforts_endpoint_503_without_key(monkeypatch):
    _clear_provider_keys(monkeypatch)

    res = client.get("/models/perplexity/sonar/efforts?provider=perplexity")

    assert res.status_code == 503


@pytest.mark.parametrize("model,expected", [
    # https://docs.x.ai/docs/guides/reasoning summary table + strands_xai 0.6.1 docstring.
    ("grok-4.6", ["low", "medium", "high", "xhigh"]),
    ("grok-4.6-0801", ["low", "medium", "high", "xhigh"]),
    ("grok-4.5", ["low", "medium", "high"]),
    ("grok-4.3", ["none", "low", "medium", "high"]),
    ("grok-4.20-multi-agent", []),  # effort means agent count; not a depth control
    ("grok-4.20-0309-fast", []),
    ("grok-build-0.1", []),
    ("grok-3-mini", []),
])
def test_xai_efforts_are_documented_not_probed(monkeypatch, model, expected):
    _clear_provider_keys(monkeypatch)
    monkeypatch.setattr(app_config, "XAI_API_KEY", "xai-test")

    res = client.get(f"/models/{model}/efforts?provider=xai")
    assert res.status_code == 200
    assert res.json()["efforts"] == expected


def test_xai_build_model_rejects_unsupported_effort(monkeypatch):
    monkeypatch.setattr(app_config, "XAI_API_KEY", "xai-test")
    monkeypatch.setattr(panel_agent, "XAI_NATIVE_TOOLS_ENABLED", False)
    with pytest.raises(ValueError, match="xhigh"):
        panel_agent.build_model("xai", "grok-4.5", "xhigh")
    with pytest.raises(ValueError, match="rejects the parameter"):
        panel_agent.build_model("xai", "grok-build-0.1", "high")
    model = panel_agent.build_model("xai", "grok-4.6", "xhigh")
    assert model.config["reasoning_effort"] == "xhigh"


def test_agent_config_files_match_sdk_schema():
    validator = Draft7Validator(AGENT_CONFIG_SCHEMA)
    names = {f"{provider}.json" for provider in panel_agent.PROVIDERS}
    files = {path.name for path in CONFIG_DIR.glob("*.json")}
    assert files == names
    for name in names:
        payload = json.loads((CONFIG_DIR / name).read_text())
        validator.validate(payload)
        assert "model" not in payload
        # Constructor overrides own the actual async catalog. Config files
        # contain only the experimental loader's supported JSON structure.
        assert all(isinstance(value, str) for value in payload.get("tools", []))


def test_infer_provider_distinguishes_catalogue_from_native():
    assert panel_agent.infer_provider("xai/grok-4.5") == "perplexity"
    assert panel_agent.infer_provider("grok-4.3") == "xai"
    assert panel_agent.infer_provider("gemini-2.5-flash") == "gemini"
    assert panel_agent.infer_provider("mistral-large-latest") == "mistral"
    assert panel_agent.infer_provider("gpt-5") == "openai"
    assert panel_agent.infer_provider("claude-sonnet-4-5") == "anthropic"


@pytest.mark.parametrize("provider,model", [("openai", "gpt-5"), ("anthropic", "claude-sonnet-4-5")])
def test_native_provider_key_guard_and_efforts_never_probe(monkeypatch, provider, model):
    _clear_provider_keys(monkeypatch)
    res = client.post("/chat", json={"session_id": "native", "message": "hi", "provider": provider, "model": model})
    assert res.status_code == 503
    assert f"{provider.upper()}_API_KEY" in res.json()["detail"]

    async def forbidden_probe(*args):
        pytest.fail("Native model ID was sent to Perplexity")

    monkeypatch.setattr(chat_endpoint, "_probe_effort", forbidden_probe)
    monkeypatch.setenv(f"{provider.upper()}_API_KEY", "offline-test")
    for suffix in (f"?provider={provider}", ""):
        res = client.get(f"/models/{model}/efforts{suffix}")
        assert res.status_code == 200
        assert res.json() == {"model": model, "provider": provider, "efforts": []}


def test_config_endpoint_reports_only_panel_providers(monkeypatch):
    _clear_provider_keys(monkeypatch)
    monkeypatch.setattr(app_config, "XAI_API_KEY", "xai-test")
    res = client.get("/config")
    assert res.status_code == 200
    body = res.json()
    assert body["features"]["chat"] is True
    assert body["providers"] == {
        "perplexity": False,
        "mistral": False,
        "xai": True,
        "gemini": False,
        "openai": False,
        "anthropic": False,
    }
    assert body["features"]["event_replay"] is True
    assert body["features"]["a2a"] is False
    assert body["runtime"]["session_settings_immutable"] is True


def test_run_binds_api_host_and_port(monkeypatch):
    """main.run() must bind uvicorn to API_HOST/API_PORT from config (systemd sets 127.0.0.1:8765)."""
    import importlib

    import uvicorn

    import agent.api.main as main_module

    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: calls.append((app, kwargs)))
    monkeypatch.setenv("API_HOST", "127.0.0.1")
    monkeypatch.setenv("API_PORT", "18765")
    try:
        importlib.reload(app_config)
        main_module.run()
    finally:
        monkeypatch.undo()
        importlib.reload(app_config)

    assert calls == [(main_module.app, {"host": "127.0.0.1", "port": 18765})]
