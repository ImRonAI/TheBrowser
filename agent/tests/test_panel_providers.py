"""Native provider configuration contracts; all clients mocked, no network."""

import builtins
import json
import socket
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from jsonschema import Draft7Validator
from strands.experimental.agent_config import AGENT_CONFIG_SCHEMA

from agent.api.core import config as app_config
from agent.api.core import panel_agent


@pytest.fixture(autouse=True)
def isolated_providers(monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("Provider tests must not access the network")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    for provider in panel_agent.PROVIDERS:
        prefix = provider.upper()
        monkeypatch.delenv(f"{prefix}_API_KEY", raising=False)
        monkeypatch.setattr(app_config, f"{prefix}_API_KEY", None, raising=False)
    for prefix in ("OPENAI", "ANTHROPIC"):
        for suffix in ("MODEL", "MAX_RETRIES", "HOSTED_TOOLS", "MAX_TOKENS", "VECTOR_STORE_IDS"):
            monkeypatch.delenv(f"{prefix}_{suffix}", raising=False)
        monkeypatch.setattr(app_config, f"{prefix}_DEFAULT_MODEL", None, raising=False)


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_key_lookup_and_selection(monkeypatch, provider):
    key_name = f"{provider.upper()}_API_KEY"
    assert panel_agent.provider_api_key(provider) is None
    monkeypatch.setattr(app_config, key_name, "config-test-key", raising=False)
    assert panel_agent.provider_api_key(provider) == "config-test-key"
    monkeypatch.setenv(key_name, "environment-test-key")
    assert panel_agent.provider_api_key(provider) == "environment-test-key"
    assert panel_agent.configured_providers() == [provider]
    monkeypatch.setenv(f"{provider.upper()}_MODEL", "custom-model")
    assert panel_agent.default_selection() == (provider, "custom-model")


@pytest.mark.parametrize("provider,default", [
    ("openai", "gpt-4o"), ("anthropic", "claude-sonnet-4-5"),
])
def test_native_defaults(monkeypatch, provider, default):
    assert panel_agent.provider_default_model(provider) == default
    monkeypatch.setattr(app_config, f"{provider.upper()}_DEFAULT_MODEL", "config-model")
    assert panel_agent.provider_default_model(provider) == "config-model"


@pytest.mark.parametrize("model_id,provider", [
    ("gpt-4o", "openai"), ("gpt-5.2", "openai"), ("o3", "openai"),
    ("claude-sonnet-4-5", "anthropic"),
    ("openai/gpt-5.2", "perplexity"), ("anthropic/claude-sonnet-4-5", "perplexity"),
    ("xai/grok-4.5", "perplexity"), ("grok-4.3", "xai"),
    ("gemini-2.5-flash", "gemini"), ("mistral-large-latest", "mistral"),
])
def test_inference_preserves_catalogue_routing(model_id, provider):
    assert panel_agent.infer_provider(model_id) == provider


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_missing_key_does_not_import_native_sdk(monkeypatch, provider):
    real_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name in ("strands.models.openai_responses", "strands.models.anthropic", "openai", "anthropic"):
            raise AssertionError("Missing-key paths must not import optional native providers")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    with pytest.raises(ValueError, match=f"{provider.upper()}_API_KEY"):
        panel_agent.build_model(provider, panel_agent.provider_default_model(provider))
    assert panel_agent.list_provider_models(provider) == []


def test_openai_builds_native_stateless_model_and_merges_tools(monkeypatch):
    import openai
    from strands.models.openai_responses import OpenAIResponsesModel

    monkeypatch.setattr(openai, "AsyncOpenAI", Mock())
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MAX_RETRIES", "0")
    monkeypatch.setenv("OPENAI_HOSTED_TOOLS", "web_search,file_search,code_interpreter,web_search")
    monkeypatch.setenv("OPENAI_VECTOR_STORE_IDS", "vs_test_a, vs_test_b")
    model = panel_agent.build_model("openai", "gpt-4o")
    assert type(model) is OpenAIResponsesModel
    assert model.stateful is False
    assert model.client_args == {"api_key": "test-key", "max_retries": 0}
    expected = [
        {"type": "web_search"},
        {"type": "file_search", "vector_store_ids": ["vs_test_a", "vs_test_b"]},
        {"type": "code_interpreter", "container": {"type": "auto"}},
    ]
    assert model.config["params"]["tools"] == expected
    messages = [{"role": "user", "content": [{"text": "hello"}]}]
    local_tools = [{"name": "local", "description": "Local tool", "inputSchema": {"json": {"type": "object"}}}]
    request = model._format_request(messages, local_tools, None, model_state={"previous_response_id": "old"})
    assert request["tools"][:3] == expected
    assert request["tools"][3]["name"] == "local"
    assert "previous_response_id" not in request
    assert model.config["params"]["tools"] == expected
    assert len(model._format_request(messages, local_tools, None)["tools"]) == 4


def test_openai_reasoning_and_default_tools(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    model = panel_agent.build_model("openai", "gpt-5", "high")
    # Unset OPENAI_HOSTED_TOOLS -> documented default web_search on current models.
    assert model.config["params"] == {"reasoning": {"effort": "high"}, "tools": [{"type": "web_search"}]}
    assert "max_retries" not in model.client_args
    monkeypatch.setenv("OPENAI_HOSTED_TOOLS", "")  # explicit empty disables
    assert "tools" not in panel_agent.build_model("openai", "gpt-5").config.get("params", {})
    with pytest.raises(ValueError, match="requires a gpt-5"):
        panel_agent.build_model("openai", "gpt-4o", "high")
    with pytest.raises(ValueError, match="Invalid OpenAI"):
        panel_agent.build_model("openai", "gpt-5", "invented")


@pytest.mark.parametrize("tools,model_id,error", [
    ("image_generation", "gpt-4o", "supports only"),
    ("mcp", "gpt-4o", "supports only"),
    ("file_search", "gpt-4o", "OPENAI_VECTOR_STORE_IDS"),
])
def test_hosted_tools_reject_unsupported_configuration(monkeypatch, tools, model_id, error):
    monkeypatch.setenv("OPENAI_HOSTED_TOOLS", tools)
    with pytest.raises(ValueError, match=error):
        panel_agent.openai_hosted_tools(model_id)


def test_anthropic_required_fields_and_preserved_function_tools(monkeypatch):
    import anthropic
    from strands.models.anthropic import AnthropicModel

    client = Mock()
    monkeypatch.setattr(anthropic, "AsyncAnthropic", client)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_MAX_TOKENS", "4096")
    monkeypatch.setenv("ANTHROPIC_MAX_RETRIES", "3")
    model = panel_agent.build_model("anthropic", "claude-sonnet-4-5")
    assert type(model) is AnthropicModel
    client.assert_called_once_with(api_key="test-key", max_retries=3)
    # Defaults per platform.claude.com web-search-tool / web-fetch-tool docs (basic versions).
    assert model.config == {
        "model_id": "claude-sonnet-4-5", "max_tokens": 4096,
        "anthropic_tools": [
            {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
            {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 5},
        ],
    }
    request = model.format_request(
        [{"role": "user", "content": [{"text": "hello"}]}],
        [{"name": "local", "description": "Local tool", "inputSchema": {"json": {"type": "object"}}}],
    )
    assert request["max_tokens"] == 4096
    # Adapter appends server tools alongside function tools (anthropic.py L505-509).
    assert request["tools"][0]["name"] == "local"
    assert {t.get("type") for t in request["tools"]} >= {"web_search_20250305", "web_fetch_20250910"}


def test_anthropic_rejects_unwired_effort_and_honours_hosted_override(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    with pytest.raises(ValueError, match="reasoning_effort is not configured"):
        panel_agent.build_model("anthropic", "claude-sonnet-4-5", "high")
    monkeypatch.setenv("ANTHROPIC_HOSTED_TOOLS", "web_fetch")
    assert [t["name"] for t in panel_agent.build_model("anthropic", "claude-sonnet-4-5").config["anthropic_tools"]] == ["web_fetch"]
    monkeypatch.setenv("ANTHROPIC_HOSTED_TOOLS", "")
    assert "anthropic_tools" not in panel_agent.build_model("anthropic", "claude-sonnet-4-5").config
    monkeypatch.setenv("ANTHROPIC_HOSTED_TOOLS", "code_execution")
    with pytest.raises(ValueError, match="supports only"):
        panel_agent.build_model("anthropic", "claude-sonnet-4-5")


@pytest.mark.parametrize("provider,setting,value", [
    ("openai", "OPENAI_MAX_RETRIES", "-1"),
    ("anthropic", "ANTHROPIC_MAX_RETRIES", "invalid"),
    ("anthropic", "ANTHROPIC_MAX_TOKENS", "0"),
])
def test_invalid_numeric_config_fails_locally(monkeypatch, provider, setting, value):
    monkeypatch.setenv(f"{provider.upper()}_API_KEY", "test-key")
    monkeypatch.setenv(setting, value)
    with pytest.raises(ValueError, match=setting):
        panel_agent.build_model(provider, panel_agent.provider_default_model(provider))


@pytest.mark.parametrize("provider,sdk_name,class_name,ids,expected", [
    ("openai", "openai", "OpenAI", ["gpt-4o", "gpt-5", "o3", "gpt-4o-audio-preview", "gpt-realtime",
                                   "gpt-4o-mini-search-preview", "text-embedding-3-small", "dall-e-3",
                                   "o1-mini", "o1-preview-2024-09-12"],
     ["gpt-4o", "gpt-5", "o3"]),
    ("anthropic", "anthropic", "Anthropic", ["claude-sonnet-4-5", "claude-opus-4-5"],
     ["claude-sonnet-4-5", "claude-opus-4-5"]),
])
def test_native_catalogue_uses_own_client_and_closes(monkeypatch, provider, sdk_name, class_name, ids, expected):
    import importlib
    from unittest.mock import MagicMock

    sdk = importlib.import_module(sdk_name)
    client = MagicMock()
    # Iterator contract exercises SDK page iteration, not just .data (first page).
    client.models.list.return_value = iter(SimpleNamespace(id=model_id) for model_id in ids)
    constructor = Mock(return_value=client)
    monkeypatch.setattr(sdk, class_name, constructor)
    monkeypatch.setenv(f"{provider.upper()}_API_KEY", "test-key")
    models = panel_agent.list_provider_models(provider)
    assert models == [{"id": model_id, "owned_by": provider, "provider": provider} for model_id in expected]
    constructor.assert_called_once_with(api_key="test-key")
    client.__exit__.assert_called_once()


def test_native_catalogue_propagates_failure_and_closes(monkeypatch):
    import openai
    from unittest.mock import MagicMock

    client = MagicMock()
    client.models.list.side_effect = RuntimeError("catalogue unavailable")
    monkeypatch.setattr(openai, "OpenAI", Mock(return_value=client))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    with pytest.raises(RuntimeError, match="catalogue unavailable"):
        panel_agent.list_provider_models("openai")
    client.__exit__.assert_called_once()


def test_perplexity_keeps_argument_recovery_adapter(monkeypatch):
    from agent.api.core.perplexity_model import PerplexityResponsesModel

    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "test-key")
    # Native provider configuration must not affect Perplexity catalogue models.
    monkeypatch.setenv("OPENAI_HOSTED_TOOLS", "web_search")
    model = panel_agent.build_model("perplexity", "anthropic/claude-sonnet-4-5", "high")
    assert type(model) is PerplexityResponsesModel
    assert model.config["stateful"] is False
    assert model.config["params"] == {
        "reasoning": {"effort": "high"},
        "max_output_tokens": panel_agent.PERPLEXITY_MAX_OUTPUT_TOKENS,
        # Every static member of the Agent API Tool union, always (docs.perplexity.ai/docs/agent-api/tools/overview).
        "tools": [
            {"type": "web_search", "search_context_size": "medium"},
            {"type": "image_search"},
            {"type": "fetch_url"},
            {"type": "people_search"},
            {"type": "finance_search"},
            {"type": "sandbox"},
        ],
        # Agent-API-only loop bound; the adapter moves it into extra_body on the wire.
        "max_steps": panel_agent.PERPLEXITY_MAX_STEPS,
        # Built-in Agent API skills (docs.perplexity.ai/docs/agent-api/skills): the office
        # umbrella plus its four leaves, so sandbox runs can produce PDF/DOCX/PPTX/XLSX files.
        "skills": [{"type": "builtin", "name": name}
                   for name in ("office", "office/pdf", "office/docx", "office/pptx", "office/xlsx")],
    }


@pytest.mark.parametrize("configured, expected", [(None, None), ("0", None), ("180", 180)])
def test_perplexity_read_timeout_is_opt_in(monkeypatch, configured, expected):
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "test-key")
    monkeypatch.delenv("PERPLEXITY_READ_TIMEOUT", raising=False)
    if configured is not None:
        monkeypatch.setenv("PERPLEXITY_READ_TIMEOUT", configured)
    model = panel_agent.build_model("perplexity", "openai/gpt-5")
    assert model.client_args["timeout"].read == expected
    assert model.client_args["timeout"].connect == 10


def test_perplexity_default_hosted_tools_include_image_search(monkeypatch):
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "test-key")
    monkeypatch.delenv("PERPLEXITY_HOSTED_TOOLS", raising=False)
    types = [t["type"] for t in panel_agent.build_model("perplexity", "openai/gpt-5").config["params"]["tools"]]
    assert "image_search" in types


def test_perplexity_hosted_tools_env_override(monkeypatch):
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "test-key")
    monkeypatch.setenv("PERPLEXITY_HOSTED_TOOLS", "web_search,finance_search")
    monkeypatch.setenv("PERPLEXITY_SEARCH_CONTEXT_SIZE", "high")
    tools = panel_agent.build_model("perplexity", "openai/gpt-5").config["params"]["tools"]
    assert tools == [{"type": "web_search", "search_context_size": "high"}, {"type": "finance_search"}]
    monkeypatch.setenv("PERPLEXITY_HOSTED_TOOLS", "")
    assert "tools" not in panel_agent.build_model("perplexity", "openai/gpt-5").config["params"]
    monkeypatch.setenv("PERPLEXITY_HOSTED_TOOLS", "web_search,bogus")
    with pytest.raises(ValueError, match="bogus"):
        panel_agent.build_model("perplexity", "openai/gpt-5")
    monkeypatch.setenv("PERPLEXITY_HOSTED_TOOLS", "web_search")
    monkeypatch.setenv("PERPLEXITY_SEARCH_CONTEXT_SIZE", "huge")
    with pytest.raises(ValueError, match="low, medium or high"):
        panel_agent.build_model("perplexity", "openai/gpt-5")


