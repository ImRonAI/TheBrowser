import asyncio
import os
import sys
from pathlib import Path
from contextlib import asynccontextmanager

_project_root = str(Path(__file__).resolve().parent.parent.parent)
if _project_root not in sys.path:
    sys.path.append(_project_root)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent.api.core import public_tunnel
from agent.api.core.config import CORS_ORIGINS, SESSION_STORAGE_DIR
from agent.api.core.panel_storage import get_panel_storage
from agent.api.core.tool_observation import setup_evals_exporter
from agent.api.endpoints import chat
from agent.api.endpoints import articles
from agent.api.endpoints import projects
from agent.api.endpoints import discover
from agent.api.endpoints import search
from agent.api.endpoints import bidi
from agent.api.endpoints import memory
from agent.api.endpoints import teaching, teaching_observe
from agent.api.endpoints import tool_repairs
from agent.api.endpoints import music
from agent.api.core.harness_agents import harness_a2a_host
from agent.api.core.teaching import get_teaching_service, mcp_app as skills_mcp_app


@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    logging.basicConfig(level=logging.INFO)
    SESSION_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    # Storage is the authority: a misconfigured HF bucket/token fails here, at boot,
    # instead of on the first chat request (never a silent in-memory fallback).
    await asyncio.to_thread(get_panel_storage)
    # RON_TOOL_OBSERVATION=1: retain spans in memory (strands_evals) for tool diagnosis.
    setup_evals_exporter()
    manager = chat.create_runtime_manager()
    from agent.api.core.issue_agents import IssueAgentRuntime
    app.state.issue_agents = IssueAgentRuntime()
    app.state.panel_runtime = manager
    app.state.panel_a2a = None
    app.state.fixer_a2a = None
    # Per-user tool repair (CAT-50/51): a tool failure makes RepairService send the repair over native
    # A2A to /a2a/fixer, whose A2AServer builds the create_harness fixer for that context. The live
    # objects are handed over here, never re-imported.
    from agent.api.core.tool_repair import RepairService
    from agent.api.endpoints.tool_repairs import reload_live_sessions

    repairs = RepairService(reload_live_sessions=lambda *args: reload_live_sessions(manager, *args))
    repairs.bind_emitter(chat.repair_emitter(manager))
    app.state.tool_repairs = repairs
    chat.bind_repair_service(repairs)
    mounted_routes = []
    try:
        from agent.api.core.a2a_tools import a2a_enabled, panel_a2a_url

        if a2a_enabled():
            from agent.api.core.panel_agent import build_model, default_selection
            from agent.api.core.panel_tools import build_core_tools
            from agent.api.core.panel_a2a import create_a2a_agent_factory, create_panel_a2a_server, mount_panel_a2a

            selection = default_selection()
            previous = list(app.routes)
            try:
                # /a2a/fixer is mounted before /a2a so the longer prefix wins.
                if repairs.config.enabled:
                    try:
                        fixer = await asyncio.to_thread(create_panel_a2a_server, agent_factory=repairs.agent_for,
                                                        http_url=repairs.fixer_url)
                        app.state.fixer_a2a = fixer
                        mount_panel_a2a(app, fixer, enabled=True, path="/a2a/fixer")
                    except Exception:
                        logging.getLogger(__name__).exception("A2A: the tool fixer server could not start")
                if selection is None:
                    logging.getLogger(__name__).warning("A2A: no provider configured; the panel A2A server is unavailable")
                else:
                    provider, model_id = selection
                    factory = create_a2a_agent_factory(
                        model_factory=lambda _: build_model(provider, model_id),
                        # Native A2AServer constructs a metadata agent for its card.
                        # Actual contexts each own a fresh core tool set.
                        tools_factory=lambda context: [] if context == "__agent_card__" else build_core_tools(chat.PROJECT_TOOLS_DIR),
                        name="Ron", description="Ron browser agent with core tools",
                        system_prompt=chat.AGENT_SYSTEM_PROMPT,
                    )
                    integration = await asyncio.to_thread(
                        create_panel_a2a_server, agent_factory=factory, http_url=panel_a2a_url(),
                    )
                    app.state.panel_a2a = integration
                    mount_panel_a2a(app, integration, enabled=True)
            finally:
                mounted_routes = [route for route in app.routes if route not in previous]
        # Opt-in (RON_NGROK=1); only allow-listed webhook paths are reachable.
        app.state.public_url = await public_tunnel.start()
        async with skills_mcp_app.lifespan(app):
            yield
    finally:
        try:
            await get_teaching_service().shutdown()
            await public_tunnel.stop()
            await app.state.issue_agents.shutdown()
            await repairs.shutdown()
            await manager.shutdown()
        finally:
            chat.bind_repair_service(None)
            try:
                if app.state.panel_a2a is not None:
                    await app.state.panel_a2a.aclose()
                if app.state.fixer_a2a is not None:
                    await app.state.fixer_a2a.aclose()
                await harness_a2a_host.aclose()
            finally:
                for route in mounted_routes:
                    app.routes.remove(route)
                app.state.panel_runtime = None
                app.state.panel_a2a = None
                app.state.fixer_a2a = None


