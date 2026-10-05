"""Live tools: native SDK tools plus the Electron MCP client, minus tools BidiAgent cannot run."""

from strands.tools.decorator import DecoratedFunctionTool
from strands.tools.mcp import MCPClient
from strands.tools.tools import PythonAgentTool

from agent.api.core.live_io import context_text
from agent.api.core.live_tools import LIVE_REJECTED_BROWSER_TOOLS, build_live_tools
from agent.api.core.panel_browser import browser_client_factory


def test_context_frame_is_not_a_model_turn():
    assert context_text({}) == ""
    text = context_text({"page_url": "https://example.com", "page_title": "Example"})
    assert "untrusted" in text
    assert "https://example.com" in text


def test_live_tools_are_native_and_exclude_tools_bidi_cannot_run():
    tools = build_live_tools("live-test-user", "panel")
    names = {value.tool_name for value in tools}
    for name in (
        "editor", "shell", "environment", "http_request", "perplexity_search",
        "search_memories", "list_learned_skills", "use_skill", "search_memory", "add_memory",
    ):
        assert name in names, name
    # think is text-only; ask_user interrupts (unsupported in bidi); tool_catalog and mcp_client
    # register tools after the connection has declared its tools.
    for name in ("think", "ask_user", "tool_catalog", "mcp_client", "journal"):
        assert name not in names, name
    host = [value for value in tools if value.tool_name in
            ("editor", "shell", "environment", "http_request", "perplexity_search")]
    assert all(isinstance(value, (DecoratedFunctionTool, PythonAgentTool)) for value in host)


def test_live_browser_client_rejects_image_results_natively():
    client = browser_client_factory("user", tool_filters={"rejected": list(LIVE_REJECTED_BROWSER_TOOLS)})()
    assert isinstance(client, MCPClient)
    assert client._prefix == "user_browser"
    assert client._tool_filters == {"rejected": ["playwright_browser_take_screenshot", "request_approval"]}
    assert client._background_thread is None
