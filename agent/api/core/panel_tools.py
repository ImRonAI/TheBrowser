"""Application-owned async tools built on Strands 1.56's native runtime.

This module does not select a model, install tools, or start services. Factories
and explicit tool assignments are supplied by the panel's composition root.
"""

from __future__ import annotations

import asyncio
import ast
import base64
import copy
import importlib
import importlib.util
import os
import sys
import threading
import weakref
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import aclosing
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, TypeAlias

from pydantic import BaseModel
from mcp import ClientSession
from mcp.shared.context import RequestContext
from mcp.types import ElicitRequestParams, ElicitResult
from strands import Agent, tool
from strands.agent.agent_result import AgentResult
from strands.hooks.events import AfterToolsEvent, BeforeInvocationEvent, BeforeToolCallEvent
from strands.models.model import Model
from strands.plugins import Plugin
from strands.multiagent import GraphBuilder, Swarm
from strands.multiagent.graph import Graph
from strands.multiagent.base import MultiAgentResult, NodeResult, Status
from strands.tools import ToolProvider
from strands.tools.loader import load_tools_from_file_path, load_tools_from_module
from strands.tools.mcp import MCPClient
from strands.tools.mcp.mcp_agent_tool import MCPAgentTool
from strands.tools.registry import ToolRegistry
from strands.types.tools import AgentTool, ToolContext
from strands.vended_plugins.skills import AgentSkills

ModelFactory: TypeAlias = Callable[[str], Model]
AsyncToolLoader: TypeAlias = Callable[[], Awaitable[Sequence[AgentTool]]]
ToolAssignment: TypeAlias = AgentTool | ToolProvider
MCPClientFactory: TypeAlias = Callable[[], MCPClient]

__all__ = [
    "AsyncToolLoader", "ChildSpec", "GraphSpec", "MCPClientFactory",
    "ManagedMCP", "ModelFactory", "PanelToolCatalog",
    "SwarmSpec", "ToolAssignment", "create_child_agent",
    "create_formation_tool", "create_skill_tool",
    "serializable_event", "skills_from_env",
    "accept_browser_elicitation", "load_vendored_think", "THINK_EXCLUDED_TOOLS",
    "ThinkToolsGuard", "MCPConnectionGuard", "is_parent_only_tool",
    "CORE_TOOL_NAMES", "VENDORED_PACKAGE", "build_core_tools", "create_tool_catalog",
    "import_vendored_module", "import_vendored_revision", "load_library_tool", "scan_vendored_tools", "stamp_source",
]

#: Always-registered tool names (user-mandated). `tool_catalog` is appended by
#: create_tool_catalog; `ask_user` (native interrupt) is composed separately.
CORE_TOOL_NAMES = ("mcp_client", "editor", "shell", "environment", "http_request", "perplexity_search", "tool_catalog")

#: Synthetic import package for agent/tools/strands_tools. The directory is never
#: added to sys.path (AGENTS.md); modules are bound under this alias so their
#: relative imports (`from ..tool_catalog_manager import`, `from .errors import`)
#: resolve without shadowing the installed `strands_tools` distribution.
VENDORED_PACKAGE = "ron_vendored_tools"


async def accept_browser_elicitation(
    context: RequestContext[ClientSession, Any], params: ElicitRequestParams
) -> ElicitResult:
    """Explicit browser no-approval policy; never installed by default.

    Application composition may assign this to its trusted browser client when
    Electron is configured with requireApproval=False. It supplies no form data.
    Other servers must retain their own elicitation policy.
    """
    return ElicitResult(action="accept", content={})


def _validated(tools: Sequence[AgentTool]) -> dict[str, AgentTool]:
    """Spec-validate and de-duplicate through a scratch native registry.

    Every ``AgentTool`` streams asynchronously by contract; ``DecoratedFunctionTool`` and
    ``PythonAgentTool`` offload synchronous bodies with ``asyncio.to_thread`` themselves.
    """
    registry = ToolRegistry()
    names: set[str] = set()
    for value in tools:
        if not isinstance(value, AgentTool):
            raise TypeError("Catalog entries must be explicit AgentTool instances, not import strings")
        name = value.tool_name.replace("-", "_")
        if name in names:
            raise ValueError(f"Duplicate catalog tool name: {value.tool_name}")
        names.add(name)
        registry.validate_tool_spec(value.tool_spec)
        registry.register_tool(value)
    return dict(registry.registry)


@dataclass(frozen=True)
class ManagedMCP:
    """A catalog-owned native ``MCPClient``; its ``on_tools_changed`` supplies refreshed lists."""

    client: MCPClient


#: agent -> bound catalog (weak on the agent so closed sessions are collected).
_BOUND_CATALOGS: "weakref.WeakKeyDictionary[Agent, PanelToolCatalog]" = weakref.WeakKeyDictionary()


