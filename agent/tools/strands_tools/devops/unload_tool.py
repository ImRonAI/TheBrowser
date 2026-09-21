"""Unload a tool from the active agent registry while keeping catalog discoverability."""

from typing import Any, Dict

from strands import tool

@tool
def unload_tool(name: str, agent=None) -> Dict[str, Any]:
    """
    Unload a tool from the agent's tool registry.

    Args:
        name: Tool name to unload
        agent: Current agent instance (injected by Strands)
    """
    if not name:
        return {"status": "error", "content": [{"text": "name is required"}]}

    if not agent or not hasattr(agent, "tool_registry"):
        return {
            "status": "error",
            "content": [{"text": "Agent does not have a tool registry"}],
        }

    registry = agent.tool_registry
    try:
        if hasattr(registry, "unregister_tool"):
            registry.unregister_tool(name)
        else:
            # Fallback to direct registry mutation
            if hasattr(registry, "registry") and isinstance(registry.registry, dict):
                registry.registry.pop(name, None)
            else:
                return {
                    "status": "error",
                    "content": [{"text": "Tool registry does not support unload"}],
                }
    except Exception as exc:
        return {
            "status": "error",
            "content": [{"text": f"Failed to unload tool '{name}': {exc}"}],
        }

    return {
        "status": "success",
        "content": [
            {
                "text": (
                    f"Tool '{name}' unloaded from the active agent registry. "
                    "It remains discoverable in the tool catalog."
                )
            }
        ],
    }
