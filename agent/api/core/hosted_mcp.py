"""A hosted MCP server's tools through one process-wide Strands ``MCPClient`` (Streamable HTTP, bearer token).

The client starts on first use and stays open for the process, so every agent built from it shares one session. A server
that can't be reached is left out of that agent and tried again for the next.
"""

from __future__ import annotations

import logging
import threading

from strands.tools.mcp import MCPClient
from strands.tools.mcp.mcp_agent_tool import MCPAgentTool
from strands.tools.mcp.mcp_tasks import DEFAULT_TASK_CONFIG, DEFAULT_TASK_REQUEST_TIMEOUT
from strands.types.tools import AgentTool

logger = logging.getLogger(__name__)


class HostedMCP:
    """The tools of the MCP server at ``url``, prefixed ``<prefix>_``."""

    def __init__(self, prefix: str) -> None:
        self.prefix = prefix
        self._lock = threading.Lock()
        self._client: MCPClient | None = None
        self._tools: list[AgentTool] = []

    def tools(self, url: str, token: str) -> list[AgentTool]:
        with self._lock:
            if self._client is not None and not self._client._is_session_active():
                self._client.stop(None, None, None)
                self._client = None
                self._tools = []
            if self._client is None:
                client = MCPClient(
                    url=url,
                    headers={"Authorization": f"Bearer {token}"},
                    prefix=self.prefix,
                    tasks_config=DEFAULT_TASK_CONFIG,
                )
                try:
                    client.start()
                    loaded = list(client.list_tools_sync())
                    for item in loaded:
                        if (
                            isinstance(item, MCPAgentTool)
                            and item.timeout is None
                            and not client._should_use_task(item.mcp_tool.name)
                        ):
                            item.timeout = DEFAULT_TASK_REQUEST_TIMEOUT
                    self._tools = loaded
                except Exception:
                    logger.exception("The %s MCP server didn't start; its tools are left out", self.prefix)
                    client.stop(None, None, None)
                    return []
                self._client = client
            return list(self._tools)