class PanelToolCatalog(ToolProvider):
    """One panel agent's explicit catalog, also a native managed ToolProvider.

    Pass this object in Agent(tools=[catalog]), then call bind(agent). Native
    registry consumer ownership releases MCP connections at agent.cleanup().
    Refresh requests only mark a generation dirty; reconciliation runs at
    BeforeInvocationEvent and AfterToolsEvent (after all foreground tools).
    """

    def __init__(
        self,
        *,
        tools: Sequence[AgentTool] = (),
        managed_mcp: Sequence[ManagedMCP] = (),
        loader: AsyncToolLoader | None = None,
        mcp_servers: Mapping[str, Any] | None = None,
        mcp_client_factories: Mapping[str, MCPClientFactory] | None = None,
    ) -> None:
        self._static = tuple(_validated(tools).values())
        self._mcp = tuple(managed_mcp)
        if len({id(entry.client) for entry in self._mcp}) != len(self._mcp):
            raise ValueError("Register each managed MCP client only once")
        self._loader = loader
        self._registry = ToolRegistry()
        self._consumers: set[Any] = set()
        self._lock = threading.RLock()
        self._initialized = False
        self._closed = False
        self._generation = 0
        self._applied = -1
        self._snapshot: dict[str, AgentTool] = {}
        self._provider_tools: list[list[AgentTool]] = []
        self._bound = False
        self._agent: Agent | None = None
        self._loaded: dict[str, AgentTool] = {}
        self._provider_updates: dict[MCPClient, list[AgentTool]] = {}
        self._callbacks: dict[MCPClient, tuple[Any, Any]] = {}
        self._extra_registries: list[ToolRegistry] = []
        self._server_config = copy.deepcopy(dict(mcp_servers or {}))
        if "mcpServers" in self._server_config:
            self._server_config = self._server_config["mcpServers"]
        if not isinstance(self._server_config, dict):
            raise ValueError("mcp_servers must be a server mapping or mcpServers mapping")
        self._client_factories = dict(mcp_client_factories or {})
        unknown = self._client_factories.keys() - self._server_config.keys()
        if unknown:
            raise ValueError(f"MCP client factories need configured server entries: {sorted(unknown)}")
        self._active_servers: set[str] = set()
        self._activation_lock = asyncio.Lock()
        #: ``(tool_name, vendored_path) -> revision file | None``; set by the composition root
        #: (``tool_repair.revision_resolver(user_id)``) so dynamic loads honour the user's active repair.
        self._revision_resolver: Callable[[str, Path], Path | None] | None = None
        self._tool_adapter: Callable[[AgentTool], AgentTool] | None = None
        #: server name -> tool names of the process being replaced by restart_mcp_server.
        self._restarting: dict[str, list[str]] = {}

    def set_revision_resolver(self, resolver: Callable[[str, Path], Path | None] | None) -> None:
        """Install the per-user active-revision lookup used by ``stage_tool``/``reload_tool``."""
        self._revision_resolver = resolver

    def set_tool_adapter(self, adapter: Callable[[AgentTool], AgentTool] | None) -> None:
        """Install the per-user adapter wrapper (``tool_repair.adapt_tool``): applied to every tool
        the catalog publishes — static, dynamically loaded and MCP provider tools — so a user's
        active ``adapter`` revision wraps the tool from the first invocation of a new session."""
        self._tool_adapter = adapter

    def _adapted(self, tools: Sequence[AgentTool]) -> list[AgentTool]:
        if self._tool_adapter is None:
            return list(tools)
        return [self._tool_adapter(value) for value in tools]

    def add_tools(self, tools: Sequence[AgentTool]) -> None:
        """Complete circular factory wiring before Agent(tools=[catalog])."""
        if self._initialized or self._consumers:
            raise RuntimeError("add_tools is construction-only; use the dynamic loader after binding")
        self._static = tuple(_validated([*self._static, *tools]).values())

    def _watch(self, client: MCPClient) -> None:
        if client in self._callbacks:
            return
        # Must be installed BEFORE native registry startup: 2026-07-28 MCP
        # negotiates its tools/list subscription only when this callback exists.
        if client._background_thread is not None:
            raise ValueError("Catalog MCP clients must be unstarted so tools-changed subscription can be installed")
        previous = client.on_tools_changed

        def changed(old_names: list[str], new_tools: list[AgentTool]) -> None:
            with self._lock:
                if not self._closed:
                    self._provider_updates[client] = list(new_tools)
                    self._generation += 1
            if previous is not None:
                previous(old_names, new_tools)

        client.on_tools_changed = changed
        self._callbacks[client] = (previous, changed)

    def _cleanup(self) -> None:
        # Never hold _lock while stop joins MCP refresh workers: a callback on
        # such a worker may be waiting for _lock to publish its new generation.
        errors = []
        for registry in [self._registry, *self._extra_registries]:
            try:
                registry.cleanup()
            except Exception as exc:
                errors.append(exc)
        for client, (previous, installed) in self._callbacks.items():
            if client.on_tools_changed is installed:
                client.on_tools_changed = previous
        if errors:
            raise ExceptionGroup("Catalog provider cleanup failed", errors)

    def add_consumer(self, consumer_id: Any, **kwargs: Any) -> None:
        with self._lock:
            if self._closed:
                raise RuntimeError("Catalog is closed; create a catalog per panel agent")
            if self._consumers and consumer_id not in self._consumers:
                raise RuntimeError("A panel catalog cannot be shared across agents")
            self._consumers.add(consumer_id)

    def remove_consumer(self, consumer_id: Any, **kwargs: Any) -> None:
        with self._lock:
            if consumer_id not in self._consumers:
                return
            self._consumers.remove(consumer_id)
            if not self._consumers:
                self._closed = True
        if self._closed:
            self._cleanup()

    def _initialize_providers(self) -> None:
        with self._lock:
            if self._closed:
                raise RuntimeError("Catalog is closed")
            if self._initialized:
                return
        try:
            for entry in self._mcp:
                self._watch(entry.client)
                # Native registry owns add_consumer/load_tools/cleanup.
                names = self._registry.process_tools([entry.client])
                self._provider_tools.append([self._registry.registry[name] for name in names])
            self._initialized = True
        except BaseException:
            self._closed = True
            self._cleanup()
            raise

    async def load_tools(self, **kwargs: Any) -> Sequence[AgentTool]:
        await asyncio.to_thread(self._initialize_providers)
        if self._applied < 0:
            with self._lock:
                generation = self._generation
                providers = [self._provider_updates.get(entry.client, previous)
                             for entry, previous in zip(self._mcp, self._provider_tools, strict=True)]
            try:
                dynamic = await self._loader() if self._loader else ()
                snapshot = _validated(self._adapted([*self._static, *dynamic, *self._loaded.values(), *(t for p in providers for t in p)]))
            except BaseException:
                self._closed = True
                await asyncio.to_thread(self._cleanup)
                raise
            self._snapshot = snapshot
            self._provider_tools = providers
            self._applied = generation
        return list(self._snapshot.values())

    def request_refresh(self) -> None:
        """Thread-safe notification; never mutate an executing agent's tools."""
        with self._lock:
            if not self._closed:
                self._generation += 1

    def bind(self, agent: Agent) -> None:
        """Install the invocation-boundary hook after native tools registration."""
        if self._bound:
            raise RuntimeError("Catalog is already bound")
        if not self._consumers or not self._initialized or any(
            agent.tool_registry.registry.get(name) is not value for name, value in self._snapshot.items()
        ):
            raise ValueError("Construct Agent(tools=[catalog, ...]) before binding the catalog")
        self._bound = True
        self._agent = agent
        _BOUND_CATALOGS[agent] = self
        agent.add_hook(self._before_invocation, BeforeInvocationEvent)
        agent.add_hook(self._before_invocation, AfterToolsEvent)

    @staticmethod
    def for_agent(agent: Agent) -> PanelToolCatalog | None:
        """The catalog bound to ``agent`` (public lookup; the SDK keeps providers private)."""
        return _BOUND_CATALOGS.get(agent)

    async def _before_invocation(self, event: BeforeInvocationEvent | AfterToolsEvent) -> None:
        with self._lock:
            if self._closed:
                raise RuntimeError("Catalog is closed")
            generation = self._generation
            updates = dict(self._provider_updates)
            loaded = dict(self._loaded)
            entries = tuple(self._mcp)
            previous_tools = list(self._provider_tools)
        if generation == self._applied:
            return

        dynamic = await self._loader() if self._loader else ()
        providers = [updates.get(entry.client, previous)
                     for entry, previous in zip(entries, previous_tools, strict=True)]
        desired = _validated(self._adapted([*self._static, *dynamic, *loaded.values(), *(t for p in providers for t in p)]))
        registry = event.agent.tool_registry
        # Check both maps before changing anything. SDK plugin/dynamic-only tools
        # and tools owned by other providers must never be overwritten.
        for name, value in self._snapshot.items():
            if registry.registry.get(name) is not value:
                raise RuntimeError(f"Catalog ownership changed for {name!r}")
            if name in registry.dynamic_tools and registry.dynamic_tools[name] is not value:
                raise RuntimeError(f"Dynamic catalog ownership changed for {name!r}")
        foreign = {
            name.replace("-", "_")
            for name in registry.registry.keys() | registry.dynamic_tools.keys()
            if name not in self._snapshot
        }
        if any(name.replace("-", "_") in foreign for name in desired):
            raise ValueError("Refreshed catalog conflicts with a tool owned by another registry participant")

        # No awaits from here to snapshot commit. 1.56 has replace() but no
        # unregister(); removal must update both public maps to avoid ghosts.
        for name in self._snapshot.keys() - desired.keys():
            registry.registry.pop(name, None)
            registry.dynamic_tools.pop(name, None)
        for name, value in desired.items():
            if name in registry.registry:
                registry.replace(value)
            else:
                registry.register_tool(value)
        self._snapshot = desired
        self._provider_tools = providers
        self._applied = generation

    def _require_agent(self, agent: Agent) -> None:
        if self._closed or self._agent is not agent:
            raise RuntimeError("Catalog tools must execute on their bound parent; construct a separate catalog for children")

    async def stage_tool(self, path: Path, name: str, *, agent: Agent, root: Path | None = None) -> list[str]:
        """Load a tool module; publish it at the next batch boundary.

        With ``root`` the file is imported as a submodule of the synthetic vendored
        package (so relative imports resolve); otherwise the native filepath loader
        is used. Neither path touches the executing parent's registry directly.
        """
        self._require_agent(agent)
        if os.environ.get("STRANDS_DISABLE_LOAD_TOOL", "").lower() == "true":
            raise RuntimeError("Dynamic loading is disabled by STRANDS_DISABLE_LOAD_TOOL")

        def load() -> AgentTool:
            if root is not None:
                # A user-scoped repaired revision (tool_repair.active_revision_file) replaces the
                # vendored file for THIS user only; the module name stays the same so relative
                # imports resolve. Other users keep importing the library file.
                override = self._revision_resolver(name, path) if self._revision_resolver else None
                return load_library_tool(root, path, name, revision_file=override)
            loaded = {value.tool_name: value for value in load_tools_from_file_path(str(path))}
            if name not in loaded:
                raise ValueError(f"File does not export tool {name!r}; found {list(loaded)}")
            value = loaded[name]
            value.mark_dynamic()
            stamp_source(value, path)
            return value

        value = await asyncio.to_thread(load)
        with self._lock:
            self._require_agent(agent)
            proposed = {**self._loaded, name: value}
            fixed = {key: value for key, value in self._snapshot.items() if key not in self._loaded}
            for values in self._provider_tools:
                fixed.update((value.tool_name, value) for value in values)
            _validated([*fixed.values(), *proposed.values()])
            foreign = (agent.tool_registry.registry.keys() | agent.tool_registry.dynamic_tools.keys()) - self._snapshot.keys()
            if name.replace("-", "_") in {key.replace("-", "_") for key in foreign}:
                raise ValueError(f"Tool name {name!r} belongs to another registry participant")
            self._loaded = proposed
            self._generation += 1
        return [name]

    async def replace_tool(self, name: str, *, agent: Agent, build: Callable[[AgentTool], AgentTool]) -> bool:
        """Replace catalog-owned tool ``name`` with ``build(current)`` through native ``ToolRegistry.replace``.

        Covers static tools, dynamically loaded tools AND MCP provider tools (browser tools): the
        provider list is updated so a later refresh re-applies the same wrapper. Effective at the
        SDK's next invocation; an in-flight call finishes on the old implementation.
        """
        self._require_agent(agent)
        with self._lock:
            self._require_agent(agent)
            registry = agent.tool_registry
            current = registry.registry.get(name)
            if current is None or self._snapshot.get(name) is not current:
                return False
            from agent.api.core.tool_repair import _AdaptedTool

            value = build(current.wrapped if isinstance(current, _AdaptedTool) else current)
            if name in self._loaded:
                self._loaded[name] = value
            elif any(item.tool_name == name for item in self._static):
                self._static = tuple(value if item.tool_name == name else item for item in self._static)
            else:
                self._provider_tools = [[value if item.tool_name == name else item for item in group]
                                        for group in self._provider_tools]
                for client, tools in self._provider_updates.items():
                    self._provider_updates[client] = [value if item.tool_name == name else item for item in tools]
            registry.replace(value)
            self._snapshot[name] = value
        return True

    async def reload_tool(self, name: str, *, agent: Agent, root: Path, path: Path,
                          revision_file: Path | None) -> bool:
        """Swap a catalog-owned library tool for a (re)loaded implementation.

        ``revision_file`` is a user-scoped repaired copy (or ``None`` to go back to the vendored
        file). The module is re-executed under its vendored name, adapted and marked dynamic,
        then handed to the native ``ToolRegistry.replace`` — which the SDK applies at the **next**
        invocation, so an in-flight call completes on the old implementation. Returns ``False``
        when this catalog does not own ``name`` (static core tools and foreign tools are left
        alone; ``_loaded`` dynamic tools and static vendored tools it adapted are swapped).
        """
        self._require_agent(agent)
        value = await asyncio.to_thread(load_library_tool, root, path, name, revision_file)
        with self._lock:
            self._require_agent(agent)
            registry = agent.tool_registry
            current = registry.registry.get(name)
            if current is None or self._snapshot.get(name) is not current:
                return False
            if name in self._loaded:
                self._loaded[name] = value
            else:
                self._static = tuple(value if item.tool_name == name else item for item in self._static)
            registry.replace(value)
            self._snapshot[name] = value
        return True

    async def stage_mcp_server(self, name: str, *, agent: Agent) -> list[str]:
        """Activate only an application-configured server, with native provider ownership."""
        self._require_agent(agent)
        async with self._activation_lock:
            if name in self._active_servers:
                return []
            if name not in self._server_config:
                raise ValueError(f"Unknown configured MCP server: {name}")
            config = self._server_config[name]
            if not isinstance(config, dict):
                raise ValueError(f"MCP server {name!r} configuration must be a mapping")
            if config.get("disabled", False):
                raise ValueError(f"MCP server {name!r} is disabled")
            if factory := self._client_factories.get(name):
                # Constructor policy injection is application-owned. load_servers
                # has no public callback option/setter and does not use cls when
                # building clients in 1.56; do not copy private client fields.
                client = await asyncio.to_thread(factory)
                if not isinstance(client, MCPClient):
                    raise TypeError("MCP client factory must return a fresh, unstarted MCPClient")
                if client in self._callbacks:
                    raise ValueError("MCP client factory reused an already catalog-owned client")
                clients = [client]
            else:
                clients = await asyncio.to_thread(
                    MCPClient.load_servers,
                    {"mcpServers": {name: config}}, prefix_with_server_name=True,
                )
            if not clients:
                raise ValueError(f"MCP server {name!r} is disabled or its configuration was skipped")
            client = clients[0]
            registry = ToolRegistry()
            self._watch(client)

            def start() -> list[AgentTool]:
                names = registry.process_tools([client])
                return [registry.registry[key] for key in names]

            startup = asyncio.create_task(asyncio.to_thread(start))
            try:
                values = await asyncio.shield(startup)
                with self._lock:
                    self._require_agent(agent)
                    # A restarted server's previous tools are still in the published snapshot until the
                    # next boundary swaps them; they are not duplicates of the respawned server's tools.
                    retired = set(self._restarting.pop(name, ()))
                    current = {key: value for key, value in self._snapshot.items() if key not in retired}
                    current.update(self._loaded)
                    for tools in self._provider_tools:
                        current.update((value.tool_name, value) for value in tools)
                    _validated([*current.values(), *values])
                    foreign = (agent.tool_registry.registry.keys() | agent.tool_registry.dynamic_tools.keys()) - self._snapshot.keys()
                    if {value.tool_name.replace("-", "_") for value in values} & {key.replace("-", "_") for key in foreign}:
                        raise ValueError("MCP tool name belongs to another registry participant")
                    self._mcp = (*self._mcp, ManagedMCP(client))
                    self._provider_tools.append(values)
                    self._extra_registries.append(registry)
                    self._active_servers.add(name)
                    self._generation += 1
                return [value.tool_name for value in values]
            except BaseException:
                try:
                    await startup
                finally:
                    self._restarting.pop(name, None)
                    await asyncio.to_thread(registry.cleanup)
                    previous, installed = self._callbacks.pop(client)
                    if client.on_tools_changed is installed:
                        client.on_tools_changed = previous
                    self._provider_updates.pop(client, None)
                raise

    async def restart_mcp_server(self, name: str, *, agent: Agent) -> list[str]:
        """Stop a catalog-staged MCP server (its stdio child process) and start a fresh one.

        The new client is built by the same configured factory, so it picks up whatever the factory
        reads at start time (e.g. this user's active ``server`` repair on ``PYTHONPATH``). The old
        registry is cleaned up (process stopped) and the new tool list is published at the next
        ``BeforeInvocationEvent``/``AfterToolsEvent`` boundary, exactly like the first load. Returns
        the new tool names; a server that was never staged in this session returns ``[]``.
        """
        self._require_agent(agent)
        async with self._activation_lock:
            if name not in self._active_servers:
                return []
            with self._lock:
                old_entry = next((entry for entry in self._mcp if any(
                    value.tool_name.startswith(f"{name}_") for group in self._provider_tools
                    for value in group if getattr(value, "mcp_client", None) is entry.client)), None)
            if old_entry is None:
                return []
            old_client = old_entry.client
            old_registry = next((reg for reg in self._extra_registries
                                 if any(getattr(v, "mcp_client", None) is old_client for v in reg.registry.values())), None)
            with self._lock:
                index = self._mcp.index(old_entry)
                self._mcp = tuple(entry for entry in self._mcp if entry is not old_entry)
                retired = self._provider_tools.pop(index)
                self._restarting[name] = [value.tool_name for value in retired]
                self._provider_updates.pop(old_client, None)
                if old_registry is not None:
                    self._extra_registries.remove(old_registry)
                previous, installed = self._callbacks.pop(old_client, (None, None))
                if installed is not None and old_client.on_tools_changed is installed:
                    old_client.on_tools_changed = previous
                self._active_servers.discard(name)
                self._generation += 1
            if old_registry is not None:
                await asyncio.to_thread(old_registry.cleanup)
        return await self.stage_mcp_server(name, agent=agent)

    def child_tools(self, names: Sequence[str]) -> tuple[ToolAssignment, ...]:
        """Explicit local-tool assignment snapshot; assign MCP providers separately.

        Catalog meta-tools close over the parent and must instead be constructed
        on a separate child catalog if the application wants child meta-tools.
        """
        selected = []
        for name in names:
            value = self._snapshot[name]
            if name == "tool_catalog":
                raise ValueError("Construct a separate child catalog to assign catalog meta-tools")
            if isinstance(value, MCPAgentTool):
                raise ValueError("Assign the MCPClient explicitly to children; a bare MCP tool has no provider ownership")
            selected.append(value)
        return tuple(selected)


