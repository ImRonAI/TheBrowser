"""``core/web_tools.py``: Tavily, Exa and Bright Data as strands_tools vends them, and Olostep, each where its key is set."""

from __future__ import annotations

import pytest

from agent.api.core import config as app_config
from agent.api.core import web_tools as web
from agent.api.core.deep_research import research_tools
from agent.api.core.live_tools import live_host_tools
from agent.api.core.panel_agent import PROJECT_TOOLS_DIR
from agent.api.core.panel_tools import DOCUMENT_TOOL_NAMES, build_core_tools

VENDED = (*web.TAVILY_TOOL_NAMES, *web.EXA_TOOL_NAMES, *web.BRIGHT_DATA_TOOL_NAMES)


@pytest.fixture
def keys(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in ("TAVILY_API_KEY", "EXA_API_KEY", "BRIGHTDATA_API_KEY", "OLOSTEP_API_KEY", "APIFY_TOKEN"):
        monkeypatch.setattr(app_config, name, None)
    monkeypatch.setattr(app_config, "FIRECRAWL_MCP", False)
    return monkeypatch


def test_no_keys_no_web_tools(keys: pytest.MonkeyPatch) -> None:
    assert web.web_tools() == []
    assert not {t.tool_name for t in build_core_tools(PROJECT_TOOLS_DIR)} & set(VENDED)


def test_each_provider_joins_with_its_key(keys: pytest.MonkeyPatch) -> None:
    keys.setattr(app_config, "TAVILY_API_KEY", "set")
    assert tuple(t.tool_name for t in web.web_tools()) == web.TAVILY_TOOL_NAMES
    keys.setattr(app_config, "EXA_API_KEY", "set")
    keys.setattr(app_config, "BRIGHTDATA_API_KEY", "set")
    assert tuple(t.tool_name for t in web.web_tools()) == VENDED
    keys.setattr(app_config, "APIFY_TOKEN", "set")
    assert tuple(t.tool_name for t in web.web_tools()) == (*VENDED, "places_search")


def test_every_agent_tool_set_carries_them(keys: pytest.MonkeyPatch) -> None:
    for name in ("TAVILY_API_KEY", "EXA_API_KEY", "BRIGHTDATA_API_KEY"):
        keys.setattr(app_config, name, "set")
    assert set(VENDED) <= {t.tool_name for t in build_core_tools(PROJECT_TOOLS_DIR)}
    assert set(VENDED) <= {t.tool_name for t in build_core_tools(PROJECT_TOOLS_DIR, names=DOCUMENT_TOOL_NAMES)}
    assert set(VENDED) <= {t.tool_name for t in live_host_tools(PROJECT_TOOLS_DIR)}
    assert set(VENDED) | {"http_request"} <= {t.tool_name for t in research_tools()}


def test_http_request_is_strands_vended_tool() -> None:
    from strands.vended_tools import http_request

    assert http_request in build_core_tools(PROJECT_TOOLS_DIR)
    assert http_request in live_host_tools(PROJECT_TOOLS_DIR)


def test_olostep_names() -> None:
    assert web.is_web_tool("olostep_answers") and web.is_web_tool("tavily_search") and web.is_web_tool("places_search") and web.is_web_tool("firecrawl_scrape") and not web.is_web_tool("brave_answer")
