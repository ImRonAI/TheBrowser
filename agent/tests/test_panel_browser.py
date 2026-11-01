"""Browser target model: per-browser MCP server config, defaults, env overrides."""

import os
from pathlib import Path

import pytest

from agent.api.core import panel_browser
from agent.api.core.panel_browser import (
    BROWSERS,
    ELECTRON_MCP_COMMAND,
    REPO_ROOT,
    browser_electron_url,
    browser_server_config,
    default_browser,
    server_name,
)

_RON_ENV = [
    f"RON_{target}_BROWSER_{surface}_URL"
    for target in ("USER", "CLOUD")
    for surface in ("ELECTRON", "PLAYWRIGHT", "CDP")
] + ["RON_BROWSER_DEFAULT"]


@pytest.fixture
def clean_env(monkeypatch):
    for name in _RON_ENV:
        monkeypatch.delenv(name, raising=False)


def test_browsers_and_server_names():
    assert BROWSERS == ("user", "cloud")
    assert server_name("user") == "user_browser"
    assert server_name("cloud") == "cloud_browser"


def test_user_server_config_defaults(clean_env):
    assert browser_server_config("user") == {
        "user_browser": {
            "command": str(REPO_ROOT / "venv" / "bin" / "electron-playwright-mcp"),
            "args": [],
            "env": {
                "ELECTRON_PLAYWRIGHT_MCP_ELECTRON_URL": "http://127.0.0.1:3000/electron",
                "ELECTRON_PLAYWRIGHT_MCP_PLAYWRIGHT_URL": "http://127.0.0.1:8931/mcp",
                "ELECTRON_PLAYWRIGHT_MCP_CDP_URL": "http://127.0.0.1:9222",
            },
        }
    }


def test_cloud_server_config_defaults(clean_env):
    config = browser_server_config("cloud")
    assert set(config) == {"cloud_browser"}
    assert config["cloud_browser"]["command"] == ELECTRON_MCP_COMMAND
    assert config["cloud_browser"]["env"] == {
        "ELECTRON_PLAYWRIGHT_MCP_ELECTRON_URL": "http://127.0.0.1:3000/electron",
        "ELECTRON_PLAYWRIGHT_MCP_PLAYWRIGHT_URL": "http://127.0.0.1:8931/mcp",
        "ELECTRON_PLAYWRIGHT_MCP_CDP_URL": "http://127.0.0.1:9222",
    }


def test_env_overrides_are_honoured(clean_env, monkeypatch):
    monkeypatch.setenv("RON_USER_BROWSER_ELECTRON_URL", "http://10.0.0.1:1/electron")
    monkeypatch.setenv("RON_USER_BROWSER_PLAYWRIGHT_URL", "http://10.0.0.1:2/mcp")
    monkeypatch.setenv("RON_USER_BROWSER_CDP_URL", "http://10.0.0.1:3")
    monkeypatch.setenv("RON_CLOUD_BROWSER_CDP_URL", "http://10.0.0.2:9")
    user_env = browser_server_config("user")["user_browser"]["env"]
    assert user_env["ELECTRON_PLAYWRIGHT_MCP_ELECTRON_URL"] == "http://10.0.0.1:1/electron"
    assert user_env["ELECTRON_PLAYWRIGHT_MCP_PLAYWRIGHT_URL"] == "http://10.0.0.1:2/mcp"
    assert user_env["ELECTRON_PLAYWRIGHT_MCP_CDP_URL"] == "http://10.0.0.1:3"
    cloud_env = browser_server_config("cloud")["cloud_browser"]["env"]
    assert cloud_env["ELECTRON_PLAYWRIGHT_MCP_CDP_URL"] == "http://10.0.0.2:9"
    assert cloud_env["ELECTRON_PLAYWRIGHT_MCP_ELECTRON_URL"] == "http://127.0.0.1:3000/electron"


def test_browser_electron_url(clean_env, monkeypatch):
    assert browser_electron_url("cloud") == "http://127.0.0.1:3000/electron"
    assert browser_electron_url("user") == "http://127.0.0.1:3000/electron"
    monkeypatch.setenv("RON_CLOUD_BROWSER_ELECTRON_URL", "http://127.0.0.1:4000/electron")
    assert browser_electron_url("cloud") == "http://127.0.0.1:4000/electron"


