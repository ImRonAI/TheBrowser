"""Tools for the Live agent, composed natively on ``strands.bidi.BidiAgent``.

``BidiAgent(tools=[...])`` registers plain tools and native ``ToolProvider``s through
``ToolRegistry.process_tools`` and declares them to the model once per connection
(``bidi/agent/loop.py``: ``start`` and ``_restart_model``). The Live tool set is therefore
fixed when the socket starts, and it holds only tools the bidi loop can run:

* The browser is the selected target's native ``MCPClient`` (``electron-playwright-mcp``),
  passed directly in ``tools``. Its native ``tool_filters`` drop
  ``playwright_browser_take_screenshot``: that tool returns an image block, which
  ``GoogleGeminiLiveModel._format_tool_result`` rejects, and the bidi loop turns the
  rejection into an error that ends the session.
* The text agent's host tools, memory tools, learned skills and formations, minus four
  tools that cannot work on ``BidiAgent``. ``think`` is text-only. ``ask_user`` is a tool
  interrupt, and the bidi loop raises "tool interrupts are not supported in bidi".
  ``tool_catalog`` and ``mcp_client`` register tools after the connection has declared its
  tools, so the model never receives them.
* Live Music (``core.live_music``): the ``music_*`` native async tools over the official
  ``client.aio.live.music`` session, plus the Lyria prompt guide as a native Agent Skill
  (``AgentSkills`` ``skills`` activation tool + its ``<available_skills>`` prompt block, applied by
  hand because ``BidiAgent`` has no plugins). Present when ``create_live_agent`` is given an
  ``emit`` for the renderer socket and ``LIVE_MUSIC_ENABLED``.
"""

from __future__ import annotations

import importlib
import json
import os
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from strands import tool
from strands.bidi import BidiAgent
from strands.tools.loader import load_tools_from_module
from strands.types.tools import AgentTool

from agent.api.core import config
from agent.api.core.panel_agent import (
    PROJECT_TOOLS_DIR,
    _assigned_tools,
    _default_formations,
    _formation_spec,
    build_model,
)
from agent.api.core.panel_browser import browser_client_factory, is_browser_tool, server_name
from agent.api.core.panel_tools import (
    ChildSpec,
    create_formation_tool,
    create_skill_tool,
    import_vendored_module,
    skills_from_env,
)

#: Unprefixed electron-playwright-mcp tools Live cannot use. The screenshot returns image content,
#: which GoogleGeminiLiveModel rejects. request_approval is FastMCP's Approval app: it returns a UI card
#: and tells the model to stop until an "I selected:" message arrives, but Ron renders no MCP Apps UI.
LIVE_REJECTED_BROWSER_TOOLS = ("playwright_browser_take_screenshot", "request_approval")

#: Installed ``strands_tools`` host tools the text agent also registers (``mcp_client`` excluded).
LIVE_HOST_TOOLS = ("editor", "shell", "environment", "http_request")

def live_system_prompt(browser: str) -> str:
    """The text agent's full prompt for ``browser`` plus the Live deltas (``chat.live_system_prompt``).

    One composition source for both agents: the Live prompt must never be a hand-written subset.
    Imported lazily because ``endpoints.chat`` imports this package's siblings at module import.
    """
    from agent.api.endpoints.chat import live_system_prompt as compose

    return compose(browser)


def child_model(_name: str) -> Any:
    """Text model for skill and formation children. The live socket model is not reusable here."""
    return build_model("gemini", config.GEMINI_DEFAULT_MODEL, hosted_tools=False)


def live_host_tools(tools_dir: Path) -> list[AgentTool]:
    """The installed host tools and the vendored Perplexity search, as native SDK tools.

    ``DecoratedFunctionTool`` and ``PythonAgentTool`` offload synchronous bodies to a thread
    themselves. Perplexity search keeps the text agent's name ``perplexity_search`` through
    ``@tool(name=...)`` over the original function, which ``DecoratedFunctionTool`` exposes
    as ``__wrapped__``.
    """
    tools: list[AgentTool] = []
    for name in LIVE_HOST_TOOLS:
        module = importlib.import_module(f"strands_tools.{name}")
        loaded = [value for value in load_tools_from_module(module, name) if value.tool_name == name]
        if not loaded:
            raise RuntimeError(f"strands_tools.{name} did not export a tool named {name!r}")
        tools.append(loaded[0])
    if config.perplexity_search_enabled():
        root = tools_dir.expanduser().resolve()
        search = import_vendored_module(root, root / "research" / "perplexity_search_api.py").perplexity_search_api
        tools.append(tool(name="perplexity_search")(search.__wrapped__))
    # Brave Answers + Brave Search vertical tools, the same native async tools the text agent carries.
    from agent.api.core.brave_tools import brave_tools

    tools.extend(brave_tools())
    from agent.api.core.render_ui_tool import render_ui_tools

    tools.extend(render_ui_tools())
    return tools


