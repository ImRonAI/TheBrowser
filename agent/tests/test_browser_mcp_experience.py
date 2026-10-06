"""The installed ``mcp_client`` tool is made idempotent by a native BeforeToolCallEvent cancel."""
from types import SimpleNamespace

from strands.hooks import BeforeToolCallEvent

from agent.api.core.panel_tools import MCPConnectionGuard


def _event(action, agent, connection_id="electron"):
    return BeforeToolCallEvent(
        agent=agent, selected_tool=None, invocation_state={},
        tool_use={"toolUseId": "setup", "name": "mcp_client", "input": {"action": action, "connection_id": connection_id}},
    )


def test_repeated_setup_is_cancelled_and_child_registry_is_checked(monkeypatch):
    from strands_tools import mcp_client as module

    connection = SimpleNamespace(is_active=True, loaded_tool_names=["playwright_browser_snapshot"])
    monkeypatch.setattr(module, "_get_connection", lambda _: connection)
    guard = MCPConnectionGuard()
    parent = SimpleNamespace(tool_registry=SimpleNamespace(registry={
        "playwright_browser_snapshot": SimpleNamespace(_connection_id="electron"),
    }))
    child = SimpleNamespace(tool_registry=SimpleNamespace(registry={}))

    event = _event("connect", parent)
    guard.before_tool_call(event)
    assert "already active" in event.cancel_tool

    event = _event("load_tools", parent)
    guard.before_tool_call(event)
    assert "already callable" in event.cancel_tool

    event = _event("load_tools", child)
    guard.before_tool_call(event)
    assert event.cancel_tool is False  # child must actually load, not inherit a false ready flag

    connection.is_active = False
    event = _event("connect", parent)
    guard.before_tool_call(event)
    assert event.cancel_tool is False  # unhealthy connections still use native recovery


def test_name_collision_does_not_claim_mcp_tools_are_ready(monkeypatch):
    from strands_tools import mcp_client as module

    monkeypatch.setattr(module, "_get_connection", lambda _: SimpleNamespace(
        is_active=True, loaded_tool_names=["playwright_browser_snapshot"]))
    agent = SimpleNamespace(tool_registry=SimpleNamespace(registry={"playwright_browser_snapshot": object()}))
    event = _event("load_tools", agent)
    MCPConnectionGuard().before_tool_call(event)
    assert event.cancel_tool is False


def test_other_tools_are_untouched():
    event = BeforeToolCallEvent(agent=None, selected_tool=None, invocation_state={},
                                tool_use={"toolUseId": "x", "name": "shell", "input": {}})
    MCPConnectionGuard().before_tool_call(event)
    assert event.cancel_tool is False