def test_gemini_xai_mistral_hosted_tools(monkeypatch):
    monkeypatch.setattr(app_config, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(app_config, "XAI_API_KEY", "test-key")
    monkeypatch.setattr(app_config, "MISTRAL_API_KEY", "test-key")
    monkeypatch.setattr(panel_agent, "XAI_NATIVE_TOOLS_ENABLED", True)
    monkeypatch.delenv("GEMINI_HOSTED_TOOLS", raising=False)  # the default, whatever the local .env says
    gemini = panel_agent.build_model("gemini", "gemini-flash-latest")
    assert [t.model_dump(exclude_none=True) for t in gemini.config["gemini_tools"]] == [
        {"google_search": {}}, {"url_context": {}}, {"code_execution": {}},
    ]
    assert gemini.config["params"]["tool_config"].include_server_side_tool_invocations is True
    assert gemini.config["params"]["thinking_config"].include_thoughts is True
    # Gemma on the Gemini API rejects url_context (400 "Url Context as tool is not enabled for this model").
    gemma = panel_agent.build_model("gemini", "gemma-4-31b-it")
    assert [t.model_dump(exclude_none=True) for t in gemma.config["gemini_tools"]] == [
        {"google_search": {}}, {"code_execution": {}},
    ]
    monkeypatch.setenv("GEMINI_HOSTED_TOOLS", "google_search")
    assert len(panel_agent.build_model("gemini", "gemini-flash-latest").config["gemini_tools"]) == 1
    xai = panel_agent.build_model("xai", "grok-4.6")
    assert xai.config["include"] == ["inline_citations", "web_search_call_output", "x_search_call_output"]
    assert len(xai.config["xai_tools"]) == 3
    assert xai.config["xai_tools"][0].web_search.enable_image_understanding is True
    assert xai.config["xai_tools"][0].web_search.enable_image_search is True
    assert xai.config["xai_tools"][1].x_search.enable_image_understanding is True
    assert xai.config["xai_tools"][1].x_search.enable_video_understanding is True
    # Mistral: web_search/code_interpreter are Conversations/Agents API only, not chat completions.
    mistral = panel_agent.build_model("mistral", "mistral-large-latest")
    assert not any("tool" in key for key in mistral.config)
    assert panel_agent.NATIVE_PROVIDER_CAPABILITIES["mistral"]["hosted_tools_default"] == ()


@pytest.mark.parametrize("provider", panel_agent.PROVIDERS)
def test_config_schema_and_hosted_tool_separation(provider):
    payload = json.loads(panel_agent.config_path(provider).read_text())
    Draft7Validator(AGENT_CONFIG_SCHEMA).validate(payload)
    assert set(payload) == {"name", "prompt", "tools"}
    assert payload["tools"] == []  # Composition supplies managed tools; hosted tools belong to models.


def test_nim_is_the_default_provider_and_builds_the_sdk_openai_model(monkeypatch):
    from strands.models.openai import OpenAIModel

    from agent.api.core import config as app_config

    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nvapi-test")
    monkeypatch.setattr(app_config, "MISTRAL_API_KEY", "mistral-test")
    assert panel_agent.default_selection() == ("nim", "z-ai/glm-5.3-flash")

    model = panel_agent.build_model("nim", "z-ai/glm-5.3-flash", "max")
    assert type(model) is OpenAIModel
    assert model.client_args == {"api_key": "nvapi-test", "base_url": "https://integrate.api.nvidia.com/v1"}
    config = model.get_config()
    assert config["model_id"] == "z-ai/glm-5.3-flash" and config["params"] == {"reasoning_effort": "max"}
    assert config["context_window_limit"] == 1_048_576
    assert "params" not in panel_agent.build_model("nim", "z-ai/glm-5.3-flash").get_config()
    with pytest.raises(ValueError, match="supported: low, high, max"):
        panel_agent.build_model("nim", "z-ai/glm-5.3-flash", "medium")
