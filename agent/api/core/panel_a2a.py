"""Opt-in native Strands 1.56 A2A integration; no network activity at import time."""

from __future__ import annotations

import asyncio
import weakref
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from strands import Agent
from strands.models.model import Model
from strands.tools.mcp import MCPClient

from agent.api.core.panel_tools import PanelToolCatalog, _check_async

__all__ = [
    "PanelA2A", "create_a2a_agent_factory", "create_panel_a2a_client",
    "create_panel_a2a_server", "mount_panel_a2a",
]

if TYPE_CHECKING:
    from a2a.client import ClientConfig
    from fastapi import FastAPI
    from strands.agent.a2a_agent import A2AAgent
    from strands.multiagent.a2a import A2AServer


def _url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError("A2A URL must be an absolute HTTP(S) URL without query or fragment")
    return url.rstrip("/")


def create_a2a_agent_factory(
    *,
    model_factory: Callable[[str], Model],
    tools_factory: Callable[[str], Sequence[Any]],
    name: str,
    description: str,
    system_prompt: str,
) -> Callable[[str], Agent]:
    """Make native per-context agents with fresh state and explicit assignments.

    Factories are synchronous because that is the native A2A factory contract.
    Return fresh models/tools where they have mutable per-conversation state.
    """
    def factory(context_id: str) -> Agent:
        model = model_factory(context_id)
        if not isinstance(model, Model):
            raise TypeError("model_factory must return an explicit Strands Model instance")
        tools = list(tools_factory(context_id))
        for value in tools:
            if not isinstance(value, (MCPClient, PanelToolCatalog)):
                _check_async(value)
        agent = Agent(
            model=model,
            name=name,
            description=description,
            system_prompt=system_prompt,
            tools=tools,
            callback_handler=None,
            session_manager=None,
            checkpointing=False,
            load_tools_from_directory=False,
        )
        try:
            for value in tools:
                if isinstance(value, PanelToolCatalog):
                    value.bind(agent)
        except BaseException:
            agent.cleanup()
            raise
        return agent

    return factory


@dataclass
class PanelA2A:
    server: A2AServer
    _agents: weakref.WeakSet[Agent]
    _closed: bool = False

    async def aclose(self) -> None:
        """After requests have drained, release remaining native tool providers."""
        self._closed = True
        results = await asyncio.gather(
            *(asyncio.to_thread(agent.cleanup) for agent in list(self._agents)), return_exceptions=True
        )
        errors = [result for result in results if isinstance(result, Exception)]
        if errors:
            raise ExceptionGroup("A2A agent cleanup failed", errors)


def create_panel_a2a_server(
    *, agent_factory: Callable[[str], Agent], http_url: str, max_contexts: int = 1000
) -> PanelA2A:
    """Native factory mode with compliant artifact streaming and isolation guard."""
    from strands.multiagent.a2a import A2AServer

    http_url = _url(http_url)
    if max_contexts < 1:
        raise ValueError("max_contexts must be positive")
    agents: weakref.WeakSet[Agent] = weakref.WeakSet()
    integration: PanelA2A | None = None

    def isolated(context_id: str) -> Agent:
        if integration is not None and integration._closed:
            raise RuntimeError("A2A integration is closed")
        agent = agent_factory(context_id)
        if not isinstance(agent, Agent):
            raise TypeError("A2A factory must return a native Strands Agent")
        if agent in agents:
            raise ValueError("A2A factory reused an agent across contexts")
        if agent._checkpointing:
            agent.cleanup()
            raise ValueError("A2A checkpoint resume is unsupported; checkpointing must be disabled")
        agents.add(agent)
        return agent

    server = A2AServer(
        agent_factory=isolated,
        http_url=http_url,
        serve_at_root=True,  # The caller mounts exactly once, below.
        max_contexts=max_contexts,
        enable_a2a_compliant_streaming=True,
    )
    integration = PanelA2A(server, agents)
    # Native construction makes a metadata-only __agent_card__ agent. Snapshot
    # its advertised skills and release any managed providers immediately.
    try:
        server.agent_skills = list(server.agent_skills)
        server.public_agent_card  # Validate name/description at startup.
    finally:
        server.strands_agent.cleanup()
    return integration


def mount_panel_a2a(
    app: FastAPI, integration: PanelA2A, *, enabled: bool = False, path: str = "/a2a"
) -> bool:
    """Explicit opt-in mount. Root application's lifespan must call aclose()."""
    if not enabled:
        return False
    if not path.startswith("/") or path == "/" or path.endswith("/"):
        raise ValueError("A2A mount path must be a non-root absolute path without a trailing slash")
    if urlsplit(integration.server.http_url).path.rstrip("/") != path:
        raise ValueError("A2A public URL path must match the FastAPI mount path")
    if any(getattr(route, "path", None) == path for route in app.routes):
        raise ValueError(f"A route is already mounted at {path}")
    app.mount(path, integration.server.to_fastapi_app())
    return True


def create_panel_a2a_client(
    endpoint: str,
    *,
    name: str | None = None,
    description: str | None = None,
    timeout: int = 300,
    client_config: ClientConfig | None = None,
) -> A2AAgent:
    """Lazy native async client. Supplied httpx clients remain caller-owned."""
    from strands.agent.a2a_agent import A2AAgent

    if timeout <= 0:
        raise ValueError("timeout must be positive")
    return A2AAgent(
        _url(endpoint), name=name, description=description, timeout=timeout, client_config=client_config
    )
