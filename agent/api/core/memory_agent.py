"""Shared background Memory Agent: recall before every model call, dreaming while idle.

One ``MemoryAgent`` per user owns that user's long-term memory. It is a plain
``strands.Agent`` built with ``strands_harness.create_harness`` over a native
``ModelRouter`` (``FallbackStrategy``) of fast Perplexity Agent API models, and it
serves two prompts over the same writable ``MemoryManager``:

* **recall** - triggered by the host agent's native hooks (``RecallPlugin``). The
  memory agent searches memory and ends by calling ``inject_memory`` with terse
  bullets, or the literal ``n/a``. The host's ``InvokeModelStage.Input`` boundary
  awaits the result and delivers it as a separate ephemeral user message
  (``docs/panel-runtime.md``); ``n/a`` injects nothing.
* **dream** - triggered by the cron-driven ``POST /memory/dream`` after five idle
  minutes. The memory agent reads the journal and promotes entries into memory
  through the native ``add_memory`` tool, carrying topic, subject, tags and the
  creation timestamp, so recall on the next turn already sees them.

Nothing here is persisted into the host conversation, journal or session.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import threading
import time
from pathlib import Path
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from html import escape
from typing import Any

from strands import Agent, tool
from strands.hooks import AfterInvocationEvent, AfterToolCallEvent, BeforeInvocationEvent, MessageAddedEvent
from strands.injection.types import InjectionContext
from strands.memory import MemoryManager
from strands.models import ModelRouter
from strands.models.routing.router import FallbackStrategy
from strands.plugins import Plugin, hook
from strands.tools.loader import load_tools_from_module
from strands.types.content import Messages
from strands.types.tools import ToolContext
from strands_harness import create_harness

from agent.api.core.panel_agent import PROJECT_TOOLS_DIR, build_model
from agent.api.core.panel_storage import create_search_memories_tool
from agent.api.core.panel_tools import adapt_native_tool, import_vendored_module

logger = logging.getLogger(__name__)

NA = "n/a"
#: Measured 2026-10-01 through the Perplexity Agent API (ttft 1.0-1.9 s). Declaration order
#: is FallbackStrategy's preference order; a candidate that keeps failing sinks below the rest.
DEFAULT_MODELS = ("google/gemini-3.5-flash-lite", "openai/gpt-5.4-nano", "perplexity/sonar",
                  "perplexity/nemotron-3-ultra-550b-a55b")

#: Fixed vocabulary the dreaming pass draws 10-12 tags from (RON_MEMORY_TAGS overrides).
DEFAULT_TAGS = (
    "todo", "deadline", "reminder", "preference", "dislike", "family", "friend", "work", "project",
    "health", "finance", "purchase", "travel", "food", "home", "schedule", "birthday", "anniversary",
    "feedback", "correction", "instruction", "habit", "goal", "decision", "question", "fact",
    "contact", "location", "account", "tool", "browser", "research", "shopping", "entertainment",
    "learning", "communication", "style", "privacy", "security", "recurring",
)

ENTRY_FORMAT = """Journal entry format (exact):
<start_entry>
<topic_name>ToDo's<topic_name/>            (one of: ToDo's, LearnedAboutUser, Feedback, UserStatement, WorthyMemory)
<subject>Two to eight words only<subject/>
<created_at>YYYY-MM-DDTHH:MM:SS<created_at/>  (creation time, to the second)
<tags>only during dreaming, 10-12 comma-separated words from the tag list</tags>
...entry body...
<end_entry/>"""

RECALL_SYSTEM_PROMPT = """You are Ron's silent memory librarian. You never talk to the user.
You receive the tail of a live conversation. Decide what long-term memories would help the
assistant right now. Search with search_memories FIRST (journal memories with topic, subject,
created_at and tags; nest filters in whatever order helps: tags, topic, since, subject), and use
search_memory for anything else. One or two searches, then call inject_memory EXACTLY ONCE:
- with terse bullets (max 6 lines, each under 160 characters, keep <topic_name>/<subject> when present), or
- with the literal text n/a when nothing relevant exists.
Never invent memories. Never answer the user's question. Never call add_memory during recall."""

