"""Ren desktop as an MCP server and client: real FastMCP servers, clients and sockets, offline."""

import asyncio
import socket

import pytest
import uvicorn
from fastmcp import Client, Context, FastMCP
from fastmcp.server.elicitation import AcceptedElicitation
from mcp import ClientSession
from mcp.server.websocket import websocket_server
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute
from starlette.websockets import WebSocket

from agent.api.core import ren_mcp
from agent.api.endpoints import chat
from agent.api.main import app, ren_mcp_server
from agent.tests.test_panel_api import OfflineModel, offline_api

AGENT_TOOLS = {"ask_ren", "ren_threads", "ren_thread", "ren_cancel"}


def test_the_server_lists_rens_agent_and_the_browser_under_its_prefix():
    async def scenario():
        async with Client(ren_mcp_server) as client:
            names = {tool.name for tool in await client.list_tools()}
        assert AGENT_TOOLS <= names
        browser = names - AGENT_TOOLS
        # The same electron-playwright-mcp tools Ren's own agents drive, e.g. the official screenshot tool.
        assert "browser_playwright_browser_take_screenshot" in browser
        assert browser and all(name.startswith("browser_") for name in browser)
    asyncio.run(scenario())


def test_ask_ren_runs_a_panel_turn_and_continues_its_thread(monkeypatch):
    async def scenario():
        model = OfflineModel()
        monkeypatch.setattr(chat, "infer_provider", lambda _: "openai")
        monkeypatch.setattr(chat, "provider_default_model", lambda _: "offline")
        async with offline_api(monkeypatch, model=model) as (client, manager, builds, agents, shell, threads):
            async with Client(ren_mcp_server) as mcp_client:
                first = (await mcp_client.call_tool("ask_ren", {"prompt": "What is on the page?"})).data
                assert first["answer"] == "offline answer"
                assert first["thread"].startswith("mcp-")
                second = (await mcp_client.call_tool("ask_ren", {"prompt": "And the next one?", "thread": first["thread"]})).data
                assert second == {"thread": first["thread"], "answer": "offline answer"}
                # The second turn ran in the same native session: the model saw the first exchange.
                texts = [block["text"] for message in model.calls[-1] for block in message["content"] if "text" in block]
                assert "What is on the page?" in texts and "And the next one?" in texts
                assert len(agents) == 1
                # It is the panel's own run: the API's snapshot holds it.
                snapshot = (await client.get(f"/sessions/{first['thread']}?user_id=default")).json()
                assert snapshot["status"] == "completed"
                thread = (await mcp_client.call_tool("ren_thread", {"thread": first["thread"]})).data
                assert [message["role"] for message in thread["messages"]] == ["user", "assistant", "user", "assistant"]
    asyncio.run(scenario())


def test_a_mutating_browser_tool_runs_without_the_caller_approving():
    async def scenario():
        browser = FastMCP("browser stand-in")

        @browser.tool
        async def click(ref: str, ctx: Context) -> str:
            """A tool that asks first, as electron-playwright-mcp's mutating tools do."""
            answer = await ctx.elicit(message=f"Approve click on {ref}", response_type=None)
            return "clicked" if isinstance(answer, AcceptedElicitation) else "rejected"

        server = ren_mcp.create_ren_mcp(app, browser=browser)
        # The caller has no elicitation handler: ren desktop applies its own no-approval browser policy.
        async with Client(server) as client:
            assert (await client.call_tool("browser_click", {"ref": "e1"})).data == "clicked"
    asyncio.run(scenario())


def test_the_desktop_serves_itself_on_a_socket_it_dials_with_the_token():
    async def scenario():
        seen: dict[str, object] = {}
        listed = asyncio.Event()

        async def attach(websocket: WebSocket) -> None:
            seen["authorization"] = websocket.headers.get("authorization")
            async with websocket_server(websocket.scope, websocket.receive, websocket.send) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    seen["tools"] = {tool.name for tool in (await session.list_tools()).tools}
                    listed.set()

        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        hub = uvicorn.Server(uvicorn.Config(Starlette(routes=[WebSocketRoute("/attach/desktop", attach)]),
                                            host="127.0.0.1", port=port, log_level="warning"))
        serving = asyncio.create_task(hub.serve())
        while not hub.started:
            await asyncio.sleep(0.02)
        link = asyncio.create_task(ren_mcp.attach_to_hub(ren_mcp_server, f"ws://127.0.0.1:{port}", "desk-token"))
        try:
            await asyncio.wait_for(listed.wait(), 10)
        finally:
            link.cancel()
            await asyncio.gather(link, return_exceptions=True)
            hub.should_exit = True
            await serving
        assert seen["authorization"] == "Bearer desk-token"
        assert AGENT_TOOLS <= seen["tools"]
    asyncio.run(scenario())


def test_the_phone_is_in_the_catalog_and_the_prompt_only_when_a_hub_is_set(monkeypatch):
    monkeypatch.delenv("REN_HUB_URL", raising=False)
    assert ren_mcp.hub_server_config() == {}
    assert ren_mcp.phone_prompt_section() == ""
    assert "## Phone" not in chat._compose("user")

    monkeypatch.setenv("REN_HUB_URL", "wss://hub.example/hub/")
    monkeypatch.setenv("REN_HUB_TOKEN", "desk-token")
    assert ren_mcp.hub_server_config() == {
        "phone": {"url": "https://hub.example/hub/mcp", "headers": {"Authorization": "Bearer desk-token"}},
    }
    section = ren_mcp.phone_prompt_section()
    assert 'tool_catalog(action="load", name="phone")' in section and "phone_request_approval" in section
    assert section in chat._compose("user")
    client = ren_mcp.hub_client_factory()()
    # The phone's tools carry its prefix; the hub's copy of this desktop's own tools is left out.
    assert client._prefix == "phone"
    assert client._tool_filters == {"rejected": [ren_mcp._OWN_TOOLS]}
