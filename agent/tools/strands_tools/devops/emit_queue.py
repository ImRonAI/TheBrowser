"""Emit Queue Tool - Display a todo list in the UI

This tool allows the agent to emit a queue/todo list that will be rendered
in the UI using the Queue component. The queue displays items with completion
status and can be updated dynamically.

Usage:
    agent.tool.emit_queue(
        items=[
            {"title": "Buy milk", "completed": False},
            {"title": "Walk dog", "completed": True}
        ]
    )
    
    # Update todo status
    agent.tool.emit_queue(
        action="update",
        item_id="item-1",
        completed=True
    )
"""

from typing import Dict, Any, List, Optional
from strands import tool


@tool
def emit_queue(
    items: Optional[List[Dict[str, Any]]] = None,
    label: Optional[str] = None,
    action: Optional[str] = None,
    item_id: Optional[str] = None,
    completed: Optional[bool] = None,
) -> Dict[str, Any]:
    """Display or update a queue/todo list in the UI.

    Args:
        items: List of todo items with title, description, and completed status
        label: Optional label for the queue (default: "Todo")
        action: Optional action - "add" (default), "update", "clear"
        item_id: ID of item to update (required for update action)
        completed: Whether item is completed (for update action)

    Returns:
        Dict with __ui_data__ marker that triggers Queue component in UI
    """
    # Handle update action
    if action == "update":
        if not item_id:
            return {
                "status": "error",
                "content": [{"text": "item_id required for update action"}],
            }
        return {
            "status": "success",
            "content": [{"text": f"Updated item: {item_id}"}],
            "__ui_data__": {
                "type": "queue",
                "action": "update",
                "item_id": item_id,
                "completed": completed,
            },
        }
    
    # Handle clear action
    if action == "clear":
        return {
            "status": "success",
            "content": [{"text": "Queue cleared"}],
            "__ui_data__": {
                "type": "queue",
                "action": "clear",
            },
        }
    
    # Default: emit queue with items
    if not items:
        return {
            "status": "error",
            "content": [{"text": "items required for emit action"}],
        }
    
    # Normalize items
    normalized_items = []
    for i, item in enumerate(items):
        normalized_item = {
            "title": item.get("title") or item.get("name") or f"Item {i+1}",
            "description": item.get("description"),
            "completed": item.get("completed", False),
            "id": item.get("id") or f"item-{i}",
        }
        normalized_items.append(normalized_item)
    
    queue_data = {
        "label": label or "Todo",
        "items": normalized_items,
    }
    
    # Return with __ui_data__ marker - callback handler will detect and emit data-part
    return {
        "status": "success",
        "content": [{"text": f"Queue displayed: {len(normalized_items)} items"}],
        "__ui_data__": {
            "type": "queue",
            "data": queue_data,
        },
    }
