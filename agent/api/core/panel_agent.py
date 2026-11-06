"""Agent Panel construction via Strands experimental Agent Config.

``config_to_agent`` only maps JSON keys ``name``, ``model``, ``prompt``, and
string ``tools``. A bare string ``model`` selects Bedrock, so explicit
provider instances, native managers/plugins and the managed async tool catalog
are passed as constructor overrides. Config-file string tools are not loaded.

Composition configuration (read at construction):
* options: context=auto|agentic|sliding, tool_execution=concurrent|sequential,
  checkpointing=False, background=False, goal="". ``auto`` is ``ContextOffloader``
  plus ``SummarizingConversationManager`` (a fresh summarizer ``Agent`` on the
  panel model; the summary is written back into this thread's session).
  ``agentic`` is the native context-manager tools. ``sliding`` trims with
  ``SlidingWindowConversationManager`` and still offloads oversized tool results.
* PANEL_RETRY_MAX_ATTEMPTS/INITIAL_DELAY/MAX_DELAY override native 6/4/240.
* PANEL_SKILLS_DIR(S) enables AgentSkills; PANEL_SKILL_TOOLS is a JSON object
  mapping skill names to explicit tool-name arrays (including [] for no tools).
* PANEL_FORMATIONS_FILE is a JSON array of recursive specs. Each spec has name
  and type=agent|graph|swarm. Agents require system_prompt and tools (names).
  Graphs require nodes (node-id -> spec), edges ([[source,target],...]) and
  entry_points; swarms require children (agent specs). Optional native limits:
  execution_timeout, node_timeout, max_node_executions (graph), max_iterations
  and max_handoffs (swarm). The file replaces default formations, not think/review.
  MCP assignments use exact-name provider views that own a shared client consumer.
  Assignments must already be registered at construction; discovery is not a grant.
* root mcp.json supplies application-approved servers for on-demand activation.
  The browser's stdio factory installs accept_browser_elicitation before startup;
  other servers use native load_servers. Browser command/args/env/cwd support
  ${VAR} and ${env:VAR} references, failing on missing variables.

GoalLoop uses a separate judge model, no attempt/time cutoff and
preserve_context=True. SDK 1.56 checks optional budgets between validations, not as a
hard request deadline; it also validates pauses. The runtime's order-200 hook
prevents goal feedback from resuming a pause. Standalone construction installs
the same final-result gate, but does not provide the runtime's durable journal.

Docs:
- https://strandsagents.com/docs/user-guide/concepts/experimental/agent-config/index.md
- https://strandsagents.com/docs/user-guide/concepts/model-providers/openai-responses/index.md
- https://strandsagents.com/docs/user-guide/concepts/model-providers/mistral/index.md
- https://strandsagents.com/docs/user-guide/concepts/model-providers/google/index.md
- https://strandsagents.com/docs/integrations/model-providers/xai/index.md
"""

from __future__ import annotations

import json
import logging
import os

import httpx
from pathlib import Path
from collections.abc import Sequence
from typing import Any, Literal

from strands.agent.agent import Agent
from strands.experimental import config_to_agent
from strands.hooks import HookProvider
from strands.models.gemini import GeminiModel
from strands.tools import ToolProvider
from strands.tools.mcp import MCPClient
from strands.types.tools import AgentTool, ToolContext

from agent.api.core.render_ui_tool import render_ui_directive
from agent.api.core.config import DEFAULT_MEMORY_MODEL
from agent.api.core.config import (
    GEMINI_DEFAULT_MODEL,
    MISTRAL_DEFAULT_MODEL,
    PANEL_ENVIRONMENT_CONTEXT,
    PANEL_INTERVENTIONS,
    PANEL_TODOS,
    PERPLEXITY_API_BASE_URL,
    PERPLEXITY_DEFAULT_MODEL,
    PERPLEXITY_MAX_OUTPUT_TOKENS,
    XAI_COLLECTION_IDS,
    XAI_DEFAULT_MODEL,
    XAI_NATIVE_TOOLS_ENABLED,
)
from agent.api.core.perplexity_model import PerplexityResponsesModel
from agent.api.core.xai_model import RonXAIModel, XAIStatePruner
from agent.api.core.panel_browser import (
    BROWSERS,
    BrowserAvailabilityHook,
    browser_client_factory,
    browser_server_config,
    default_browser,
    is_browser_tool,
    server_name,
)
from agent.api.core.memory import MEMORY_DIRECTIVE, MemoryScope, live_memory_tools, memory_manager_config
from agent.api.core.panel_storage import ThreadSessionManager, get_user_session_storage, thread_agent_id
from agent.api.core.tool_observation import ToolObservation, trace_attributes
from agent.api.core.panel_tools import (
    ChildSpec, GraphSpec, ManagedMCP, MCPConnectionGuard, PanelToolCatalog, SwarmSpec, ThinkToolsGuard,
    build_core_tools, create_formation_tool,
    create_skill_tool, create_tool_catalog, load_vendored_think, skills_from_env,
)

logger = logging.getLogger(__name__)

ProviderName = Literal["perplexity", "xai", "mistral", "gemini", "openai", "anthropic"]
PROVIDERS: tuple[ProviderName, ...] = (
    "perplexity",
    "xai",
    "mistral",
    "gemini",
    "openai",
    "anthropic",
)
CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
#: Project tool library browsed/loaded by tool_catalog (never added to sys.path).
PROJECT_TOOLS_DIR = PROJECT_ROOT / "agent" / "tools" / "strands_tools"

def memory_aux_model_id() -> str:
    """The panel Agent's native ``aux_model`` (runs memory extraction): ``RON_MEMORY_MODEL``, read at
    construction so tests and operators can change it."""
    return os.getenv("RON_MEMORY_MODEL", "").strip() or DEFAULT_MEMORY_MODEL


#: Learned skills + create_harness specialists; appended to every panel-family prompt (text and Live).
SKILLS_AND_SPECIALISTS_DIRECTIVE = (
    "\nYou can learn workflows from the user's Teach a skill screen demonstration. "
    "Use list_learned_skills to discover this agent's saved skills, and use_skill to execute "
    "their ordered SOPs. New skills become available immediately, including in this session."
    "\nFor a recurring specialised job, build a specialist agent with create_harness (its tools, "
    "skills and MCP servers), recall saved specialists with list_harness_agents, and delegate to "
    "one with a2a_send_message at its a2a_url."
    "\nTo make a finished song, use lyria_generate_song (Lyria 3.5: full song with vocals and lyrics, "
    "or lyria-3-clip-preview for a 30 s clip; one shot, 1-3 minutes) or elevenlabs_compose_song "
    "(ElevenLabs Music v2.5; draft and agree a structure first with elevenlabs_composition_plan). "
    "Both save to the user's music library when they are signed in; tell them the title and length."
) + render_ui_directive()



# Hosted (server-side) tools live on the MODEL config, never in Agent.tools.
# Every entry below is grounded in (a) the provider's official docs and (b) what
# the INSTALLED Strands adapter actually sends/handles. Env overrides are comma
# lists; an explicitly EMPTY env value disables hosted tools for that provider.
OPENAI_DEFAULT_MODEL = "gpt-4o"
ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5"
OPENAI_REASONING_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")

# https://platform.openai.com/docs/guides/tools ; adapter: strands/models/openai_responses.py
# docstring L3-16 (web_search full incl. url citations; file_search/code_interpreter partial).
OPENAI_HOSTED_TOOLS = ("web_search", "file_search", "code_interpreter")
OPENAI_HOSTED_TOOLS_DEFAULT = ("web_search",)

