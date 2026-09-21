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
                "ELECTRON_PLAYWRIGHT_MCP_ELECTRON_URL": "http://127.0.0.1:13000/electron",
                "ELECTRON_PLAYWRIGHT_MCP_PLAYWRIGHT_URL": "http://127.0.0.1:18931/mcp",
                "ELECTRON_PLAYWRIGHT_MCP_CDP_URL": "http://127.0.0.1:19222",
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
    assert browser_electron_url("user") == "http://127.0.0.1:13000/electron"
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
