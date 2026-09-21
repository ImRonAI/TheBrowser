"""Emit Plan Tool - Display a plan in the UI

This tool allows the agent to emit a plan structure that will be rendered
in the UI using the Plan component. The plan is displayed as a collapsible
card with title, description, and steps.

Usage:
    agent.tool.emit_plan(
        title="Build login feature",
        description="Create authentication flow",
        steps=[
            {"title": "Create login form", "status": "pending"},
            {"title": "Add validation", "status": "pending"},
            {"title": "Connect to backend", "status": "pending"}
        ]
    )
"""

from typing import Dict, Any, List, Optional
from strands import tool


@tool
def emit_plan(
    title: str,
    description: Optional[str] = None,
    steps: Optional[List[Dict[str, Any]]] = None,
    footer: Optional[str] = None,
) -> Dict[str, Any]:
    """Display a plan in the UI.

    Args:
        title: The plan title
        description: Optional description explaining the plan
        steps: Optional list of steps, each with title, description, and status
        footer: Optional footer text

    Returns:
        Dict with __ui_data__ marker that triggers Plan component in UI
    """
    plan_data = {
        "title": title,
    }
    
    if description:
        plan_data["description"] = description
    
    if steps:
        # Normalize steps to have required fields
        normalized_steps = []
        for i, step in enumerate(steps):
            normalized_step = {
                "title": step.get("title") or step.get("name") or f"Step {i+1}",
                "description": step.get("description"),
                "status": step.get("status", "pending"),
                "id": step.get("id") or f"step-{i}",
            }
            normalized_steps.append(normalized_step)
        plan_data["steps"] = normalized_steps
    
    if footer:
        plan_data["footer"] = footer
    
    # Return with __ui_data__ marker - callback handler will detect and emit data-part
    return {
        "status": "success",
        "content": [{"text": f"Plan displayed: {title}"}],
        "__ui_data__": {
            "type": "plan",
            "data": plan_data,
        },
    }
