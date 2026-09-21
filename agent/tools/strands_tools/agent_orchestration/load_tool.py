"""
Dynamic tool loading functionality for Strands Agent.

This module provides functionality to dynamically load Python tools at runtime,
allowing you to extend your agent's capabilities without restarting the application.

Strands automatically hot reloads Python files located in the cwd()/tools/ directory,
making them instantly available as tools without requiring explicit load_tool calls.
For tools located elsewhere, you can use this load_tool function.

Usage with Strands Agent:
```python
from strands import Agent
from strands_tools import load_tool

agent = Agent(tools=[load_tool])

# Using the load_tool through the agent
agent.tool.load_tool(
    name="my_custom_tool",  # The name to register the tool under
    path="/path/to/tool_file.py"  # Path to the Python file containing the tool
)

# After loading, you can use the custom tool directly
agent.tool.my_custom_tool(param1="value", param2="value")
```

Tool files can be defined using the new, more concise @tool decorator pattern:
```python
# cwd()/tools/my_custom_tool.py
from strands import tool
from ..tool_catalog_manager import get_tool_catalog_manager

@tool
def my_custom_tool(param1: str) -> str:
    \"\"\"
    Description of what the tool does.

    Args:
        param1: Description of parameter 1

    Returns:
        str: Description of the return value
    \"\"\"
    # Tool implementation here
    return f"Result: {param1}"
```

See the load_tool function docstring for more details on the tool file structure requirements.
"""

import logging
import os
import shutil
import traceback
from os.path import expanduser
from pathlib import Path
from typing import Any, Dict

from strands import tool

from ..tool_catalog_manager import get_tool_catalog_manager

# Set up logging
logger = logging.getLogger(__name__)


def _project_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "deploy" / "docker-compose.yml").exists():
            return parent
    return here.parents[-1]


def _inventory_root() -> Path:
    root = _project_root()
    vendored = root / "tools" / "ronbrowser_agent_tools" / "src" / "strands_tools"
    if vendored.exists():
        return vendored
    return root / "strands_tools"


def _meta_tooling_dir() -> Path:
    meta_tooling_dir = _inventory_root() / "meta-tooling"
    meta_tooling_dir.mkdir(parents=True, exist_ok=True)
    return meta_tooling_dir