@pytest.mark.parametrize("bad", ["other", "", "USER", "laptop"])
def test_invalid_browser_raises(bad):
    with pytest.raises(ValueError):
        browser_server_config(bad)
    with pytest.raises(ValueError):
        server_name(bad)
    with pytest.raises(ValueError):
        browser_electron_url(bad)


def test_default_browser(clean_env, monkeypatch):
    assert default_browser() == "user"
    monkeypatch.setenv("RON_BROWSER_DEFAULT", "cloud")
    assert default_browser() == "cloud"
    monkeypatch.setenv("RON_BROWSER_DEFAULT", "laptop")
    with pytest.raises(ValueError):
        default_browser()


def test_command_is_re_exported_from_chat():
    from agent.api.endpoints import chat

    assert chat.ELECTRON_MCP_COMMAND is panel_browser.ELECTRON_MCP_COMMAND
    assert Path(ELECTRON_MCP_COMMAND).name == "electron-playwright-mcp"
    assert os.path.isabs(ELECTRON_MCP_COMMAND)


# --- BrowserAvailabilityHook (native BeforeToolCallEvent interrupt / cancel_tool) -------------

import asyncio
import copy
import json

import httpx
from strands import Agent
from strands.hooks.events import BeforeToolCallEvent
from strands.interrupt import InterruptException
from strands.models.model import Model

from agent.api.core.panel_browser import BrowserAvailabilityHook, ATTEMPTS_STATE_PREFIX


class _OfflineModel(Model):
    def get_config(self):
        return {"model_id": "offline"}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "answer"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


def _agent(hook: BrowserAvailabilityHook) -> Agent:
    return Agent(model=_OfflineModel(), hooks=[hook], callback_handler=None)


def _event(agent: Agent, name: str = "user_browser_playwright_List_tabs") -> BeforeToolCallEvent:
    return BeforeToolCallEvent(
        agent=agent,
        selected_tool=None,
        tool_use={"toolUseId": "t1", "name": name, "input": {}},
        invocation_state={},
    )


def _probe(result: bool):
    seen = []

    async def probe(url: str) -> bool:
        seen.append(url)
        return result

    probe.seen = seen  # type: ignore[attr-defined]
    return probe


def _run(coro):
    return asyncio.run(coro)


def test_hook_a_reachable_browser_lets_tool_proceed(clean_env):
    probe = _probe(True)
    hook = BrowserAvailabilityHook("user", probe=probe)
    agent = _agent(hook)
    event = _event(agent)
    _run(hook.before_tool_call(event))
    assert event.cancel_tool is False
    assert probe.seen == ["http://127.0.0.1:3000/electron"]


def test_hook_b_unreachable_browser_interrupts_with_reason(clean_env):
    hook = BrowserAvailabilityHook("user", probe=_probe(False))
    agent = _agent(hook)
    event = _event(agent)
    with pytest.raises(InterruptException) as exc:
        _run(hook.before_tool_call(event))
    interrupt = exc.value.interrupt
    assert interrupt.name == "browser_unavailable:1"
    assert interrupt.reason == {
        "browser": "user",
        "tool": "user_browser_playwright_List_tabs",
        "url": "http://127.0.0.1:3000/electron",
        "question": "Your browser is offline. Reconnect the tunnel and reply 'continue', or reply 'cancel'.",
    }
    assert interrupt.id.startswith("v1:before_tool_call:t1:")
    assert agent.state.get(f"{ATTEMPTS_STATE_PREFIX}t1") == 1


def test_hook_c_cancel_response_sets_cancel_tool(clean_env):
    hook = BrowserAvailabilityHook("user", probe=_probe(False))
    agent = _agent(hook)
    event = _event(agent)
    with pytest.raises(InterruptException) as exc:
        _run(hook.before_tool_call(event))
    exc.value.interrupt.response = "cancel"  # recorded on the agent's native interrupt state
    event = _event(agent)
    _run(hook.before_tool_call(event))
    assert event.cancel_tool == "Browser unavailable; user cancelled this action."


