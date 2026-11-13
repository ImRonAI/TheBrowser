"""Ren's Build Agent: one strands_harness ``create_harness`` agent per build session (contract: docs/build-agent.md).

**Model.** A native ``ModelRouter`` (strands ``models/routing``) over, in order: the session's chosen model; GLM 5.3
Flash on every other offered chat provider, in ``RON_CHAT_PROVIDERS`` order (NIM ``z-ai/glm-5.3-flash``, Mistral
``zai-glm-5-3-flash``); and, last, GLM 5.3 on Mistral (``zai-glm-5-3``) for when GLM 5.3 Flash has no capacity
anywhere. All three report the same 1,048,576-token window (``context_windows.py``), as the router requires of its
candidates. NIM and Mistral candidates are built with a read bound (``RON_BUILD_NIM_READ_TIMEOUT``,
``RON_BUILD_MISTRAL_READ_TIMEOUT``): a provider that accepts the request and then sends nothing fails that call with
its client's timeout error. The native ``ModelRetryStrategy`` retries only throttling (two short retries), so the
router sees the failure and continues the same call on the next candidate. Without the bound, NIM's hosted endpoint
holding a request open sent the run silent until the runtime's stall watchdog (``PANEL_RUN_STALL_SECONDS``) cancelled
it, twice, before failing (2026-11-11).

**Routing strategy.** ``RecentFailureStrategy`` wraps the native ``FallbackStrategy``: a failed call fails over
exactly as ``FallbackStrategy`` decides, and a candidate that failed within ``RON_BUILD_MODEL_COOLDOWN`` seconds is not
the one a new invocation opens on. NOT NATIVE: the SDK's ``RoutingStrategy`` protocol is the extension point, and its
strategies see only the current invocation's attempts, so without this every turn and every runtime respawn paid a
dead provider's full read bound again.

**Effort.** GLM 5.3 Flash runs at ``max`` reasoning unless the user picked a level; a fallback candidate keeps the
picked level when it offers it.

**Agent.** ``create_harness`` with the choices ``create_issue_chat_agent`` documents for a multi-tenant host:
``builtin_tools=[]`` (the harness ``shell``/``read``/``write``/``edit`` run in ``agent.sandbox``, whose local
default is the API process's cwd, i.e. this repository), ``builtin_plugins=["todos"]`` (``todo_write``, the Plan
pane), ``skills=False``, ``memory=False``, ``session=False`` (the runtime's ``ThreadSessionManager`` arrives in
``agent_kwargs``), ``mcp_servers=None``, ``caching=False`` (pre-built models) and ``interventions=None``. The context
modes are the panel composition's (``_context_kwargs``), so every Build thread saved before this module restores. The
tools are the installed ``strands_tools`` ``shell`` and ``editor`` (the names the workbench reads,
``src/lib/build-insights.ts``), which ``BuildWorkspaceGuard`` defaults to the session's workspace, plus
``http_request`` and the Brave search tools for documentation.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from agent.api.core import config as app_config
from agent.api.core.panel_agent import (
    NIM_REASONING_EFFORTS_BY_MODEL,
    build_model,
    configured_providers,
    mistral_reasoning_efforts,
)

logger = logging.getLogger(__name__)

#: GLM 5.3 Flash on each chat provider that serves it.
BUILD_MODELS: dict[str, str] = {"nim": "z-ai/glm-5.3-flash", "mistral": "zai-glm-5-3-flash"}
#: The last candidate: GLM 5.3 on Mistral, for when GLM 5.3 Flash has no capacity on any provider.
BUILD_LAST_RESORT: tuple[str, str] = ("mistral", "zai-glm-5-3")
#: The reasoning level GLM 5.3 Flash runs at when the user picked none.
BUILD_EFFORT = "max"


def _efforts(provider: str, model_id: str) -> tuple[str, ...] | None:
    """The documented reasoning levels of a NIM or Mistral model; ``None`` for other providers."""
    if provider == "nim":
        return NIM_REASONING_EFFORTS_BY_MODEL.get(model_id, ())
    if provider == "mistral":
        return mistral_reasoning_efforts(model_id)
    return None


def _read_timeout(provider: str) -> float | None:
    """Seconds a NIM or Mistral call may send nothing; ``None`` (unbounded) for other providers or when set to 0."""
    seconds = {"nim": app_config.RON_BUILD_NIM_READ_TIMEOUT,
               "mistral": app_config.RON_BUILD_MISTRAL_READ_TIMEOUT}.get(provider)
    return seconds or None


def build_candidates(provider: str, model_id: str, effort: str | None) -> list[tuple[str, str, str | None]]:
    """``(provider, model_id, effort)`` in routing order: the chosen model, GLM 5.3 Flash elsewhere, GLM 5.3."""
    levels = _efforts(provider, model_id)
    chosen = effort or (BUILD_EFFORT if levels and BUILD_EFFORT in levels else None)
    candidates = [(provider, model_id, chosen)]
    offered_providers = configured_providers()
    fallbacks = [(name, BUILD_MODELS[name]) for name in offered_providers if name in BUILD_MODELS]
    if BUILD_LAST_RESORT[0] in offered_providers:
        fallbacks.append(BUILD_LAST_RESORT)
    for name, fallback in fallbacks:
        if (name, fallback) == (provider, model_id):
            continue
        offered = _efforts(name, fallback) or ()
        candidates.append((name, fallback, chosen if chosen in offered else BUILD_EFFORT))
    return candidates


class RecentFailureStrategy:
    """NOT NATIVE: a strands ``RoutingStrategy`` (``models/routing/strategy.py``) wrapping ``FallbackStrategy``.

    After a failed call it is ``FallbackStrategy`` unchanged. On an invocation's opening ask it returns the first
    declared candidate that has not failed within ``cooldown`` seconds (when all have, the one whose failure is
    oldest), so a provider that is down costs one read bound per cooldown rather than one per turn. Failures are
    keyed by candidate name and kept in this process (one instance is shared by every Build router); a candidate
    that succeeds after failing is cleared.
    """

    def __init__(self, cooldown: float) -> None:
        from strands.models.routing import FallbackStrategy

        self.cooldown = cooldown
        self._fallback = FallbackStrategy()
        self._failed_at: dict[str, float] = {}

    async def select(self, context: Any, **kwargs: Any) -> Any:
        """The opening candidate by recent failures; after a failure, ``FallbackStrategy``'s choice."""
        if context.attempts:
            for attempt in context.attempts[:-1]:
                if attempt.exception is None:
                    self._failed_at.pop(attempt.candidate.name, None)
            self._failed_at[context.attempts[-1].candidate.name] = time.monotonic()
            return await self._fallback.select(context, **kwargs)
        now = time.monotonic()
        recent = {name: at for name, at in self._failed_at.items() if now - at < self.cooldown}
        healthy = [candidate for candidate in context.candidates if candidate.name not in recent]
        if healthy:
            return healthy[0]
        return min(context.candidates, key=lambda candidate: recent[candidate.name])


