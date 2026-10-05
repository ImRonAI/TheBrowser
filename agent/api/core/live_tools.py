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
"""

from __future__ import annotations

import importlib
import json
import os
from collections.abc import Callable
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

LIVE_SYSTEM_PROMPT = (
    "You are Ron, the voice assistant inside the Ron Browser. "
    "The user's browser is an MCP server (electron-playwright-mcp) that is already connected. "
    "Its tools are already declared to you; their names start with the server prefix "
    "(user_browser_ or cloud_browser_). Call those tools to act in the browser. "
    "Every tool you can use is already declared; there is nothing to connect or load. "
    "When a tool returns an error, tell the user exactly what it returned.\n"
    "You can learn workflows from the user's Teach a skill screen demonstration. "
    "Use list_learned_skills to discover this agent's saved skills, and use_skill to execute them."
    """

## Journal and memory
Journal things worth remembering with add_memory. Write an entry the moment it happens.
Every entry is wrapped exactly like this:
<start_entry>
<topic_name>ToDo's<topic_name/>
<subject>Two to eight words<subject/>
<created_at>YYYY-MM-DDTHH:MM:SS<created_at/>
...the entry...
<end_entry/>
Topics: ToDo's, LearnedAboutUser, Feedback, UserStatement, WorthyMemory. The subject is two to
eight words. Do NOT add <tags>; the server stamps <created_at>. Call search_memories (nest
filters: time, tags, topic, subject) and search_memory when they help; the newest memory wins."""
)


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
    root = tools_dir.expanduser().resolve()
    search = import_vendored_module(root, root / "research" / "perplexity_search_api.py").perplexity_search_api
    tools.append(tool(name="perplexity_search")(search.__wrapped__))
    return tools


def build_live_tools(
    user_id: str,
    agent_scope: str,
    *,
    resolve_agent: Callable[[], Any] | None = None,
) -> list[AgentTool]:
    """Host, learned-skill and memory tools; the browser ``MCPClient`` is added by ``create_live_agent``."""
    from agent.api.core.panel_agent import user_memory_manager
    from agent.api.core.teaching import create_learned_skill_tools

    host = live_host_tools(PROJECT_TOOLS_DIR)

    def skill_tools() -> list[Any]:
        agent = resolve_agent() if resolve_agent is not None else None
        available = list(agent.tool_registry.registry.values()) if agent is not None else host
        return [
            value for value in available
            if value.tool_name not in {"use_skill", "list_learned_skills"}
            and not value.tool_name.startswith("strands_") and not is_browser_tool(value.tool_name)
            and not value.tool_name.startswith("a2a_")
        ]

    learned = create_learned_skill_tools(
        user_id, agent_scope, child_model, additional_tools=skill_tools(), tool_supplier=skill_tools,
    )
    # BidiAgent takes no plugins: the manager's tools (search_memory, journal-only add_memory and
    # the stores' search_memories via get_tools) are registered directly, with no injection.
    from agent.api.core.a2a_tools import a2a_tools

    return [*host, *learned, *user_memory_manager(user_id, agent_scope).tools, *a2a_tools()]


def create_live_agent(model: Any, user_id: str, agent_scope: str, browser: str) -> tuple[BidiAgent, str]:
    """``BidiAgent(tools=[browser MCPClient, *tools])``; the registry owns the client's lifecycle."""
    created: dict[str, Any] = {}
    tools = build_live_tools(user_id, agent_scope, resolve_agent=lambda: created.get("agent"))
    client = browser_client_factory(browser, tool_filters={"rejected": list(LIVE_REJECTED_BROWSER_TOOLS)})()
    try:
        agent = BidiAgent(model=model, tools=[client, *tools], system_prompt=LIVE_SYSTEM_PROMPT)
    except BaseException:
        client.stop(None, None, None)
        raise
    created["agent"] = agent
    try:
        _register_delegated_tools(agent)
    except BaseException:
        agent.tool_registry.cleanup()
        raise
    return agent, server_name(browser)


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