# https://docs.perplexity.ai/docs/agent-api/tools/overview: every static member of the
# Agent API `Tool` union, always. They execute on Perplexity's side inside the request's
# own agentic loop; the adapter (PerplexityResponsesModel <- OpenAIResponsesModel) merges
# params["tools"] with function tools and re-emits their result items
# (search_results, fetch_url_results, sandbox_results, share_file, ...) as
# {"perplexity": ...} stream events for the panel. With sandbox enabled the model may
# also search/fetch from inside sandbox code via the preinstalled Perplexity SDK; those
# results then arrive as sandbox_results. Both paths are real and both are rendered.
PERPLEXITY_HOSTED_TOOLS = ("web_search", "image_search", "fetch_url", "people_search", "finance_search", "sandbox")
PERPLEXITY_HOSTED_TOOLS_DEFAULT = PERPLEXITY_HOSTED_TOOLS
PERPLEXITY_SEARCH_CONTEXT_SIZES = ("low", "medium", "high")
# Agent-API-only loop bound (docs: `max_steps`). Rides in extra_body on the wire.
PERPLEXITY_MAX_STEPS = int(os.getenv("PERPLEXITY_MAX_STEPS", "100"))
# Built-in Agent API skills attached to every Perplexity request
# (https://docs.perplexity.ai/docs/agent-api/skills): the `office` umbrella plus its
# four leaves so sandbox runs can author PDF/DOCX/PPTX/XLSX files with visual QA.
# A skill needs `max_steps` > 1 to load AND act; PERPLEXITY_MAX_STEPS covers that.
PERPLEXITY_BUILTIN_SKILLS: tuple[str, ...] = ("office", "office/pdf", "office/docx", "office/pptx", "office/xlsx")

# https://platform.claude.com/docs/en/agents-and-tools/tool-use/{web-search-tool,web-fetch-tool}
# Basic (non dynamic-filtering) versions: no allowed_callers/programmatic-tool-calling
# requirement, no beta header. Adapter: strands/models/anthropic.py `anthropic_tools`
# (appended alongside function tools, L505-509), handles server_tool_use /
# web_search_tool_result / web_fetch_tool_result blocks and pause_turn (L40-60, L979).
ANTHROPIC_HOSTED_TOOLS = {
    "web_search": {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
    "web_fetch": {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 5},
}
ANTHROPIC_HOSTED_TOOLS_DEFAULT = ("web_search", "web_fetch")

# https://ai.google.dev/gemini-api/docs/{google-search,url-context,code-execution,tool-combination}
GEMINI_HOSTED_TOOLS = ("google_search", "url_context", "code_execution")
GEMINI_HOSTED_TOOLS_DEFAULT = GEMINI_HOSTED_TOOLS

NATIVE_PROVIDER_CAPABILITIES = {
    "perplexity": {
        "adapter": "agent.api.core.perplexity_model.PerplexityResponsesModel (OpenAI Responses dialect)",
        "hosted_tools_configurable": PERPLEXITY_HOSTED_TOOLS,
        "hosted_tools_default": PERPLEXITY_HOSTED_TOOLS_DEFAULT,
        "env": "PERPLEXITY_HOSTED_TOOLS, PERPLEXITY_SEARCH_CONTEXT_SIZE",
        "hosted_tool_support": {
            "web_search": "sent as params.tools; url_citation annotations surfaced; search_results items ignored",
            "image_search": "sent as params.tools; image_search_results + response.reasoning.image_search_* streamed as native_tool",
            "fetch_url": "sent; fetch_url_results items ignored by adapter (model still sees them)",
            "sandbox": "sent; executed code/stdout not surfaced to the panel",
            "finance_search": "opt-in; docs require max_steps>=3 without a preset",
            "people_search": "opt-in",
            "mcp/connector": "not enabled; use the local mcp_client tool instead",
        },
        "stateful": False,
    },
    "openai": {
        "adapter": "strands.models.openai_responses.OpenAIResponsesModel",
        "hosted_tools_configurable": OPENAI_HOSTED_TOOLS,
        "hosted_tools_default": OPENAI_HOSTED_TOOLS_DEFAULT,
        "env": "OPENAI_HOSTED_TOOLS, OPENAI_VECTOR_STORE_IDS",
        "hosted_tool_support": {
            "web_search": "supported, including URL citations",
            "file_search": "partial: text only; file citation annotations omitted",
            "code_interpreter": "partial: text only; code and stdout/stderr omitted",
            "mcp": "partial adapter support; not enabled here",
            "image_generation": "unsupported by adapter",
            "computer_use_preview": "unsupported by adapter",
        },
        "stateful": False,
    },
    "anthropic": {
        "adapter": "strands.models.anthropic.AnthropicModel",
        "hosted_tools_configurable": tuple(ANTHROPIC_HOSTED_TOOLS),
        "hosted_tools_default": ANTHROPIC_HOSTED_TOOLS_DEFAULT,
        "env": "ANTHROPIC_HOSTED_TOOLS",
        "hosted_tool_support": {
            "web_search": "web_search_20250305 via anthropic_tools; result blocks + citations handled; pause_turn resumed",
            "web_fetch": "web_fetch_20250910 via anthropic_tools; result blocks handled",
            "code_execution": "adapter handles result blocks but not enabled (beta header not managed by adapter)",
        },
    },
    "gemini": {
        "adapter": "strands.models.gemini.GeminiModel",
        "hosted_tools_configurable": GEMINI_HOSTED_TOOLS,
        "hosted_tools_default": GEMINI_HOSTED_TOOLS_DEFAULT,
        "env": "GEMINI_HOSTED_TOOLS",
        "hosted_tool_support": {
            "google_search": "grounding via gemini_tools; grounding metadata not surfaced as citations",
            "url_context": "via gemini_tools",
            "code_execution": "via gemini_tools; executable_code/result parts not surfaced separately",
            "combination": "tool_config.include_server_side_tool_invocations=True required with function calling",
            "thinking": "thinking_config.include_thoughts=True -> reasoningContent deltas; thinking_level per GEMINI_THINKING_LEVELS_BY_MODEL",
        },
    },
    "xai": {
        "adapter": "agent.api.core.xai_model.RonXAIModel (strands_xai.xAIModel + one-state-blob history, input_too_large -> ContextWindowOverflowException)",
        "hosted_tools_configurable": ("web_search", "x_search", "code_execution", "collections_search"),
        "hosted_tools_default": ("web_search", "x_search", "code_execution"),
        "env": "XAI_NATIVE_TOOLS_ENABLED, XAI_COLLECTION_IDS",
        "hosted_tool_support": {
            "all": (
                "xai_tools (web_search with image search/understanding, x_search with image/video understanding, "
                "code_execution) + include=['inline_citations', 'web_search_call_output', 'x_search_call_output']; "
                "server tool calls/outputs and image results streamed as native_tool events; "
                "server tool state carried in encrypted reasoningContent"
            ),
        },
    },
    "mistral": {
        "adapter": "agent.api.core.mistral_model.RonMistralModel (strands MistralModel + reasoning_effort/thinking chunks, client.chat.stream)",
        "hosted_tools_configurable": (),
        "hosted_tools_default": (),
        "env": None,
        "hosted_tool_support": {
            "all": "none: Mistral documents web_search/web_search_premium/code_interpreter as Conversations/Agents API only, not /v1/chat/completions (https://docs.mistral.ai/studio/agents/agent-tools/websearch)",
            "reasoning": "reasoning_effort per MISTRAL_REASONING_EFFORTS_BY_MODEL; ThinkChunk deltas -> reasoningContent",
        },
    },
}


def _hosted_tool_names(env_name: str, allowed: tuple[str, ...], default: tuple[str, ...]) -> list[str]:
    """Comma list from env; unset -> default; set-but-empty -> none; unknown -> error."""
    raw = os.getenv(env_name)
    if raw is None:
        return list(default)
    names = list(dict.fromkeys(name.strip() for name in raw.split(",") if name.strip()))
    unknown = [name for name in names if name not in allowed]
    if unknown:
        raise ValueError(f"{env_name} supports only {', '.join(allowed)}; got {', '.join(unknown)}")
    return names

#: Per-model ``reasoning_effort`` support, from two agreeing sources:
#: https://docs.x.ai/docs/guides/reasoning (summary table) and the installed
#: strands_xai 0.6.1 ``xAIConfig.reasoning_effort`` docstring. Ordered lowest to
#: highest. ``xhigh`` needs xai-sdk >= 1.18 (pinned 1.19.0). On grok-4.5 xAI
#: treats ``xhigh`` as ``high``, so it is not offered there. grok-4.20-multi-agent
#: repurposes effort as agent count, and grok-build / grok-4.20-0309 snapshots
#: reject the parameter outright, so those return no efforts. Longest prefix wins.
XAI_REASONING_EFFORTS_BY_MODEL: dict[str, tuple[str, ...]] = {
    # grok-4.7: docs "grok-4.7, grok-4.6 and grok-4.5 support reasoning_effort ...
    # xhigh is available on grok-4.6 and later"; live 2026-10-09: none -> "This model
    # does not support reasoning_effort value none", low/medium/high/xhigh accepted.
    "grok-4.7": ("low", "medium", "high", "xhigh"),
    "grok-4.6": ("low", "medium", "high", "xhigh"),
    "grok-4.5": ("low", "medium", "high"),
    "grok-4.3": ("none", "low", "medium", "high"),
    "grok-4.20-multi-agent": (),
    "grok-4.20": (),
    "grok-build": (),
}

#: Per-model Mistral ``reasoning_effort`` values on ``POST /v1/chat/completions``.
#: Sources, which agree: https://docs.mistral.ai/studio/conversations/reasoning
#: (``mistral-small-latest`` / ``mistral-medium-3-5`` / ``mistral-large-4-0`` take
#: ``none``/``high``; ``zai-glm-5-3`` takes ``low``/``high``/``max``, never ``none``),
#: the installed ``mistralai`` 2.10.1 ``ReasoningEffort`` literal, and a live probe
#: of every id ``client.models.list()`` returned on 2026-10-09: every other
#: generation model answers ``400 "reasoning_effort is not enabled for this
#: model"`` (code 3051). Ordered lowest to highest. ``zai-glm-5-2`` (deprecated
#: 2026-09-29) accepts the whole enum live but Mistral documents no effort for it,
#: so it is left out and reports no efforts. ``max`` is not in the pinned SDK
#: literal, so ``MistralModel`` sends it through ``_MistralReasoningEffortHook``
#: (the SDK marshaller drops ``UnrecognizedStr`` values). Longest prefix wins.
MISTRAL_REASONING_EFFORTS_BY_MODEL: dict[str, tuple[str, ...]] = {
    "mistral-large-4": ("none", "high"),
    "mistral-medium": ("none", "high"),
    "mistral-small": ("none", "high"),
    "mistral-vibe-cli": ("none", "high"),
    "magistral-medium": ("none", "high"),
    "magistral-small": ("none", "high"),
    "zai-glm-5-3": ("low", "high", "max"),
    "zai-glm-5": ("low", "high", "max"),
    "zai-glm-latest": ("low", "high", "max"),
}

#: Mistral ids that match a family prefix above but reject the parameter live
#: (``mistral-large-latest`` -> ``mistral-large-2512`` = Mistral Large 3).
MISTRAL_REASONING_EFFORTS_EXCLUDED: tuple[str, ...] = (
    "mistral-large-2512",
    "mistral-large-latest",
    "mistral-large-3",
    "zai-glm-5-2",
    "glm-5-2",
)

#: Per-model Gemini ``thinking_config.thinking_level`` values on ``generateContent``.
#: Source: the "Controlling thinking" table at
#: https://ai.google.dev/gemini-api/docs/thinking plus the per-model pages for
#: the Nano Banana image models (``minimal``/``high``; Nano Banana 2.1 adds
#: ``medium``), confirmed live on 2026-10-09 with ``include_thoughts=True`` for
#: every flash id, the ``-latest`` aliases and ``gemini-robotics-er-2-preview``
#: (``MINIMAL`` is rejected with ``400 "Thinking level MINIMAL is not supported"``
#: exactly where the table omits it). TTS, transcribe and computer-use ids answer
#: ``400 "Thinking level is not supported for this model"`` and return no efforts.
#: Ordered lowest to highest. Longest prefix wins.
GEMINI_THINKING_LEVELS_BY_MODEL: dict[str, tuple[str, ...]] = {
    "gemini-3.8-flash": ("low", "medium", "high"),
    "gemini-3.7-flash": ("low", "medium", "high"),
    "gemini-3.6-flash": ("minimal", "low", "medium", "high"),
    "gemini-3.5-flash-lite": ("minimal", "low", "medium", "high"),
    "gemini-3.5-flash": ("minimal", "low", "medium", "high"),
    "gemini-3.1-pro-preview": ("low", "medium", "high"),
    "gemini-3.1-flash-lite-image": ("minimal", "high"),
    "gemini-3.1-flash-lite": ("minimal", "low", "medium", "high"),
    "gemini-3.1-flash-image": ("minimal", "high"),
    "gemini-3-flash-preview": ("minimal", "low", "medium", "high"),
    "gemini-3-pro-preview": ("low", "high"),
    # Nano Banana Pro: model page says thinking is supported but documents no
    # levels, and the Interactions image guide lists only 2.1 / 3.1 Flash Image /
    # 3.1 Flash Lite Image as level-configurable.
    "gemini-3-pro-image": (),
    "gemini-nano-banana-2.1": ("minimal", "medium", "high"),
    "gemini-2.5-pro": ("low", "medium", "high"),
    "gemini-2.5-flash-lite": ("low", "medium", "high"),
    "gemini-2.5-flash-image": (),
    "gemini-2.5-flash": ("low", "medium", "high"),
    "gemini-robotics-er-2-preview": ("minimal", "low", "medium", "high"),
    # Aliases: "Latest release of Gemini Flash/Flash-Lite/Pro" (models.list). Live:
    # flash-latest rejects MINIMAL (= 3.8 Flash), flash-lite-latest accepts all
    # four (= 3.5 Flash-Lite); pro-latest follows 3.1 Pro.
    "gemini-flash-lite-latest": ("minimal", "low", "medium", "high"),
    "gemini-flash-latest": ("low", "medium", "high"),
    "gemini-pro-latest": ("low", "medium", "high"),
}

#: Gemini ids that match a family prefix above but have no thinking control
#: (speech, transcription, image-only and computer-use surfaces).
GEMINI_THINKING_LEVELS_EXCLUDED_SUFFIXES: tuple[str, ...] = (
    "-tts",
    "-tts-preview",
    "-transcribe",
)

#: Documented popular Gemini models used when live listing is unavailable.
GEMINI_FALLBACK_MODELS = (
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
)

#: Documented Mistral example id used when live listing is unavailable.
MISTRAL_FALLBACK_MODELS = ("mistral-large-latest",)

_MISTRAL_PREFIXES = (
    "mistral",
    "magistral",
    "codestral",
    "pixtral",
    "ministral",
    "devstral",
    "open-mistral",
    "open-mixtral",
)


def config_path(provider: ProviderName) -> Path:
    path = CONFIG_DIR / f"{provider}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Agent config not found: {path}")
    return path


