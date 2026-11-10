"""Specialist agents: strands_harness ``create_harness`` from its own portable config, stored in Supabase, served over A2A.

- The definition IS the harness's portable agent config (``define_harness_agent_config``), written by
  the model and stored verbatim in the Supabase table ``harness_agents``
  (``supabase/migrations/011_harness_agents.sql``) through the official ``supabase`` client with the
  backend's ``SUPABASE_SERVICE_ROLE_KEY``, filtered by ``owner_id``. Guests (non-UUID user ids such as
  ``default``) must sign in.
- Construction is ``harness_agent_kwargs_from_config(config, base_dir=<tool library>)`` ->
  ``create_harness``: library tools are harness module references
  (``{"module": "./<tool_catalog path>", "export": "<name>"}``, imported by the harness off
  ``sys.path``). A model string whose provider is one of Ron's (``panel_agent.PROVIDERS``:
  perplexity, mistral, xai, gemini, openai, anthropic) is built by Ron's composition root
  ``build_model`` (Ron's custom Strands ``Model`` providers, e.g. ``PerplexityResponsesModel``) and
  passed as ``create_harness(model=<Model>)``, which the harness accepts natively; any other harness
  model string (``bedrock/``, ``google/``, ...) is resolved by the harness.
- At build time Ron sets two harness options per run, never stored: ``session`` off (each A2A
  context is its own conversation; Ron's A2A server rejects checkpointing) and, when memory is on, a
  per-agent ``memory.dir`` (the harness default ``./.agent/memory`` is the process cwd, shared by
  every user).
- Through ``create_harness(tools=...)``, the harness's documented seam for instances, Ron adds the
  native A2A client tools every Ron agent carries and, for ``mcpServers`` keys ``user_browser`` /
  ``cloud_browser``, Ron's browser ``MCPClient`` from ``browser_client_factory``. NOT NATIVE:
  ``MCPServerConfig`` has no elicitation callback, and electron-playwright-mcp's approval tools need one.
- A2A: ``HarnessA2AHost`` (mounted at ``/a2a/agents``) serves every stored agent with a native
  ``A2AServer`` at ``<PANEL_A2A_URL>/agents/<id>``. NOT NATIVE: the SDK serves one agent per
  ``A2AServer``, so the host builds that server on first request and rebuilds it when the row changes.
  Like ``/a2a`` it is loopback-only and must never be added to the ngrok allowlist.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from typing import Any
from uuid import UUID

import httpx
from strands import tool
from strands.types.tools import AgentTool
from strands_harness import create_harness as harness_factory
from strands_harness import define_harness_agent_config, harness_agent_kwargs_from_config

logger = logging.getLogger(__name__)

TABLE = "harness_agents"
_CARD_CONTEXT = "__agent_card__"


class SignInRequired(PermissionError):
    """Stored agents belong to a signed-in Supabase user."""


def owner_uuid(user_id: str) -> str:
    try:
        return str(UUID(user_id))
    except (TypeError, ValueError):
        raise SignInRequired("Sign in to Ren to save and recall specialist agents (guest sessions cannot store them).") from None


async def harness_table(httpx_client: httpx.AsyncClient | None = None) -> Any:
    """The ``harness_agents`` table on the official async Supabase client (service-role key)."""
    from supabase import AsyncClientOptions, acreate_client

    url, key = os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("Stored agents need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Ren API host.")
    options = AsyncClientOptions(httpx_client=httpx_client) if httpx_client is not None else None
    return (await acreate_client(url, key, options)).table(TABLE)


def agent_url(agent_id: str) -> str:
    from agent.api.core.a2a_tools import panel_a2a_url

    return f"{panel_a2a_url()}/agents/{agent_id}"


def build_specialist(config: dict[str, Any], owner_id: str, *, connect_mcp: bool = True, model: Any = None,
                     plugins: list[Any] | None = None, **agent_kwargs: Any) -> Any:
    """``create_harness`` from a stored portable config (see the module docstring for what Ron adds).

    ``model`` (a built ``Model``) overrides the config's model; ``plugins`` are added as consumer plugins and
    ``agent_kwargs`` go to ``Agent`` (the Agent Panel passes its session's ``agent_id``, ``session_manager`` and
    ``callback_handler`` here when the user talks to the specialist directly).
    """
    from agent.api.core import config as app_config
    from agent.api.core.a2a_tools import a2a_tools
    from agent.api.core.brave_tools import brave_tools
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR, PROVIDERS, build_model
    from agent.api.core.panel_browser import BROWSERS, browser_client_factory, server_name

    browsers = {server_name(browser): browser for browser in BROWSERS}
    servers = config.get("mcpServers") or {}
    memory_dir = app_config.SESSION_STORAGE_DIR / "harness-agents" / hashlib.sha256(f"{owner_id}:{config['name']}".encode()).hexdigest()
    run = {**config, "session": False,
           "memory": False if config.get("memory") is False else {"dir": str(memory_dir / "memory")},
           "mcpServers": {name: value for name, value in servers.items() if name not in browsers} if connect_mcp else {}}
    kwargs = harness_agent_kwargs_from_config(run, base_dir=PROJECT_TOOLS_DIR)
    provider, _, model_id = str(config["model"]).partition("/")
    if model is not None:
        kwargs["model"] = model
    elif provider in PROVIDERS and model_id and not config.get("modelModule"):
        kwargs["model"] = build_model(provider, model_id)  # type: ignore[arg-type]
    clients = [browser_client_factory(browsers[name])() for name in servers if name in browsers] if connect_mcp else []
    existing = list(kwargs.get("tools", []))
    seen_names = {getattr(t, "tool_name", None) for t in existing if getattr(t, "tool_name", None)}
    extra_brave = [t for t in brave_tools() if t.tool_name not in seen_names]
    kwargs["tools"] = [*existing, *clients, *extra_brave, *a2a_tools(), *context_search_tools(owner_id)]
    if plugins:
        kwargs["plugins"] = [*(kwargs.get("plugins") or []), *plugins]
    return harness_factory(**{"callback_handler": None, **kwargs, **agent_kwargs})


def context_search_tools(owner_id: str) -> list[AgentTool]:
    """Read-only ``search_context`` over the owner's Context widget items (Markdown files).

    Native ``MemoryManager`` tools over the same ``FileMemoryStore`` the panel's memory registers; named
    apart from the harness's own ``search_memory`` (its per-agent memory dir).
    """
    from strands.memory import MemoryManager

    from agent.api.core.context_agent import context_store

    manager = MemoryManager(
        stores=[context_store(owner_id)], add_tool_config=False, injection=False,
        search_tool_config={"name": "search_context", "description": (
            "Search the context your user collected for you (pages, articles, highlights, chat threads, "
            "project documents as Markdown, screenshots and recordings by title). Returns full Markdown entries.")},
    )
    return manager.tools


class HarnessA2AHost:
    """ASGI app mounted at ``/a2a/agents``: ``/<id>/...`` -> that stored agent's native ``A2AServer``."""

    def __init__(self, table: Any = None) -> None:
        self._table = table
        self._servers: dict[str, tuple[str, Any, Any]] = {}
        self._lock = asyncio.Lock()

    async def table(self) -> Any:
        return self._table if self._table is not None else await harness_table()

    def invalidate(self, agent_id: str) -> None:
        entry = self._servers.pop(agent_id, None)
        if entry is not None:
            asyncio.get_running_loop().create_task(entry[1].aclose())

    async def _app(self, agent_id: str) -> Any | None:
        from agent.api.core.panel_a2a import create_panel_a2a_server

        rows = (await (await self.table()).select("*").eq("id", agent_id).limit(1).execute()).data
        if not rows:
            return None
        row = rows[0]
        async with self._lock:
            cached = self._servers.get(agent_id)
            if cached is not None and cached[0] == row["updated_at"]:
                return cached[2]
            if cached is not None:
                await cached[1].aclose()

            def factory(context_id: str) -> Any:
                return build_specialist(row["config"], row["owner_id"], connect_mcp=context_id != _CARD_CONTEXT)

            integration = await asyncio.to_thread(create_panel_a2a_server, agent_factory=factory, http_url=agent_url(agent_id))
            app = integration.server.to_fastapi_app()
            self._servers[agent_id] = (row["updated_at"], integration, app)
            logger.info("agent_id=<%s>, name=<%s> | serving stored harness agent over A2A", agent_id, row["name"])
            return app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            return
        root_path = scope.get("root_path", "")
        agent_id = scope["path"].removeprefix(root_path).lstrip("/").partition("/")[0]
        try:
            app = await self._app(str(UUID(agent_id)))
        except (ValueError, RuntimeError) as error:
            logger.warning("path=<%s>, error=<%s> | stored agent unavailable over A2A", scope["path"], error)
            app = None
        if app is None:
            await send({"type": "http.response.start", "status": 404, "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": b'{"error": "Unknown agent"}'})
            return
        await app({**scope, "root_path": f"{root_path}/{agent_id}"}, receive, send)

    async def aclose(self) -> None:
        servers, self._servers = list(self._servers.values()), {}
        await asyncio.gather(*(entry[1].aclose() for entry in servers), return_exceptions=True)


