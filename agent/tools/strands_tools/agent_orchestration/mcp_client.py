"""MCP Client Tool for Strands Agents.

⚠️ SECURITY WARNING: This tool allows agents to autonomously connect to external
MCP servers and dynamically load remote tools. This poses security risks as agents
can potentially connect to malicious servers and execute untrusted code. Use with
caution in production environments.

This tool provides a high-level interface for dynamically connecting to any MCP server
and loading remote tools at runtime. This is different from the static MCP server
implementation in the Strands SDK (see https://github.com/strands-agents/docs/blob/main/docs/user-guide/concepts/tools/mcp-tools.md).

Key differences from SDK's MCP implementation:
- This tool enables connections to new MCP servers at runtime
- Can autonomously discover and load external tools from untrusted sources
- MCP tools are catalog-first and can be executed directly via call_tool
- Connections persist across multiple tool invocations
- Supports multiple concurrent connections to different MCP servers

It leverages the Strands SDK's MCPClient for robust connection management
and implements a per-operation connection pattern for stability.
"""

import logging
import os
import time
from dataclasses import dataclass
from datetime import timedelta
from threading import Lock
from typing import Any, Dict, List, Optional

from mcp import StdioServerParameters, stdio_client
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client
from strands import tool
from strands.tools.mcp import MCPClient
from strands.types.tools import AgentTool, ToolGenerator, ToolSpec, ToolUse
from ..tool_catalog_manager import get_tool_catalog_manager

logger = logging.getLogger(__name__)

# Default timeout for MCP operations - can be overridden via environment variable
API_TOOL_TIMEOUT_SECONDS = int(os.getenv("API_TOOL_TIMEOUT_SECONDS", "7"))
DEFAULT_MCP_TIMEOUT = float(os.environ.get("STRANDS_MCP_TIMEOUT", str(API_TOOL_TIMEOUT_SECONDS)))
DEFAULT_MCP_TIMEOUT = min(DEFAULT_MCP_TIMEOUT, API_TOOL_TIMEOUT_SECONDS)
DEFAULT_MCP_SSE_READ_TIMEOUT = float(os.environ.get("STRANDS_MCP_SSE_READ_TIMEOUT", str(API_TOOL_TIMEOUT_SECONDS)))
DEFAULT_MCP_SSE_READ_TIMEOUT = min(DEFAULT_MCP_SSE_READ_TIMEOUT, API_TOOL_TIMEOUT_SECONDS)


def _cap_timeout(value: Optional[float], default: float) -> float:
    try:
        if value is None:
            return default
        return min(float(value), API_TOOL_TIMEOUT_SECONDS)
    except (TypeError, ValueError):
        return default


class MCPTool(AgentTool):
    """Wrapper class for dynamically loaded MCP tools that extends AgentTool.

    This class wraps MCP tools loaded through mcp_client and ensures proper
    connection management using the `with mcp_client:` context pattern used throughout
    the dynamic MCP client. It handles both sync and async tool execution while
    maintaining connection health and error handling.
    """

    def __init__(self, mcp_tool, connection_id: str):
        """Initialize MCPTool wrapper.

        Args:
            mcp_tool: The underlying MCP tool instance from the SDK
            connection_id: ID of the connection this tool belongs to
        """
        super().__init__()
        self._mcp_tool = mcp_tool
        self._connection_id = connection_id
        logger.debug(f"MCPTool wrapper created for tool '{mcp_tool.tool_name}' on connection '{connection_id}'")

    @property
    def tool_name(self) -> str:
        """Get the name of the tool."""
        return self._mcp_tool.tool_name

    @property
    def tool_spec(self) -> ToolSpec:
        """Get the specification of the tool."""
        return self._mcp_tool.tool_spec

    @property
    def tool_type(self) -> str:
        """Get the type of the tool."""
        return "mcp_dynamic"

    async def stream(self, tool_use: ToolUse, invocation_state: dict[str, Any], **kwargs: Any) -> ToolGenerator:
        """Stream the MCP tool execution with proper connection management.

        This method uses the same `with mcp_client:` context pattern as other
        operations in mcp_client to ensure proper connection management
        and error handling.

        Args:
            tool_use: The tool use request containing tool ID and parameters.
            invocation_state: Context for the tool invocation, including agent state.
            **kwargs: Additional keyword arguments for future extensibility.

        Yields:
            Tool events with the last being the tool result.
        """
        logger.debug(
            f"MCPTool executing tool '{self.tool_name}' on connection '{self._connection_id}' "
            f"with tool_use_id '{tool_use['toolUseId']}'"
        )

        # Get connection info
        config = _get_connection(self._connection_id)
        if not config:
            error_result = {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": f"Connection '{self._connection_id}' not found"}],
            }
            yield error_result
            return

        if not config.is_active:
            error_result = {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": f"Connection '{self._connection_id}' is not active"}],
            }
            yield error_result
            return

        try:
            # Use the same context pattern as other operations in mcp_client
            with config.mcp_client:
                result = await config.mcp_client.call_tool_async(
                    tool_use_id=tool_use["toolUseId"],
                    name=self.tool_name,
                    arguments=tool_use["input"],
                )
                yield result

        except Exception as e:
            logger.error(f"Error executing MCP tool '{self.tool_name}': {e}", exc_info=True)

            # Mark connection as unhealthy if it fails
            with _CONNECTION_LOCK:
                config.is_active = False
                config.last_error = str(e)

            error_result = {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": f"Failed to execute tool '{self.tool_name}': {str(e)}"}],
            }
            yield error_result

    def get_display_properties(self) -> dict[str, str]:
        """Get properties to display in UI representations of this tool."""
        base_props = super().get_display_properties()
        base_props["Connection ID"] = self._connection_id
        return base_props