class MCPConnectionGuard(Plugin):
    """Make the installed ``strands_tools.mcp_client`` idempotent through a native ``BeforeToolCallEvent``.

    That tool rejects ``connect`` on an active connection and re-registers every tool on
    ``load_tools``. When the connection is already active (and, for ``load_tools``, its tools are
    already in THIS agent's registry) the call is cancelled with a success-shaped note instead of
    running; the SDK writes ``cancel_tool`` into the tool result, so no facade around the tool is needed.
    """

    @property
    def name(self) -> str:
        return "ron:mcp-connection-guard"

    def init_agent(self, agent: Agent) -> None:
        agent.add_hook(self.before_tool_call, BeforeToolCallEvent)

    def before_tool_call(self, event: BeforeToolCallEvent) -> None:
        if event.tool_use.get("name") != "mcp_client":
            return
        from strands_tools import mcp_client as module

        inputs = event.tool_use.get("input") or {}
        connection_id = inputs.get("connection_id")
        connection = module._get_connection(connection_id)
        if not (connection and connection.is_active):
            return
        action = inputs.get("action")
        if action == "connect":
            event.cancel_tool = (f"Connection {connection_id!r} is already active. Reuse it; "
                                 "load_tools only if its tools are not in your registry.")
        elif action == "load_tools":
            names = set(connection.loaded_tool_names)
            registry = event.agent.tool_registry.registry
            if names and all(getattr(registry.get(name), "_connection_id", None) == connection_id for name in names):
                event.cancel_tool = (f"Connection {connection_id!r} is active and its tools are already "
                                     "callable in this agent; execute the next action directly.")


