"""
Event loop control tool for Strands Agent.

This module provides functionality to gracefully terminate the current event loop cycle
by setting a stop flag in the request state. It's particularly useful for:

1. Ending conversations when a task is complete
2. Preventing further processing when an error condition is encountered
3. Creating logical exit points in complex workflows
4. Implementing cancel/abort functionality in user interfaces

Usage with Strands Agent:
```python
from strands import Agent
from strands_tools import stop

agent = Agent(tools=[stop])

# Basic usage
agent.tool.stop(reason="Task completed successfully")

# In conditional workflows
if condition_met:
    agent.tool.stop(reason="Condition satisfied, no further processing needed")
```

The stop tool sets the 'stop_event_loop' flag in the request state,
which signals the Strands runtime to terminate the current cycle cleanly.
"""

import logging
from typing import Any

from strands import tool
from strands.types.tools import ToolContext

# Initialize logging and set paths
logger = logging.getLogger(__name__)


@tool(context=True)
def stop(reason: str = "No reason provided", tool_context: ToolContext = None) -> dict:
    """
    Stops the current event loop cycle by setting the stop_event_loop flag.

    This tool allows for graceful termination of the current event loop iteration
    while providing an optional reason for the termination. When called, it sets
    the 'stop_event_loop' flag in the request state, signaling the Strands runtime
    to complete the current cycle and then stop further processing.

    How It Works:
    ------------
    1. The tool extracts the optional reason from the input
    2. It sets the 'stop_event_loop' flag in the request state to True
    3. It returns a success message with the provided reason
    4. The Strands runtime detects the flag and stops further cycle execution

    Common Usage Scenarios:
    ---------------------
    - Task completion: Stop processing once a specific goal is achieved
    - Error handling: Terminate gracefully when encountering unrecoverable errors
    - User requests: End the session when the user explicitly requests termination
    - Resource management: Stop processing to prevent excessive computation

    Args:
        reason: Optional reason for stopping the event loop cycle. Default: "No reason provided"
        tool_context: Tool context containing request state

    Returns:
        Dict containing status and response content

    Notes:
        - This tool only stops the current event loop cycle, not the entire application
        - The stop is graceful, allowing current operations to complete
        - Always provide a meaningful reason for debugging and user feedback
        - The stop flag is only effective within the current request context
    """
    request_state = tool_context.invocation_state.get("request_state", {}) if tool_context else {}

    # Set the stop flag
    request_state["stop_event_loop"] = True

    logger.debug(f"Reason: {reason}")

    return {
        "status": "success",
        "content": [{"text": f"Event loop cycle stop requested. Reason: {reason}"}],
    }
