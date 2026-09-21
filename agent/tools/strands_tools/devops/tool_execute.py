"""Generic tool executor for catalog-driven tool invocation."""

from typing import Any, Dict, Optional

from strands import tool

from strands_tools.agent_orchestration.load_tool import load_tool
from ..tool_catalog_manager import get_tool_catalog_manager


@tool
def tool_execute(
    name: str,
    arguments: Optional[Dict[str, Any]] = None,
    load_path: Optional[str] = None,
    load_if_missing: bool = True,
    agent: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Execute a tool by name, optionally loading it first.

    Args:
        name: Tool name to execute.
        arguments: Arguments to pass to the tool.
        load_path: Optional path to load the tool from if missing.
        load_if_missing: Whether to load the tool when it's not registered.
        agent: Injected agent instance from the SDK.
    """
    if not name:
        return {"status": "error", "content": [{"text": "name is required"}]}

    if name == "tool_execute":
        return {"status": "error", "content": [{"text": "tool_execute cannot invoke itself"}]}

    if agent is None:
        return {"status": "error", "content": [{"text": "agent context not available"}]}

    args = arguments or {}
    if not isinstance(args, dict):
        return {"status": "error", "content": [{"text": "arguments must be a dict"}]}

    registry = getattr(getattr(agent, "tool_registry", None), "registry", None)
    tool_obj = registry.get(name) if isinstance(registry, dict) else None

    if tool_obj is None and load_if_missing and not load_path:
        try:
            catalog = get_tool_catalog_manager()
            details = catalog.get_tool_details(name)
            if details:
                load_path = details.get("module_path") or details.get("path")
        except Exception:
            load_path = None

    if tool_obj is None and load_if_missing and load_path:
        load_result = load_tool(path=load_path, name=name, agent=agent)
        if isinstance(load_result, dict) and load_result.get("status") == "error":
            return load_result
        registry = getattr(getattr(agent, "tool_registry", None), "registry", None)
        tool_obj = registry.get(name) if isinstance(registry, dict) else None

    if tool_obj is None:
        return {"status": "error", "content": [{"text": f"Tool not loaded: {name}"}]}

    tool_proxy = getattr(agent, "tool", None)
    try:
        callable_tool = getattr(tool_proxy, name) if tool_proxy else tool_obj
    except Exception:
        callable_tool = tool_obj

    try:
        result = callable_tool(**args) if args else callable_tool()
    except Exception as exc:
        return {"status": "error", "content": [{"text": f"Tool '{name}' execution failed: {exc}"}]}

    if isinstance(result, dict) and "status" in result and "content" in result:
        return result

    return {"status": "success", "content": [{"json": {"tool": name, "result": result}}]}