app = FastAPI(title="Ron Browser API", version="4.0.0", lifespan=lifespan)

# The electron-vite renderer port drifts (5173 -> 5174 -> ...) whenever a stale
# dev server holds the default, which made POST /chat preflights fail with
# "Disallowed CORS origin" while simple GETs still succeeded. Match any
# localhost port so the origin cannot go stale again.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, tags=["chat"])
app.include_router(articles.router, tags=["articles"])
app.include_router(projects.router, tags=["projects"])
app.include_router(discover.router, tags=["discover"])
app.include_router(search.router, tags=["search"])
app.include_router(bidi.router, tags=["bidi"])
app.include_router(memory.router, tags=["memory"])
app.include_router(teaching.router, tags=["teaching"])
app.include_router(teaching_observe.router, tags=["teaching"])
app.include_router(tool_repairs.router, tags=["tool-repairs"])
app.include_router(music.router, tags=["music"])
app.mount("/skills/mcp", skills_mcp_app)
# Stored harness specialists over native A2A (<PANEL_A2A_URL>/agents/<id>). Mounted before the
# lifespan's /a2a mount so this prefix wins; loopback-only like /a2a (never on the ngrok allowlist).
from agent.api.core.a2a_tools import a2a_enabled as _a2a_enabled  # noqa: E402
if _a2a_enabled():
    app.mount("/a2a/agents", harness_a2a_host)


@app.get("/health")
async def health_check():
    from datetime import datetime, timezone
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/config")
async def get_config():
    from agent.api.core.panel_agent import PROVIDERS, NATIVE_PROVIDER_CAPABILITIES, configured_providers, provider_api_key

    ready = configured_providers()
    return {
        "features": {
            "chat": bool(ready),
            "sessions": True,
            "event_replay": True,
            "steering": True,
            "cancellation": True,
            "checkpointing": True,
            "interrupts": True,
            "background_tasks": True,
            "goal_loop": True,
            "context_management": ["auto", "agentic", "sliding"],
            "tool_execution": ["concurrent", "sequential"],
            "a2a": getattr(app.state, "panel_a2a", None) is not None,
        },
        "providers": {provider: bool(provider_api_key(provider)) for provider in PROVIDERS},
        "provider_capabilities": NATIVE_PROVIDER_CAPABILITIES,
        "runtime": {"sdk": "strands", "session_settings_immutable": True, "server_owned_tasks": True},
    }


def run() -> None:
    """Serve the API on API_HOST/API_PORT (defaults 0.0.0.0:8765; systemd pins 127.0.0.1)."""
    import uvicorn

    from agent.api.core.config import API_HOST, API_PORT

    uvicorn.run(app, host=API_HOST, port=API_PORT)


if __name__ == "__main__":
    run()