harness_a2a_host = HarnessA2AHost()


def _listing(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "description": row.get("description", ""),
            "a2a_url": agent_url(row["id"]), "updated_at": row.get("updated_at"), "config": row.get("config")}


def create_harness_tools(user_id: str, *, table: Any = None, host: HarnessA2AHost | None = None) -> list[AgentTool]:
    """``create_harness`` and ``list_harness_agents`` bound to one signed-in user."""
    host = host or harness_a2a_host

    async def current_table() -> Any:
        return table if table is not None else await harness_table()

    @tool
    async def create_harness(config: dict[str, Any]) -> dict[str, Any]:
        """Create or update (by name) a specialist agent from a Strands harness portable agent config.

        The config is the harness's own agent definition (camelCase JSON; omitted keys take the harness
        defaults): name, description (its A2A agent card), instructions, model ("<provider>/<model>":
        Ren's providers perplexity/, xai/, mistral/, gemini/, openai/, anthropic/, or a harness
        string such as bedrock/... or google/...; omitted = Ren's default provider),
        effort, tools (library tools as {"module": "./<path from tool_catalog describe>",
        "export": "<tool name>"}), skills (Agent Skill paths from list_learned_skills), mcpServers
        (user_browser / cloud_browser for Ren's browser, or {"url": "https://..."} servers),
        builtinTools, builtinPlugins and memory. The specialist is saved to the user's account and
        served over A2A at the returned a2a_url: delegate with a2a_send_message(message_text=...,
        target_agent_url=a2a_url), now or in any later session (list_harness_agents recalls it).

        Args:
            config: The harness portable agent config.
        """
        owner = owner_uuid(user_id)
        if not config.get("model") and not config.get("modelModule"):
            from agent.api.core.panel_agent import default_selection

            selection = default_selection()
            if selection is None:
                raise ValueError("No model provider is configured; set config.model to '<provider>/<model>'.")
            config = {**config, "model": f"{selection[0]}/{selection[1]}"}
        normalized = define_harness_agent_config(config)
        if not normalized["description"].strip():
            raise ValueError("A specialist needs a description for its A2A agent card.")
        # Built once without MCP connections, so a definition the harness cannot construct is never saved.
        agent = await asyncio.to_thread(build_specialist, normalized, owner, connect_mcp=False)
        try:
            registered = sorted(agent.tool_registry.registry)
        finally:
            await asyncio.to_thread(agent.cleanup)
        rows = (await (await current_table()).upsert(
            {"owner_id": owner, "name": normalized["name"], "description": normalized["description"],
             "config": normalized}, on_conflict="owner_id,name").execute()).data
        host.invalidate(rows[0]["id"])
        logger.info("owner=<%s>, agent_id=<%s>, name=<%s>, tools=<%d> | stored harness agent", owner, rows[0]["id"], normalized["name"], len(registered))
        return {**_listing(rows[0]), "registered_tools": registered}

    @tool
    async def list_harness_agents() -> list[dict[str, Any]]:
        """Recall this user's saved specialist agents (name, description, harness config, a2a_url).

        Delegate to one with a2a_send_message(message_text=..., target_agent_url=<a2a_url>).
        """
        rows = (await (await current_table()).select("id,name,description,config,updated_at")
                .eq("owner_id", owner_uuid(user_id)).order("updated_at", desc=True).execute()).data
        return [_listing(row) for row in rows]

    return [create_harness, list_harness_agents]


__all__ = ["HarnessA2AHost", "SignInRequired", "agent_url", "build_specialist", "context_search_tools", "create_harness_tools",
           "harness_a2a_host", "harness_table", "owner_uuid"]