def build_live_tools(
    user_id: str,
    agent_scope: str,
    *,
    resolve_agent: Callable[[], Any] | None = None,
) -> list[AgentTool]:
    """Host, learned-skill and memory tools; the browser ``MCPClient`` is added by ``create_live_agent``."""
    from agent.api.core.panel_agent import user_memory_tools
    from agent.api.core.teaching import create_learned_skill_tools

    host = live_host_tools(PROJECT_TOOLS_DIR)

    def skill_tools() -> list[Any]:
        agent = resolve_agent() if resolve_agent is not None else None
        available = list(agent.tool_registry.registry.values()) if agent is not None else host
        return [
            value for value in available
            if value.tool_name not in {"use_skill", "list_learned_skills", "create_harness"}
            and not value.tool_name.startswith("strands_") and not is_browser_tool(value.tool_name)
            and not value.tool_name.startswith("a2a_")
        ]

    learned = create_learned_skill_tools(
        user_id, agent_scope, child_model, additional_tools=skill_tools(), tool_supplier=skill_tools,
    )
    # BidiAgent takes no plugins: the native manager's search_memory/add_memory over the same stores
    # as Chat are registered directly (no injection, no extraction on Live).
    from agent.api.core.a2a_tools import a2a_tools
    from agent.api.core.harness_agents import create_harness_tools
    from agent.api.core.music_generation import music_generation_tools

    return [*host, *learned, *user_memory_tools(user_id, agent_scope), *a2a_tools(),
            *create_harness_tools(user_id), *music_generation_tools(user_id)]


def live_music_tools(emit: Callable[[dict[str, Any]], Awaitable[None]] | None, user_id: str = "default") -> tuple[list[AgentTool], str, Any]:
    """The ``music_*`` tools, the Lyria skill's ``skills`` tool, and the prompt addendum for Live Music.

    Returns ``([], "", None)`` when there is no renderer socket to carry audio or Live Music is off.
    The third element is the ``LiveMusicTools`` instance so the socket can close its session.
    """
    if emit is None or not config.LIVE_MUSIC_ENABLED:
        return [], "", None
    from agent.api.core.live_music import LiveMusicTools, lyria_skills_plugin, skills_prompt_block

    music = LiveMusicTools(emit, user_id=user_id)
    plugin = lyria_skills_plugin()
    addendum = LIVE_MUSIC_ADDENDUM + "\n\n" + skills_prompt_block(plugin)
    return [*music.tools, *plugin.tools], addendum, music


def create_live_agent(
    model: Any, user_id: str, agent_scope: str, browser: str, *,
    emit: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    session_id: str | None = None,
) -> tuple[BidiAgent, str]:
    """``BidiAgent(tools=[browser MCPClient, *tools])``; the registry owns the client's lifecycle.

    With ``session_id`` the agent is a **thread**: it constructs with the user's shared native
    ``agent_id`` (``thread_agent_id``) and a native ``SnapshotSessionManager`` over the user's session
    storage -- the same key the Chat ``Agent`` uses -- so the SDK restores the thread's messages and
    state on init (``AgentInitializedEvent``), saves on every ``MessageAddedEvent``/``MessageUpdatedEvent``
    (``bidi_agent_save_latest_on="message"``, the default) and checkpoints on ``BidiAgentStopEvent``.
    The Chat agent can then open the same thread, and take it over when the socket dies.

    The renderer's capability for ``/music/*`` is ``agent.live_id``, a fresh random per-socket id (the
    ``agent_id`` is now shared across the user's agents, so it can no longer key a socket). ``emit`` is
    the renderer socket sender; when given, the Live Music tools stream ``music_*`` frames through it and
    ``bidi.py`` closes the Lyria session with ``close_live_music`` after ``run``.
    """
    from agent.api.core.panel_storage import ThreadSessionManager, thread_agent_id
    from agent.api.core.panel_agent import get_user_session_storage

    created: dict[str, Any] = {}
    tools = build_live_tools(user_id, agent_scope, resolve_agent=lambda: created.get("agent"))
    music_tools, music_addendum, music = live_music_tools(emit, user_id)
    client = browser_client_factory(browser, tool_filters={"rejected": list(LIVE_REJECTED_BROWSER_TOOLS)})()
    live_id = f"live-{uuid.uuid4().hex}"
    session_kwargs: dict[str, Any] = {}
    hooks: list[Any] = []
    if session_id:
        from agent.api.core.threads import ThreadProjection

        session_kwargs = {
            "agent_id": thread_agent_id(user_id),
            "session_manager": ThreadSessionManager(session_id, storage=get_user_session_storage(user_id)),
        }
        # Same Supabase read model the Chat agent writes; `agent="live"` marks who wrote each row.
        hooks.append(ThreadProjection(user_id=user_id, session_id=session_id, destination=agent_scope, agent="live", browser=browser))
        # The bidi loop runs tools through the SDK executor, so AfterToolCallEvent fires here too:
        # a failing Live tool starts the same bounded investigation as in Chat. The text fixer owns
        # approval (the panel); BidiAgent never sees an interrupt.
        from agent.api.endpoints.chat import repair_service

        service = repair_service()
        if service is not None and service.config.enabled:
            from agent.api.core.tool_observation import ToolObservation

            hooks.extend([ToolObservation(), service.trigger(browser=browser, user_id=user_id, session_id=session_id)])
    else:
        session_kwargs = {"agent_id": live_id}
    if hooks:
        session_kwargs["hooks"] = hooks
    try:
        agent = BidiAgent(model=model, tools=[client, *tools, *music_tools],
                          system_prompt=live_system_prompt(browser) + music_addendum, **session_kwargs)
    except BaseException:
        client.stop(None, None, None)
        raise
    agent.live_id = live_id  # type: ignore[attr-defined]
    created["agent"] = agent
    try:
        _register_delegated_tools(agent)
    except BaseException:
        agent.tool_registry.cleanup()
        raise
    if music is not None:
        LIVE_MUSIC_SESSIONS[live_id] = music
    return agent, server_name(browser)