@dataclass
class ConnectionInfo:
    """Information about an MCP connection."""

    connection_id: str
    mcp_client: MCPClient
    transport: str
    url: str
    register_time: float
    is_active: bool = True
    last_error: Optional[str] = None
    loaded_tool_names: List[str] = None
    agent_loaded_tool_names: List[str] = None

    def __post_init__(self):
        """Initialize mutable defaults."""
        if self.loaded_tool_names is None:
            self.loaded_tool_names = []
        if self.agent_loaded_tool_names is None:
            self.agent_loaded_tool_names = []


# Thread-safe connection storage
_connections: Dict[str, ConnectionInfo] = {}
_CONNECTION_LOCK = Lock()


def _get_connection(connection_id: str) -> Optional[ConnectionInfo]:
    """Get a connection by ID with thread safety."""
    with _CONNECTION_LOCK:
        return _connections.get(connection_id)


def _escape_single_quotes(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _spec_description(tool_obj: Any) -> str:
    tool_spec = getattr(tool_obj, "tool_spec", {}) or {}
    if isinstance(tool_spec, dict):
        return tool_spec.get("description", "") or ""
    return getattr(tool_spec, "description", "") or ""


def _spec_input_schema(tool_obj: Any) -> Dict[str, Any]:
    tool_spec = getattr(tool_obj, "tool_spec", {}) or {}
    if isinstance(tool_spec, dict):
        return tool_spec.get("inputSchema", {}) or {}
    return getattr(tool_spec, "input_schema", {}) or {}


def _register_mcp_tools_in_catalog(connection_id: str, tools: List[Any]) -> None:
    """Register MCP tools in the catalog with direct execution pathways."""
    if not tools:
        return

    escaped_connection_id = _escape_single_quotes(connection_id)
    try:
        catalog = get_tool_catalog_manager()
        for tool_obj in tools:
            tool_name = getattr(tool_obj, "tool_name", None)
            if not tool_name:
                continue

            escaped_tool_name = _escape_single_quotes(tool_name)
            catalog.register_entry(
                name=tool_name,
                description=_spec_description(tool_obj) or f"MCP tool from connection '{connection_id}'",
                input_schema=_spec_input_schema(tool_obj),
                origin=f"mcp:{connection_id}",
                category="mcp_tools",
                path=None,
                load_pathway=(
                    f"mcp_client(action='load_tools', connection_id='{escaped_connection_id}', "
                    "load_into_agent_registry=False)"
                ),
                execute_pathway=(
                    f"mcp_client(action='call_tool', connection_id='{escaped_connection_id}', "
                    f"tool_name='{escaped_tool_name}', tool_args={{...}})"
                ),
                unload_pathway=f"mcp_client(action='disconnect', connection_id='{escaped_connection_id}')",
            )
    except Exception as exc:
        logger.debug("Failed to register MCP tools in catalog: %s", exc)


def _validate_connection(connection_id: str, check_active: bool = False) -> Optional[Dict[str, Any]]:
    """Validate that a connection exists and optionally check if it's active."""
    if not connection_id:
        return {"status": "error", "content": [{"text": "connection_id is required"}]}

    config = _get_connection(connection_id)
    if not config:
        return {"status": "error", "content": [{"text": f"Connection '{connection_id}' not found"}]}

    if check_active and not config.is_active:
        return {"status": "error", "content": [{"text": f"Connection '{connection_id}' is not active"}]}

    return None


def _create_transport_callable(transport: str, **params):
    """Create a transport callable based on the transport type and parameters."""
    if transport == "stdio":
        command = params.get("command")
        if not command:
            raise ValueError("command is required for stdio transport")
        args = params.get("args", [])
        env = params.get("env")
        stdio_params = {"command": command, "args": args}
        if env:
            stdio_params["env"] = env
        return lambda: stdio_client(StdioServerParameters(**stdio_params))

    elif transport == "sse":
        server_url = params.get("server_url")
        if not server_url:
            raise ValueError("server_url is required for SSE transport")
        return lambda: sse_client(server_url)

    elif transport == "streamable_http":
        server_url = params.get("server_url")
        if not server_url:
            raise ValueError("server_url is required for streamable HTTP transport")

        # Build streamable HTTP parameters
        http_params = {"url": server_url}
        if params.get("headers"):
            http_params["headers"] = params["headers"]
        if params.get("timeout"):
            http_params["timeout"] = timedelta(seconds=params["timeout"])
        if params.get("sse_read_timeout"):
            http_params["sse_read_timeout"] = timedelta(seconds=params["sse_read_timeout"])
        if params.get("terminate_on_close") is not None:
            http_params["terminate_on_close"] = params["terminate_on_close"]
        if params.get("auth"):
            http_params["auth"] = params["auth"]

        return lambda: streamablehttp_client(**http_params)

    else:
        raise ValueError(f"Unsupported transport: {transport}. Supported: stdio, sse, streamable_http")


@tool
def mcp_client(
    action: str,
    server_config: Optional[Dict[str, Any]] = None,
    connection_id: Optional[str] = None,
    tool_name: Optional[str] = None,
    tool_args: Optional[Dict[str, Any]] = None,
    prompt_name: Optional[str] = None,
    prompt_args: Optional[Dict[str, Any]] = None,
    pagination_token: Optional[str] = None,
    resource_uri: Optional[str] = None,
    # Additional parameters that can be passed directly
    transport: Optional[str] = None,
    command: Optional[str] = None,
    args: Optional[List[str]] = None,
    env: Optional[Dict[str, str]] = None,
    server_url: Optional[str] = None,
    arguments: Optional[Dict[str, Any]] = None,
    # New streamable HTTP parameters
    headers: Optional[Dict[str, Any]] = None,
    timeout: Optional[float] = None,
    sse_read_timeout: Optional[float] = None,
    terminate_on_close: Optional[bool] = None,
    auth: Optional[Any] = None,
    load_into_agent_registry: Optional[bool] = None,
    agent: Optional[Any] = None,  # Agent instance passed by SDK
) -> Dict[str, Any]:
    """
    MCP client tool for autonomously connecting to external MCP servers.

    ⚠️ SECURITY WARNING: This tool enables agents to autonomously connect to external
    MCP servers and dynamically load remote tools at runtime. This can pose significant
    security risks as agents may connect to malicious servers or execute untrusted code.

    Key Security Considerations:
    - Agents can connect to ANY MCP server URL or command provided
    - External tools are discoverable via catalog and may be loaded into the agent registry only when requested
    - Loaded tools can execute arbitrary code with agent's permissions
    - Connections persist and can be reused across multiple operations

    This is different from the static MCP server configuration in the Strands SDK
    (see https://github.com/strands-agents/docs/blob/main/docs/user-guide/concepts/tools/mcp-tools.md)
    which uses pre-configured, trusted MCP servers.

    Supports multiple actions for comprehensive MCP server management:
    - connect: Establish connection to an MCP server
    - list_tools: List available tools from a connected server
    - disconnect: Close connection to an MCP server
    - call_tool: Directly invoke a tool on a connected server
    - list_connections: Show all active MCP connections
    - load_tools: Register MCP tools in the tool catalog; optionally also register with the agent
    - list_prompts: List available prompts from a connected server
    - get_prompt: Retrieve a prompt (optionally with arguments) from a connected server
    - list_resources: List available resources from a connected server
    - list_resource_templates: List available resource templates from a connected server
    - read_resource: Read a resource by URI from a connected server

    Args:
        action: The action to perform (connect, list_tools, disconnect, call_tool, list_connections, load_tools,
            list_prompts, get_prompt, list_resources, list_resource_templates, read_resource)
        server_config: Configuration for MCP server connection (optional, can use direct parameters)
        connection_id: Identifier for the MCP connection
        tool_name: Name of tool to call (for call_tool action)
        tool_args: Arguments to pass to tool (for call_tool action)
        prompt_name: Name of prompt to retrieve (for get_prompt action)
        prompt_args: Arguments to pass to prompt (for get_prompt action, string values only)
        pagination_token: Cursor token for list_* pagination (optional)
        resource_uri: URI of the resource to read (for read_resource action)
        transport: Transport type (stdio, sse, or streamable_http) - can be passed directly instead of in server_config
        command: Command for stdio transport - can be passed directly
        args: Arguments for stdio command - can be passed directly
        env: Environment variables for stdio command - can be passed directly
        server_url: URL for SSE or streamable_http transport - can be passed directly
        arguments: Alternative to tool_args for tool arguments
        headers: HTTP headers for streamable_http transport (optional)
        timeout: Timeout in seconds for HTTP operations in streamable_http transport (default: 7)
        sse_read_timeout: SSE read timeout in seconds for streamable_http transport (default: 7)
        terminate_on_close: Whether to terminate connection on close for streamable_http transport (default: True)
        auth: Authentication object for streamable_http transport (httpx.Auth compatible)
        load_into_agent_registry: When True, also register tools in the active agent tool registry.
            Default False to keep MCP tools catalog-first and reduce agent context size.

    Returns:
        Dict with the result of the operation

    Examples:
        # Connect to custom stdio server with direct parameters
        mcp_client(
            action="connect",
            connection_id="my_server",
            transport="stdio",
            command="python",
            args=["my_server.py"]
        )

        # Connect to streamable HTTP server
        mcp_client(
            action="connect",
            connection_id="http_server",
            transport="streamable_http",
            server_url="https://example.com/mcp",
            headers={"Authorization": "Bearer token"},
            timeout=7
        )

        # Call a tool directly with parameters
        mcp_client(
            action="call_tool",
            connection_id="my_server",
            tool_name="calculator",
            tool_args={"x": 10, "y": 20}
        )
    """

    try:
        # Prepare parameters for action handlers
        params = {
            "action": action,
            "connection_id": connection_id,
            "tool_name": tool_name,
            "tool_args": tool_args or arguments,  # Support both parameter names
            "prompt_name": prompt_name,
            "prompt_args": prompt_args,
            "pagination_token": pagination_token,
            "resource_uri": resource_uri,
            "load_into_agent_registry": bool(load_into_agent_registry),
            "agent": agent,  # Pass agent instance to handlers
        }

        # Handle server configuration - merge direct parameters with server_config
        if action == "connect":
            if server_config is None:
                server_config = {}

            # Direct parameters override server_config
            if transport is not None:
                params["transport"] = transport
            elif "transport" in server_config:
                params["transport"] = server_config["transport"]

            if command is not None:
                params["command"] = command
            elif "command" in server_config:
                params["command"] = server_config["command"]

            if args is not None:
                params["args"] = args
            elif "args" in server_config:
                params["args"] = server_config["args"]

            if server_url is not None:
                params["server_url"] = server_url
            elif "server_url" in server_config:
                params["server_url"] = server_config["server_url"]

            if env is not None:
                params["env"] = env
            elif "env" in server_config:
                params["env"] = server_config["env"]

            # Streamable HTTP specific parameters
            if headers is not None:
                params["headers"] = headers
            elif "headers" in server_config:
                params["headers"] = server_config["headers"]

            if timeout is not None:
                params["timeout"] = _cap_timeout(timeout, DEFAULT_MCP_TIMEOUT)
            elif "timeout" in server_config:
                params["timeout"] = _cap_timeout(server_config["timeout"], DEFAULT_MCP_TIMEOUT)
            else:
                params["timeout"] = DEFAULT_MCP_TIMEOUT

            if sse_read_timeout is not None:
                params["sse_read_timeout"] = _cap_timeout(sse_read_timeout, DEFAULT_MCP_SSE_READ_TIMEOUT)
            elif "sse_read_timeout" in server_config:
                params["sse_read_timeout"] = _cap_timeout(server_config["sse_read_timeout"], DEFAULT_MCP_SSE_READ_TIMEOUT)
            else:
                params["sse_read_timeout"] = DEFAULT_MCP_SSE_READ_TIMEOUT

            if terminate_on_close is not None:
                params["terminate_on_close"] = terminate_on_close
            elif "terminate_on_close" in server_config:
                params["terminate_on_close"] = server_config["terminate_on_close"]

            if auth is not None:
                params["auth"] = auth
            elif "auth" in server_config:
                params["auth"] = server_config["auth"]

        # Process the action
        if action == "connect":
            return _connect_to_server(params)
        elif action == "disconnect":
            return _disconnect_from_server(params)
        elif action == "list_connections":
            return _list_active_connections(params)
        elif action == "list_tools":
            return _list_server_tools(params)
        elif action == "call_tool":
            return _call_server_tool(params)
        elif action == "load_tools":
            return _load_tools_to_agent(params)
        elif action == "list_prompts":
            return _list_server_prompts(params)
        elif action == "get_prompt":
            return _get_server_prompt(params)
        elif action == "list_resources":
            return _list_server_resources(params)
        elif action == "list_resource_templates":
            return _list_server_resource_templates(params)
        elif action == "read_resource":
            return _read_server_resource(params)
        else:
            return {
                "status": "error",
                "content": [
                    {
                        "text": f"Unknown action: {action}. Available actions: "
                        "connect, disconnect, list_connections, list_tools, call_tool, load_tools, "
                        "list_prompts, get_prompt, list_resources, list_resource_templates, read_resource"
                    }
                ],
            }

    except Exception as e:
        logger.error(f"Error in mcp_client: {e}", exc_info=True)
        return {"status": "error", "content": [{"text": f"Error in mcp_client: {str(e)}"}]}


def _connect_to_server(params: Dict[str, Any]) -> Dict[str, Any]:
    """Connect to an MCP server using SDK's MCPClient."""
    connection_id = params.get("connection_id")
    if not connection_id:
        return {"status": "error", "content": [{"text": "connection_id is required for connect action"}]}

    transport = params.get("transport", "stdio")

    # Check if connection already exists
    with _CONNECTION_LOCK:
        if connection_id in _connections and _connections[connection_id].is_active:
            return {
                "status": "error",
                "content": [{"text": f"Connection '{connection_id}' already exists and is active"}],
            }

    try:
        # Create transport callable using the SDK pattern
        params_copy = params.copy()
        params_copy.pop("transport", None)  # Remove transport to avoid duplicate parameter
        transport_callable = _create_transport_callable(transport, **params_copy)

        # Create MCPClient using SDK
        mcp_client = MCPClient(transport_callable)

        # Test the connection by listing tools using the context manager
        # The context manager handles starting and stopping the client
        with mcp_client:
            tools = mcp_client.list_tools_sync()
            tool_count = len(tools)

        # At this point, the client has been initialized and tested
        # The connection is ready for future use

        # Store connection info
        url = params.get("server_url", f"{params.get('command', '')} {' '.join(params.get('args', []))}")
        connection_info = ConnectionInfo(
            connection_id=connection_id,
            mcp_client=mcp_client,
            transport=transport,
            url=url,
            register_time=time.time(),
            is_active=True,
        )

        with _CONNECTION_LOCK:
            _connections[connection_id] = connection_info

        connection_result = {
            "message": f"Connected to MCP server '{connection_id}'",
            "connection_id": connection_id,
            "transport": transport,
            "tools_count": tool_count,
            "available_tools": [tool.tool_name for tool in tools],
        }

        return {
            "status": "success",
            "content": [{"text": f"Connected to MCP server '{connection_id}'"}, {"json": connection_result}],
        }

    except Exception as e:
        logger.error(f"Connection failed: {e}", exc_info=True)
        return {"status": "error", "content": [{"text": f"Connection failed: {str(e)}"}]}


def _disconnect_from_server(params: Dict[str, Any]) -> Dict[str, Any]:
    """Disconnect from an MCP server and optionally clean up agent-registered tools."""
    connection_id = params.get("connection_id")
    agent = params.get("agent")
    error_result = _validate_connection(connection_id)
    if error_result:
        return error_result

    try:
        with _CONNECTION_LOCK:
            config = _connections[connection_id]
            catalog_tool_names = config.loaded_tool_names.copy()
            agent_tool_names = config.agent_loaded_tool_names.copy()

            # Remove connection
            del _connections[connection_id]

        # Clean up loaded tools from agent if agent is provided
        cleanup_result = {"cleaned_tools": [], "failed_tools": []}
        if agent and agent_tool_names:
            cleanup_result = _clean_up_tools_from_agent(agent, connection_id, agent_tool_names)

        disconnect_result = {
            "message": f"Disconnected from MCP server '{connection_id}'",
            "connection_id": connection_id,
            "was_active": config.is_active,
            "catalog_tools_remain_discoverable": bool(catalog_tool_names),
        }

        if cleanup_result["cleaned_tools"]:
            disconnect_result["cleaned_tools"] = cleanup_result["cleaned_tools"]
            disconnect_result["cleaned_tools_count"] = len(cleanup_result["cleaned_tools"])

        if cleanup_result["failed_tools"]:
            disconnect_result["failed_to_clean_tools"] = cleanup_result["failed_tools"]
            disconnect_result["failed_tools_count"] = len(cleanup_result["failed_tools"])

        if agent_tool_names and not agent:
            disconnect_result["loaded_tools_info"] = (
                f"Note: No agent provided, {len(agent_tool_names)} agent-registered tools could not be cleaned up: "
                f"{', '.join(agent_tool_names)}"
            )

        return {
            "status": "success",
            "content": [{"text": f"Disconnected from MCP server '{connection_id}'"}, {"json": disconnect_result}],
        }
    except Exception as e:
        return {"status": "error", "content": [{"text": f"Disconnect failed: {str(e)}"}]}


def _list_active_connections(params: Dict[str, Any]) -> Dict[str, Any]:
    """List all active MCP connections."""
    with _CONNECTION_LOCK:
        connections_info = []
        for conn_id, config in _connections.items():
            connections_info.append(
                {
                    "connection_id": conn_id,
                    "transport": config.transport,
                    "url": config.url,
                    "is_active": config.is_active,
                    "registered_at": config.register_time,
                    "last_error": config.last_error,
                    "loaded_tools_count": len(config.loaded_tool_names),
                    "agent_loaded_tools_count": len(config.agent_loaded_tool_names),
                }
            )

        connections_result = {"total_connections": len(_connections), "connections": connections_info}

        return {
            "status": "success",
            "content": [{"text": f"Found {len(_connections)} MCP connections"}, {"json": connections_result}],
        }


def _list_server_tools(params: Dict[str, Any]) -> Dict[str, Any]:
    """List available tools from a connected MCP server."""
    connection_id = params.get("connection_id")
    error_result = _validate_connection(connection_id, check_active=True)
    if error_result:
        return error_result

    try:
        config = _get_connection(connection_id)
        with config.mcp_client:
            tools = config.mcp_client.list_tools_sync()

        tools_info = []
        for tool in tools:
            tool_spec = tool.tool_spec
            tools_info.append(
                {
                    "name": tool.tool_name,
                    "description": tool_spec.get("description", ""),
                    "input_schema": tool_spec.get("inputSchema", {}),
                }
            )

        tools_result = {"connection_id": connection_id, "tools_count": len(tools), "tools": tools_info}

        return {
            "status": "success",
            "content": [{"text": f"Found {len(tools)} tools on MCP server '{connection_id}'"}, {"json": tools_result}],
        }
    except Exception as e:
        return {"status": "error", "content": [{"text": f"Failed to list tools: {str(e)}"}]}


def _list_server_prompts(params: Dict[str, Any]) -> Dict[str, Any]:
    """List available prompts from a connected MCP server."""
    connection_id = params.get("connection_id")
    error_result = _validate_connection(connection_id, check_active=True)
    if error_result:
        return error_result

    pagination_token = params.get("pagination_token")

    try:
        config = _get_connection(connection_id)
        with config.mcp_client:
            prompts_result = config.mcp_client.list_prompts_sync(pagination_token=pagination_token)

        return {
            "status": "success",
            "content": [
                {"text": f"Listed prompts for MCP server '{connection_id}'"},
                {"json": prompts_result.model_dump(by_alias=True)},
            ],
        }
    except Exception as e:
        return {"status": "error", "content": [{"text": f"Failed to list prompts: {str(e)}"}]}


def _get_server_prompt(params: Dict[str, Any]) -> Dict[str, Any]:
    """Get a specific prompt from a connected MCP server."""
    connection_id = params.get("connection_id")
    prompt_name = params.get("prompt_name")

    if not prompt_name:
        return {"status": "error", "content": [{"text": "prompt_name is required for get_prompt action"}]}

    error_result = _validate_connection(connection_id, check_active=True)
    if error_result:
        return error_result

    try:
        config = _get_connection(connection_id)
        prompt_args = params.get("prompt_args") or {}
        if prompt_args:
            non_string_keys = [key for key, value in prompt_args.items() if not isinstance(value, str)]
            if non_string_keys:
                return {
                    "status": "error",
                    "content": [
                        {
                            "text": "prompt_args values must be strings per MCP spec. "
                            f"Non-string keys: {', '.join(non_string_keys)}"
                        }
                    ],
                }
        with config.mcp_client:
            prompt_result = config.mcp_client.get_prompt_sync(prompt_name, prompt_args or None)

        return {
            "status": "success",
            "content": [
                {"text": f"Retrieved prompt '{prompt_name}' from MCP server '{connection_id}'"},
                {"json": prompt_result.model_dump(by_alias=True)},
            ],
        }
    except Exception as e:
        return {
            "status": "error",
            "content": [{"text": f"Failed to get prompt '{prompt_name}': {str(e)}"}],
        }


def _list_server_resources(params: Dict[str, Any]) -> Dict[str, Any]:
    """List available resources from a connected MCP server."""
    connection_id = params.get("connection_id")
    error_result = _validate_connection(connection_id, check_active=True)
    if error_result:
        return error_result

    pagination_token = params.get("pagination_token")

    try:
        config = _get_connection(connection_id)
        with config.mcp_client:
            resources_result = config.mcp_client.list_resources_sync(pagination_token=pagination_token)

        return {
            "status": "success",
            "content": [
                {"text": f"Listed resources for MCP server '{connection_id}'"},
                {"json": resources_result.model_dump(by_alias=True)},
            ],
        }
    except Exception as e:
        return {"status": "error", "content": [{"text": f"Failed to list resources: {str(e)}"}]}


def _list_server_resource_templates(params: Dict[str, Any]) -> Dict[str, Any]:
    """List available resource templates from a connected MCP server."""
    connection_id = params.get("connection_id")
    error_result = _validate_connection(connection_id, check_active=True)
    if error_result:
        return error_result

    pagination_token = params.get("pagination_token")

    try:
        config = _get_connection(connection_id)
        with config.mcp_client:
            templates_result = config.mcp_client.list_resource_templates_sync(pagination_token=pagination_token)

        return {
            "status": "success",
            "content": [
                {"text": f"Listed resource templates for MCP server '{connection_id}'"},
                {"json": templates_result.model_dump(by_alias=True)},
            ],
        }
    except Exception as e:
        return {"status": "error", "content": [{"text": f"Failed to list resource templates: {str(e)}"}]}


def _read_server_resource(params: Dict[str, Any]) -> Dict[str, Any]:
    """Read a resource by URI from a connected MCP server."""
    connection_id = params.get("connection_id")
    resource_uri = params.get("resource_uri")

    if not resource_uri:
        return {"status": "error", "content": [{"text": "resource_uri is required for read_resource action"}]}

    error_result = _validate_connection(connection_id, check_active=True)
    if error_result:
        return error_result

    try:
        config = _get_connection(connection_id)
        with config.mcp_client:
            resource_result = config.mcp_client.read_resource_sync(resource_uri)

        return {
            "status": "success",
            "content": [
                {"text": f"Read resource '{resource_uri}' from MCP server '{connection_id}'"},
                {"json": resource_result.model_dump(by_alias=True)},
            ],
        }
    except Exception as e:
        return {
            "status": "error",
            "content": [{"text": f"Failed to read resource '{resource_uri}': {str(e)}"}],
        }


def _call_server_tool(params: Dict[str, Any]) -> Dict[str, Any]:
    """Call a tool on a connected MCP server."""
    connection_id = params.get("connection_id")
    tool_name = params.get("tool_name")

    if not tool_name:
        return {"status": "error", "content": [{"text": "tool_name is required for call_tool action"}]}

    error_result = _validate_connection(connection_id, check_active=True)
    if error_result:
        return error_result

    try:
        config = _get_connection(connection_id)
        tool_args = params.get("tool_args", {})

        with config.mcp_client:
            # Use SDK's call_tool_sync which returns proper ToolResult
            return config.mcp_client.call_tool_sync(
                tool_use_id=f"mcp_{connection_id}_{tool_name}", name=tool_name, arguments=tool_args
            )
    except Exception as e:
        return {"status": "error", "content": [{"text": f"Failed to call tool: {str(e)}"}]}


def _clean_up_tools_from_agent(agent, connection_id: str, tool_names: List[str]) -> Dict[str, Any]:
    """Clean up tools loaded from a specific connection from the agent's tool registry."""
    if not agent or not hasattr(agent, "tool_registry"):
        return {
            "cleaned_tools": [],
            "failed_tools": tool_names if tool_names else [],
            "error": "Agent does not support tool unregistration",
        }

    registry_obj = agent.tool_registry
    cleaned_tools = []
    failed_tools = []

    for tool_name in tool_names:
        try:
            if hasattr(registry_obj, "unregister_tool"):
                registry_obj.unregister_tool(tool_name)
            else:
                registry = getattr(registry_obj, "registry", None)
                if isinstance(registry, dict):
                    registry.pop(tool_name, None)
                else:
                    raise RuntimeError("Tool registry does not support unload")
            cleaned_tools.append(tool_name)
        except Exception as e:
            failed_tools.append(f"{tool_name} ({str(e)})")

    return {"cleaned_tools": cleaned_tools, "failed_tools": failed_tools}


def _load_tools_to_agent(params: Dict[str, Any]) -> Dict[str, Any]:
    """Load MCP tools into the catalog and optionally into the agent registry."""
    connection_id = params.get("connection_id")
    agent = params.get("agent")
    load_into_agent_registry = bool(params.get("load_into_agent_registry", False))

    if load_into_agent_registry and not agent:
        return {
            "status": "error",
            "content": [{"text": "agent instance is required when load_into_agent_registry=True"}],
        }

    error_result = _validate_connection(connection_id, check_active=True)
    if error_result:
        return error_result

    # Check if agent has tool_registry only when registry loading is requested.
    if load_into_agent_registry and (
        not hasattr(agent, "tool_registry") or not hasattr(agent.tool_registry, "register_tool")
    ):
        return {
            "status": "error",
            "content": [
                {"text": "Agent does not have a tool registry. Make sure you're using a compatible Strands agent."}
            ],
        }

    try:
        config = _get_connection(connection_id)

        with config.mcp_client:
            # Use SDK's list_tools_sync which returns MCPAgentTool instances
            tools = config.mcp_client.list_tools_sync()

        catalog_tool_names: List[str] = []
        loaded_into_agent: List[str] = []
        skipped_tools = []

        _register_mcp_tools_in_catalog(connection_id, tools)

        for tool in tools:
            tool_name = getattr(tool, "tool_name", "")
            if tool_name:
                catalog_tool_names.append(tool_name)

            if not load_into_agent_registry:
                continue

            try:
                wrapped_tool = MCPTool(tool, connection_id)
                logger.info("Loading MCP tool [%s] wrapped in MCPTool", tool_name)
                agent.tool_registry.register_tool(wrapped_tool)
                loaded_into_agent.append(tool_name)
            except Exception as e:
                skipped_tools.append({"name": tool_name, "error": str(e)})

        # Update connection state
        with _CONNECTION_LOCK:
            catalog_existing = set(config.loaded_tool_names)
            for tool_name in catalog_tool_names:
                if tool_name and tool_name not in catalog_existing:
                    config.loaded_tool_names.append(tool_name)
                    catalog_existing.add(tool_name)

            registry_existing = set(config.agent_loaded_tool_names)
            for tool_name in loaded_into_agent:
                if tool_name and tool_name not in registry_existing:
                    config.agent_loaded_tool_names.append(tool_name)
                    registry_existing.add(tool_name)

            total_catalog_tools = len(config.loaded_tool_names)
            total_agent_loaded_tools = len(config.agent_loaded_tool_names)

        load_result = {
            "message": (
                f"Catalog registered {len(catalog_tool_names)} tools from MCP server '{connection_id}'"
                + (
                    f"; loaded {len(loaded_into_agent)} into agent registry"
                    if load_into_agent_registry
                    else ""
                )
            ),
            "connection_id": connection_id,
            "catalog_tools": catalog_tool_names,
            "tool_count": len(catalog_tool_names),
            "total_catalog_tools": total_catalog_tools,
            "agent_registry_loaded_tools": loaded_into_agent,
            "agent_registry_tool_count": len(loaded_into_agent),
            "total_agent_registry_tools": total_agent_loaded_tools,
            "load_into_agent_registry": load_into_agent_registry,
        }

        if skipped_tools:
            load_result["skipped_tools"] = skipped_tools

        return {
            "status": "success",
            "content": [
                {
                    "text": (
                        f"Registered {len(catalog_tool_names)} MCP tools in catalog for '{connection_id}'"
                        + (
                            f" and loaded {len(loaded_into_agent)} into active agent registry"
                            if load_into_agent_registry
                            else " (agent registry unchanged)"
                        )
                    )
                },
                {"json": load_result},
            ],
        }

    except Exception as e:
        return {"status": "error", "content": [{"text": f"Failed to load tools: {str(e)}"}]}