def _vendored_module_name(root: Path, path: Path) -> str:
    relative = path.resolve().relative_to(root.resolve()).with_suffix("")
    # Directory names like `meta-tooling` are not identifiers; normalise for import.
    parts = [part.replace("-", "_") for part in relative.parts]
    return ".".join([VENDORED_PACKAGE, *parts])


_vendored_import_lock = threading.Lock()


def _ensure_vendored_packages(root: Path, path: Path) -> None:
    """Register every package level (ron_vendored_tools, ron_vendored_tools.research, ...).

    Package modules get ``submodule_search_locations`` pointing at the real directories, so
    relative imports work, while ``root`` itself is never added to ``sys.path``.
    """
    parts = [p.replace("-", "_") for p in path.parent.relative_to(root).parts]
    directory, package_name = root, VENDORED_PACKAGE
    for index in range(len(parts) + 1):
        if package_name not in sys.modules:
            spec = importlib.machinery.ModuleSpec(package_name, None, is_package=True)
            spec.submodule_search_locations = [str(directory)]
            module = importlib.util.module_from_spec(spec)
            module.__path__ = [str(directory)]
            module.__file__ = str(directory / "__init__.py") if (directory / "__init__.py").exists() else None
            sys.modules[package_name] = module
            # Run a real __init__.py if present (vendored packages are mostly empty).
            init = directory / "__init__.py"
            if init.is_file():
                code = compile(init.read_text(encoding="utf-8"), str(init), "exec")
                exec(code, module.__dict__)
        if index < len(parts):
            directory = root / Path(*path.parent.relative_to(root).parts[: index + 1])
            package_name = f"{package_name}.{parts[index]}"