_strategy: RecentFailureStrategy | None = None


def routing_strategy() -> RecentFailureStrategy:
    """The process's one ``RecentFailureStrategy`` (built on first use from ``RON_BUILD_MODEL_COOLDOWN``)."""
    global _strategy
    if _strategy is None:
        _strategy = RecentFailureStrategy(app_config.RON_BUILD_MODEL_COOLDOWN)
    return _strategy


def build_model_router(provider: str, model_id: str, effort: str | None) -> Any:
    """The Build Agent's native ``ModelRouter`` over ``build_candidates``, routed by ``routing_strategy()``."""
    from strands.models.routing import ModelRouter, RoutingCandidate

    candidates = [
        RoutingCandidate(build_model(name, model, level, read_timeout=_read_timeout(name)), name=f"{name}:{model}")
        for name, model, level in build_candidates(provider, model_id, effort)
    ]
    return ModelRouter(candidates, strategy=routing_strategy())


def _installed_tool(module: Any, name: str) -> Any:
    from strands.tools.loader import load_tools_from_module

    loaded = [value for value in load_tools_from_module(module, name) if value.tool_name == name]
    if not loaded:
        raise RuntimeError(f"strands_tools.{name} did not export a tool named {name!r}")
    return loaded[0]


def build_side_model(provider: str, model_id: str, effort: str | None) -> Any:
    """The chosen model alone (no routing), read-bounded like its candidate: for the goal judge."""
    provider, model_id, level = build_candidates(provider, model_id, effort)[0]
    return build_model(provider, model_id, level, hosted_tools=False, read_timeout=_read_timeout(provider))


def _context_kwargs(context: str, side_model_factory: Any) -> dict[str, Any]:
    """The panel composition's context modes (``panel_agent.create_panel_agent``), unchanged.

    A Build thread's snapshot stores its conversation manager's state under the manager's class name, and the SDK
    refuses to restore it into another class (``ConversationManager.restore_from_session``: "Invalid conversation
    manager state."), so the Build Agent keeps the managers every existing Build thread was saved with:
    ``SummarizingConversationManager`` for ``auto`` (its summarizer a separate ``Agent``: summarizing through the
    agent itself deadlocks on its invocation lock), ``SlidingWindowConversationManager`` for ``sliding`` and the native
    agentic ``ContextManager`` for ``agentic`` (which ignores a conversation manager).
    """
    from strands import Agent
    from strands.agent.conversation_manager import SlidingWindowConversationManager, SummarizingConversationManager
    from strands.agent.conversation_manager.summarizing_conversation_manager import DEFAULT_SUMMARIZATION_PROMPT

    if context == "agentic":
        return {"context_manager": "agentic"}
    if context == "sliding":
        return {"context_manager": False, "conversation_manager": SlidingWindowConversationManager()}
    summarizer = Agent(model=side_model_factory("summarizer"), system_prompt=DEFAULT_SUMMARIZATION_PROMPT,
                       callback_handler=None, load_tools_from_directory=False)
    return {"context_manager": False, "conversation_manager": SummarizingConversationManager(
        summarization_agent=summarizer,
        preserve_recent_messages=4,
        proactive_compression={"compression_threshold": app_config.PANEL_CONTEXT_COMPRESSION_THRESHOLD},
    )}