def provider_api_key(provider: ProviderName) -> str | None:
    from agent.api.core import config as app_config

    if provider == "perplexity":
        return app_config.PERPLEXITY_API_KEY if app_config.perplexity_agent_api_enabled() else None
    if provider in ("openai", "anthropic"):
        key_name = f"{provider.upper()}_API_KEY"
        return os.getenv(key_name) or getattr(app_config, key_name, None)
    return {
        "mistral": app_config.MISTRAL_API_KEY,
        "xai": app_config.XAI_API_KEY,
        "gemini": app_config.GEMINI_API_KEY,
    }[provider]


def provider_default_model(provider: ProviderName) -> str:
    if provider in ("openai", "anthropic"):
        from agent.api.core import config as app_config

        fallback = OPENAI_DEFAULT_MODEL if provider == "openai" else ANTHROPIC_DEFAULT_MODEL
        return (
            os.getenv(f"{provider.upper()}_MODEL")
            or getattr(app_config, f"{provider.upper()}_DEFAULT_MODEL", None)
            or fallback
        )
    return {
        "perplexity": PERPLEXITY_DEFAULT_MODEL,
        "mistral": MISTRAL_DEFAULT_MODEL,
        "xai": XAI_DEFAULT_MODEL,
        "gemini": GEMINI_DEFAULT_MODEL,
    }[provider]


def configured_providers() -> list[ProviderName]:
    return [name for name in PROVIDERS if provider_api_key(name)]