def _exec_vendored(module_name: str, source_file: Path) -> Any:
    """(Re)execute ``source_file`` under ``module_name``; a failed exec never leaves a half module."""
    previous = sys.modules.get(module_name)
    spec = importlib.util.spec_from_file_location(module_name, source_file)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot build import spec for {source_file}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        if previous is not None:
            sys.modules[module_name] = previous
        else:
            sys.modules.pop(module_name, None)
        raise
    return module


def import_vendored_module(root: Path, path: Path) -> Any:
    """Import a vendored tool file as `ron_vendored_tools.<cat>.<mod>`.

    Package/subpackage modules are registered in sys.modules with
    ``submodule_search_locations`` pointing at the real directories, so relative
    imports work, while ``root`` itself is never added to ``sys.path`` and the
    installed ``strands_tools`` distribution is never shadowed.
    """
    root = root.resolve()
    path = path.resolve()
    if not path.is_relative_to(root) or path.suffix != ".py":
        raise ValueError(f"{path} is not a Python file under {root}")
    with _vendored_import_lock:
        _ensure_vendored_packages(root, path)
        module_name = _vendored_module_name(root, path)
        if module_name in sys.modules:
            existing = sys.modules[module_name]
            if getattr(existing, "__file__", None) == str(path):
                return importlib.reload(existing)
            # A repaired revision was executed under this name earlier; go back to the library file.
            return _exec_vendored(module_name, path)
        return _exec_vendored(module_name, path)


def import_vendored_revision(root: Path, path: Path, revision_file: Path) -> Any:
    """Execute a repaired copy of vendored ``path`` under the vendored module name.

    ``revision_file`` may live anywhere (per-user storage copy); it is bound as
    ``ron_vendored_tools.<cat>.<mod>`` with the vendored package parents, so the file's relative
    imports (``from ..x import``) resolve against the library exactly as the original does.
    """
    root = root.resolve()
    path = path.resolve()
    revision_file = Path(revision_file).resolve()
    if not path.is_relative_to(root) or path.suffix != ".py":
        raise ValueError(f"{path} is not a Python file under {root}")
    if not revision_file.is_file() or revision_file.suffix != ".py":
        raise ValueError(f"{revision_file} is not a Python file")
    with _vendored_import_lock:
        _ensure_vendored_packages(root, path)
        return _exec_vendored(_vendored_module_name(root, path), revision_file)


def stamp_source(tool: AgentTool, source_file: Path) -> None:
    """Record ``(path, sha256)`` of the imported file on the adapted tool (``tool_observation``)."""
    from agent.api.core.tool_observation import SOURCE_ATTRIBUTE, file_sha256

    try:
        setattr(tool, SOURCE_ATTRIBUTE, (str(Path(source_file).resolve()), file_sha256(Path(source_file))))
    except (AttributeError, OSError):  # pragma: no cover - some AgentTool subclasses use __slots__
        pass


def load_library_tool(root: Path, path: Path, name: str, revision_file: Path | None = None) -> AgentTool:
    """Import vendored ``path`` (or its repaired ``revision_file``) and return tool ``name``
    marked dynamic and stamped with its provenance."""
    module = import_vendored_revision(root, path, revision_file) if revision_file is not None \
        else import_vendored_module(root, path)
    staging = ToolRegistry()
    for value in load_tools_from_module(module, path.stem):
        staging.register_tool(value)
    if name not in staging.registry:
        raise ValueError(f"File does not export tool {name!r}; found {list(staging.registry)}")
    value = staging.registry[name]
    value.mark_dynamic()
    stamp_source(value, revision_file if revision_file is not None else path)
    return value


def scan_vendored_tools(root: Path, *, exclude: Sequence[str] = ()) -> list[dict[str, Any]]:
    """AST-scan the vendored tree for @tool functions and TOOL_SPEC dicts (no imports)."""
    root = root.resolve()
    excluded = set(exclude)
    found: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        if path.name.startswith("_") or "utils" in rel.parts or "__pycache__" in rel.parts:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, SyntaxError):
            continue
        for node in tree.body:
            name = description = None
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for decorator in node.decorator_list:
                    target = decorator.func if isinstance(decorator, ast.Call) else decorator
                    if (isinstance(target, ast.Name) and target.id == "tool") or (
                        isinstance(target, ast.Attribute) and target.attr == "tool"
                    ):
                        name = node.name
                        if isinstance(decorator, ast.Call):
                            for keyword in decorator.keywords:
                                if keyword.arg == "name" and isinstance(keyword.value, ast.Constant):
                                    name = str(keyword.value.value)
                        description = (ast.get_docstring(node) or "").strip()
            elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "TOOL_SPEC" for t in node.targets):
                try:
                    spec = ast.literal_eval(node.value)
                    name, description = str(spec["name"]), str(spec.get("description", "")).strip()
                except (ValueError, TypeError, KeyError):
                    continue
            if name and name not in excluded:
                found.append({
                    "name": name, "category": rel.parts[0] if len(rel.parts) > 1 else "",
                    "path": str(rel), "description": description or "",
                })
    return found