def _is_within_directory(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
    except ValueError:
        return False
    return True


def _persistent_tool_path(source_path: Path, tool_name: str) -> Path:
    meta_tooling_dir = _meta_tooling_dir()
    if tool_name.isidentifier():
        return meta_tooling_dir / f"{tool_name}.py"
    return meta_tooling_dir / source_path.name


def _persist_tool_source(source_path: Path, tool_name: str) -> Path:
    resolved_source = source_path.resolve()
    inventory_root = _inventory_root()
    if _is_within_directory(resolved_source, inventory_root):
        return resolved_source

    persistent_path = _persistent_tool_path(resolved_source, tool_name)
    if resolved_source != persistent_path:
        shutil.copy2(resolved_source, persistent_path)
    return persistent_path.resolve()


@tool
def load_tool(path: str, name: str, agent=None) -> Dict[str, Any]:
    """
    Dynamically load a Python tool file and register it with the Strands Agent.

    This function allows you to load custom tools at runtime from Python files.
    The tool file can use either the new @tool decorator approach (recommended)
    or the traditional TOOL_SPEC dictionary method.

    How It Works:
    ------------
    1. The function validates the provided tool file path exists
    2. It checks if dynamic tool loading is allowed via environment configuration
    3. It uses the agent's tool registry to load and register the tool
    4. Once loaded, the tool becomes available to use like any built-in tool
    5. The tool can then be called directly on the agent object as agent.tool.tool_name(...)

    Tool Loading Process:
    -------------------
    - Expands the path to handle user paths with tilde (~)
    - Validates that the file exists at the specified path
    - Uses the tool_registry's load_tool_from_filepath method to:
      * Parse the Python file
      * Extract the tool function and metadata
      * Register the tool with the provided name
      * Make it available for immediate use

    Common Error Scenarios:
    ---------------------
    - File not found: The specified Python file does not exist
    - Runtime error: Dynamic tool loading is disabled
    - Import error: The tool file has dependencies that aren't installed
    - Syntax error: The tool file contains Python syntax errors
    - Schema error: The tool doesn't conform to expected Strands tool structure

    Recommended Tool File Structure (using @tool decorator):
    ```python
    # cwd()/tools/my_custom_tool.py
    from strands import tool

    @tool
    def my_custom_tool(param1: str) -> str:
        \"\"\"
        Description of what the tool does.

        Args:
            param1: Description of parameter 1

        Returns:
            str: Description of the return value
        \"\"\"
        # Tool implementation here
        return f"Result: {param1}"
    ```

    Alternative Tool File Structure (using TOOL_SPEC):
    ```python
    # cwd()/tools/my_custom_tool.py
    from typing import Any
    from strands.types.tools import ToolResult, ToolUse

    TOOL_SPEC = {
        "name": "my_custom_tool",
        "description": "Description of what the tool does",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "param1": {
                        "type": "string",
                        "description": "Description of parameter 1"
                    },
                    # Additional parameters...
                },
                "required": ["param1"]
            }
        }
    }

    def my_custom_tool(tool: ToolUse, **kwargs: Any) -> ToolResult:
        # Tool implementation here
        return {
            "toolUseId": tool["toolUseId"],
            "status": "success",
            "content": [{"text": "Tool execution result"}]
        }
    ```

    Args:
        path: Path to the Python tool file to load. Can be absolute or relative.
            User paths with tilde (~) are automatically expanded.
        name: Name of the tool function to register. This is the name that will be
            used to access the tool through the agent (e.g., agent.tool.name(...)).
        agent: Optional agent instance. If not provided, the function will attempt to
            get the current agent from context. For most use cases, this can be left
            as None and the tool will automatically use the running agent.

    Returns:
        Dict containing status and response content in the format:
        {
            "status": "success|error",
            "content": [{"text": "Response message"}]
        }

        Success case: Returns details about the successfully loaded tool
        Error case: Returns information about what went wrong during loading

    Raises:
        FileNotFoundError: If the specified tool file doesn't exist
        RuntimeError: If dynamic tool loading is disabled
        Various exceptions: Depending on the tool file's content and validity

    Notes:
        - The tool loading can be disabled via STRANDS_DISABLE_LOAD_TOOL=true environment variable
        - Python files in the cwd()/tools/ directory are automatically hot reloaded without
          requiring explicit calls to load_tool
        - When using the load_tool function, ensure your tool files have proper docstrings as they are
          displayed in the agent's available tools
        - For security reasons, tool loading might be restricted in production environments
        - The @tool decorator approach is recommended for new tools as it's more concise and type-safe
    """
    # Get the current agent instance from the Strands context
    current_agent = agent

    try:
        # Check if dynamic tool loading is disabled via environment variable.
        if os.environ.get("STRANDS_DISABLE_LOAD_TOOL", "").lower() == "true":
            logger.warning("Dynamic tool loading is disabled via STRANDS_DISABLE_LOAD_TOOL=true")
            return {"status": "error", "content": [{"text": "⚠️ Dynamic tool loading is disabled in production mode."}]}

        # Expand user path (e.g., ~/tools/my_tool.py -> /home/username/tools/my_tool.py)
        path = expanduser(path)
        source_path = Path(path)

        # Validate that the file exists
        if not source_path.exists():
            raise FileNotFoundError(f"Tool file not found: {path}")

        persistent_path = _persist_tool_source(source_path, name)
        persistent_path_str = str(persistent_path)

        # Load the tool using the agent's tool registry
        current_agent.tool_registry.load_tool_from_filepath(tool_name=name, tool_path=persistent_path_str)

        # Update tool catalog after successful load
        try:
            catalog = get_tool_catalog_manager()
            tool_obj = None
            if current_agent and hasattr(current_agent, "tool_registry"):
                registry = getattr(current_agent.tool_registry, "registry", None)
                if isinstance(registry, dict):
                    tool_obj = registry.get(name)
            if tool_obj is not None:
                load_pathway = f"load_tool(path='{persistent_path_str}', name='{name}')"
                catalog.register_tool(
                    tool_obj,
                    origin="dynamically_loaded",
                    category="meta-tooling",
                    load_pathway=load_pathway,
                )
            else:
                catalog.register_entry(
                    name=name,
                    description=f"Dynamically loaded tool from {persistent_path_str}",
                    input_schema={},
                    origin="dynamically_loaded",
                    category="meta-tooling",
                    path=persistent_path_str,
                    load_pathway=f"load_tool(path='{persistent_path_str}', name='{name}')",
                    execute_pathway=f"tool_execute(name='{name}', arguments={{...}})" if name else None,
                    unload_pathway=f"unload_tool(name='{name}')" if name else None,
                )
        except Exception as exc:
            logger.debug("Tool catalog update failed for load_tool: %s", exc)

        # Return catalog overview first, then success message
        if persistent_path == source_path.resolve():
            message = f"✅ Tool '{name}' loaded successfully from {persistent_path_str}"
        else:
            message = (
                f"✅ Tool '{name}' loaded successfully from {source_path.resolve()} and persisted to "
                f"{persistent_path_str}"
            )
        catalog_payload = None
        try:
            catalog_payload = get_tool_catalog_manager().build_catalog_overview()
        except Exception as exc:
            logger.debug("Failed to build catalog overview: %s", exc)

        content = []
        if catalog_payload:
            content.append({"json": catalog_payload})
        content.append({"text": message})
        return {"status": "success", "content": content}

    except Exception as e:
        # Capture full traceback
        error_tb = traceback.format_exc()
        error_message = f"❌ Failed to load tool: {str(e)}"
        logger.error(error_message)
        catalog_payload = None
        try:
            catalog_payload = get_tool_catalog_manager().build_catalog_overview()
        except Exception:
            pass
        content = []
        if catalog_payload:
            content.append({"json": catalog_payload})
        return {
            "status": "error",
            "content": content
            + [
                {"text": f"❌ {error_message}\n\nTraceback:\n{error_tb}"},
                {"text": f"📥 Input parameters: Name: {name}, Path: {path}"},
            ],
        }