def test_hook_d_continue_but_still_down_reinterrupts_attempt_2(clean_env):
    hook = BrowserAvailabilityHook("user", probe=_probe(False))
    agent = _agent(hook)
    with pytest.raises(InterruptException) as first:
        _run(hook.before_tool_call(_event(agent)))
    first.value.interrupt.response = "continue"
    with pytest.raises(InterruptException) as second:
        _run(hook.before_tool_call(_event(agent)))
    assert second.value.interrupt.name == "browser_unavailable:2"
    assert second.value.interrupt.id != first.value.interrupt.id
    assert agent.state.get(f"{ATTEMPTS_STATE_PREFIX}t1") == 2


def test_hook_d2_continue_and_recovered_proceeds(clean_env):
    state = {"up": False}

    async def probe(url: str) -> bool:
        return state["up"]

    hook = BrowserAvailabilityHook("user", probe=probe)
    agent = _agent(hook)
    with pytest.raises(InterruptException) as first:
        _run(hook.before_tool_call(_event(agent)))
    first.value.interrupt.response = "continue"
    state["up"] = True
    event = _event(agent)
    _run(hook.before_tool_call(event))
    assert event.cancel_tool is False


def test_hook_e_ignores_tools_outside_selected_browser(clean_env):
    probe = _probe(False)
    hook = BrowserAvailabilityHook("user", probe=probe)
    agent = _agent(hook)
    for name in ("shell", "cloud_browser_playwright_List_tabs", "tool_catalog", "user_browserX"):
        event = _event(agent, name)
        _run(hook.before_tool_call(event))
        assert event.cancel_tool is False
    assert probe.seen == []


def test_hook_registers_before_tool_call_callback(clean_env):
    hook = BrowserAvailabilityHook("cloud", probe=_probe(True))
    agent = _agent(hook)
    assert hook.browser == "cloud"
    callbacks = agent.hooks.get_callbacks_for(_event(agent, "cloud_browser_x"))
    assert any(getattr(cb, "__self__", None) is hook for cb in callbacks)


@pytest.mark.parametrize(
    "behaviour, expected",
    [
        ("404", True),
        ("200", True),
        ("connect_error", False),
        ("remote_protocol_error", False),
        ("read_timeout", False),
    ],
)
def test_hook_f_default_probe_maps_http_outcomes(clean_env, monkeypatch, behaviour, expected):
    def handler(request: httpx.Request) -> httpx.Response:
        if behaviour == "404":
            return httpx.Response(404)
        if behaviour == "200":
            return httpx.Response(200, json={"tabs": []})
        if behaviour == "connect_error":
            raise httpx.ConnectError("refused", request=request)
        if behaviour == "remote_protocol_error":
            raise httpx.RemoteProtocolError("EOF", request=request)
        raise httpx.ReadTimeout("timeout", request=request)

    monkeypatch.setattr(panel_browser, "_transport_factory", lambda: httpx.MockTransport(handler))
    assert _run(panel_browser.default_probe("http://127.0.0.1:3000/electron")) is expected


def test_hook_default_probe_is_async_only():
    import inspect

    source = inspect.getsource(panel_browser)
    assert "httpx.get(" not in source
    assert inspect.iscoroutinefunction(panel_browser.default_probe)
    assert inspect.iscoroutinefunction(BrowserAvailabilityHook.before_tool_call)


# --- mcp.json parity (todo 16) ------------------------------------------------------------

@pytest.mark.parametrize("browser", ["user", "cloud"])
def test_mcp_json_declares_browser_servers_matching_defaults(clean_env, browser):
    declared = json.loads((REPO_ROOT / "mcp.json").read_text())["mcpServers"]
    name = server_name(browser)
    assert name in declared, f"mcp.json is missing {name}"
    ours = browser_server_config(browser)[name]
    assert declared[name]["env"] == ours["env"]
    assert Path(declared[name]["command"]).name == Path(str(ours["command"])).name == "electron-playwright-mcp"
    assert "prefix" not in declared[name]  # name-based prefixing
    assert "electron-playwright-mcp" in declared  # legacy entry for external clients is kept