def create_tool_catalog(catalog: PanelToolCatalog, project_tools_dir: Path) -> AgentTool:
    """`tool_catalog`: list/search/describe/load tools from the project library."""
    root = project_tools_dir.expanduser().resolve()
    excluded = tuple(name for name in CORE_TOOL_NAMES if name != "tool_catalog") + ("tool_catalog", "ask_user", "think")

    def entries() -> list[dict[str, Any]]:
        return scan_vendored_tools(root, exclude=excluded)

    @tool(context=True)
    async def tool_catalog(action: str, query: str = "", name: str = "", tool_context: ToolContext = None) -> dict[str, Any]:
        """Discover and load additional tools from the project tool library or configured MCP servers.

        Core tools are always available. Use this to find and load specialised
        tools on demand. A loaded tool becomes callable in your next step.
        Configured MCP servers (e.g. `user_browser`, `cloud_browser`) are loaded by
        server name; their tools register with the server name as prefix.

        Args:
            action: One of `list` (categories with counts, plus configured MCP servers),
                `search` (by query), `describe` (one tool or server by name), or
                `load` (register a tool, or stage a configured MCP server, by name).
            query: Case-insensitive text matched against name/category/description for `search`.
            name: Tool or MCP server name for `describe` and `load`.
            tool_context: Native invocation context.
        """
        items = await asyncio.to_thread(entries)
        if action == "list":
            categories: dict[str, list[str]] = {}
            for item in items:
                categories.setdefault(item["category"] or "(root)", []).append(item["name"])
            return {"root": str(root), "tool_count": len(items),
                    "categories": {key: sorted(set(values)) for key, values in sorted(categories.items())},
                    "loaded": sorted(catalog._loaded),
                    "mcp_servers": {key: key in catalog._active_servers for key in sorted(catalog._server_config)}}
        if action == "search":
            needle = query.strip().lower()
            if not needle:
                raise ValueError("search requires a query")
            hits = [item for item in items if needle in f"{item['name']} {item['category']} {item['description']}".lower()]
            return {"query": query, "matches": hits[:50], "truncated": len(hits) > 50}
        if action in ("describe", "load"):
            if not name:
                raise ValueError(f"{action} requires a tool name")
            if name in catalog._server_config:
                loaded = name in catalog._active_servers
                if action == "describe":
                    return {"server": name, "kind": "mcp_server", "loaded": loaded}
                if loaded:
                    return {"server": name, "loaded": True, "note": "already loaded"}
                tools = await catalog.stage_mcp_server(name, agent=tool_context.agent)
                return {"server": name, "loaded": True, "tools": list(tools),
                        "activation": "callable from your next step"}
            matches = [item for item in items if item["name"] == name]
            if not matches:
                raise ValueError(f"Unknown library tool {name!r}; use action='search' to find it")
            item = matches[0]
            if action == "describe":
                return {**item, "loaded": name in catalog._loaded, "alternatives": matches[1:]}
            if name in catalog._loaded:
                return {"tool": name, "loaded": True, "note": "already loaded and callable"}
            try:
                await catalog.stage_tool(root / item["path"], name, agent=tool_context.agent, root=root)
            except ImportError as error:
                # Missing optional dependency of a vendored module: report, don't crash the turn.
                raise ValueError(f"Tool {name!r} cannot be imported: {error}") from error
            return {"tool": name, "path": item["path"], "loaded": True, "activation": "callable from your next step"}
        raise ValueError("action must be list, search, describe or load")

    return tool_catalog


def _install_mcp_client_elicitation() -> None:
    """Give the installed strands_tools.mcp_client an elicitation-capable MCPClient.

    The dynamic tool builds clients at module scope without an elicitation
    callback, so approval-gated MCP servers (electron-playwright-mcp) fail with
    "Elicitation not supported". Module-level attribute swap, applied once.
    """
    from strands_tools import mcp_client as module

    if getattr(module.MCPClient, "__ron_elicitation__", False):
        return

    def factory(*args: Any, **kwargs: Any) -> MCPClient:
        kwargs.setdefault("elicitation_callback", accept_browser_elicitation)
        return MCPClient(*args, **kwargs)

    factory.__ron_elicitation__ = True  # type: ignore[attr-defined]
    module.MCPClient = factory  # type: ignore[assignment]


def build_core_tools(project_tools_dir: Path) -> list[AgentTool]:
    """The always-registered tool set (minus `tool_catalog`, which needs the catalog).

    Installed strands_tools are registered as the native tools their modules export
    (``DecoratedFunctionTool``/``PythonAgentTool`` offload synchronous bodies themselves).
    ``perplexity_search`` is the vendored ``research/perplexity_search_api.py`` ``@tool`` re-declared
    under the user-facing name with ``@tool(name=...)`` over its ``__wrapped__`` function.
    """
    from strands_tools import editor, environment, http_request, mcp_client, shell

    _install_mcp_client_elicitation()
    tools: list[AgentTool] = []
    for module in (mcp_client, editor, shell, environment, http_request):
        short = module.__name__.rsplit(".", 1)[-1]
        # load_tools_from_module handles both @tool modules and TOOL_SPEC modules
        # (http_request/environment are TOOL_SPEC-style in strands_tools 0.8.6).
        loaded = [t for t in load_tools_from_module(module, short) if t.tool_name == short]
        if not loaded:
            raise RuntimeError(f"strands_tools.{short} did not export a tool named {short!r}")
        tools.append(loaded[0])
    root = project_tools_dir.expanduser().resolve()
    search_path = root / "research" / "perplexity_search_api.py"
    search = import_vendored_module(root, search_path).perplexity_search_api
    renamed = tool(name="perplexity_search")(search.__wrapped__)
    stamp_source(renamed, search_path)
    tools.append(renamed)
    return tools


