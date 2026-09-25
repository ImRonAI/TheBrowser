"""Regression coverage for the native MCP setup facade (no live model calls)."""
from types import SimpleNamespace
import asyncio

from agent.api.core.panel_tools import _IdempotentMCPTool


class NativeProbe:
    def __init__(self):
        self.calls = 0

    async def stream(self, tool_use, invocation_state, **kwargs):
        self.calls += 1
        yield {"toolUseId": tool_use["toolUseId"], "status": "success", "content": [{"text": "native"}]}


def test_repeated_setup_is_success_and_child_registry_is_checked(monkeypatch):
    asyncio.run(_repeated_setup(monkeypatch))


async def _repeated_setup(monkeypatch):
    from strands_tools import mcp_client as module

    connection = SimpleNamespace(is_active=True, loaded_tool_names=["playwright_browser_snapshot"])
    monkeypatch.setattr(module, "_get_connection", lambda _: connection)
    native = NativeProbe()
    tool = _IdempotentMCPTool(native)
    parent = SimpleNamespace(tool_registry=SimpleNamespace(registry={
        "playwright_browser_snapshot": SimpleNamespace(_connection_id="electron"),
    }))
    child = SimpleNamespace(tool_registry=SimpleNamespace(registry={}))

    async def invoke(action, agent=parent):
        return [event async for event in tool.stream(
            {"toolUseId": "setup", "input": {"action": action, "connection_id": "electron"}}, {}, agent=agent
        )]

    assert (await invoke("connect"))[0]["status"] == "success"
    assert "already callable" in (await invoke("load_tools"))[0]["content"][0]["text"]
    assert native.calls == 0
    await invoke("load_tools", child)
    assert native.calls == 1  # child must actually load, not inherit a false ready flag
    connection.is_active = False
    await invoke("connect")
    assert native.calls == 2  # unhealthy connections still use native recovery


def test_name_collision_does_not_claim_mcp_tools_are_ready(monkeypatch):
    asyncio.run(_name_collision(monkeypatch))


async def _name_collision(monkeypatch):
    from strands_tools import mcp_client as module

    monkeypatch.setattr(module, "_get_connection", lambda _: SimpleNamespace(
        is_active=True, loaded_tool_names=["playwright_browser_snapshot"]))
    native = NativeProbe()
    tool = _IdempotentMCPTool(native)
    agent = SimpleNamespace(tool_registry=SimpleNamespace(registry={"playwright_browser_snapshot": object()}))
    _ = [event async for event in tool.stream(
        {"toolUseId": "load", "input": {"action": "load_tools", "connection_id": "electron"}}, {}, agent=agent)]
    assert native.calls == 1