DREAM_SYSTEM_PROMPT = f"""You are Ron's memory consolidator ("dreaming"). The browser has been idle.
1. The user prompt lists the journal dates that exist. For each date, call
   journal(action="read", date="<YYYY-MM-DD>") unless search_memories(topic="WorthyMemory",
   subject="Consolidated <date>") already returns a hit for it.
2. For every entry worth keeping long-term (todos, facts about the user, feedback, statements,
   worthy memories) call add_memory with the entry text as content, keeping its topic, subject and
   created_at, and ADD a <tags> line choosing 10 to 12 words ONLY from this list:
   {", ".join(DEFAULT_TAGS)}
   Each add_memory content MUST start with a heading line "# <topic_name> | <subject>" and follow:
{ENTRY_FORMAT}
3. Finish each date by calling add_memory once with a WorthyMemory entry whose subject is
   "Consolidated <date>" so the pass is not repeated.
Keep it factual. Do not address the user."""


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    try:
        return float(raw) if raw else default
    except ValueError:
        raise ValueError(f"{name} must be a number") from None


@dataclass(frozen=True)
class MemoryAgentConfig:
    models: tuple[str, ...] = DEFAULT_MODELS
    #: Recall is two fast model calls (search, inject); measured 2.7-3.5 s end to end on the
    #: default chain. The gate only blocks the first model call of a turn; later tool-loop
    #: calls reuse the latest finished recall while a fresh one warms in the background.
    timeout_s: float = 6.0
    context_messages: int = 8
    max_injected_chars: int = 2000
    enabled: bool = True

    @classmethod
    def from_env(cls) -> MemoryAgentConfig:
        raw = os.getenv("RON_MEMORY_AGENT_MODELS", "")
        models = tuple(m.strip() for m in raw.split(",") if m.strip()) or DEFAULT_MODELS
        return cls(
            models=models,
            timeout_s=_env_float("RON_MEMORY_AGENT_TIMEOUT_S", 6.0),
            context_messages=int(os.getenv("RON_MEMORY_AGENT_CONTEXT_MESSAGES", "8")),
            enabled=os.getenv("RON_MEMORY_AGENT", "1") != "0",
        )


@dataclass
class RecallResult:
    key: str
    text: str | None
    latency_s: float


def journal_tool() -> Any:
    """The vendored strands_tools ``journal`` tool, loaded through the framework loader."""
    root = PROJECT_TOOLS_DIR.expanduser().resolve()
    module = import_vendored_module(root, root / "devops" / "journal.py")
    loaded = [t for t in load_tools_from_module(module, "journal") if t.tool_name == "journal"]
    if not loaded:
        raise RuntimeError("vendored devops/journal.py did not export a `journal` tool")
    return adapt_native_tool(loaded[0])


def journal_dates() -> list[str]:
    """Dates (``YYYY-MM-DD``) with a journal file, as the vendored ``journal`` tool lays them out."""
    base = Path(os.environ.get("RON_AGENT_SANDBOX_ROOT") or Path.cwd()) / "journal"
    if not base.is_dir():
        return []
    return sorted(path.stem for path in base.glob("*.md") if len(path.stem) == 10)


def _tail(messages: Messages, limit: int) -> str:
    lines: list[str] = []
    for message in messages[-limit:]:
        parts = []
        for block in message.get("content", []):
            if "text" in block:
                parts.append(block["text"])
            elif "toolUse" in block:
                parts.append(f"[tool call {block['toolUse'].get('name')}]")
            elif "toolResult" in block:
                parts.append("[tool result]")
        if parts:
            lines.append(f"{message['role']}: " + " ".join(parts)[:1200])
    return "\n".join(lines)


def _cycle_key(messages: Messages) -> str:
    digest = hashlib.sha256()
    digest.update(str(len(messages)).encode())
    for message in messages[-2:]:
        digest.update(json.dumps(message, sort_keys=True, default=str).encode())
    return digest.hexdigest()[:16]