def skills_from_env(environ: Mapping[str, str] | None = None) -> AgentSkills | None:
    """Read PANEL_SKILLS_DIRS (os.pathsep-separated) or PANEL_SKILLS_DIR."""
    env = os.environ if environ is None else environ
    raw = env.get("PANEL_SKILLS_DIRS") or env.get("PANEL_SKILLS_DIR", "")
    paths = list(dict.fromkeys(Path(p.strip()).expanduser().resolve() for p in raw.split(os.pathsep) if p.strip()))
    for path in paths:
        if not path.is_dir():
            raise ValueError(f"Skill directory does not exist: {path}")
    return AgentSkills(skills=paths) if paths else None


def serializable_event(value: Any) -> Any:
    """Preserve SDK envelopes/results; explicitly tag binary/opaque payloads."""
    if isinstance(value, Enum):
        return value.value
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return {"encoding": "base64", "data": base64.b64encode(value).decode("ascii")}
    if isinstance(value, Mapping):
        return {str(key): serializable_event(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [serializable_event(item) for item in value]
    if isinstance(value, BaseModel):
        return serializable_event(value.model_dump(mode="json"))
    if isinstance(value, Exception):
        return {"type": type(value).__name__, "message": str(value)}
    if hasattr(value, "to_dict"):
        return serializable_event(value.to_dict())
    if hasattr(value, "as_dict"):
        return serializable_event(value.as_dict())
    # Agent/tool objects can occur in SDK progress events. Do not leak their
    # __dict__ (model credentials, conversations, transports) or repr addresses.
    return {"type": type(value).__name__, "opaque": True}


@dataclass(frozen=True)
class ChildSpec:
    name: str
    system_prompt: str
    tools: tuple[ToolAssignment, ...]  # Required: even an empty assignment is explicit.
    description: str = "Delegated panel task"
    checkpointing: bool = False

    def __post_init__(self) -> None:
        if self.checkpointing:
            raise ValueError("Child checkpoints are unsupported until formation resume is implemented")
        for value in self.tools:
            if isinstance(value, MCPAgentTool):
                raise ValueError("Assign MCPClient or a scoped ToolProvider to a child, not an unowned MCPAgentTool")
            if not isinstance(value, (ToolProvider, AgentTool)):
                raise TypeError("Child tools must be AgentTool or ToolProvider instances")


async def create_child_agent(
    spec: ChildSpec, *, model_factory: ModelFactory, plugins: Sequence[Any] = ()
) -> Agent:
    """Build an isolated child. Caller owns cleanup; no parent session/state."""
    def build() -> Agent:
        model = model_factory(spec.name)
        if not isinstance(model, Model):
            raise TypeError("model_factory must return an explicit Strands Model instance")
        return Agent(
            name=spec.name,
            description=spec.description,
            model=model,
            system_prompt=spec.system_prompt,
            tools=list(spec.tools),
            plugins=list(plugins),
            callback_handler=None,
            session_manager=None,
            checkpointing=False,
            load_tools_from_directory=False,
        )

    # Constructors may synchronously initialize plugins and managed MCP clients.
    # Shield startup so cancellation cannot orphan a successfully built child.
    startup = asyncio.create_task(asyncio.to_thread(build))
    try:
        return await asyncio.shield(startup)
    except asyncio.CancelledError:
        child = await startup
        await asyncio.to_thread(child.cleanup)
        raise


def create_skill_tool(
    *,
    skills: AgentSkills,
    model_factory: ModelFactory,
    tool_assignments: Mapping[str, Sequence[ToolAssignment]],
) -> AgentTool:
    """Expose an isolated skill child with application-assigned tools only."""
    assignments = {name: tuple(values) for name, values in tool_assignments.items()}

    @tool(name="run_skill", context=True)
    async def run_skill(skill_name: str, prompt: str, tool_context: ToolContext) -> AsyncIterator[dict[str, Any]]:
        """Run a configured skill in an isolated child conversation.

        Args:
            skill_name: Name of an available, application-assigned skill.
            prompt: Task for the skill child.
            tool_context: Native tool invocation context.
        """
        available = {skill.name: skill for skill in skills.get_available_skills(tool_context.agent)}
        if skill_name not in available or skill_name not in assignments:
            raise ValueError(f"Skill {skill_name!r} is unavailable or has no explicit tool assignment")
        skill = available[skill_name]
        spec = ChildSpec(
            name=f"skill-{skill_name}",
            system_prompt=skill.instructions,
            tools=assignments[skill_name],
            description=skill.description,
        )
        child = await create_child_agent(spec, model_factory=model_factory, plugins=[AgentSkills(skills=[skill])])
        try:
            result = None
            async with aclosing(child.stream_async(prompt)) as stream:
                async for event in stream:
                    if "result" in event:
                        result = event["result"]
                    yield {"skill": skill_name, "event": serializable_event(event)}
            if result is None:
                raise RuntimeError("Skill child did not produce an AgentResult")
            error = _incomplete(result)
            yield {
                "status": "error" if error else "success",
                "content": [{"json": {"result": serializable_event(result), "error": error}}],
            }
        finally:
            await asyncio.to_thread(child.cleanup)

    return run_skill

#: Tools the think child never inherits: itself (no recursion), user interrupts
#: (the parent owns the conversation), and catalog loading (parent registry only).
THINK_EXCLUDED_TOOLS = frozenset({"think", "ask_user", "tool_catalog", "create_harness"})


def is_parent_only_tool(name: str) -> bool:
    """Tools children must never inherit or be assigned.

    Browser tools (``<browser>_browser_*``) stay parent-only: the availability
    interrupt hook is registered on the parent agent only, so a child driving the
    browser could bypass the unavailability policy.
    """
    from agent.api.core.a2a_tools import is_a2a_tool
    from agent.api.core.panel_browser import is_browser_tool

    # A2A tools are per-agent (each agent builds its own provider), never inherited by children.
    return name in THINK_EXCLUDED_TOOLS or name.startswith("strands_") or is_browser_tool(name) or is_a2a_tool(name)


class ThinkToolsGuard(Plugin):
    """Keep parent-only tools out of the vendored ``think`` child (native ``BeforeToolCallEvent``).

    ``research/think.py`` inherits every parent tool when its ``tools`` argument is omitted and
    looks each explicit name up in the parent registry otherwise. This plugin rewrites the writable
    ``tool_use`` input before the tool runs: an omitted list becomes the parent registry minus
    :func:`is_parent_only_tool`; an explicit list is intersected with that set. A blank
    ``model_provider`` (models emit ``""`` for "unset") is dropped so think.py takes its documented
    ``None`` branch (the parent's model) instead of warning about an unknown provider. The vendored
    file itself is never modified.
    """

    @property
    def name(self) -> str:
        return "ron:think-tools-guard"

    def init_agent(self, agent: Agent) -> None:
        agent.add_hook(self.before_tool_call, BeforeToolCallEvent)

    def before_tool_call(self, event: BeforeToolCallEvent) -> None:
        if event.tool_use.get("name") != "think":
            return
        allowed = [name for name in event.agent.tool_registry.registry if not is_parent_only_tool(name)]
        inputs = dict(event.tool_use.get("input") or {})
        requested = inputs.get("tools")
        if isinstance(requested, list):
            wanted = {str(name) for name in requested}
            inputs["tools"] = [name for name in allowed if name in wanted]
        else:
            inputs["tools"] = allowed
        if not inputs.get("model_provider"):
            inputs.pop("model_provider", None)
        event.tool_use["input"] = inputs


def load_vendored_think(tools_dir: Path) -> AgentTool:
    """The vendored strands_tools ``think`` (``research/think.py``), loaded unchanged.

    The native loader builds its ``DecoratedFunctionTool``; the SDK injects the parent ``agent``
    and runs the synchronous body off the event loop. Each cycle is a fresh child ``Agent`` over
    the parent's model and tools, reporting to the parent's ``callback_handler`` (none in the
    panel), so its steps do not stream; the conclusion is the tool result.
    """
    root = tools_dir.expanduser().resolve()
    module = import_vendored_module(root, root / "research" / "think.py")
    loaded = [value for value in load_tools_from_module(module, "think") if value.tool_name == "think"]
    if not loaded:
        raise RuntimeError("vendored research/think.py did not export a `think` tool")
    return loaded[0]


@dataclass(frozen=True)
class GraphSpec:
    name: str
    nodes: Mapping[str, ChildSpec | GraphSpec | SwarmSpec]
    edges: tuple[tuple[str, str], ...] = ()
    entry_points: tuple[str, ...] = ()
    max_node_executions: int | None = None
    execution_timeout: float | None = None
    node_timeout: float | None = None

    def __post_init__(self) -> None:
        if any(value is not None and value <= 0 for value in
               (self.max_node_executions, self.execution_timeout, self.node_timeout)):
            raise ValueError("Graph execution limits must be positive")


@dataclass(frozen=True)
class SwarmSpec:
    name: str
    children: tuple[ChildSpec, ...]
    max_handoffs: int | None = None
    max_iterations: int | None = None
    execution_timeout: float | None = None
    node_timeout: float | None = None

    def __post_init__(self) -> None:
        if any(value is not None and value <= 0 for value in
               (self.max_handoffs, self.max_iterations, self.execution_timeout, self.node_timeout)):
            raise ValueError("Swarm execution limits must be positive")


def _incomplete(result: Any) -> str | None:
    if isinstance(result, AgentResult):
        if result.stop_reason == "checkpoint" or result.checkpoint is not None:
            return "Child checkpoint encountered; formation/skill resume is unsupported (not completed)"
        if result.stop_reason not in ("end_turn", "stop_sequence"):
            return f"Child stopped with {result.stop_reason!r}; not completed and resume is unsupported"
    if isinstance(result, NodeResult):
        return _incomplete(result.result) or (
            None if result.status is Status.COMPLETED else f"Node status: {result.status.value}"
        )
    if isinstance(result, MultiAgentResult):
        for node in result.results.values():
            if error := _incomplete(node):
                return error
        if result.status is not Status.COMPLETED:
            return f"Formation status: {result.status.value}; resume is unsupported"
    if isinstance(result, Exception):
        return str(result)
    return None


def create_formation_tool(
    spec: GraphSpec | SwarmSpec, *, model_factory: ModelFactory, description: str
) -> AgentTool:
    """Build a fresh native Graph/Swarm (including nested Graphs) per tool call."""
    async def build(node: ChildSpec | GraphSpec | SwarmSpec, owned: list[Agent]) -> Agent | Graph | Swarm:
        if isinstance(node, ChildSpec):
            child = await create_child_agent(node, model_factory=model_factory)
            owned.append(child)
            return child
        if isinstance(node, SwarmSpec):
            if not node.children or len({c.name for c in node.children}) != len(node.children):
                raise ValueError("Swarm children must be nonempty with unique names")
            children = [await build(child, owned) for child in node.children]
            return Swarm(
                children,
                id=node.name,
                # SDK 1.56 compares these directly (None is unsupported), and
                # logs counts with %d. Use the platform maximum integer rather
                # than infinity for counts; graph limits natively accept None.
                max_handoffs=node.max_handoffs if node.max_handoffs is not None else sys.maxsize,
                max_iterations=node.max_iterations if node.max_iterations is not None else sys.maxsize,
                execution_timeout=node.execution_timeout if node.execution_timeout is not None else float("inf"),
                node_timeout=node.node_timeout,
            )
        builder = GraphBuilder()
        builder.set_graph_id(node.name)
        if node.max_node_executions is not None:
            builder.set_max_node_executions(node.max_node_executions)
        if node.execution_timeout is not None:
            builder.set_execution_timeout(node.execution_timeout)
        if node.node_timeout is not None:
            builder.set_node_timeout(node.node_timeout)
        for name, child_spec in node.nodes.items():
            builder.add_node(await build(child_spec, owned), name)
        for source, target in node.edges:
            builder.add_edge(source, target)
        for name in node.entry_points:
            builder.set_entry_point(name)
        return builder.build()

    @tool(name=spec.name, description=description)
    async def formation(prompt: str) -> AsyncIterator[dict[str, Any]]:
        """Execute the configured formation once and stream node envelopes.

        Args:
            prompt: Task for the formation.
        """
        owned: list[Agent] = []
        try:
            executor = await build(spec, owned)
            final: MultiAgentResult | None = None
            async with aclosing(executor.stream_async(prompt)) as stream:
                async for event in stream:
                    if isinstance(event.get("result"), MultiAgentResult):
                        if final is not None:
                            raise RuntimeError("Formation emitted multiple final results")
                        final = event["result"]
                    yield {"formation": spec.name, "event": serializable_event(event)}
            if final is None:
                raise RuntimeError("Formation stream ended without a MultiAgentResult; execution was not retried")
            error = _incomplete(final)
            # Async-generator tools use the LAST yield as their tool result.
            # Keep the complete native serialized result, not just its text.
            yield {
                "status": "error" if error else "success",
                "content": [{"json": {"result": serializable_event(final), "error": error}}],
            }
        finally:
            errors = []
            for child in reversed(owned):
                try:
                    await asyncio.to_thread(child.cleanup)
                except Exception as exc:
                    errors.append(exc)
            if errors:
                raise ExceptionGroup("Formation child cleanup failed", errors)

    return formation