def infer_provider(model_id: str) -> ProviderName | None:
    """Guess a provider when the client omits ``provider``.

    Perplexity Agent API catalogue ids are ``vendor/model`` (e.g. ``xai/grok-4.5``).
    Native ids have no slash. Vendor-prefixed ids remain Perplexity catalogue ids.
    """
    if not model_id:
        ready = configured_providers()
        return ready[0] if ready else None
    if "/" in model_id:
        return "perplexity"
    lowered = model_id.lower()
    if lowered.startswith("claude-"):
        return "anthropic"
    if lowered.startswith(("gpt-", "chatgpt-", "o1", "o3", "o4")):
        return "openai"
    if lowered.startswith("gemini"):
        return "gemini"
    if lowered.startswith("grok"):
        return "xai"
    if any(lowered.startswith(prefix) for prefix in _MISTRAL_PREFIXES):
        return "mistral"
    ready = configured_providers()
    return ready[0] if ready else None


def xai_reasoning_efforts(model_id: str) -> tuple[str, ...]:
    """Documented ``reasoning_effort`` values for a Grok model id; empty if unsupported."""
    lowered = model_id.lower()
    for family in sorted(XAI_REASONING_EFFORTS_BY_MODEL, key=len, reverse=True):
        if lowered == family or lowered.startswith(family + "-"):
            return XAI_REASONING_EFFORTS_BY_MODEL[family]
    return ()


def xai_accepts_reasoning_effort(model_id: str) -> bool:
    return bool(xai_reasoning_efforts(model_id))


def _efforts_by_family(table: dict[str, tuple[str, ...]], model_id: str) -> tuple[str, ...]:
    """Longest-prefix lookup shared by the per-provider effort tables."""
    lowered = model_id.lower()
    for family in sorted(table, key=len, reverse=True):
        if lowered == family or lowered.startswith((family + "-", family + ".")):
            return table[family]
    return ()


def mistral_reasoning_efforts(model_id: str) -> tuple[str, ...]:
    """Documented ``reasoning_effort`` values for a Mistral model id; empty if the model rejects it."""
    lowered = model_id.lower()
    if lowered.startswith("ft:"):
        # Fine-tuned ids embed their base model: ft:<base>:<org>:<date>:<hash>.
        parts = lowered.split(":")
        lowered = parts[1] if len(parts) > 1 else lowered
    if lowered in MISTRAL_REASONING_EFFORTS_EXCLUDED:
        return ()
    return _efforts_by_family(MISTRAL_REASONING_EFFORTS_BY_MODEL, lowered)


def gemini_thinking_levels(model_id: str) -> tuple[str, ...]:
    """Documented ``thinking_level`` values for a Gemini model id; empty if the model has no thinking control."""
    lowered = model_id.lower().removeprefix("models/")
    if lowered.endswith(GEMINI_THINKING_LEVELS_EXCLUDED_SUFFIXES) or "computer-use" in lowered:
        return ()
    return _efforts_by_family(GEMINI_THINKING_LEVELS_BY_MODEL, lowered)


def _env_integer(name: str, default: int, *, minimum: int = 0) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        raise ValueError(f"{name} must be an integer >= {minimum}.") from None
    if value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}.")
    return value


def _native_client_args(provider: ProviderName) -> dict[str, Any]:
    key = provider_api_key(provider)
    if not key:
        raise ValueError(f"{provider.upper()}_API_KEY is not configured.")
    args: dict[str, Any] = {"api_key": key}
    # Native HTTP retries are separate from Agent(retry_strategy=...). Omit the
    # option by default to retain each installed client's own retry defaults.
    retry_env = f"{provider.upper()}_MAX_RETRIES"
    if os.getenv(retry_env) is not None:
        args["max_retries"] = _env_integer(retry_env, 2)
    return args


def openai_hosted_tools(model_id: str) -> list[dict[str, Any]]:
    """OpenAI Responses built-in tools (default: web_search). OPENAI_HOSTED_TOOLS overrides.

    file_search additionally requires OPENAI_VECTOR_STORE_IDS. Hosted tools are
    model params and never entries in Agent.tools. model_id is accepted for
    symmetry; OpenAI documents web_search on current models without a fixed list.
    """
    del model_id
    tools: list[dict[str, Any]] = []
    for name in _hosted_tool_names("OPENAI_HOSTED_TOOLS", OPENAI_HOSTED_TOOLS, OPENAI_HOSTED_TOOLS_DEFAULT):
        tool: dict[str, Any] = {"type": name}
        if name == "file_search":
            ids = [value.strip() for value in os.getenv("OPENAI_VECTOR_STORE_IDS", "").split(",") if value.strip()]
            if not ids:
                raise ValueError("OPENAI_VECTOR_STORE_IDS is required for file_search.")
            tool["vector_store_ids"] = ids
        elif name == "code_interpreter":
            tool["container"] = {"type": "auto"}
        tools.append(tool)
    return tools


def perplexity_hosted_tools() -> list[dict[str, Any]]:
    """Perplexity Agent API built-in tools; shapes per docs.perplexity.ai/docs/agent-api/tools."""
    size = os.getenv("PERPLEXITY_SEARCH_CONTEXT_SIZE", "medium").strip().lower()
    if size not in PERPLEXITY_SEARCH_CONTEXT_SIZES:
        raise ValueError("PERPLEXITY_SEARCH_CONTEXT_SIZE must be low, medium or high")
    tools: list[dict[str, Any]] = []
    for name in _hosted_tool_names("PERPLEXITY_HOSTED_TOOLS", PERPLEXITY_HOSTED_TOOLS, PERPLEXITY_HOSTED_TOOLS_DEFAULT):
        tool: dict[str, Any] = {"type": name}
        if name == "web_search":
            tool["search_context_size"] = size
        tools.append(tool)
    return tools


def anthropic_hosted_tools() -> list[dict[str, Any]]:
    """Anthropic server tools for the `anthropic_tools` adapter config (basic, non-beta versions)."""
    return [dict(ANTHROPIC_HOSTED_TOOLS[name]) for name in
            _hosted_tool_names("ANTHROPIC_HOSTED_TOOLS", tuple(ANTHROPIC_HOSTED_TOOLS), ANTHROPIC_HOSTED_TOOLS_DEFAULT)]


def gemini_hosted_tools() -> list[Any]:
    """Gemini built-in tools as genai Tool objects for the `gemini_tools` adapter config."""
    from google import genai

    builders = {
        "google_search": lambda: genai.types.Tool(google_search=genai.types.GoogleSearch()),
        "url_context": lambda: genai.types.Tool(url_context=genai.types.UrlContext()),
        "code_execution": lambda: genai.types.Tool(code_execution=genai.types.ToolCodeExecution()),
    }
    return [builders[name]() for name in
            _hosted_tool_names("GEMINI_HOSTED_TOOLS", GEMINI_HOSTED_TOOLS, GEMINI_HOSTED_TOOLS_DEFAULT)]


