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
from agent.api.endpoints import chat
from agent.api.endpoints import articles
from agent.api.endpoints import projects
from agent.api.endpoints import discover
from agent.api.endpoints import memory


@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    logging.basicConfig(level=logging.INFO)
    SESSION_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    manager = chat.create_runtime_manager()
    from agent.api.core.issue_agents import IssueAgentRuntime
    app.state.issue_agents = IssueAgentRuntime()
    app.state.panel_runtime = manager
    app.state.panel_a2a = None
    mounted_routes = []
    try:
        if os.getenv("PANEL_A2A_ENABLED", "").lower() in {"1", "true", "yes"}:
            from agent.api.core.panel_agent import build_model, default_selection
            from agent.api.core.panel_tools import build_core_tools
            from agent.api.core.panel_a2a import create_a2a_agent_factory, create_panel_a2a_server, mount_panel_a2a

            selection = default_selection()
            if selection is not None:
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
                    create_panel_a2a_server, agent_factory=factory,
                    http_url=os.getenv("PANEL_A2A_URL", "http://localhost:8765/a2a"),
                )
                app.state.panel_a2a = integration
                previous = list(app.routes)
                mount_panel_a2a(app, integration, enabled=True)
                mounted_routes = [route for route in app.routes if route not in previous]
            else:
                logging.getLogger(__name__).warning("PANEL_A2A_ENABLED: no provider configured; A2A is unavailable")
        # Opt-in (RON_NGROK=1); only allow-listed webhook paths are reachable.
        app.state.public_url = await public_tunnel.start()
        yield
    finally:
        try:
            await public_tunnel.stop()
            await app.state.issue_agents.shutdown()
            await manager.shutdown()
        finally:
            try:
                if app.state.panel_a2a is not None:
                    await app.state.panel_a2a.aclose()
            finally:
                for route in mounted_routes:
                    app.routes.remove(route)
                app.state.panel_runtime = None
                app.state.panel_a2a = None


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
app.include_router(memory.router, tags=["memory"])


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