class MemoryAgent:
    """The user's shared memory agent: one harness ``Agent``, two prompts."""

    def __init__(self, *, user_id: str, memory_manager: MemoryManager, config: MemoryAgentConfig,
                 emit: Callable[[dict[str, Any]], Awaitable[None]] | None = None) -> None:
        self.user_id = user_id
        self.memory_manager = memory_manager
        self.config = config
        self.emit = emit
        self._lock = asyncio.Lock()
        self.agent = self._build()

    def _build(self) -> Agent:
        candidates = [build_model("perplexity", model_id, None, hosted_tools=False) for model_id in self.config.models]
        router = ModelRouter(candidates, strategy=FallbackStrategy())

        @tool(context=True)
        async def inject_memory(content: str, tool_context: ToolContext) -> dict[str, Any]:
            """Deliver the memories relevant to the current conversation, or exactly "n/a".

            Args:
                content: Terse bullet lines of relevant memories, or the literal text n/a.
                tool_context: Native invocation context.
            """
            value = content.strip()
            tool_context.invocation_state["recall_injection"] = value
            tool_context.invocation_state["request_state"]["stop_event_loop"] = True
            return {"status": "success", "content": [{"text": "skipped" if value.lower() == NA else "queued"}]}

        # Explicit memory_manager/system_prompt win over the harness defaults; every built-in,
        # plugin, session, skill, context manager and intervention is off: this agent only recalls.
        return create_harness(
            model=router, effort="off", system_prompt=RECALL_SYSTEM_PROMPT,
            tools=[inject_memory, journal_tool(), create_search_memories_tool(list(self.memory_manager._stores))], memory_manager=self.memory_manager,
            builtin_tools=[], builtin_plugins=[], session=False, skills=False, caching=None,
            context_manager=False, background_tasks=False, interventions=None,
            callback_handler=None, load_tools_from_directory=False, name="Ron Memory",
        )

    async def _run(self, system_prompt: str, prompt: str, node_path: list[str]) -> dict[str, Any]:
        """Run one prompt against the shared agent and return its invocation state."""
        state: dict[str, Any] = {"request_state": {}}
        async with self._lock:
            self.agent.system_prompt = system_prompt
            self.agent.messages.clear()
            async for event in self.agent.stream_async(prompt, invocation_state=state):
                if self.emit is not None and ("data" in event or "current_tool_use" in event):
                    await self.emit({"node_path": node_path, "event": {k: v for k, v in event.items()
                                                                        if k in ("data", "current_tool_use")}})
        return state

    async def recall(self, messages: Messages) -> RecallResult:
        key = _cycle_key(messages)
        started = time.perf_counter()
        prompt = ("Conversation tail:\n" + _tail(messages, self.config.context_messages)
                  + "\n\nSearch memory, then call inject_memory once (bullets or n/a).")
        state = await self._run(RECALL_SYSTEM_PROMPT, prompt, ["recall", key])
        raw = str(state.get("recall_injection") or "").strip()
        text = None if not raw or raw.lower().rstrip(".") == NA else raw[: self.config.max_injected_chars]
        return RecallResult(key=key, text=text, latency_s=time.perf_counter() - started)

    async def dream(self) -> dict[str, Any]:
        dates = journal_dates()
        if not dates:
            return {"status": "nothing_to_dream", "user_id": self.user_id, "journal_dates": []}
        prompt = ("The browser has been idle for five minutes. Journal dates on disk: "
                  + ", ".join(dates) + ". Consolidate every unconsolidated entry into memory now.")
        state = await self._run(DREAM_SYSTEM_PROMPT, prompt, ["dream"])
        return {"status": "dreamed", "user_id": self.user_id, "journal_dates": dates,
                "request_state": state.get("request_state", {})}