def build_model(
    provider: ProviderName,
    model_id: str,
    reasoning_effort: str | None = None,
    *, hosted_tools: bool = True,
) -> Any:
    """Construct the SDK (or community) model instance for ``provider``.

    Server-side tools stay on the model object, not on ``Agent.tools``.
    """
    if provider == "openai":
        client_args = _native_client_args(provider)
        from strands.models.openai_responses import OpenAIResponsesModel

        openai_params: dict[str, Any] = {}
        if reasoning_effort:
            # The installed OpenAI Reasoning schema restricts this field to
            # gpt-5/o-series. Its enum is NOT a per-model capability guarantee.
            if not model_id.startswith(("gpt-5", "o1", "o3", "o4")):
                raise ValueError("OpenAI reasoning_effort requires a gpt-5 or o-series model.")
            if reasoning_effort not in OPENAI_REASONING_EFFORTS:
                raise ValueError("Invalid OpenAI reasoning_effort.")
            openai_params["reasoning"] = {"effort": reasoning_effort}
        tools = openai_hosted_tools(model_id) if hosted_tools else []
        if tools:
            openai_params["tools"] = tools
        return OpenAIResponsesModel(
            client_args=client_args,
            model_id=model_id,
            stateful=False,
            **({"params": openai_params} if openai_params else {}),
        )

    if provider == "anthropic":
        client_args = _native_client_args(provider)
        from strands.models.anthropic import AnthropicModel

        if reasoning_effort:
            raise ValueError("Anthropic reasoning_effort is not configured; do not send OpenAI effort values.")
        kwargs: dict[str, Any] = {
            "client_args": client_args,
            "model_id": model_id,
            "max_tokens": _env_integer("ANTHROPIC_MAX_TOKENS", 8192, minimum=1),
        }
        hosted = anthropic_hosted_tools() if hosted_tools else []
        if hosted:
            kwargs["anthropic_tools"] = hosted
        return AnthropicModel(**kwargs)

    if provider == "perplexity":
        if not provider_api_key("perplexity"):
            raise ValueError("PERPLEXITY_API_KEY is not configured.")
        params: dict[str, Any] = {
            "max_steps": PERPLEXITY_MAX_STEPS,
            "skills": [{"type": "builtin", "name": name} for name in PERPLEXITY_BUILTIN_SKILLS],
        }
        if reasoning_effort:
            params["reasoning"] = {"effort": reasoning_effort}
        if model_id.startswith("anthropic/"):
            params["max_output_tokens"] = PERPLEXITY_MAX_OUTPUT_TOKENS
        hosted = perplexity_hosted_tools() if hosted_tools else []
        if hosted:
            params["tools"] = hosted
        return PerplexityResponsesModel(
            client_args={
                "api_key": provider_api_key("perplexity"),
                "base_url": PERPLEXITY_API_BASE_URL,
                # Reasoning/server-side tools can legitimately emit no bytes for
                # minutes. Do not abort them after 30s. An explicit positive env
                # override retains the retryable stall watchdog; 0 disables it.
                "timeout": httpx.Timeout(
                    _env_integer("PERPLEXITY_TIMEOUT", 120, minimum=1),
                    connect=10.0,
                    read=_env_integer("PERPLEXITY_READ_TIMEOUT", 0) or None,
                ),
                "max_retries": 0,  # retries belong to the Strands retry strategy, not the HTTP client
            },
            model_id=model_id,
            stateful=False,
            **({"params": params} if params else {}),
        )

    if provider == "mistral":
        if not provider_api_key("mistral"):
            raise ValueError("MISTRAL_API_KEY is not configured.")
        from agent.api.core.mistral_model import RonMistralModel

        if reasoning_effort:
            supported = mistral_reasoning_efforts(model_id)
            if reasoning_effort not in supported:
                raise ValueError(
                    f"{model_id} does not accept reasoning_effort={reasoning_effort!r}; "
                    + (f"supported: {', '.join(supported)}" if supported else "this model rejects the parameter")
                )
        return RonMistralModel(
            api_key=provider_api_key("mistral"),
            model_id=model_id,
            reasoning_effort=reasoning_effort or None,
        )

    if provider == "xai":
        if not provider_api_key("xai"):
            raise ValueError("XAI_API_KEY is not configured.")
        kwargs: dict[str, Any] = {
            "client_args": {"api_key": provider_api_key("xai")},
            "model_id": model_id,
        }
        if hosted_tools and XAI_NATIVE_TOOLS_ENABLED:
            from xai_sdk.tools import code_execution, collections_search, web_search, x_search

            xai_tools: list[Any] = [
                web_search(enable_image_understanding=True, enable_image_search=True),
                x_search(enable_image_understanding=True, enable_video_understanding=True),
                code_execution(),
            ]
            if XAI_COLLECTION_IDS:
                xai_tools.append(collections_search(collection_ids=XAI_COLLECTION_IDS))
            kwargs["xai_tools"] = xai_tools
            # https://docs.x.ai/developers/tools/citations ; strands_xai 0.6.1 `include` (L173/L402).
            kwargs["include"] = ["inline_citations", "web_search_call_output", "x_search_call_output"]
        if reasoning_effort:
            supported = xai_reasoning_efforts(model_id)
            if reasoning_effort not in supported:
                raise ValueError(
                    f"{model_id} does not accept reasoning_effort={reasoning_effort!r}; "
                    + (f"supported: {', '.join(supported)}" if supported else "this model rejects the parameter")
                )
            kwargs["reasoning_effort"] = reasoning_effort
        return RonXAIModel(**kwargs)

    if provider == "gemini":
        if not provider_api_key("gemini"):
            raise ValueError("GEMINI_API_KEY is not configured.")
        from google import genai

        thinking: dict[str, Any] = {"include_thoughts": True}
        if reasoning_effort:
            supported = gemini_thinking_levels(model_id)
            if reasoning_effort not in supported:
                raise ValueError(
                    f"{model_id} does not accept thinking_level={reasoning_effort!r}; "
                    + (f"supported: {', '.join(supported)}" if supported else "this model has no thinking control")
                )
            # google-genai ThinkingLevel enum values are upper-case (MINIMAL/LOW/MEDIUM/HIGH).
            thinking["thinking_level"] = reasoning_effort.upper()

        return GeminiModel(
            client_args={"api_key": provider_api_key("gemini")},
            model_id=model_id,
            gemini_tools=gemini_hosted_tools() if hosted_tools else [],
            params={
                # Gemini rejects built-in tools combined with function calling
                # unless this is set (400 INVALID_ARGUMENT). The adapter honours
                # an explicit tool_config in params over its tool_choice mapping.
                "tool_config": genai.types.ToolConfig(
                    include_server_side_tool_invocations=True,
                    function_calling_config=genai.types.FunctionCallingConfig(mode="AUTO"),
                ),
                # Stream thought summaries; the adapter maps part.thought=True to
                # reasoningContent deltas, which the panel renders as chain of thought.
                # thinking_level is the panel's reasoning effort for Gemini.
                "thinking_config": genai.types.ThinkingConfig(**thinking),
            },
        )

    raise ValueError(f"Unknown provider: {provider}")



class _MCPToolView(ToolProvider):
    """Exact registered-name grant with independent native consumer ownership.

    No callbacks, filters or caches on the shared client are mutated. A fresh
    child load filters the provider's current list again; newly advertised tools
    never expand this grant. Missing assigned tools fail construction.
    """

    def __init__(self, client: MCPClient, names: list[str]) -> None:
        self.client = client
        self.names = frozenset(names)

    def add_consumer(self, consumer_id: Any, **kwargs: Any) -> None:
        self.client.add_consumer((self, consumer_id), **kwargs)

    def remove_consumer(self, consumer_id: Any, **kwargs: Any) -> None:
        self.client.remove_consumer((self, consumer_id), **kwargs)

    async def load_tools(self, **kwargs: Any) -> list[AgentTool]:
        tools = [value for value in await self.client.load_tools(**kwargs) if value.tool_name in self.names]
        missing = self.names - {value.tool_name for value in tools}
        if missing:
            raise ValueError(f"Assigned MCP tools are no longer available: {sorted(missing)}")
        return tools