def _background(options: dict[str, Any]) -> Any:
    """Off unless the ``background`` option is on; then native ``wait_for_completion`` as the panel runtime requires."""
    if not options.get("background"):
        return False
    return {"agentic": ["*"], "wait_for_completion": True, "never": ["editor"]}


def create_build_agent(*, user_id: str, session_id: str, model: Any, side_model_factory: Any, browser: str,
                       options: dict[str, Any] | None = None, plugins: list[Any] | tuple[Any, ...] = (),
                       hooks: list[Any] | tuple[Any, ...] = (), **agent_kwargs: Any) -> Any:
    """The Build Agent for one session; callers offload this synchronous constructor.

    ``model`` is ``build_model_router(...)``; ``side_model_factory(name)`` builds the ``"summarizer"``'s model (an
    ``Agent``'s, so a fresh router) and the ``"goal-judge"``'s (``build_side_model``). ``plugins`` are the runtime's consumer plugins (its ``ContextInjector``), ``hooks`` the runtime's hooks
    (registered after construction, as the harness forwards constructor hooks to ``subagent`` children) and
    ``agent_kwargs`` go to ``Agent`` (``agent_id``, ``session_manager``, ``callback_handler``).
    """
    from strands import ModelRetryStrategy
    from strands.tools.executors import ConcurrentToolExecutor, SequentialToolExecutor
    from strands.vended_plugins.context_offloader import ContextOffloader
    from strands.vended_plugins.goal import GoalLoop, JudgeConfig
    from strands_harness import create_harness
    from strands_tools import editor, shell

    from agent.api.core.brave_tools import brave_tools
    from agent.api.core.build_workspace import BuildWorkspaceGuard, build_agent_prompt, ensure_workspace
    from agent.api.core.panel_storage import get_user_session_storage
    from agent.api.core.panel_tools import installed_http_request
    from agent.api.core.threads import ThreadProjection
    from agent.api.core.tool_observation import ToolObservation, trace_attributes

    options = dict(options or {})
    context = options.get("context", "auto")
    if context not in ("auto", "agentic", "sliding"):
        raise ValueError("context must be auto, agentic or sliding")
    workspace = ensure_workspace(user_id, session_id)
    storage = get_user_session_storage(user_id)
    consumer_plugins: list[Any] = [*plugins, BuildWorkspaceGuard(workspace)]
    context_kwargs = _context_kwargs(context, side_model_factory)
    if context != "agentic":
        consumer_plugins.append(ContextOffloader(storage=storage))
    goal = options.get("goal") or ""
    if goal:
        # The panel runtime supports GoalLoop only with preserve_context=True (panel_runtime.py docstring).
        consumer_plugins.append(GoalLoop(goal=goal, judge=JudgeConfig(model=side_model_factory("goal-judge")),
                                         preserve_context=True))
    agent = create_harness(
        model=model,
        caching=False,
        instructions=build_agent_prompt(workspace).strip(),
        tools=[_installed_tool(shell, "shell"), _installed_tool(editor, "editor"), installed_http_request(),
               *brave_tools()],
        plugins=consumer_plugins,
        mcp_servers=None,
        builtin_tools=[],
        builtin_plugins=["todos"],
        background_tasks=_background(options),
        session=False,
        skills=False,
        memory=False,
        interventions=None,
        name="Ren Build Agent",
        description="Ren's Build Agent: builds software in the session's private workspace",
        storage=storage,
        # Throttling only, briefly: after two short retries the router continues on the next candidate.
        retry_strategy=ModelRetryStrategy(max_attempts=3, initial_delay=2, max_delay=8),
        tool_executor=SequentialToolExecutor() if options.get("tool_execution") == "sequential" else ConcurrentToolExecutor(),
        checkpointing=bool(options.get("checkpointing", False)),
        trace_attributes=trace_attributes(session_id=session_id, user_id=user_id),
        load_tools_from_directory=False,
        **context_kwargs,
        **agent_kwargs,
    )
    for hook in (ToolObservation(),
                 ThreadProjection(user_id=user_id, session_id=session_id, destination="build", agent="chat",
                                  browser=browser),
                 *hooks):
        agent.hooks.add_hook(hook)
    logger.info("user=<%s>, session=<%s>, candidates=<%s> | build agent built", user_id, session_id,
                [candidate.name for candidate in model.candidates] if hasattr(model, "candidates") else type(model).__name__)
    return agent
