"""``recall``: deep, visible memory recall as a native harness subagent.

The panel agent already receives relevant memories on every model call through the SDK's
``MemoryInjectionConfig(trigger="everyTurn")``. ``recall`` is the model-driven complement: a
``strands_harness.make_subagent`` tool whose child is a fresh ``create_harness`` agent over the
user's memory stores wrapped read-only by ``strands_harness.memory.resolve_memory(writable=False)``
(the harness's own ``_ReadOnlyStore``: ``add``/``add_messages``/extraction/``get_tools`` dropped).
The child runs on a native ``ModelRouter`` of fast Perplexity Agent API models with
``FallbackStrategy`` and no retry backoff, and its events stream back as native
``ToolStreamEvent``s under the host tool-use id, which the panel renders as a chain of thought.

Every axis is ``Fixed``, so the model supplies only ``task``. Nothing the child does is written to
memory, the host conversation, the session or the journal.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from strands import Agent
from strands.memory import MemoryStore
from strands.models.routing import FallbackStrategy, ModelRouter
from strands.types.tools import AgentTool
from strands_harness import create_harness
from strands_harness.memory import resolve_memory
from strands_harness.tools import AgentSpec, Fixed, Preset, make_subagent

from agent.api.core.panel_agent import build_model
from agent.api.core.panel_storage import SerializedFileMemoryStore

logger = logging.getLogger(__name__)

#: Measured 2026-10-01 through the Perplexity Agent API (ttft 1.0-1.9 s). Declaration order is
#: FallbackStrategy's preference order; a candidate that keeps failing sinks below the rest.
DEFAULT_MODELS = ("google/gemini-3.5-flash-lite", "openai/gpt-5.4-nano", "perplexity/sonar",
                  "perplexity/nemotron-3-ultra-550b-a55b")

RECALL_TOOL_NAME = "recall"

RECALL_PROMPT = """You are Ron's memory librarian. You never talk to the user; you report to Ron.
You receive one task describing what Ron needs to remember right now. Search the user's long-term
memory and report what is relevant, terse and factual.

Use search_memories FIRST: it returns journal memories with topic, subject, created_at and tags, and
nests filters in whatever order helps (tags, topic, since/until, subject). Use search_memory for
anything else (consolidated notes, learned skills). Two or three searches is plenty.

Corrections resolve by recency: when two memories about the same subject disagree, the one with the
NEWEST created_at wins; inside a consolidated subject file the lowest line is the newest. Say which
memory you relied on. Never invent memories. Reply with bullets (each under 160 characters, keep the
<topic_name>/<subject> when present) or the literal text n/a when nothing relevant exists."""

RECALL_DESCRIPTION = (
    "Deep recall over the user's long-term memory. Give it a self-contained task (what Ron needs to "
    "remember and why) at the start of each task, before planning, and whenever a detail about the "
    "user, their preferences, to-dos, feedback or past statements would change the answer. It "
    "searches journal memories with nested filters and reports the relevant ones (newest wins)."
)

#: Factory returning the user's memory stores; called fresh per ``recall`` call.
StoresFactory = Callable[[], Sequence[MemoryStore]]


@dataclass(frozen=True)
class RecallConfig:
    models: tuple[str, ...] = DEFAULT_MODELS
    enabled: bool = True

    @classmethod
    def from_env(cls) -> RecallConfig:
        raw = os.getenv("RON_MEMORY_AGENT_MODELS", "")
        models = tuple(model.strip() for model in raw.split(",") if model.strip()) or DEFAULT_MODELS
        return cls(models=models, enabled=os.getenv("RON_MEMORY_AGENT", "1") != "0")


def _search_tools(stores: Sequence[MemoryStore]) -> list[AgentTool]:
    """The journal stores' own ``search_memories`` (search-only by construction).

    ``resolve_memory(writable=False)`` strips ``get_tools`` from the read-only view, so the
    store-native search tool is passed to the child explicitly.
    """
    return [tool for store in stores if isinstance(store, SerializedFileMemoryStore) for tool in store.get_tools()]


def create_recall_tool(stores_factory: StoresFactory, config: RecallConfig | None = None) -> AgentTool | None:
    """Build the ``recall`` subagent tool, or ``None`` when ``RON_MEMORY_AGENT=0``.

    Args:
        stores_factory: Returns the user's memory stores (the same ones the panel manager uses);
            called on every ``recall`` invocation so each child is a fresh agent over fresh
            read-only views.
        config: Model chain and enablement; defaults to the environment.
    """
    resolved = config or RecallConfig.from_env()
    if not resolved.enabled:
        return None

    def builder(spec: AgentSpec) -> Agent:
        stores = list(stores_factory())
        candidates = [build_model("perplexity", model_id, None, hosted_tools=False) for model_id in resolved.models]
        router = ModelRouter(candidates, strategy=FallbackStrategy())
        memory = resolve_memory(stores=stores, writable=False)
        logger.info("stores=<%s>, models=<%s> | building recall child",
                    ",".join(store.name for store in stores), ",".join(resolved.models))
        # Every built-in, plugin, session, skill, context manager and intervention is off: this
        # child only searches. retry_strategy=None: a failing candidate fails over immediately.
        from agent.api.core.a2a_tools import a2a_tools

        return create_harness(
            model=router, system_prompt=spec.instructions or RECALL_PROMPT, tools=[*_search_tools(stores), *a2a_tools()],
            memory=memory, builtin_tools=[], builtin_plugins=[], session=False, skills=False, caching=None,
            context_manager=False, background_tasks=False, interventions=None,
            callback_handler=None, load_tools_from_directory=False, retry_strategy=None, name="Ron Memory",
        )

    # The child's tools are pinned by the builder (the stores' search_memories plus the read-only
    # manager's search_memory); the Fixed axes only keep them out of the model-facing schema.
    child_tools = ["search_memories", "search_memory"]
    return make_subagent(
        builder=builder,
        presets={"memory": Preset(instructions=RECALL_PROMPT, tools=child_tools, description=RECALL_DESCRIPTION)},
        instructions=Fixed(RECALL_PROMPT),
        tools=Fixed(child_tools),
        mcp_servers=Fixed([]),
        model=Fixed(None),
        context=Fixed("none"),
        max_depth=1,
        name=RECALL_TOOL_NAME,
    )


__all__ = ["DEFAULT_MODELS", "RECALL_PROMPT", "RECALL_TOOL_NAME", "RecallConfig", "StoresFactory", "create_recall_tool"]