class RecallPlugin(Plugin):
    """Hooks-as-triggers plus the render callback the host's injection boundary awaits.

    Register the SAME instance on the panel agent and on every ``think`` child so recall
    runs before any of them produces output. Hooks pre-warm a recall for the current
    conversation state; ``render`` awaits it (bounded by ``timeout_s``) and fails open.
    """

    name = "ron:memory"

    def __init__(self, memory_agent: MemoryAgent) -> None:
        self.memory_agent = memory_agent
        self._pending: dict[str, asyncio.Task[RecallResult]] = {}
        self._last: RecallResult | None = None
        super().__init__()

    def _schedule(self, messages: Messages) -> asyncio.Task[RecallResult] | None:
        if not self.memory_agent.config.enabled or not messages:
            return None
        key = _cycle_key(messages)
        task = self._pending.get(key)
        if task is None or task.done() and task.cancelled():
            task = asyncio.create_task(self.memory_agent.recall(list(messages)))
            self._pending[key] = task
            # Bound the map: keep only the most recent few cycles.
            for stale in list(self._pending)[:-4]:
                if self._pending[stale].done():
                    self._pending.pop(stale, None)
        return task

    @hook
    def _on_before_invocation(self, event: BeforeInvocationEvent) -> None:
        self._schedule(event.agent.messages)

    @hook
    def _on_message_added(self, event: MessageAddedEvent) -> None:
        if event.message.get("role") == "user":
            self._schedule(event.agent.messages)

    @hook
    def _on_after_tool(self, event: AfterToolCallEvent) -> None:
        self._schedule(event.agent.messages)

    @hook
    def _on_after_invocation(self, event: AfterInvocationEvent) -> None:
        for task in self._pending.values():
            if not task.done():
                task.cancel()
        self._pending.clear()

    async def render(self, context: InjectionContext) -> str | None:
        """Text to deliver before this model call, or ``None``. Never raises."""
        if not self.memory_agent.config.enabled:
            return None
        task = self._schedule(context.messages)
        if task is None:
            return None
        first_call = not any("toolResult" in block for m in context.messages for block in m.get("content", []))
        if not first_call and not task.done() and self._last is not None:
            # Mid-turn (after tool results): never stall the loop; reuse the latest recall
            # while the fresh one keeps warming for the next call.
            return self._format(self._last)
        try:
            result = await asyncio.wait_for(asyncio.shield(task), self.memory_agent.config.timeout_s)
        except asyncio.TimeoutError:
            logger.info("recall skipped | timeout after %.2fs", self.memory_agent.config.timeout_s)
            return self._format(self._last) if self._last is not None else None
        except Exception as error:  # noqa: BLE001 - fail open like the SDK injection middleware
            logger.warning("recall skipped | %s", error)
            return None
        self._last = result
        logger.info("recall | key=%s injected=%s latency=%.2fs", result.key, result.text is not None, result.latency_s)
        return self._format(result)

    @staticmethod
    def _format(result: RecallResult) -> str | None:
        if result.text is None:
            return None
        return f'<recall source="memory">\n{escape(result.text)}\n</recall>'

    def init_agent(self, agent: Agent) -> None:
        """Deliver recall as a separate ephemeral trailing user message (docs/panel-runtime.md)."""
        from dataclasses import replace

        from strands._middleware.stages import InvokeModelContext, InvokeModelStage

        async def deliver(context: InvokeModelContext) -> InvokeModelContext:
            if not any(m["role"] == "user" for m in context.messages):
                return context
            text = await self.render(InjectionContext(messages=list(context.messages), state=agent.state, agent=agent))
            if not text:
                return context
            return replace(context, messages=[*context.messages, {"role": "user", "content": [{"text": text}]}],
                           dynamic_trailing_blocks=context.dynamic_trailing_blocks + 1)

        agent._middleware_registry.add_middleware(InvokeModelStage.Input, deliver)


_agents: dict[str, MemoryAgent] = {}
_agents_guard = threading.Lock()


def memory_agent_for(user_id: str, memory_manager_factory: Callable[[], MemoryManager],
                     config: MemoryAgentConfig | None = None) -> MemoryAgent:
    """One shared memory agent per user: the single writer of that user's memory.

    Called from the synchronous composition root (offloaded to a thread) and from the
    ``/memory/dream`` endpoint, so the guard is a thread lock, not an asyncio one.
    """
    with _agents_guard:
        agent = _agents.get(user_id)
        if agent is None:
            agent = MemoryAgent(user_id=user_id, memory_manager=memory_manager_factory(),
                                config=config or MemoryAgentConfig.from_env())
            _agents[user_id] = agent
        return agent


def known_memory_agents() -> dict[str, MemoryAgent]:
    with _agents_guard:
        return dict(_agents)