class _OwnedPanelCatalog(PanelToolCatalog):
    """Catalog that can release its native provider consumers when construction fails."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.consumers: set[Any] = set()

    def add_consumer(self, consumer_id: Any, **kwargs: Any) -> None:
        super().add_consumer(consumer_id, **kwargs)
        self.consumers.add(consumer_id)

    def remove_consumer(self, consumer_id: Any, **kwargs: Any) -> None:
        self.consumers.discard(consumer_id)
        super().remove_consumer(consumer_id, **kwargs)

    def close(self) -> None:
        for consumer in tuple(self.consumers):
            self.remove_consumer(consumer)


def _assigned_tools(agent: Agent, names: Any) -> tuple[Any, ...]:
    from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

    if not isinstance(names, list) or not all(isinstance(name, str) for name in names):
        raise ValueError("Tool assignments must be explicit arrays of registered tool names")
    selected = []
    mcp_assignments: dict[MCPClient, list[str]] = {}
    seen = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        if name in {"tool_catalog", "think", "run_skill", "skills",
                    "search_memory", "add_memory",
                    # Context manager (agentic) and context offloader (auto/sliding).
                    "retrieve_context", "summarize_context", "truncate_context", "pin_context",
                    "retrieve_offloaded_content"}:
            raise ValueError(f"Cannot assign parent-bound tool {name!r} to a child")
        value = agent.tool_registry.registry.get(name)
        if value is None:
            raise ValueError(f"Assigned tool {name!r} is not registered")
        # Plugin tools can capture their parent state; only catalog-owned local
        # tools and MCP providers are supported as explicit child capabilities.
        if name.startswith("strands_") or value.tool_type == "agent" or is_browser_tool(name):
            raise ValueError(f"Cannot assign parent-bound tool {name!r} to a child")
        if isinstance(value, MCPAgentTool):
            mcp_assignments.setdefault(value.mcp_client, []).append(value.tool_name)
        else:
            selected.append(value)
    selected.extend(_MCPToolView(client, names) for client, names in mcp_assignments.items())
    return tuple(selected)


def _formation_spec(raw: Any, agent: Agent) -> ChildSpec | GraphSpec | SwarmSpec:
    """Parse actual recursive graph topology, rejecting ambiguous assignments."""
    if not isinstance(raw, dict) or not isinstance(raw.get("name"), str) or not raw["name"]:
        raise ValueError("Each formation spec requires a nonempty name")
    kind, name = raw.get("type"), raw["name"]
    allowed = {
        "agent": {"system_prompt", "tools"},
        "graph": {"nodes", "edges", "entry_points", "execution_timeout", "node_timeout", "max_node_executions"},
        "swarm": {"children", "execution_timeout", "node_timeout", "max_handoffs", "max_iterations"},
    }
    if kind not in allowed:
        raise ValueError("Formation type must be agent, graph or swarm")
    if unknown := raw.keys() - {"type", "name"} - allowed[kind]:
        raise ValueError(f"Unknown {kind} spec fields: {sorted(unknown)}")
    if kind == "agent":
        if not isinstance(raw.get("system_prompt"), str) or "tools" not in raw:
            raise ValueError("Agent specs require system_prompt and explicit tools")
        return ChildSpec(name, raw["system_prompt"], _assigned_tools(agent, raw["tools"]))
    limits = {key: raw[key] for key in ("execution_timeout", "node_timeout") if key in raw}
    if kind == "swarm":
        children = tuple(_formation_spec(child, agent) for child in raw.get("children", []))
        if not children or any(not isinstance(child, ChildSpec) for child in children):
            raise ValueError("Swarm children must be nonempty agent specs")
        if len({child.name for child in children}) != len(children):
            raise ValueError("Swarm child names must be unique")
        limits.update({key: raw[key] for key in ("max_handoffs", "max_iterations") if key in raw})
        return SwarmSpec(name, children, **limits)
    if kind == "graph":
        nodes = raw.get("nodes")
        if not isinstance(nodes, dict) or not nodes:
            raise ValueError("Graph nodes must be a nonempty node-id mapping")
        edges, entries = raw.get("edges", []), raw.get("entry_points", [])
        if not isinstance(edges, list) or any(
            not isinstance(edge, list) or len(edge) != 2
            or any(not isinstance(key, str) or key not in nodes for key in edge) for edge in edges
        ):
            raise ValueError("Graph edges must reference existing node IDs")
        if not isinstance(entries, list) or not entries or any(
            not isinstance(key, str) or key not in nodes for key in entries
        ):
            raise ValueError("Graph entry_points must reference existing node IDs")
        if "max_node_executions" in raw:
            limits["max_node_executions"] = raw["max_node_executions"]
        return GraphSpec(name, {key: _formation_spec(value, agent) for key, value in nodes.items()},
                         tuple(tuple(edge) for edge in edges), tuple(entries), **limits)
    raise ValueError("Formation type must be agent, graph or swarm")


def _default_formations() -> list[GraphSpec | SwarmSpec]:
    research = ChildSpec("research", "Analyze the supplied material and identify evidence and uncertainties. "
                         "You have no local tools or filesystem access.", ())
    review = ChildSpec("review", "Critically review the supplied analysis and produce a concise synthesis. "
                       "You have no local tools or filesystem access.", ())
    graph = GraphSpec("research_review", {"research": research, "review": review},
                      (("research", "review"),), ("research",))
    swarm = SwarmSpec("reasoning_swarm", (research, review))
    nested = GraphSpec("nested_research_review", {"research_review": graph, "swarm": swarm},
                       (("research_review", "swarm"),), ("research_review",))
    return [graph, swarm, nested]


def user_memory_config(user_id: str, agent_scope: str = "panel", *, extraction: bool = True,
                       scope: MemoryScope | None = None) -> Any:
    """The user's memory (``core/memory.py``) plus the agent's read-only learned-skills store."""
    from agent.api.core.teaching import get_teaching_service

    return memory_manager_config(user_id, scope, extraction=extraction,
                                 extra_stores=[get_teaching_service().get_memory_store(user_id, agent_scope)])


def user_memory_tools(user_id: str, agent_scope: str = "panel", scope: MemoryScope | None = None) -> list[Any]:
    """``search_memory`` / ``add_memory`` over the same stores, for ``BidiAgent`` (no plugins)."""
    from agent.api.core.teaching import get_teaching_service

    return live_memory_tools(user_id, scope, extra_stores=[get_teaching_service().get_memory_store(user_id, agent_scope)])


def create_panel_agent(
    *,
    provider: ProviderName,
    model_id: str,
    session_id: str,
    user_id: str,
    system_prompt: str,
    extra_tools: list[Any],
    reasoning_effort: str | None = None,
    options: dict | None = None,
    runtime_options: dict | None = None,
    hooks: Sequence[HookProvider] = (),
    browser: str | None = None,
    agent_scope: str = "panel",
) -> Agent:
    """Compose a native 1.56 agent; callers offload this synchronous constructor.

    Runtime constructor overrides are trusted application objects. Their scalar
    values win; hooks/plugins are appended to application hooks/plugins. User
    options are only the five documented configuration fields above.
    """
    from strands import Agent, ModelRetryStrategy, tool
    from strands.agent.conversation_manager import SlidingWindowConversationManager, SummarizingConversationManager
    from strands.agent.conversation_manager.summarizing_conversation_manager import DEFAULT_SUMMARIZATION_PROMPT
    from strands.vended_plugins.context_offloader import ContextOffloader
    from strands.hooks.events import AfterInvocationEvent
    from strands.tools.executors import ConcurrentToolExecutor, SequentialToolExecutor
    from strands.tools.mcp.mcp_agent_tool import MCPAgentTool
    from strands.vended_plugins.goal import GoalLoop, JudgeConfig

    # Validate the browser target before any model/catalog construction.
    selected_browser = default_browser() if browser is None else browser
    if selected_browser not in BROWSERS:
        raise ValueError(f"browser must be one of {BROWSERS!r}, got {browser!r}")
    path = config_path(provider)
    options, runtime = dict(options or {}), dict(runtime_options or {})
    unknown = options.keys() - {"context", "tool_execution", "checkpointing", "background", "goal"}
    if unknown:
        raise ValueError(f"Unknown panel options: {sorted(unknown)}")
    context = options.get("context", "auto")
    execution = options.get("tool_execution", "concurrent")
    if context not in ("auto", "agentic", "sliding"):
        raise ValueError("context must be auto, agentic or sliding")
    if execution not in ("concurrent", "sequential"):
        raise ValueError("tool_execution must be concurrent or sequential")
    for key in ("checkpointing", "background"):
        if key in options and not isinstance(options[key], bool):
            raise ValueError(f"{key} must be a boolean")
    goal = options.get("goal", "")
    if not isinstance(goal, str) and not callable(goal):
        raise ValueError("goal must be text or an application validator")
    # Perplexity stream stalls are surfaced as throttles by the adapter; a short
    # first backoff keeps the visible pause brief. Other providers keep native 4s.
    retry = ModelRetryStrategy(
        max_attempts=_env_integer("PANEL_RETRY_MAX_ATTEMPTS", 6, minimum=1),
        initial_delay=_env_integer("PANEL_RETRY_INITIAL_DELAY", 1 if provider == "perplexity" else 4),
        max_delay=_env_integer("PANEL_RETRY_MAX_DELAY", 240),
    )
    clients = [value for value in extra_tools if isinstance(value, MCPClient)]
    if any(isinstance(value, MCPAgentTool) for value in extra_tools):
        raise ValueError("Pass the owning MCPClient in extra_tools, not unowned MCP tool references")
    local_tools = [value for value in extra_tools if not isinstance(value, MCPClient)]
    from agent.api.core.tool_repair import (
        RepairConfig, ToolRepairTrigger, adapt_tool, browser_server_env, revision_notice, revision_resolver,
    )

    repair_config = RepairConfig.from_env()
    # Exactly ONE browser MCP server is configured; it is staged on demand through
    # tool_catalog(action="load", name=<server>) with a prefixed, elicitation-accepting client.
    browser_server = server_name(selected_browser)
    catalog = _OwnedPanelCatalog(
        tools=local_tools, managed_mcp=[ManagedMCP(client) for client in clients],
        mcp_servers=browser_server_config(selected_browser),
        # This user's browser MCP server runs their active `server` repair (PYTHONPATH), if any.
        mcp_client_factories={browser_server: browser_client_factory(
            selected_browser, extra_env=(lambda: browser_server_env(user_id)) if repair_config.enabled else None)},
    )
    from agent.api.core.threads import ThreadProjection
    hooks = [*hooks, BrowserAvailabilityHook(selected_browser), ToolObservation()]
    if agent_scope != "document":
        # Mirrors this thread into Supabase (threads/thread_messages) on every message change; guests skipped.
        # Document Agent conversations belong to their page (document_conversations), not the thread list.
        hooks.append(ThreadProjection(user_id=user_id, session_id=session_id, destination=agent_scope, agent="chat", browser=selected_browser))
    if provider == "xai":
        # strands_xai appends the whole encrypted protobuf history to every assistant turn and
        # only ever reads the newest copy; keep one so history/snapshots/token estimates stay linear.
        hooks.append(XAIStatePruner())
    if repair_config.enabled:
        # Order 310 (after ToolObservation): starts a bounded investigation after repeated failures
        # (or one side-effecting failure). The process RepairService supplies its trigger among the
        # runtime hooks (chat._create_runtime_agent); without one (tests, standalone builds) a bare
        # trigger only records guidance.
        if not any(isinstance(hook, ToolRepairTrigger) for hook in runtime.get("hooks", [])):
            hooks.append(ToolRepairTrigger(repair_config, browser=selected_browser))
        # Dynamic loads honour this user's active repaired revisions (other users are unaffected):
        # `file` revisions replace the vendored module, `adapter` revisions wrap any tool (incl. MCP).
        catalog.set_revision_resolver(revision_resolver(user_id))
        catalog.set_tool_adapter(lambda value: adapt_tool(user_id, value))
    agent = None
    summarizer: Agent | None = None
    try:
        def model_factory(_name: str) -> Any:
            return build_model(provider, model_id, reasoning_effort)

        @tool(context=True)
        async def ask_user(question: str, tool_context: ToolContext) -> Any:
            """Ask the user a question and pause until a native interrupt response arrives.

            Args:
                question: Question to display to the user.
                tool_context: Native invocation context.
            """
            return tool_context.interrupt("ask_user", reason={"question": question})

        tools_dir = PROJECT_TOOLS_DIR
        core = build_core_tools(tools_dir)
        catalog.add_tools([*core, create_tool_catalog(catalog, tools_dir), ask_user])
        from agent.api.core.teaching import create_learned_skill_tools, get_teaching_service
        def skill_tools() -> list[Any]:
            available = list(agent.tool_registry.registry.values()) if agent is not None else [*core, *local_tools]
            excluded = {"use_skill", "list_learned_skills", "think", "ask_user", "tool_catalog", "create_harness"}
            return [value for value in available if value.tool_name not in excluded
                    and not value.tool_name.startswith("strands_") and not is_browser_tool(value.tool_name)]

        catalog.add_tools(create_learned_skill_tools(
            user_id, agent_scope, model_factory, additional_tools=skill_tools(), tool_supplier=skill_tools,
        ))
        system_prompt += SKILLS_AND_SPECIALISTS_DIRECTIVE
        storage = get_user_session_storage(user_id)
        # Native MemoryManager (core/memory.py): search_memory, add_memory, userTurn injection,
        # and facts extraction on aux_model (below).
        memory = user_memory_config(user_id, agent_scope)
        system_prompt += MEMORY_DIRECTIVE
        # Native A2A client tools over Ron's agents (panel A2A server + RON_A2A_AGENTS).
        from agent.api.core.a2a_tools import a2a_tools
        catalog.add_tools(a2a_tools())
        # Specialists built with strands_harness create_harness, stored in Supabase, served over A2A.
        from agent.api.core.harness_agents import create_harness_tools
        catalog.add_tools(create_harness_tools(user_id))
        # Batch music generation (Lyria 3.5 / Clip via the Interactions API, ElevenLabs Music); saves to the songs library.
        from agent.api.core.music_generation import music_generation_tools
        catalog.add_tools(music_generation_tools(user_id))
        # Native BeforeToolCallEvent cancel: an active mcp_client connection is never re-connected or re-loaded.
        plugins: list[Any] = [MCPConnectionGuard()]
        # Harness builtin plugins (strands_harness.plugins): Todos keeps the task list in
        # agent.state — session-snapshotted and re-injected before every model call — so a
        # stall-respawned instance resumes mid-task with its plan; EnvironmentContext injects
        # platform/date/cwd/AGENTS.md before each user turn.
        from strands_harness.plugins import EnvironmentContext, Todos
        if PANEL_TODOS:
            plugins.append(Todos())
        if PANEL_ENVIRONMENT_CONTEXT:
            plugins.append(EnvironmentContext())
        if repair_config.enabled:
            # userTurn note "<tool> was repaired and is active", once per live session (agent.state).
            plugins.append(revision_notice(user_id))
        if provider == "perplexity":
            catalog.add_tools([load_vendored_think(tools_dir)])
            plugins.append(ThinkToolsGuard())

        skills = skills_from_env()
        if skills is not None:
            plugins.append(skills)
        if goal:
            plugins.append(GoalLoop(goal=goal, judge=JudgeConfig(model=model_factory("goal-judge"))
                                    if isinstance(goal, str) else None,
                                    preserve_context=True))

        def pause_gate(event: AfterInvocationEvent) -> None:
            if event.result is None or event.result.stop_reason not in ("end_turn", "stop_sequence"):
                event.resume = None

        panel_model = model_factory("panel")
        kwargs: dict[str, Any] = {
            "model": panel_model, "system_prompt": system_prompt, "tools": [catalog],
            "agent_id": thread_agent_id(user_id),
            "session_manager": ThreadSessionManager(session_id, storage=storage),
            "storage": storage, "memory_manager": memory,
            "callback_handler": None, "load_tools_from_directory": False,
            # Copied by the SDK onto every agent/cycle/model/tool span (tool observation, CAT-49).
            "trace_attributes": trace_attributes(session_id=session_id, user_id=user_id),
            # ``agentic`` is the native ContextManager (summarize_context / truncate_context /
            # pin_context / retrieve_context). It ignores a co-provided conversation manager,
            # so the offloader and SummarizingConversationManager are the other two modes.
            "context_manager": "agentic" if context == "agentic" else False,
            "tool_executor": ConcurrentToolExecutor() if execution == "concurrent" else SequentialToolExecutor(),
            "retry_strategy": retry, "checkpointing": options.get("checkpointing", False),
            "background_tasks": False,
            # Native aux_model: memory extraction (and other side calls) on a fast model, not the
            # panel model. Unset, the SDK falls back to the panel model.
            "aux_model": (build_model("perplexity", memory_aux_model_id(), None, hosted_tools=False)
                          if provider_api_key("perplexity") else None),
        }
        if PANEL_INTERVENTIONS:
            # strands_harness intervention sugar ("ask" | "smart" | policy | .cedar) onto the
            # native Agent(interventions=...); ask=None parks flagged calls as interrupts.
            from strands_harness.interventions import resolve_interventions
            kwargs["interventions"] = resolve_interventions(PANEL_INTERVENTIONS)
        if context != "agentic":
            # Oversized tool results are stored on this user's session storage (namespaced
            # ``offloader``) and the native ``retrieve_offloaded_content`` tool reads them back.
            # https://strandsagents.com/docs/user-guide/sdk/plugins/context-offloader/index.md
            plugins.append(ContextOffloader(storage=storage))
        if context == "sliding":
            kwargs["conversation_manager"] = SlidingWindowConversationManager()
        elif context == "auto":
            # A separate Agent: SummarizingConversationManager invokes it with the messages to
            # fold. Calling the panel agent itself deadlocks on its invocation lock
            # (summarizing_conversation_manager.py). No session manager here — the SDK swaps this
            # agent's messages for the summary call, and a shared session would persist that swap.
            # The summary is written back onto the panel agent, which keeps this thread's session.
            # proactive_compression=True is the SDK default threshold (0.7).
            # https://strandsagents.com/docs/user-guide/sdk/agents/conversation-management/index.md
            summarizer = Agent(
                model=panel_model,
                system_prompt=DEFAULT_SUMMARIZATION_PROMPT,
                callback_handler=None,
                load_tools_from_directory=False,
            )
            kwargs["conversation_manager"] = SummarizingConversationManager(
                summarization_agent=summarizer,
                proactive_compression=True,
            )
        kwargs.update(runtime)
        kwargs["plugins"] = [*plugins, *runtime.get("plugins", [])]
        # Application hooks (e.g. browser availability) register before runtime hooks (order 200).
        kwargs["hooks"] = [*hooks, *runtime.get("hooks", [])]
        if repair_config.enabled:
            # Native ContextInjector tells the agent what to do about a failed tool (one reviewed
            # retry for idempotent tools, otherwise wait for the investigation; never repeat a
            # side-effecting action; call the tool again before claiming it is fixed).
            from agent.api.core.tool_failure import failure_guidance_injector
            kwargs["plugins"] = [*kwargs["plugins"], failure_guidance_injector()]
        # The catalog is the sole owner even when runtime overrides are supplied.
        kwargs["tools"] = [catalog]
        formations_file = os.getenv("PANEL_FORMATIONS_FILE")
        raw_formations = json.loads(Path(formations_file).expanduser().read_text()) if formations_file else None
        if raw_formations is not None and not isinstance(raw_formations, list):
            raise ValueError("PANEL_FORMATIONS_FILE must contain an array of formation specs")
        if raw_formations is not None and any(
            not isinstance(raw, dict) or not isinstance(raw.get("name"), str) or not raw["name"]
            for raw in raw_formations
        ):
            raise ValueError("Each formation spec requires a nonempty name")
        formation_names = [raw["name"] for raw in raw_formations] \
            if raw_formations is not None else [spec.name for spec in _default_formations()]
        if options.get("background") or kwargs["background_tasks"]:
            # All delegated children remain foreground-only. The native scheduler
            # still owns scheduling and always joins its background tools.
            background = kwargs["background_tasks"]
            background = dict(background) if isinstance(background, dict) else {}
            background.setdefault("agentic", ["*"])
            background["wait_for_completion"] = True
            # Meta/interactive/delegating tools stay foreground: they mutate the
            # registry, pause for the user, or run child agents.
            background["never"] = [*background.get("never", []), "tool_catalog", "mcp_client", "editor",
                "ask_user", "think", "run_skill", "programmatic_tool_caller", *formation_names]
            kwargs["background_tasks"] = background
        agent = config_to_agent(str(path), **kwargs)
        agent.add_hook(pause_gate, AfterInvocationEvent, order=200)
        catalog.bind(agent)
        delegated = []
        if skills is not None:
            assignments = json.loads(os.getenv("PANEL_SKILL_TOOLS", "{}"))
            if not isinstance(assignments, dict):
                raise ValueError("PANEL_SKILL_TOOLS must be a skill-name to tool-name-array object")
            available = {skill.name for skill in skills.get_available_skills(agent)}
            if assignments.keys() - available:
                raise ValueError("PANEL_SKILL_TOOLS references unavailable skills")
            delegated.append(create_skill_tool(skills=skills, model_factory=model_factory,
                tool_assignments={name: _assigned_tools(agent, names) for name, names in assignments.items()}))
        elif os.getenv("PANEL_SKILL_TOOLS"):
            raise ValueError("PANEL_SKILL_TOOLS requires PANEL_SKILLS_DIR(S)")
        formations = [_formation_spec(raw, agent) for raw in raw_formations] \
            if raw_formations is not None else _default_formations()
        for spec in formations:
            if isinstance(spec, ChildSpec):
                raise ValueError("Top-level formations must be graph or swarm specs")
            delegated.append(create_formation_tool(spec, model_factory=model_factory,
                description=f"Run the configured {spec.name} formation with explicitly assigned child tools."))
        names = [value.tool_name.replace("-", "_") for value in delegated]
        if len(set(names)) != len(names) or set(names) & {
            name.replace("-", "_") for name in agent.tool_registry.registry
        }:
            raise ValueError("Delegated tool names conflict with registered tools")
        agent.tool_registry.process_tools(delegated)
        return agent
    except BaseException:
        try:
            if agent is not None:
                agent.cleanup()
            # The summarizer is a separate Agent the panel does not own. Release it
            # whenever construction fails, including before the panel agent exists.
            if summarizer is not None:
                summarizer.cleanup()
        finally:
            catalog.close()
        raise


def default_selection() -> tuple[ProviderName, str] | None:
    ready = configured_providers()
    if not ready:
        return None
    provider = ready[0]
    return provider, provider_default_model(provider)


def _strip_model_prefix(name: str) -> str:
    return name.removeprefix("models/") if name.startswith("models/") else name


def list_provider_models(provider: ProviderName) -> list[dict[str, str]]:
    """Live catalogue for one provider. Raises on hard failures; callers log and skip."""
    if provider == "perplexity":
        raise RuntimeError("Perplexity catalogue is listed asynchronously in the chat endpoint.")

    if provider in ("openai", "anthropic"):
        if not provider_api_key(provider):
            return []
        if provider == "openai":
            from openai import OpenAI

            client = OpenAI(**_native_client_args(provider))
        else:
            from anthropic import Anthropic

            client = Anthropic(**_native_client_args(provider))
        models = []
        # Both SDK page objects iterate across pages. Never fabricate catalogue
        # entries on API failure or use the Perplexity catalogue for native keys.
        with client:
            for item in client.models.list():
                model_id = getattr(item, "id", "") or ""
                if provider == "openai" and not _is_openai_responses_candidate(model_id):
                    continue
                if provider == "anthropic" and not model_id.startswith("claude-"):
                    continue
                models.append({
                    "id": model_id,
                    "owned_by": getattr(item, "owned_by", None) or provider,
                    "provider": provider,
                })
        return models

    if provider == "xai":
        if not provider_api_key("xai"):
            return []
        from xai_sdk import Client

        client = Client(api_key=provider_api_key("xai"))
        models = []
        for item in client.models.list_language_models():
            model_id = _strip_model_prefix(getattr(item, "name", "") or "")
            if model_id:
                models.append({"id": model_id, "owned_by": "xai", "provider": "xai"})
        return models

    if provider == "gemini":
        if not provider_api_key("gemini"):
            return []
        from google import genai

        client = genai.Client(api_key=provider_api_key("gemini"))
        models = []
        for item in client.models.list():
            model_id = _strip_model_prefix(getattr(item, "name", "") or "")
            actions = getattr(item, "supported_actions", None) or []
            if not model_id.startswith("gemini"):
                continue
            if actions and "generateContent" not in actions:
                continue
            models.append({"id": model_id, "owned_by": "google", "provider": "gemini"})
        return models or [
            {"id": model_id, "owned_by": "google", "provider": "gemini"}
            for model_id in GEMINI_FALLBACK_MODELS
        ]

    if provider == "mistral":
        if not provider_api_key("mistral"):
            return []
        from mistralai.client import Mistral

        client = Mistral(api_key=provider_api_key("mistral"))
        payload = client.models.list()
        items = getattr(payload, "data", None) or []
        models = []
        for item in items:
            model_id = getattr(item, "id", None) or getattr(item, "name", None)
            if not model_id:
                continue
            owned_by = getattr(item, "owned_by", None) or "mistral"
            models.append({"id": str(model_id), "owned_by": str(owned_by), "provider": "mistral"})
        return models or [
            {"id": model_id, "owned_by": "mistral", "provider": "mistral"}
            for model_id in MISTRAL_FALLBACK_MODELS
        ]

    raise ValueError(f"Unknown provider: {provider}")


def _is_openai_responses_candidate(model_id: str) -> bool:
    """Catalogue heuristic, not a hosted-tool/effort compatibility guarantee.

    The OpenAI models endpoint exposes no Responses capability flag. Exclude
    known non-Responses families; the API remains authoritative for new ids.
    """
    return model_id.startswith(("gpt-4o", "gpt-4.1", "gpt-5", "o1", "o3", "o4")) and not any(
        marker in model_id
        for marker in (
            "realtime", "audio", "transcribe", "tts", "search", "chat", "instruct", "diarize",
            "o1-mini", "o1-preview",
        )
    )