def live_id_of(agent: BidiAgent) -> str:
    """The per-socket capability id (`/music/*`, `ready.agent_id`); falls back to ``agent_id``."""
    return getattr(agent, "live_id", None) or agent.agent_id


async def close_live_music(agent: BidiAgent) -> None:
    """End this agent's Lyria session (if any) when its socket ends; never another agent's entry."""
    live_id = live_id_of(agent)
    music = LIVE_MUSIC_SESSIONS.get(live_id)
    if music is None:
        return
    LIVE_MUSIC_SESSIONS.pop(live_id, None)
    await music.session.close()


#: ``LiveMusicTools`` per live ``BidiAgent``, keyed by its random ``agent_id`` (see ``create_live_agent``).
LIVE_MUSIC_SESSIONS: dict[str, Any] = {}

#: Appended to the Live prompt when the music tools are registered; the skill carries the prompt guide.
LIVE_MUSIC_ADDENDUM = """

## Live music (Lyria RealTime)
You can play and steer live instrumental music for the user with the music_* tools: music_set_weighted_prompts
starts the stream and plays immediately on first use, and steers it afterwards (the list replaces the previous
list; cross-fade with intermediate weights). When the user asks for music, call it at once with your first
prompts; do not ask questions or set config first. The deck's Edit box sends you "[music edit at m:ss]"
messages: steer from that moment with music_set_weighted_prompts (the stream cannot go back and
regenerate what already played). music_set_generation_config sends the whole config (bpm/scale changes need
music_playback_control "reset_context"), music_playback_control plays/pauses/stops/resets, music_status reports what is in effect,
music_take_status/music_save/music_discard_take manage the rolling recording (save needs a signed-in user)
and music_close ends it. Saved songs are the user's library: music_library lists them, and
music_playlists / music_playlist_create / music_playlist_add / music_playlist_remove / music_playlist_reorder /
music_playlist_delete group them into playlists or albums (kind "album") that the deck plays continuously in
order or shuffled; a song must be saved before it can join one. Before the first music_set_weighted_prompts call, activate the
lyria-realtime-prompting skill with the skills tool and follow it. The audio plays in the user's Vibe
music deck, not to you; say in one sentence what you changed."""


def _register_delegated_tools(agent: BidiAgent) -> None:
    """Formations and the optional skill tool, registered before the connection declares tools."""
    formations_file = os.getenv("PANEL_FORMATIONS_FILE")
    raw_formations = json.loads(Path(formations_file).expanduser().read_text()) if formations_file else None
    if raw_formations is not None and not isinstance(raw_formations, list):
        raise ValueError("PANEL_FORMATIONS_FILE must contain an array of formation specs")
    formations = (
        [_formation_spec(raw, agent) for raw in raw_formations]
        if raw_formations is not None else _default_formations()
    )
    delegated = []
    skills = skills_from_env()
    if skills is not None:
        assignments = json.loads(os.getenv("PANEL_SKILL_TOOLS", "{}"))
        if not isinstance(assignments, dict):
            raise ValueError("PANEL_SKILL_TOOLS must be a skill-name to tool-name-array object")
        delegated.append(create_skill_tool(
            skills=skills, model_factory=child_model,
            tool_assignments={name: _assigned_tools(agent, names) for name, names in assignments.items()},
        ))
    for spec in formations:
        if isinstance(spec, ChildSpec):
            raise ValueError("Top-level formations must be graph or swarm specs")
        delegated.append(create_formation_tool(
            spec, model_factory=child_model,
            description=f"Run the configured {spec.name} formation with explicitly assigned child tools.",
        ))
    if delegated:
        agent.tool_registry.process_tools(delegated)
