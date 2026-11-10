"""Per-user tool repair (CAT-50/51) on native SDK, harness, evals and vendored-tool surfaces.

Tenant = ``user_id``. A repaired tool is a **user-scoped revision** stored under the user's HF
namespace (``panel/users/<sha256(user_id)>/tool-repairs/<tool>/``); other users keep importing
the vendored library file. There is no global activation and no maintainer promotion path.

Pipeline (each piece is a public surface that already exists in this repo):

1. ``ToolRepairTrigger`` (``AfterToolCallEvent``, order 310, after ``ToolObservation``) counts
   ``(tool_name, exception class)`` failures of **every** tool in one live session. At
   ``RON_TOOL_REPAIR_THRESHOLD`` — or at once for a side-effecting tool or a call whose parameters
   are not visible — it captures the evidence (tool spec, exact arguments, error, the user's
   current request, the surrounding messages, browser target) and **starts one bounded
   investigation** through :class:`RepairService` without awaiting it. Active investigations are
   deduplicated per ``(user, tool)``; cancelled calls, hook retries and the fixer's own tools never
   trigger. No approval is needed to investigate; nothing is applied without approval.
2. The fixer is one ``create_harness`` agent run in the background by ``RepairService`` (an
   asyncio task; one per ``(user, tool)``): a ``ModelRouter(FallbackStrategy)`` over the Perplexity
   chain, the harness built-ins ``shell``/``read``/``write``/``edit`` routed through the SDK
   ``Agent(sandbox=)`` seam (a per-run ``DockerSandbox`` when Docker works, otherwise the SDK local
   environment with real host paths), ``todos``/``environment``, read-only memory search and the
   application tools ``record_demonstration``/``submit_repair``. Its input is the native Agent SOP
   prompt; its stream renders as the panel's "Repair" chain; it ends with ``submit_repair``.
3. Diagnosis = ``strands_evals.detectors.diagnose_session`` over the in-memory exporter spans
   (``RON_TOOL_OBSERVATION=1``) or, without it, the ``agent.state`` outcomes — redacted by
   ``tool_observation.redact_outcome`` before anything leaves the session. The **wrapper audit**
   and the reflection checklist are SOP steps (``agent/sops/repairing-a-broken-tool.sop.md``,
   retrieved through the pinned ``strands_agents_sops`` server by ``native_sop_prompt``).
4. The panel's Approve is ``activate`` with the ``approval_token`` (bound to owner, base ``sha256``
   and artifact digest); it re-checks all of them, writes ``active.json`` and swaps the
   tool in every live session of that user via ``PanelToolCatalog.reload_tool`` (native
   ``ToolRegistry.replace``: effective at the SDK's next invocation). New sessions consult
   ``active.json`` through ``revision_resolver`` before importing a vendored file.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from strands import Agent, tool
from strands.multiagent.a2a._converters import convert_input_to_message
from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry
from strands.models.routing import FallbackStrategy, ModelRouter
from strands.types.tools import AgentTool
from strands.vended_plugins.context_injector import ContextInjector, InjectionContext
from strands_harness import create_harness
from strands_harness.memory import resolve_memory

from agent.api.core import config
from agent.api.core.native_sop import native_sop_prompt
from agent.api.core.panel_storage import _ScopedStorage, _user_scope, get_panel_storage
from agent.api.core.tool_observation import (
    OBSERVATION_HOOK_ORDER, file_sha256, is_library_tool, redact_outcome, tool_outcome, tool_source,
)

logger = logging.getLogger(__name__)

#: ``agent.state`` keys.
REPAIR_COUNTS_STATE_KEY = "panel.tool_repair.counts"      # {"<tool>|<ExceptionClass>": int}
REPAIR_REQUEST_STATE_KEY = "panel.tool_repair.request"     # the latest proposal (one at a time)
REPAIR_CONTEXT_STATE_KEY = "panel.tool_repair.context"     # per-tool recorded tool_use blocks
REPAIR_NOTICES_STATE_KEY = "panel.tool_repair.notices"     # revisions already announced to this session
REPAIR_HOOK_ORDER = OBSERVATION_HOOK_ORDER + 10
SOP_NAME = "repairing-a-broken-tool"
SOPS_DIR = Path(__file__).resolve().parents[2] / "sops"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
CORE_DIR = Path(__file__).resolve().parent
STORAGE_PREFIX = "tool-repairs"
MAX_CONTEXT_EXAMPLES = 4
MAX_CONTEXT_RECORDED = 12
#: Tools whose demonstrations must be dry runs (they change the outside world).
SIDE_EFFECT_TOOLS = frozenset({"shell", "editor", "environment", "mcp_client", "http_request", "use_skill"})
#: Native evals fix types plus Ron's own classification layered on top.
FIX_TYPES = ("SYSTEM_PROMPT_FIX", "TOOL_DESCRIPTION_FIX", "OTHERS", "WRAPPER_FIX")
#: ``submit_repair`` statuses plus the lifecycle statuses the service/activation write.
REVISION_STATUSES = ("proposed", "investigating", "verified", "failed", "unverified", "not_reproducible", "needs_maintainer",
                     "blocked", "cancelled", "declined", "active", "rolled_back")
_REV = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_TOOL = re.compile(r"^[A-Za-z0-9_]{1,80}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


#: The fixer's model: a strong coding model at maximum reasoning effort (not the recall chain).
DEFAULT_FIXER_MODELS = ("openai/gpt-6.1-sol",)
DEFAULT_FIXER_EFFORT = "max"
#: Server-side tool names the fixer may be given (Perplexity Agent API). Built-ins are enabled by
#: ``type``; ``connector_github`` is the managed GitHub connector (``type: connector``); ``context7`` is
#: Context7's remote MCP server (``type: mcp``, Streamable HTTP).
FIXER_HOSTED_BUILTINS = ("web_search", "fetch_url", "image_search", "sandbox", "finance_search", "people_search")
FIXER_HOSTED_NAMES = (*FIXER_HOSTED_BUILTINS, "connector_github", "context7")


def fixer_hosted_tools(names: Sequence[str] | None = None) -> list[dict[str, Any]]:
    """The ``tools`` array for the fixer's Perplexity request (server-side, on the MODEL params).

    Shapes follow docs.perplexity.ai/docs/agent-api/tools: built-ins ``{"type": <name>}`` (web_search
    with ``search_context_size``), the GitHub connector ``{"type": "connector", "id":
    "connector_github", "server_label": "github"}`` and Context7 ``{"type": "mcp", "server_label":
    "context7", "server_url": CONTEXT7_MCP_URL, "authorization": CONTEXT7_API_KEY}``. Connectors use
    deferred discovery, which ``PERPLEXITY_MAX_STEPS`` (100) comfortably covers.
    """
    raw = list(names) if names is not None else [n.strip() for n in config.RON_TOOL_REPAIR_HOSTED_TOOLS.split(",") if n.strip()]
    unknown = [n for n in raw if n not in FIXER_HOSTED_NAMES]
    if unknown:
        raise ValueError(f"RON_TOOL_REPAIR_HOSTED_TOOLS supports {', '.join(FIXER_HOSTED_NAMES)}; got {', '.join(unknown)}")
    size = os.getenv("PERPLEXITY_SEARCH_CONTEXT_SIZE", "medium").strip().lower()
    tools: list[dict[str, Any]] = []
    for name in dict.fromkeys(raw):
        if name == "connector_github":
            tools.append({"type": "connector", "id": "connector_github", "server_label": "github",
                          "server_description": "GitHub repositories, files, issues and pull requests of the connected account."})
        elif name == "context7":
            entry: dict[str, Any] = {"type": "mcp", "server_label": "context7", "server_url": config.CONTEXT7_MCP_URL,
                                     "defer_loading": False}
            if config.CONTEXT7_API_KEY:
                entry["authorization"] = config.CONTEXT7_API_KEY
            tools.append(entry)
        elif name == "web_search":
            tools.append({"type": "web_search", "search_context_size": size})
        else:
            tools.append({"type": name})
    return tools


def fixer_a2a_provider(urls: Sequence[str] | None = None) -> Any | None:
    """The installed ``strands_tools`` ``A2AClientToolProvider`` (``a2a_discover_agent``,
    ``a2a_list_discovered_agents``, ``a2a_send_message``) over the fixer's **own** peers only:
    ``urls`` / ``RON_TOOL_REPAIR_A2A_AGENTS``. The panel A2A server (``/a2a``, Ron's agent with host
    shell tools) is deliberately not a fixer peer: the fixer is isolated, and a peer that executes
    host tools on its behalf would defeat that. ``None`` when A2A is disabled or no peer is listed."""
    from agent.api.core.a2a_tools import _valid, a2a_enabled, a2a_provider

    if not a2a_enabled():
        return None
    raw = list(urls) if urls is not None else [u.strip() for u in config.RON_TOOL_REPAIR_A2A_AGENTS.split(",") if u.strip()]
    known: list[str] = []
    for url in raw:
        cleaned = url.strip().rstrip("/")
        if cleaned and _valid(cleaned) and cleaned not in known:
            known.append(cleaned)
    if not known:
        return None
    return a2a_provider(known)


@dataclass(frozen=True)
class RepairConfig:
    enabled: bool = True
    threshold: int = 2
    models: tuple[str, ...] = DEFAULT_FIXER_MODELS
    effort: str | None = DEFAULT_FIXER_EFFORT
    timeout_s: int = 900
    hosted_tools: tuple[str, ...] | None = None   # None -> RON_TOOL_REPAIR_HOSTED_TOOLS
    a2a_agents: tuple[str, ...] | None = None     # None -> RON_TOOL_REPAIR_A2A_AGENTS (fixer-only peers)
    #: Concurrent isolated investigations per API process (each one is a container).
    max_concurrent: int = 2

    @classmethod
    def from_env(cls) -> RepairConfig:
        raw = os.getenv("RON_TOOL_REPAIR_MODELS", "") or config.RON_TOOL_REPAIR_MODELS
        models = tuple(m.strip() for m in raw.split(",") if m.strip()) or DEFAULT_FIXER_MODELS
        effort = (os.getenv("RON_TOOL_REPAIR_EFFORT", config.RON_TOOL_REPAIR_EFFORT) or "").strip() or None
        threshold = int(os.getenv("RON_TOOL_REPAIR_THRESHOLD", str(config.RON_TOOL_REPAIR_THRESHOLD)))
        return cls(enabled=os.getenv("RON_TOOL_REPAIR", "1") != "0" and config.perplexity_agent_api_enabled(),
                   threshold=max(1, threshold), models=models,
                   effort=effort, timeout_s=int(os.getenv("RON_TOOL_REPAIR_TIMEOUT_S", str(config.RON_TOOL_REPAIR_TIMEOUT_S))),
                   max_concurrent=max(1, int(os.getenv("RON_TOOL_REPAIR_MAX_CONCURRENT", "2"))))


# --- Trigger ----------------------------------------------------------------------------------

def _exception_class(outcome: dict[str, Any]) -> str:
    exception = outcome.get("exception")
    if isinstance(exception, str) and exception:
        return exception.split(":", 1)[0]
    return str(outcome.get("status") or "error")


#: Where the failing tool lives. Every kind is repairable per user; the kind selects HOW
#: (``REPAIR_KINDS``): ``library`` -> a repaired copy of the vendored file (``file``); ``mcp`` ->
#: a repaired copy of the MCP server package run by this user's server process (``server``) or
#: an adapter; ``core``/``other`` -> an adapter (installed/plugin code is wrapped, not edited).
TARGET_KINDS = ("library", "mcp", "core", "other")
#: ``file``: swap the vendored module. ``adapter``: wrap the registered tool with the user's
#: ``transform_input``/``transform_result`` module (works for ANY tool, including MCP/browser).
#: ``server``: run this user's browser MCP server from a repaired copy of ``electron_playwright_mcp``.
REPAIR_KINDS = ("file", "adapter", "server")
MCP_SERVER_PACKAGE = "electron_playwright_mcp"
ADAPTER_HOOKS = ("transform_input", "transform_result")


def target_kind(tool: Any) -> str:
    """``library`` (vendored file), ``mcp`` (MCPAgentTool incl. browser tools), ``core`` (installed
    ``strands_tools`` host tool / any other importable file outside the library), ``other``
    (plugin/agent/harness tools without a source file)."""
    from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

    from agent.api.core.tool_observation import wrapped_chain

    if tool is None:
        return "other"
    if any(isinstance(item, MCPAgentTool) for item in wrapped_chain(tool)):
        return "mcp"
    if is_library_tool(tool):
        return "library"
    return "core" if tool_source(tool) is not None else "other"


def _record_context(agent: Agent, tool_use: dict[str, Any], outcome: dict[str, Any]) -> None:
    """Remember recent tool_use blocks per tool (most recent first) for context examples."""
    name = str(tool_use.get("name", ""))
    recorded = dict(agent.state.get(REPAIR_CONTEXT_STATE_KEY) or {})
    entries = list(recorded.get(name) or [])
    entries.insert(0, {"toolUseId": tool_use.get("toolUseId"), "input": tool_use.get("input", {}),
                       "status": outcome.get("status"), "exception": outcome.get("exception")})
    recorded[name] = entries[:MAX_CONTEXT_RECORDED]
    agent.state.set(REPAIR_CONTEXT_STATE_KEY, recorded)


#: Tools of the fixer itself, Ron's control tools and the fixer's harness built-ins: a failure of one
#: of these never starts an investigation (it would be fixer recursion or a Ron defect).
NON_REPAIRABLE_TOOLS = frozenset({
    "record_demonstration", "submit_repair", "todo_write", "read", "write", "edit",
    "tool_catalog", "ask_user", "retrieve_offloaded_content", "strands_manage_background_task",
    "a2a_discover_agent", "a2a_list_discovered_agents", "a2a_send_message",
})

#: Where investigation starts are delivered. The hook is synchronous and must not await the
#: investigation; it hands the captured evidence to this callable, which the service wires to
#: ``asyncio.create_task`` on the API loop.
StartInvestigation = Callable[["RepairEvidence"], Any]


@dataclass
class RepairEvidence:
    """What the trigger captured at the failure: everything the fixer needs, owner-scoped."""

    user_id: str
    session_id: str
    tool_name: str
    kind: str
    exception_class: str
    count: int
    failing_tool_use_id: str
    tool_use: dict[str, Any]              # the exact failing call (stays inside the owner's fixer)
    outcome: dict[str, Any]               # redacted (``redact_outcome``)
    error: str | None                     # exception text or tool error content
    tool_spec: dict[str, Any] | None
    current_request: str | None           # ``current_request_text(agent.messages)``
    messages: Sequence[Any]               # the session messages at the failure
    browser: str | None
    agent: Any                            # the originating agent (hooks/state); never run concurrently
    observation: bool
    side_effecting: bool
    captured_at: str = field(default_factory=_now)


def _error_text(event: AfterToolCallEvent, outcome: dict[str, Any]) -> str | None:
    if outcome.get("exception"):
        return str(outcome["exception"])
    result = event.result if isinstance(event.result, dict) else {}
    parts = [str(block.get("text")) for block in result.get("content", []) if isinstance(block, dict) and block.get("text")]
    return "\n".join(parts)[:2000] or None


#: Prefixes the native layers put on an input-validation failure *before* the tool body runs:
#: ``strands.tools.decorator.FunctionToolMetadata.validate_input`` and the MCP server
#: (``mcp/server/lowlevel/server.py``: ``Input validation error: ...``).
_PRE_EXECUTION_ERROR_PREFIXES = ("Validation failed for input parameters", "Input validation error:")


def input_validation_failure(tool: Any, tool_use: dict[str, Any], error: str | None) -> str | None:
    """Why this call never reached the tool body, or ``None`` if it (probably) did.

    A tool call whose arguments do not satisfy the tool's own input schema is rejected by the
    native decorator (``decorator.py``: ``validate_input`` raises ``ValueError`` and the body is
    skipped) or by the MCP server. That is a defect of the *call* — the model/stream delivered
    missing or malformed arguments — not of the tool, so it must not start a fixer. For a native
    decorated tool the decision is made by re-running its Pydantic input model on the exact
    arguments (authoritative, no string matching); the documented error prefixes are the fallback
    for MCP and module tools whose validation happens elsewhere.
    """
    from agent.api.core.tool_observation import wrapped_chain

    raw_input = tool_use.get("input")
    for candidate in wrapped_chain(tool):
        metadata = getattr(candidate, "_metadata", None)
        model = getattr(metadata, "input_model", None)
        if model is None or not hasattr(model, "model_validate"):
            continue
        try:
            model(**(raw_input if isinstance(raw_input, dict) else {}))
        except Exception as exc:  # pydantic ValidationError / TypeError on non-dict input
            return f"input rejected by the tool's schema before execution: {exc}"[:500]
        return None
    text = (error or "").strip()
    if text.startswith("Error: "):
        text = text[len("Error: "):]
    for prefix in _PRE_EXECUTION_ERROR_PREFIXES:
        if text.startswith(prefix):
            return f"input rejected before execution: {text}"[:500]
    return None


class ToolRepairTrigger(HookProvider):
    """Start one investigation when a tool keeps failing (or fails once with side effects).

    ``start`` is the service's non-blocking entry point (``RepairService.investigate``); without it
    the trigger only records guidance (tests, Live agents without a runtime).
    """

    def __init__(self, config_: RepairConfig | None = None, *, start: StartInvestigation | None = None,
                 browser: str | None = None, user_id: str | None = None, session_id: str | None = None) -> None:
        self.config = config_ or RepairConfig.from_env()
        self.start = start
        self.browser = browser
        self.user_id, self.session_id = user_id, session_id

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(AfterToolCallEvent, self.after_tool_call, order=REPAIR_HOOK_ORDER)

    def after_tool_call(self, event: AfterToolCallEvent) -> None:
        if not self.config.enabled:
            return
        outcome = tool_outcome(event)
        _record_context(event.agent, dict(event.tool_use), outcome)
        from agent.api.core.tool_failure import observe_tool

        failed = outcome["status"] != "success" or outcome["exception"] is not None
        if not failed or outcome["cancelled"] or outcome["retry"]:
            observe_tool(event, outcome, count=None)
            return
        name = outcome["tool_name"]
        if name in NON_REPAIRABLE_TOOLS:
            return
        tool_use = dict(event.tool_use)
        rejected = input_validation_failure(event.selected_tool, tool_use, _error_text(event, outcome))
        if rejected is not None:
            # The body never ran: missing/malformed arguments are a call (model/stream) defect, not a
            # tool defect. Record it for the agent and the observation span; never count it toward a
            # repair or start a fixer (a shell fixer for ``shell(command missing)`` repairs nothing).
            observe_tool(event, outcome, count=None, rejected=rejected)
            logger.warning("tool_name=<%s> | %s; no repair investigation", name, rejected)
            return
        kind = target_kind(event.selected_tool)
        key = f"{name}|{_exception_class(outcome)}"
        counts = dict(event.agent.state.get(REPAIR_COUNTS_STATE_KEY) or {})
        counts[key] = int(counts.get(key, 0)) + 1
        event.agent.state.set(REPAIR_COUNTS_STATE_KEY, counts)
        visible = isinstance(tool_use.get("input"), dict) and bool(tool_use.get("input"))
        side_effecting = is_side_effecting(name, tool_use.get("input"))
        # One more call is only ever suggested for an idempotent tool with visible parameters below
        # the threshold; a side-effecting tool (browser, shell, non-GET request) is never repeated
        # on the live environment: the investigation starts at the first failure.
        if counts[key] < self.config.threshold and visible and not side_effecting:
            observe_tool(event, outcome, count=counts[key], escalate=False)
            return
        existing = event.agent.state.get(REPAIR_REQUEST_STATE_KEY) or {}
        observe_tool(event, outcome, count=counts[key], escalate=True, side_effecting=side_effecting)
        if existing.get("tool_name") == name and existing.get("status") in ("investigating", "approval"):
            return  # one investigation per tool at a time; the result updates the guidance
        from agent.api.core.panel_tools import current_request_text

        spec = getattr(event.selected_tool, "tool_spec", None)
        # BidiAgent has no trace_attributes; the Live trigger carries the identity explicitly.
        traces = dict(getattr(event.agent, "trace_attributes", None) or {})
        evidence = RepairEvidence(
            user_id=str(self.user_id or traces.get("user.id") or ""),
            session_id=str(self.session_id or traces.get("session.id") or ""),
            tool_name=name, kind=kind, exception_class=_exception_class(outcome), count=counts[key],
            failing_tool_use_id=outcome["toolUseId"], tool_use=tool_use,
            outcome=redact_outcome(outcome, tool_use), error=_error_text(event, outcome),
            tool_spec={"name": spec.get("name"), "description": spec.get("description"), "inputSchema": spec.get("inputSchema")}
            if isinstance(spec, dict) else None,
            current_request=current_request_text(list(event.agent.messages)), messages=list(event.agent.messages),
            browser=self.browser, agent=event.agent,
            observation=bool(os.getenv("RON_TOOL_OBSERVATION", "").strip().lower() in {"1", "true", "yes"}),
            side_effecting=side_effecting,
        )
        event.agent.state.set(REPAIR_REQUEST_STATE_KEY, {
            "id": uuid.uuid4().hex, "tool_name": name, "exception_class": evidence.exception_class, "kind": kind,
            "count": counts[key], "status": "investigating" if self.start else "proposed", "proposed_at": evidence.captured_at,
            "failing_tool_use_id": outcome["toolUseId"], "outcome": evidence.outcome, "observation": evidence.observation,
        })
        logger.warning("tool_name=<%s>, kind=<%s>, count=<%d> | tool failure, investigation %s", name, kind, counts[key],
                       "started" if self.start else "recorded (no repair service)")
        if self.start is not None:
            self.start(evidence)


def pending_proposal(agent: Agent) -> dict[str, Any] | None:
    """The latest repair request on the agent (``proposed`` or ``investigating``), or ``None``."""
    request = agent.state.get(REPAIR_REQUEST_STATE_KEY)
    return dict(request) if isinstance(request, dict) and request.get("status") in ("proposed", "investigating") else None


# --- Context examples -------------------------------------------------------------------------

def select_context_examples(messages: Sequence[dict[str, Any]], tool_name: str, *, n: int = MAX_CONTEXT_EXAMPLES,
                            exclude_tool_use_id: str | None = None) -> list[dict[str, Any]]:
    """Other ``toolUse`` blocks for ``tool_name`` in this user's session, most recent first.

    Each entry is ``{kind: "context", input, toolUseId, dry_run, source: "session"}``; when fewer
    than ``n`` exist the caller (the fixer) must synthesize the remainder from the tool's own input
    schema and label them ``synthetic``.
    """
    found: list[dict[str, Any]] = []
    for message in reversed(list(messages)):
        for block in message.get("content", []) if isinstance(message, dict) else []:
            use = block.get("toolUse") if isinstance(block, dict) else None
            if not isinstance(use, dict) or use.get("name") != tool_name:
                continue
            if exclude_tool_use_id and use.get("toolUseId") == exclude_tool_use_id:
                continue
            found.append({"kind": "context", "source": "session", "toolUseId": use.get("toolUseId"),
                          "input": use.get("input", {}), "dry_run": is_side_effecting(tool_name, use.get("input"))})
            if len(found) >= n:
                return found
    return found


def is_side_effecting(tool_name: str, tool_input: Any) -> bool:
    """Side-effecting calls are demonstrated as dry runs (assert the constructed call, never run it)."""
    from agent.api.core.panel_browser import is_browser_tool

    if is_browser_tool(tool_name) or tool_name.startswith("strands_"):
        return True
    if tool_name == "http_request":
        method = str((tool_input or {}).get("method", "GET")).upper() if isinstance(tool_input, dict) else "GET"
        return method != "GET"
    return tool_name in SIDE_EFFECT_TOOLS


# --- Storage layout ---------------------------------------------------------------------------

def repair_storage(user_id: str) -> Any:
    """``_ScopedStorage`` rooted at the user's ``tool-repairs/`` namespace (HF in production)."""
    return _ScopedStorage(get_panel_storage(), f"{_user_scope(user_id)}/{STORAGE_PREFIX}")


def _tool_key(tool_name: str) -> str:
    if not _TOOL.match(tool_name):
        raise ValueError("Invalid tool name")
    return tool_name


def _rev_key(rev: str) -> str:
    if not _REV.match(rev):
        raise ValueError("Invalid revision id")
    return rev


def new_revision_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dt%H%M%S") + "-" + uuid.uuid4().hex[:6]


async def read_manifest(user_id: str, tool_name: str, rev: str) -> dict[str, Any] | None:
    data = await repair_storage(user_id).read(f"{_tool_key(tool_name)}/{_rev_key(rev)}/manifest.json")
    return json.loads(data) if data else None


async def write_manifest(user_id: str, manifest: dict[str, Any]) -> None:
    tool_name, rev = _tool_key(manifest["tool_name"]), _rev_key(manifest["revision"])
    await repair_storage(user_id).write(f"{tool_name}/{rev}/manifest.json",
                                        json.dumps(manifest, ensure_ascii=False, indent=2).encode())


async def write_revision_files(user_id: str, tool_name: str, rev: str, files: dict[str, bytes]) -> None:
    storage = repair_storage(user_id)
    for relative, data in files.items():
        if not relative or relative.startswith("/") or ".." in Path(relative).parts:
            raise ValueError("Revision file paths must be relative and inside the revision")
        await storage.write(f"{_tool_key(tool_name)}/{_rev_key(rev)}/{relative}", data)


async def read_active(user_id: str, tool_name: str) -> dict[str, Any] | None:
    data = await repair_storage(user_id).read(f"{_tool_key(tool_name)}/active.json")
    return json.loads(data) if data else None


async def list_repairs(user_id: str, tool_name: str | None = None) -> list[dict[str, Any]]:
    storage = repair_storage(user_id)
    keys = await storage.list(_tool_key(tool_name) if tool_name else "")
    manifests: list[dict[str, Any]] = []
    actives: dict[str, dict[str, Any]] = {}
    for key in keys:
        if key.endswith("/manifest.json"):
            data = await storage.read(key)
            if data:
                manifests.append(json.loads(data))
        elif key.endswith("/active.json"):
            data = await storage.read(key)
            if data:
                actives[key.split("/", 1)[0]] = json.loads(data)
    for manifest in manifests:
        active = actives.get(manifest["tool_name"])
        manifest["active"] = bool(active and active.get("revision") == manifest["revision"])
    manifests.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return manifests


def _active_dir(user_id: str) -> Path:
    return config.SESSION_STORAGE_DIR / "repairs" / "active" / _user_scope(user_id).rsplit("/", 1)[-1]


async def materialize_revision(user_id: str, tool_name: str, rev: str) -> Path:
    """Copy the revision's ``files/`` out of storage so the import machinery can load it by path.

    Returns the path of the repaired tool file. The copy lives under
    ``SESSION_STORAGE_DIR/repairs/active/<scope>/<tool>/<rev>/`` (never in the library tree).
    """
    manifest = await read_manifest(user_id, tool_name, rev)
    if manifest is None:
        raise FileNotFoundError(f"Unknown revision {rev!r} for {tool_name!r}")
    storage = repair_storage(user_id)
    prefix = f"{_tool_key(tool_name)}/{_rev_key(rev)}/"
    target_root = _active_dir(user_id) / tool_name / rev
    for key in await storage.list(prefix):
        relative = key[len(prefix):]
        if not any(relative.startswith(f"{folder}/") for folder in ("files", "adapter", "server", "tests")):
            continue
        data = await storage.read(key)
        if data is None:
            continue
        target = target_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(target.write_bytes, data)
    repair_kind = manifest.get("repair_kind", "file")
    if repair_kind == "file":
        written = target_root / "files" / str(manifest.get("source_path") or "")
        if not manifest.get("source_path") or not written.is_file():
            raise FileNotFoundError(f"Revision {rev!r} has no file for {manifest.get('source_path')!r}")
        return written
    if repair_kind == "adapter":
        written = target_root / "adapter" / f"{tool_name}.py"
        if not written.is_file():
            raise FileNotFoundError(f"Revision {rev!r} has no adapter module")
        return written
    server_dir = target_root / "server"
    if not (server_dir / MCP_SERVER_PACKAGE).is_dir():
        raise FileNotFoundError(f"Revision {rev!r} has no repaired {MCP_SERVER_PACKAGE} package")
    return server_dir


def _read_marker(user_id: str, tool_name: str) -> dict[str, Any] | None:
    marker = _active_dir(user_id) / tool_name / "active.json"
    if not marker.is_file():
        return None
    try:
        return json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def active_revision_file(user_id: str, tool_name: str, vendored_path: Path) -> Path | None:
    """Synchronous lookup used by the catalog loader: the materialized active ``file`` revision."""
    active = _read_marker(user_id, tool_name)
    if active is None or active.get("repair_kind", "file") != "file":
        return None
    candidate = _active_dir(user_id) / tool_name / str(active.get("revision", "")) / "files" / str(active.get("source_path", ""))
    return candidate if active.get("source_path") and candidate.is_file() else None


def active_adapter_file(user_id: str, tool_name: str) -> tuple[Path, str] | None:
    """The materialized active ``adapter`` module for a tool, if any: ``(path, revision)``."""
    active = _read_marker(user_id, tool_name)
    if active is None or active.get("repair_kind") != "adapter":
        return None
    candidate = _active_dir(user_id) / tool_name / str(active.get("revision", "")) / "adapter" / f"{tool_name}.py"
    return (candidate, str(active.get("revision"))) if candidate.is_file() else None


def active_server_dirs(user_id: str) -> list[Path]:
    """Materialized ``server`` revisions active for this user (newest first): directories that
    contain a repaired ``electron_playwright_mcp`` package, to be put on the user's server PYTHONPATH."""
    root = _active_dir(user_id)
    found: list[tuple[str, Path]] = []
    if root.is_dir():
        for marker in root.glob("*/active.json"):
            try:
                active = json.loads(marker.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if active.get("repair_kind") != "server":
                continue
            server_dir = marker.parent / str(active.get("revision", "")) / "server"
            if (server_dir / MCP_SERVER_PACKAGE).is_dir():
                found.append((str(active.get("activated_at", "")), server_dir))
    return [path for _, path in sorted(found, reverse=True)]


def browser_server_env(user_id: str) -> dict[str, str]:
    """Extra env for THIS user's browser MCP server process: the repaired package first on PYTHONPATH."""
    dirs = active_server_dirs(user_id)
    if not dirs:
        return {}
    return {"PYTHONPATH": os.pathsep.join(str(path) for path in dirs)}


def adapt_tool(user_id: str, tool: AgentTool) -> AgentTool:
    """Wrap ``tool`` with this user's active adapter revision, if one exists (idempotent)."""
    if isinstance(tool, _AdaptedTool):
        return tool
    found = active_adapter_file(user_id, tool.tool_name)
    if found is None:
        return tool
    path, revision = found
    return _AdaptedTool(tool, load_adapter(path), revision)


def revision_resolver(user_id: str) -> Callable[[str, Path], Path | None]:
    return lambda name, path: active_revision_file(user_id, name, path)


def _write_active_marker(user_id: str, tool_name: str, active: dict[str, Any] | None) -> None:
    marker = _active_dir(user_id) / tool_name / "active.json"
    marker.parent.mkdir(parents=True, exist_ok=True)
    if active is None:
        marker.unlink(missing_ok=True)
    else:
        marker.write_text(json.dumps(active), encoding="utf-8")


# --- Diagnosis --------------------------------------------------------------------------------

async def diagnose(session_id: str, *, model: Any) -> dict[str, Any] | None:
    """``strands_evals`` diagnosis over the in-memory exporter (requires ``RON_TOOL_OBSERVATION=1``).

    Returns the ``DiagnosisResult`` as JSON, or ``None`` when no spans are retained for the session.
    ``diagnose_session`` is synchronous (``detect_failures`` -> ``analyze_root_cause``), so it runs
    in a worker thread.
    """
    from agent.api.core.tool_observation import setup_evals_exporter

    exporter = setup_evals_exporter()
    if exporter is None:
        return None
    from strands_evals.detectors import diagnose_session
    from strands_evals.mappers import StrandsInMemorySessionMapper

    spans = [span for span in exporter.get_finished_spans()
             if span.attributes and str(span.attributes.get("session.id", "")) == session_id]
    if not spans:
        return None
    session = StrandsInMemorySessionMapper().map_to_session(spans, session_id)
    result = await asyncio.to_thread(diagnose_session, session, model=model)
    return result.model_dump(mode="json")


def route_fix(fix_type: str, *, source_path: str | None, kind: str = "library") -> str:
    """CAT-51 routing: which outcome a classified fix leads to.

    ``repair``: a user-scoped revision (file, adapter or server, see ``REPAIR_KINDS``) — every
    target kind qualifies. ``needs_maintainer`` only when nothing user-scoped can carry the fix: a
    provider system prompt (``configs/*.json``) or a defect in Ron's own wrapper code (``core/*``)
    that an adapter cannot sit in front of.
    """
    if fix_type not in FIX_TYPES:
        raise ValueError(f"fix_type must be one of {FIX_TYPES}")
    if kind not in TARGET_KINDS:
        raise ValueError(f"kind must be one of {TARGET_KINDS}")
    if fix_type == "SYSTEM_PROMPT_FIX":
        return "needs_maintainer"
    if fix_type == "WRAPPER_FIX":
        return "repair" if source_path and not Path(source_path).is_absolute() and not source_path.startswith("core/") \
            else "needs_maintainer"
    return "repair"


# --- Fixer run --------------------------------------------------------------------------------

@dataclass
class RepairRun:
    user_id: str
    session_id: str
    tool_name: str
    revision: str
    workspace: Path
    manifest: dict[str, Any]
    demonstrations: list[dict[str, Any]] = field(default_factory=list)
    submitted: bool = False
    sandbox: str = "none"
    container: str | None = None


#: One Docker container per fixer run; the harness's built-in shell/read/write/edit route through it.
#: ``deploy/repair-replica/`` builds the versioned Ron replica image (Ubuntu, Python, Node, Electron,
#: Xvfb, both halves of electron-playwright-mcp); ``python:3.12-slim`` is the minimal fallback that
#: still verifies pure-Python library tools.
SANDBOX_IMAGE = os.getenv("RON_TOOL_REPAIR_SANDBOX_IMAGE", "python:3.12-slim")
SANDBOX_WORKDIR = "/workspace"
#: Per-container bounds (``docker run`` flags). The sandbox never joins the host network: the
#: replica's own automation listeners live inside its network namespace, so a repaired call cannot
#: reach the user's live Electron, the API or the Docker socket.
SANDBOX_LIMITS = {
    "memory": os.getenv("RON_TOOL_REPAIR_SANDBOX_MEMORY", "4g"),
    "cpus": os.getenv("RON_TOOL_REPAIR_SANDBOX_CPUS", "2"),
    "pids": os.getenv("RON_TOOL_REPAIR_SANDBOX_PIDS", "512"),
    "network": os.getenv("RON_TOOL_REPAIR_SANDBOX_NETWORK", "bridge"),
    "shm": os.getenv("RON_TOOL_REPAIR_SANDBOX_SHM", "1g"),
}


def _mount_sources(run: RepairRun) -> list[tuple[Path, str, bool]]:
    """``(host_path, container_path, read_only)`` binds: the repair workspace writable at /workspace,
    everything the fixer may read (library, Ron's core, installed strands_tools, the MCP server
    package) read-only under /sources."""
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR

    binds = [(run.workspace, SANDBOX_WORKDIR, False), (PROJECT_TOOLS_DIR, "/sources/tools", True)]
    for name, path in fixer_sources().items():
        binds.append((path, f"/sources/{name}", True))
    return binds


def sandbox_run_args(run: RepairRun, container: str) -> list[str]:
    """The ``docker run`` command for one investigation's container (bounded, no host network)."""
    args = ["docker", "run", "-d", "--rm", "--name", container, "-w", SANDBOX_WORKDIR,
            "--memory", SANDBOX_LIMITS["memory"], "--cpus", SANDBOX_LIMITS["cpus"],
            "--pids-limit", SANDBOX_LIMITS["pids"], "--network", SANDBOX_LIMITS["network"],
            "--shm-size", SANDBOX_LIMITS["shm"], "--security-opt", "no-new-privileges",
            "--label", "ron.repair=1", "--label", f"ron.repair.revision={run.revision}"]
    for host, inside, read_only in _mount_sources(run):
        args += ["-v", f"{host.resolve()}:{inside}{':ro' if read_only else ''}"]
    args += [SANDBOX_IMAGE, "sleep", "infinity"]
    return args


def create_sandbox(run: RepairRun) -> tuple[Any, str]:
    """``(environment, kind)`` for one run: a fresh SDK ``DockerSandbox`` (``docker run`` of
    ``SANDBOX_IMAGE`` with the binds/bounds of ``sandbox_run_args``) when Docker works, otherwise the
    SDK's ``NotASandboxLocalEnvironment`` (kind ``local``; ``fixer_paths`` then points the fixer at
    the real host paths). The kind is shown to the user with the result."""
    from strands.sandbox.docker import DockerSandbox
    from strands.sandbox.not_a_sandbox_local_environment import NotASandboxLocalEnvironment

    if shutil.which("docker"):
        container = f"ron-repair-{run.revision}"
        try:
            subprocess.run(sandbox_run_args(run, container), check=True, capture_output=True, timeout=120)
            run.container = container
            subprocess.run(["docker", "exec", container, "pip", "install", "-q", "pytest"], check=False,
                           capture_output=True, timeout=300)
            return DockerSandbox(container, working_dir=SANDBOX_WORKDIR), "docker"
        except (subprocess.SubprocessError, OSError) as error:
            detail = getattr(error, "stderr", b"") or b""
            logger.warning("error=<%s> | Docker unavailable; the fixer runs in the local environment",
                           (detail.decode(errors="replace") if isinstance(detail, bytes) else str(detail)).strip()[:300] or error)
    return NotASandboxLocalEnvironment(), "local"


def fixer_paths(run: RepairRun) -> dict[str, str]:
    """Where the fixer finds things: container paths under Docker, real host paths locally."""
    if run.sandbox == "docker":
        paths = {"workspace": SANDBOX_WORKDIR, "tools": "/sources/tools"}
        paths.update({name: f"/sources/{name}" for name in fixer_sources()})
        return paths
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR

    paths = {"workspace": str(run.workspace.resolve()), "tools": str(PROJECT_TOOLS_DIR.resolve())}
    paths.update({name: str(path.resolve()) for name, path in fixer_sources().items()})
    return paths


def destroy_sandbox(run: RepairRun) -> None:
    if run.container:
        subprocess.run(["docker", "rm", "-f", run.container], capture_output=True, timeout=60, check=False)
        run.container = None


def mcp_server_package_dir() -> Path | None:
    """The installed ``electron_playwright_mcp`` package directory (editable sibling checkout in dev)."""
    try:
        import electron_playwright_mcp

        path = Path(str(electron_playwright_mcp.__file__)).resolve().parent
        return path if path.is_dir() else None
    except ImportError:
        return None


def fixer_sources() -> dict[str, Path]:
    """Read-only snapshots the fixer may inspect besides the library: Ron's wrapper code, the
    installed ``strands_tools`` (core host tools) and the sibling ``electron-playwright-mcp``
    server when its checkout exists (browser MCP tools)."""
    sources: dict[str, Path] = {"core": CORE_DIR}
    try:
        import strands_tools

        installed = Path(str(strands_tools.__file__)).resolve().parent
        if installed.is_dir():
            sources["strands_tools"] = installed
    except ImportError:  # pragma: no cover
        pass
    package = mcp_server_package_dir()
    if package is not None:
        sources["mcp"] = package.parent
    return sources


def artifact_digest(files: dict[str, bytes]) -> str:
    """sha256 over the sorted revision files (path + content): what an approval is bound to."""
    digest = hashlib.sha256()
    for relative in sorted(files):
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(files[relative])
        digest.update(b"\0")
    return digest.hexdigest()


def approval_token(user_id: str, tool_name: str, revision: str, base_sha256: str | None, digest: str) -> str:
    """Approval binds owner, tool, revision, base file sha and artifact digest; ``activate`` recomputes it."""
    raw = "\n".join([user_id, tool_name, revision, base_sha256 or "", digest])
    return hashlib.sha256(raw.encode()).hexdigest()


def _repair_tools(run: RepairRun) -> list[AgentTool]:
    """``record_demonstration`` and ``submit_repair``: the fixer's application tools."""

    @tool
    async def record_demonstration(kind: str, input: dict[str, Any], expected: str, actual: str, status: str,
                                   dry_run: bool = False, source: str = "session") -> dict[str, Any]:
        """Record one verified demonstration of the repaired tool run in the sandbox.

        Args:
            kind: ``failing`` (the exact recorded failing request) or ``context`` (one of the four
                context examples).
            input: The exact tool input used.
            expected: What the call should produce.
            actual: What it produced in the sandbox (or the asserted constructed call for a dry run).
            status: ``passed`` or ``failed``.
            dry_run: True when the call was asserted but not executed (side-effecting tools).
            source: ``session`` when taken from the user's session, ``synthetic`` when derived from
                the tool's input schema.
        """
        if kind not in ("failing", "context") or status not in ("passed", "failed") or source not in ("session", "synthetic"):
            raise ValueError("kind must be failing|context, status passed|failed, source session|synthetic")
        entry = {"kind": kind, "input": input, "expected": expected, "actual": actual, "status": status,
                 "dry_run": bool(dry_run), "source": source, "sandbox": run.sandbox, "recorded_at": _now()}
        run.demonstrations.append(entry)
        return {"recorded": len(run.demonstrations), "sandbox": run.sandbox}

    @tool
    async def submit_repair(status: str, fix_type: str, summary: str, reflection: dict[str, Any],
                            wrapper_audit: dict[str, Any], diff: str = "", test_file: str = "",
                            repair_kind: str = "") -> dict[str, Any]:
        """Submit the repair: writes the manifest and the repaired files from /workspace to the user's
        durable tool-repairs storage. Nothing is activated; the user decides.

        Args:
            status: ``verified`` (all demonstrations passed in a sandbox and pytest is green),
                ``failed``, ``not_reproducible`` (the recorded exception did not reproduce),
                ``needs_maintainer`` (only for a system-prompt defect or a Ren wrapper defect no
                adapter can sit in front of) or ``unverified`` (no isolated sandbox was available).
            fix_type: SYSTEM_PROMPT_FIX | TOOL_DESCRIPTION_FIX | OTHERS | WRAPPER_FIX.
            summary: One paragraph the user will read.
            reflection: Answers to the seven SOP reflection questions, keyed "1".."7".
            wrapper_audit: ``{direct_call, wrapped_call, conclusion}`` from the two sandbox reproductions.
            diff: The smallest unified diff applied.
            test_file: Relative path of the pytest file under /workspace/tests.
            repair_kind: ``file`` (repaired copy at /workspace/files/<source_path>; library tools),
                ``adapter`` (/workspace/adapter/<tool>.py with transform_input/transform_result;
                any tool incl. MCP/browser), ``server`` (repaired MCP server package under
                /workspace/server/electron_playwright_mcp/; browser tools). Defaults to ``file``
                for library tools, ``adapter`` otherwise.
        """
        if status not in REVISION_STATUSES:
            raise ValueError(f"status must be one of {REVISION_STATUSES}")
        if fix_type not in FIX_TYPES:
            raise ValueError(f"fix_type must be one of {FIX_TYPES}")
        kind = run.manifest.get("target_kind", "library")
        repair_kind = repair_kind or ("file" if kind == "library" else "adapter")
        if repair_kind not in REPAIR_KINDS:
            raise ValueError(f"repair_kind must be one of {REPAIR_KINDS}")
        if repair_kind == "file" and kind != "library":
            raise ValueError("repair_kind=file is only possible for library tools; use adapter or server")
        if repair_kind == "server" and kind != "mcp":
            raise ValueError("repair_kind=server is only possible for MCP/browser tools")
        route = route_fix(fix_type, source_path=run.manifest.get("source_path"), kind=kind)
        if route == "needs_maintainer" and status == "verified":
            status = "needs_maintainer"
        if status == "verified":
            # A local (no-container) run can be verified too; the panel shows the sandbox kind
            # beside Approve, so the user decides with that information.
            failing = [d for d in run.demonstrations if d["kind"] == "failing"]
            context = [d for d in run.demonstrations if d["kind"] == "context"]
            if not failing or any(d["status"] != "passed" for d in run.demonstrations) or len(context) < MAX_CONTEXT_EXAMPLES:
                raise ValueError("verified requires the failing demonstration plus four passed context demonstrations")
        files: dict[str, bytes] = {}
        for folder in ("files", "adapter", "server", "tests"):
            folder_root = run.workspace / folder
            if folder_root.is_dir():
                for path in folder_root.rglob("*.py"):
                    files[f"{folder}/{path.relative_to(folder_root).as_posix()}"] = path.read_bytes()
        if status in ("verified", "unverified"):
            if repair_kind == "file" and f"files/{run.manifest['source_path']}" not in files:
                raise ValueError(f"/workspace/files/{run.manifest['source_path']} must contain the repaired tool")
            if repair_kind == "adapter":
                adapter_key = f"adapter/{run.tool_name}.py"
                if adapter_key not in files:
                    raise ValueError(f"/workspace/{adapter_key} must define transform_input and/or transform_result")
                validate_adapter_source(files[adapter_key].decode("utf-8"))
            if repair_kind == "server" and not any(key.startswith(f"server/{MCP_SERVER_PACKAGE}/") for key in files):
                raise ValueError(f"/workspace/server/{MCP_SERVER_PACKAGE}/ must contain the repaired server package")
        if route == "needs_maintainer" and not (diff.strip() or summary.strip()):
            raise ValueError("needs_maintainer requires at least a summary of the diagnosis (and a diff when possible)")
        digest = artifact_digest(files)
        run.manifest.update({
            "status": status, "fix_type": fix_type, "route": route, "repair_kind": repair_kind, "summary": summary,
            "reflection": reflection, "wrapper_audit": wrapper_audit, "diff": diff, "test_file": test_file,
            "demonstrations": run.demonstrations, "sandbox": run.sandbox, "submitted_at": _now(), "files": sorted(files),
            "artifact_digest": digest,
            "approval_token": approval_token(run.user_id, run.tool_name, run.revision, run.manifest.get("base_sha256"), digest)
            if status == "verified" else None,
        })
        await write_revision_files(run.user_id, run.tool_name, run.revision, files)
        await write_manifest(run.user_id, run.manifest)
        run.submitted = True
        return {"revision": run.revision, "status": status, "route": route, "files": sorted(files)}

    return [record_demonstration, submit_repair]


def validate_adapter_source(source: str) -> None:
    """Reject an adapter that is not a plain module defining the allowed hooks."""
    import ast

    tree = ast.parse(source)
    names = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    if not names & set(ADAPTER_HOOKS):
        raise ValueError(f"adapter must define at least one of {ADAPTER_HOOKS}")


def load_adapter(path: Path) -> Any:
    """Import a user's adapter module from its materialized file (isolated module name)."""
    import importlib.util

    name = f"ron_tool_adapters.{hashlib.sha256(str(path).encode()).hexdigest()[:16]}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot import adapter {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    validate_adapter_source(path.read_text(encoding="utf-8"))
    return module


class _AdaptedTool(AgentTool):
    """A user's repaired call boundary around ANY registered tool (incl. MCP/browser tools).

    ``transform_input(input: dict) -> dict`` runs before the wrapped tool; ``transform_result``
    ``(result: dict, input: dict) -> dict`` runs on its final tool result. Both may be sync or
    async. The wrapped tool is untouched, so other users and the shared server are unaffected.
    """

    def __init__(self, wrapped: AgentTool, adapter: Any, revision: str) -> None:
        super().__init__()
        self.wrapped, self.adapter, self.revision = wrapped, adapter, revision
        if wrapped.is_dynamic:
            self.mark_dynamic()

    @property
    def tool_name(self) -> str:
        return self.wrapped.tool_name

    @property
    def tool_spec(self):
        return self.wrapped.tool_spec

    @property
    def tool_type(self) -> str:
        return self.wrapped.tool_type

    async def _call(self, name: str, *args: Any) -> Any:
        hook = getattr(self.adapter, name, None)
        if hook is None:
            return args[0]
        value = hook(*args)
        return await value if asyncio.iscoroutine(value) else value

    async def stream(self, tool_use, invocation_state, **kwargs):
        from contextlib import aclosing

        from strands.types._events import ToolResultEvent

        use: Any = dict(tool_use)
        use["input"] = await self._call("transform_input", dict(use.get("input") or {}))
        async with aclosing(self.wrapped.stream(use, invocation_state, **kwargs)) as stream:
            async for event in stream:
                if not hasattr(self.adapter, "transform_result"):
                    yield event
                    continue
                if isinstance(event, ToolResultEvent):
                    original: Any = event["tool_result"]
                    adapted = await self._call("transform_result", dict(original), use["input"])
                    yield ToolResultEvent(adapted, exception=event.exception)
                elif isinstance(event, dict) and "toolUseId" in event and "status" in event and "tool_result" not in event:
                    yield await self._call("transform_result", dict(event), use["input"])
                else:
                    yield event


def _memory_search_tools(user_id: str) -> list[AgentTool]:
    from agent.api.core.panel_agent import user_memory_config

    stores = user_memory_config(user_id, "panel", extraction=False)["stores"]
    return list(resolve_memory(stores=list(stores), writable=False).tools)


def _with_hosted_tools(model: Any, hosted: list[dict[str, Any]]) -> Any:
    """Put the fixer's server-side ``tools`` on the Perplexity model's request params (never on
    ``Agent.tools``); a scripted test model without ``params`` is left alone."""
    params = dict((getattr(model, "config", None) or {}).get("params") or {})
    if not hasattr(model, "update_config"):
        return model
    params["tools"] = hosted
    try:
        model.update_config(params=params)
    except Exception:  # pragma: no cover - test doubles
        pass
    return model


def build_fixer(run: RepairRun, *, models: Sequence[str], effort: str | None = DEFAULT_FIXER_EFFORT,
                build_model: Callable[..., Any] | None = None,
                sandbox_factory: Callable[[RepairRun], tuple[Any, str]] | None = None,
                hosted_tools: Sequence[str] | None = None, a2a_agents: Sequence[str] | None = None,
                sandbox: tuple[Any, str] | None = None) -> Agent:
    """One ``create_harness`` call. The harness supplies the agent: built-in ``shell``/``read``/
    ``write``/``edit`` (all routed through the SDK ``Agent(sandbox=)`` seam, here a ``DockerSandbox``
    with the workspace writable and every source read-only), ``todos`` and ``environment`` for the
    multi-step SOP, the harness context manager (oversized tool results offloaded to a temporary
    directory), native throttling retry and the harness system-prompt contract. Ron adds only its
    domain: ``record_demonstration``/``submit_repair`` and read-only memory search. The SOP is the
    agent's input (``sop_task``). The user approves the submitted revision in the panel; the fixer
    never applies anything itself.
    """
    from agent.api.core import panel_agent

    builder = build_model or panel_agent.build_model
    # Reasoning effort is configured on the PerplexityResponsesModel instance (``reasoning.effort``);
    # ``create_harness`` ignores ``effort`` for prebuilt Model/ModelRouter instances by design.
    hosted = fixer_hosted_tools(hosted_tools)
    router = ModelRouter([_with_hosted_tools(builder("perplexity", model_id, effort, hosted_tools=False), hosted)
                          for model_id in models], strategy=FallbackStrategy())
    run.workspace.mkdir(parents=True, exist_ok=True)
    for folder in ("files", "adapter", "server", "tests"):
        (run.workspace / folder).mkdir(exist_ok=True)
    environment, run.sandbox = sandbox or (sandbox_factory or create_sandbox)(run)
    tools: list[Any] = [*_repair_tools(run)]
    try:
        tools.extend(_memory_search_tools(run.user_id))
    except Exception as error:  # memory is optional for a repair
        logger.info("error=<%s> | fixer runs without memory search", error)
    # Native A2A over fixer-only peers (never Ron's own /a2a agent, which runs host tools).
    a2a = fixer_a2a_provider(a2a_agents)
    if a2a is not None:
        tools.extend(a2a.tools)  # the provider vends plain AgentTools (not an SDK ToolProvider)
    return create_harness(
        model=router, instructions=FIXER_PROMPT, tools=tools,
        builtin_tools=["shell", "read", "write", "edit"], builtin_plugins=["todos", "environment"],
        sandbox=environment, memory=False, session=False, skills=False, caching=None,
        background_tasks=False, interventions=None, callback_handler=None, load_tools_from_directory=False,
        name="Ren Tool Fixer",
        description="Reproduces a failed Ren tool, repairs it in its workspace and submits a revision for the user's approval.",
    )


FIXER_PROMPT = """You are Ren's tool fixer. Your input is a native Agent SOP ("Repairing a Broken Tool") with
its parameters in <user-input>; run it in order and call submit_repair exactly once. The user decides
in Ren's panel whether a verified revision is applied; you never apply anything.

Server-side (Perplexity) tools run inside your model turn: web_search, fetch_url, image_search for
documentation and prior art; the sandbox for scratch computation; the GitHub connector for upstream
source/issues/PRs of the tool's project; Context7 (MCP) for current library documentation.
Your shell, read, write and edit tools run inside one isolated container (a replica of Ren's
runtime when the replica image is configured). Read-only mounts: /sources/tools (vendored tool
library), /sources/core (Ren's wrapper code), /sources/strands_tools (installed host tools),
/sources/mcp (browser MCP server package). /workspace is the only writable area. Install what you
need with pip inside the sandbox. The container has no access to the user's live browser, Ren's
API or the host: a demonstration against the live server is a dry run. Never claim a run you did
not perform; a model's belief that code works is not a passed demonstration."""


def sop_parameters(run: RepairRun, request: dict[str, Any], failing_use: dict[str, Any] | None,
                   context: list[dict[str, Any]], diagnosis: dict[str, Any] | None) -> str:
    """The SOP's ``user_input``: every parameter the SOP declares, as a readable block."""
    schema = run.manifest.get("tool_spec")
    kind = run.manifest.get("target_kind", "library")
    source_path = run.manifest.get("source_path")
    paths = fixer_paths(run)
    ws, lib = paths["workspace"], paths["tools"]
    core, mcp, installed = paths.get("core", "(Ren core)"), paths.get("mcp", "(MCP package)"), paths.get("strands_tools", "(strands_tools)")
    if kind == "library":
        location = f"Source: {lib}/{source_path} (sha256 {run.manifest['base_sha256']}). A copy is at {ws}/files/{source_path}; edit the copy only."
    elif kind == "mcp":
        location = ("Target kind: MCP tool (browser/MCP server). Two user-scoped repairs are possible: "
                    f"(a) repair_kind=server — the server package is copied at {ws}/server/{MCP_SERVER_PACKAGE}/ "
                    f"(original at {mcp}); edit the copy. (b) repair_kind=adapter — write {ws}/adapter/<tool>.py with "
                    "transform_input(input) and/or transform_result(result, input) to fix the call boundary. "
                    f"Audit Ren's wrapper in {core} (panel_browser.py, panel_tools.py). You have no browser: "
                    "unit-test the adapter/server logic directly with pytest; live-browser demonstrations are dry runs.")
    elif kind == "core":
        location = (f"Target kind: core host tool (installed file {source_path} under {installed}). Installed code is not "
                    f"edited: write {ws}/adapter/<tool>.py (repair_kind=adapter) with transform_input/transform_result. "
                    f"Audit the wrapper in {core}.")
    else:
        location = (f"Target kind: plugin/agent tool without a source file. Write {ws}/adapter/<tool>.py "
                    f"(repair_kind=adapter) with transform_input/transform_result; audit {core}.")
    location += (f" Your workspace is {ws} (the only place you write). Put tests under {ws}/tests."
                 + ("" if run.sandbox == "docker" else
                    " You are running WITHOUT a container on the API host: never modify anything outside the workspace, "
                    "never restart services, never touch the user's browser."))
    parts = [
        f"tool_name: {run.tool_name}",
        f"target_kind: {kind}",
        f"revision: {run.revision}",
        f"source_path: {source_path}",
        f"base_sha256: {run.manifest.get('base_sha256')}",
        f"sandbox: {run.sandbox}",
        location,
        "outcome: " + json.dumps(request.get("outcome"), ensure_ascii=False),
        f"failures_counted_this_session: {request.get('count')}",
        "failing_request: " + json.dumps(failing_use or {"input": {}}, ensure_ascii=False),
        f"context_examples ({len(context)} from this session; synthesize the rest from tool_spec as source=synthetic, "
        f"{MAX_CONTEXT_EXAMPLES} in total): " + json.dumps(context, ensure_ascii=False),
    ]
    if request.get("error"):
        parts.append("error_text: " + json.dumps(str(request["error"])[:2000], ensure_ascii=False))
    if request.get("current_request"):
        parts.append("user_request_at_failure: " + json.dumps(str(request["current_request"])[:1500], ensure_ascii=False))
    if request.get("browser"):
        parts.append(f"browser_target_at_failure: {request['browser']} (the sandbox cannot reach it)")
    if schema:
        parts.append("tool_spec: " + json.dumps(schema, ensure_ascii=False)[:6000])
    if diagnosis is not None:
        parts.append("diagnosis (strands_evals): " + json.dumps(diagnosis, ensure_ascii=False)[:12000])
    else:
        parts.append("diagnosis: none (no retained observation spans); work from outcome and reproduce in the sandbox")
    return "\n".join(parts)


def sop_task(run: RepairRun, request: dict[str, Any], failing_use: dict[str, Any] | None,
             context: list[dict[str, Any]], diagnosis: dict[str, Any] | None, *, sop_prompt: str | None = None) -> str:
    """The fixer's single input: the native Agent SOP prompt (``Run this SOP: <agent-sop name=...>
    <content>…</content><user-input>…</user-input></agent-sop>``) rendered by the pinned
    ``strands_agents_sops`` MCP server with the repair parameters as ``user_input``."""
    parameters = sop_parameters(run, request, failing_use, context, diagnosis)
    if sop_prompt is not None:  # tests: a pre-rendered SOP body
        return f"Run this SOP:\n<agent-sop name=\"{SOP_NAME}\">\n<content>\n{sop_prompt}\n</content>\n<user-input>\n{parameters}\n</user-input>\n</agent-sop>"
    return native_sop_prompt(SOPS_DIR, parameters, name=SOP_NAME)


@dataclass
class Investigation:
    """One background repair: the run, what triggered it, and its asyncio task."""

    run: RepairRun
    evidence: RepairEvidence
    state: str = "investigating"          # investigating -> approval | done
    result: dict[str, Any] | None = None
    task: asyncio.Task[dict[str, Any]] | None = None
    #: The create_harness fixer the A2A server built for this context (``agent_for``).
    fixer: Agent | None = None
    started_at: str = field(default_factory=_now)

    @property
    def context_id(self) -> str:
        """The A2A ``context_id`` this repair's fixer is served under at ``/a2a/fixer``."""
        return f"repair-{self.run.revision}"

    def summary(self) -> dict[str, Any]:
        manifest = self.run.manifest
        return {"revision": self.run.revision, "tool_name": self.run.tool_name, "state": self.state,
                "started_at": self.started_at, "result": self.result,
                "evidence": {"kind": self.evidence.kind, "exception_class": self.evidence.exception_class,
                             "count": self.evidence.count, "session_id": self.evidence.session_id},
                "artifact": {"status": manifest.get("status"), "summary": manifest.get("summary"), "diff": manifest.get("diff"),
                             "repair_kind": manifest.get("repair_kind"), "target_kind": manifest.get("target_kind"),
                             "demonstrations": manifest.get("demonstrations", []), "sandbox": self.run.sandbox,
                             "route": manifest.get("route"),
                             "approval_token": manifest.get("approval_token") if self.state == "approval" else None}}


class RepairService:
    """Runs one ``create_harness`` fixer per failing ``(user, tool)`` in the background.

    ``trigger()`` is the hook every agent registers; on a failure it calls ``investigate()``, which
    starts ``_run`` as an asyncio task and returns immediately. ``_run`` builds the fixer, streams
    ``fixer.stream_async(sop_task)`` (progress goes to the originating session through the bound
    emitter), and ends with the stored manifest. A ``verified`` result waits for the user's Approve
    in the panel (``POST /tools/repairs/{tool}/activate`` with the approval token); nothing is
    applied without it.
    """

    def __init__(self, config_: RepairConfig | None = None, *, fixer_url: str | None = None,
                 reload_live_sessions: Callable[..., Any] | None = None,
                 client_config: Any | None = None) -> None:
        self.config = config_ or RepairConfig.from_env()
        self._fixer_url = fixer_url
        self._client_config = client_config  # a2a ClientConfig (tests inject an ASGI httpx client)
        self._reload_live_sessions = reload_live_sessions
        self._by_key: dict[tuple[str, str], Investigation] = {}
        self._by_context: dict[str, Investigation] = {}
        self._results: dict[tuple[str, str], dict[str, Any]] = {}
        self._slots = asyncio.Semaphore(max(1, self.config.max_concurrent))
        self._emit: Callable[[str, str, dict[str, Any]], Any] | None = None
        # Test seams (production uses panel_agent.build_model / create_sandbox / the native SOP server).
        self.build_model: Callable[..., Any] | None = None
        self.sandbox_factory: Callable[[RepairRun], tuple[Any, str]] | None = None
        self.sop_prompt: str | None = None

    def bind_emitter(self, emit: Callable[[str, str, dict[str, Any]], Any]) -> None:
        """``emit(user_id, session_id, payload)`` delivers repair events to the originating session."""
        self._emit = emit

    @property
    def fixer_url(self) -> str:
        if self._fixer_url:
            return self._fixer_url
        from agent.api.core.a2a_tools import panel_a2a_url

        return f"{panel_a2a_url()}/fixer"

    def agent_for(self, context_id: str) -> Agent:
        """``A2AServer(agent_factory=)`` for ``/a2a/fixer``: the real ``create_harness`` fixer.

        A registered ``repair-<rev>`` context gets that repair's fixer; the server's own
        ``__agent_card__`` construction gets an unconfigured fixer for the card. Any other context
        is refused, so a caller cannot open a fixer that Ron did not start.
        """
        investigation = self._by_context.get(context_id)
        if investigation is None:
            if context_id != "__agent_card__":
                raise LookupError(f"No repair is registered for A2A context {context_id!r}")
            from strands.sandbox.not_a_sandbox_local_environment import NotASandboxLocalEnvironment

            card_run = RepairRun(user_id="__card__", session_id="__card__", tool_name="__card__", revision="card",
                                 workspace=config.SESSION_STORAGE_DIR / "repairs" / "_card", manifest={"target_kind": "other"})
            return build_fixer(card_run, models=self.config.models, effort=self.config.effort, build_model=self.build_model,
                               hosted_tools=self.config.hosted_tools, a2a_agents=self.config.a2a_agents,
                               sandbox=(NotASandboxLocalEnvironment(), "local"))
        investigation.fixer = build_fixer(investigation.run, models=self.config.models, effort=self.config.effort,
                                          build_model=self.build_model, sandbox_factory=self.sandbox_factory,
                                          hosted_tools=self.config.hosted_tools, a2a_agents=self.config.a2a_agents)
        return investigation.fixer

    def client(self) -> Any:
        """The SDK's native A2A client (``A2AAgent``) for the fixer endpoint."""
        from agent.api.core.panel_a2a import create_panel_a2a_client

        return create_panel_a2a_client(self.fixer_url, timeout=max(60, int(self.config.timeout_s)),
                                       client_config=self._client_config)

    def trigger(self, *, browser: str | None = None, user_id: str | None = None, session_id: str | None = None) -> ToolRepairTrigger:
        """The hook to register on an agent (Chat agents carry ids in ``trace_attributes``; Live passes them)."""
        return ToolRepairTrigger(self.config, start=self.investigate, browser=browser, user_id=user_id, session_id=session_id)

    # -- inspection ---------------------------------------------------------------------------

    def status(self, user_id: str, tool_name: str) -> dict[str, Any]:
        investigation = self._by_key.get((user_id, tool_name))
        if investigation is not None and investigation.task is not None and not investigation.task.done():
            return {"state": investigation.state, "investigation": investigation.summary()}
        return {"state": "idle", "last": self._results.get((user_id, tool_name))}

    def active(self, user_id: str) -> list[dict[str, Any]]:
        return [inv.summary() for (owner, _), inv in self._by_key.items()
                if owner == user_id and (inv.state == "approval" or (inv.task is not None and not inv.task.done()))]

    async def wait(self, user_id: str, tool_name: str) -> dict[str, Any] | None:
        investigation = self._by_key.get((user_id, tool_name))
        return await investigation.task if investigation is not None and investigation.task is not None else None

    # -- start --------------------------------------------------------------------------------

    def investigate(self, evidence: RepairEvidence) -> Investigation | None:
        """Start one background repair (idempotent per ``(user, tool)``). Never blocks the caller."""
        if not self.config.enabled or not evidence.user_id or not evidence.session_id:
            logger.warning("tool_name=<%s> | repair not started: missing user/session id", evidence.tool_name)
            return None
        key = (evidence.user_id, _tool_key(evidence.tool_name))
        current = self._by_key.get(key)
        if current is not None and current.task is not None and not current.task.done():
            return None
        source_agent = evidence.agent
        registered = source_agent.tool_registry.registry.get(evidence.tool_name) if source_agent is not None else None
        if source_agent is None or registered is None:
            logger.warning("tool_name=<%s> | repair not started: tool not registered", evidence.tool_name)
            return None
        request = {"tool_name": evidence.tool_name, "count": evidence.count, "exception_class": evidence.exception_class,
                   "outcome": evidence.outcome, "observation": evidence.observation,
                   "failing_tool_use_id": evidence.failing_tool_use_id, "error": evidence.error,
                   "current_request": evidence.current_request, "browser": evidence.browser}
        run = self._prepare(evidence.user_id, evidence.session_id, evidence.tool_name, tool_source(registered), registered,
                            request, evidence.kind)
        investigation = Investigation(run=run, evidence=evidence)
        self._by_key[key] = investigation
        self._by_context[investigation.context_id] = investigation
        source_agent.state.set(REPAIR_REQUEST_STATE_KEY, {
            **(source_agent.state.get(REPAIR_REQUEST_STATE_KEY) or {}), "tool_name": evidence.tool_name,
            "status": "investigating", "revision": run.revision,
        })
        investigation.task = asyncio.get_running_loop().create_task(
            self._run(investigation, request), name=f"tool-repair-{evidence.user_id}-{evidence.tool_name}")
        logger.warning("tool_name=<%s>, revision=<%s> | repair started", evidence.tool_name, run.revision)
        return investigation

    async def start(self, *, user_id: str, session_id: str, tool_name: str, session_messages: Sequence[dict[str, Any]],
                    agent: Agent | None, **_: Any) -> dict[str, Any]:
        """``POST /tools/repairs``: repair a tool the user names, from the session's recorded failure."""
        if not self.config.enabled:
            raise RuntimeError("RON_TOOL_REPAIR=0: tool repair is disabled")
        if agent is None:
            raise ValueError("A live session is required")
        registered = agent.tool_registry.registry.get(tool_name)
        if registered is None:
            raise ValueError(f"{tool_name!r} is not registered in this session")
        key = (user_id, _tool_key(tool_name))
        if (current := self._by_key.get(key)) is not None and current.task is not None and not current.task.done():
            raise RuntimeError(f"A repair of {tool_name!r} is already running for this user")
        request = agent.state.get(REPAIR_REQUEST_STATE_KEY) or {}
        if request.get("tool_name") != tool_name:
            request = {}
        recorded = ((agent.state.get(REPAIR_CONTEXT_STATE_KEY) or {}).get(tool_name) or [{}])[0]
        failing_use = {"toolUseId": recorded.get("toolUseId", ""), "name": tool_name, "input": recorded.get("input", {})}
        from agent.api.core.panel_tools import current_request_text

        spec = getattr(registered, "tool_spec", None)
        evidence = RepairEvidence(
            user_id=user_id, session_id=session_id, tool_name=tool_name, kind=target_kind(registered),
            exception_class=str(request.get("exception_class") or "error"), count=int(request.get("count") or 0),
            failing_tool_use_id=str(request.get("failing_tool_use_id") or failing_use["toolUseId"]),
            tool_use=failing_use, outcome=dict(request.get("outcome") or {"tool_name": tool_name}),
            error=recorded.get("exception"),
            tool_spec={"name": spec.get("name"), "inputSchema": spec.get("inputSchema")} if isinstance(spec, dict) else None,
            current_request=current_request_text(list(session_messages)), messages=list(session_messages), browser=None,
            agent=agent, observation=bool(request.get("observation")), side_effecting=is_side_effecting(tool_name, failing_use["input"]),
        )
        investigation = self.investigate(evidence)
        if investigation is None:
            raise RuntimeError("The repair could not be started")
        return {"revision": investigation.run.revision, "tool_name": tool_name, "state": "investigating"}

    async def cancel(self, user_id: str, tool_name: str) -> dict[str, Any]:
        investigation = self._by_key.get((user_id, _tool_key(tool_name)))
        if investigation is None or investigation.task is None or investigation.task.done():
            raise LookupError(f"No running repair of {tool_name!r} for this user")
        if investigation.fixer is not None:
            investigation.fixer.cancel()  # native: the A2A task ends at the next safe point
        investigation.task.cancel()
        return investigation.summary()

    def decline(self, user_id: str, tool_name: str, rev: str | None = None) -> dict[str, Any]:
        """The user declined a verified revision: nothing is applied, the panel closes it."""
        investigation = self._by_key.get((user_id, _tool_key(tool_name)))
        if investigation is None or investigation.state != "approval" or (rev and investigation.run.revision != rev):
            raise LookupError(f"No repair of {tool_name!r} is waiting for approval")
        investigation.state = "done"
        investigation.run.manifest["status"] = "declined"
        self._guide(investigation, "declined")
        return investigation.summary()

    async def applied(self, user_id: str, tool_name: str, rev: str) -> None:
        """``/activate`` succeeded: tell the originating agent to call the tool again."""
        investigation = self._by_key.get((user_id, _tool_key(tool_name)))
        if investigation is None or investigation.run.revision != rev:
            return
        investigation.state = "done"
        investigation.run.manifest["status"] = "active"
        self._guide(investigation, "confirm")

    async def shutdown(self) -> None:
        tasks = [inv.task for inv in self._by_key.values() if inv.task is not None and not inv.task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    # -- the run ------------------------------------------------------------------------------

    async def _notify(self, investigation: Investigation, payload: dict[str, Any]) -> None:
        if self._emit is None:
            return
        try:
            await _maybe_await(self._emit(investigation.evidence.user_id, investigation.evidence.session_id,
                                          {"revision": investigation.run.revision, "tool_name": investigation.run.tool_name, **payload}))
        except Exception:
            logger.exception("revision=<%s> | repair event delivery failed", investigation.run.revision)

    def _guide(self, investigation: Investigation, phase: str, summary: str | None = None) -> None:
        from agent.api.core.tool_failure import note_repair

        agent = investigation.evidence.agent
        if agent is None:
            return
        try:
            note_repair(agent, investigation.run.tool_name, phase=phase, revision=investigation.run.revision, summary=summary)
            agent.state.set(REPAIR_REQUEST_STATE_KEY, {**(agent.state.get(REPAIR_REQUEST_STATE_KEY) or {}),
                                                       "tool_name": investigation.run.tool_name, "status": investigation.state,
                                                       "revision": investigation.run.revision})
        except Exception:
            logger.exception("revision=<%s> | guidance update failed", investigation.run.revision)

    def _result(self, run: RepairRun) -> dict[str, Any]:
        manifest = run.manifest
        return {"revision": run.revision, "tool_name": run.tool_name, "status": manifest.get("status"),
                "summary": manifest.get("summary", ""), "demonstrations": manifest.get("demonstrations", []),
                "sandbox": run.sandbox, "route": manifest.get("route"), "repair_kind": manifest.get("repair_kind"),
                "target_kind": manifest.get("target_kind"), "diff": manifest.get("diff", ""),
                "approval_token": manifest.get("approval_token"), "artifact_digest": manifest.get("artifact_digest")}

    async def _run(self, investigation: Investigation, request: dict[str, Any]) -> dict[str, Any]:
        run, evidence = investigation.run, investigation.evidence
        try:
            async with self._slots:
                await write_manifest(run.user_id, run.manifest)
                await self._notify(investigation, {"investigating": {"kind": run.manifest.get("target_kind"), "count": evidence.count,
                                                                      "exception_class": evidence.exception_class}})
                self._guide(investigation, "investigating")
                diagnosis = None
                try:
                    from agent.api.core import panel_agent

                    diag_builder = self.build_model or panel_agent.build_model
                    diagnosis = await diagnose(run.session_id, model=diag_builder("perplexity", self.config.models[0], None, hosted_tools=False))
                except Exception as error:
                    logger.info("error=<%s> | diagnosis unavailable; fixer works from recorded outcomes", error)
                run.manifest["diagnosis"] = diagnosis
                failing_use = {"toolUseId": evidence.tool_use.get("toolUseId"), "input": evidence.tool_use.get("input", {})}
                context = select_context_examples(evidence.messages, run.tool_name, exclude_tool_use_id=evidence.failing_tool_use_id)
                task_text = await asyncio.to_thread(sop_task, run, request, failing_use, context, diagnosis, sop_prompt=self.sop_prompt)
                logger.warning("tool_name=<%s>, revision=<%s>, fixer=<%s> | sending repair to fixer over A2A",
                               run.tool_name, run.revision, self.fixer_url)
                fixer = self.client()

                async def drive() -> None:
                    # Native A2A: one message in this repair's context; the server's agent_factory
                    # builds the create_harness fixer for it and streams the task back.
                    message = convert_input_to_message(task_text)
                    message.context_id = investigation.context_id
                    async with fixer._get_a2a_client() as client:
                        async for event in client.send_message(message):
                            await self._notify(investigation, {"a2a": _a2a_event(event)})
                            state = _a2a_state(event)
                            if state in ("failed", "rejected"):
                                run.manifest.setdefault("summary", "The fixer's A2A task failed.")

                await asyncio.wait_for(drive(), timeout=self.config.timeout_s)
                if not run.submitted:
                    run.manifest.update({"status": "failed", "summary": "The fixer ended without calling submit_repair."})
        except asyncio.CancelledError:
            run.manifest.update({"status": "cancelled", "summary": "The repair was cancelled."})
        except asyncio.TimeoutError:
            run.manifest.update({"status": "failed", "summary": f"The repair exceeded {self.config.timeout_s}s and was stopped."})
        except Exception as error:
            logger.exception("tool_name=<%s>, revision=<%s> | repair failed", run.tool_name, run.revision)
            run.manifest.update({"status": "failed", "summary": f"{type(error).__name__}: {error}"[:500]})
        finally:
            run.manifest.setdefault("demonstrations", run.demonstrations)
            run.manifest["sandbox"] = run.sandbox
            self._by_context.pop(investigation.context_id, None)
            if investigation.fixer is not None:
                investigation.fixer.cancel()
                try:
                    await asyncio.to_thread(investigation.fixer.cleanup)
                except Exception:
                    logger.exception("fixer cleanup failed")
            await asyncio.to_thread(destroy_sandbox, run)
            try:
                await write_manifest(run.user_id, run.manifest)
            except Exception:
                logger.exception("manifest write failed")
        result = self._result(run)
        investigation.result = result
        self._results[(run.user_id, run.tool_name)] = result
        status = run.manifest.get("status")
        investigation.state = "approval" if status == "verified" else "done"
        phase = {"verified": "approval", "cancelled": "failed"}.get(str(status), "failed")
        self._guide(investigation, phase, result.get("summary"))
        logger.warning("tool_name=<%s>, revision=<%s>, status=<%s> | repair finished", run.tool_name, run.revision, status)
        await self._notify(investigation, {"approval" if status == "verified" else "ready": result})
        return result

    def _prepare(self, user_id: str, session_id: str, tool_name: str, source: dict[str, Any] | None, registered: Any,
                 request: dict[str, Any], kind: str = "library") -> RepairRun:
        from agent.api.core.panel_agent import PROJECT_TOOLS_DIR

        revision = new_revision_id()
        workspace = config.SESSION_STORAGE_DIR / "repairs" / _user_scope(user_id).rsplit("/", 1)[-1] / revision
        workspace.mkdir(parents=True, exist_ok=True)
        source_path = source["path"] if source is not None else None
        if kind == "library" and source_path is not None:
            vendored = PROJECT_TOOLS_DIR / source_path
            target = workspace / "files" / source_path
            target.parent.mkdir(parents=True, exist_ok=True)
            if vendored.is_file():
                shutil.copyfile(vendored, target)
        (workspace / "adapter").mkdir(exist_ok=True)
        if kind == "mcp":
            package = mcp_server_package_dir()
            if package is not None:
                shutil.copytree(package, workspace / "server" / MCP_SERVER_PACKAGE,
                                ignore=shutil.ignore_patterns("__pycache__"), dirs_exist_ok=True)
        spec = getattr(registered, "tool_spec", None)
        manifest = {
            "tool_name": tool_name, "revision": revision, "target_kind": kind,
            "source_path": source_path, "base_sha256": source["sha256"] if source is not None else None,
            "session_id": session_id, "owner_id": user_id, "created_at": _now(), "status": "investigating", "sop": SOP_NAME,
            "request": {k: v for k, v in request.items() if k in ("count", "exception_class", "outcome", "observation", "current_request", "browser")},
            "tool_spec": {"name": spec.get("name"), "inputSchema": spec.get("inputSchema")} if isinstance(spec, dict) else None,
            "demonstrations": [], "reflection": {}, "wrapper_audit": {}, "diagnosis": None,
        }
        return RepairRun(user_id=user_id, session_id=session_id, tool_name=tool_name, revision=revision,
                         workspace=workspace, manifest=manifest)


async def _maybe_await(value: Any) -> None:
    if asyncio.iscoroutine(value) or asyncio.isfuture(value):
        await value


def _a2a_state(event: Any) -> str | None:
    """Task state of one A2A client event (``(Task, update)`` tuple or ``Message``)."""
    if isinstance(event, tuple) and len(event) == 2:
        task, update = event
        status = getattr(update, "status", None) or getattr(task, "status", None)
        state = getattr(status, "state", None)
        return getattr(state, "value", None) if state is not None else None
    return None


def _a2a_event(event: Any) -> dict[str, Any]:
    """Compact JSON view of one A2A client event for the panel's Repair chain."""
    def text(parts: Any) -> str:
        return "".join(getattr(getattr(part, "root", part), "text", "") or "" for part in parts or [])

    if isinstance(event, tuple) and len(event) == 2:
        task, update = event
        artifact = getattr(update, "artifact", None)
        if artifact is not None:
            return {"kind": "artifact", "task_id": task.id, "text": text(artifact.parts)}
        status = getattr(update, "status", None) or task.status
        message = getattr(status, "message", None)
        return {"kind": "status", "task_id": task.id, "state": _a2a_state(event),
                "text": text(message.parts) if message is not None else ""}
    return {"kind": "message", "text": text(getattr(event, "parts", None))}


# --- Activate / rollback ------------------------------------------------------------------

class RevisionConflict(RuntimeError):
    """The vendored file or the artifact changed since the repair was verified (HTTP 409)."""


async def activate(user_id: str, tool_name: str, rev: str, *, approval_token_: str | None = None) -> dict[str, Any]:
    """Re-check owner, base sha, artifact digest and approval token; write ``active.json``;
    materialize the revision.

    Raises:
        FileNotFoundError: unknown revision.
        ValueError: the revision is not verified, or the token is missing.
        PermissionError: another owner, or a token that does not match the verified artifact.
        RevisionConflict: the library file or the stored files changed since verification.
    """
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR

    manifest = await read_manifest(user_id, tool_name, rev)
    if manifest is None:
        raise FileNotFoundError(f"Unknown revision {rev!r} for {tool_name!r}")
    if manifest.get("owner_id") not in (None, user_id):
        raise PermissionError("This revision belongs to another user")
    if manifest.get("status") not in ("verified", "active", "rolled_back"):
        raise ValueError(f"Revision {rev!r} is {manifest.get('status')!r}; only verified revisions can be activated")
    repair_kind = manifest.get("repair_kind", "file")
    if repair_kind == "file":
        if not manifest.get("source_path"):
            raise ValueError(f"Revision {rev!r} has no source_path")
        vendored = PROJECT_TOOLS_DIR / manifest["source_path"]
        current_sha = file_sha256(vendored) if vendored.is_file() else None
        if current_sha != manifest["base_sha256"]:
            raise RevisionConflict("The library file changed since this repair was verified; re-run the repair")
    # The artifact in storage must still be the one that was verified (digest), and the approval
    # must have been given for exactly that artifact (token).
    storage = repair_storage(user_id)
    prefix = f"{_tool_key(tool_name)}/{_rev_key(rev)}/"
    files: dict[str, bytes] = {}
    for key in await storage.list(prefix):
        relative = key[len(prefix):]
        if any(relative.startswith(f"{folder}/") for folder in ("files", "adapter", "server", "tests")):
            data = await storage.read(key)
            if data is not None:
                files[relative] = data
    digest = artifact_digest(files)
    if manifest.get("artifact_digest") and digest != manifest["artifact_digest"]:
        raise RevisionConflict("The stored revision files changed since this repair was verified")
    expected = manifest.get("approval_token") or approval_token(user_id, tool_name, rev, manifest.get("base_sha256"), digest)
    if approval_token_ is None:
        raise ValueError("Activation requires the approval token of the verified artifact")
    if approval_token_ != expected:
        raise PermissionError("The approval token does not match this verified artifact")
    revision_file = await materialize_revision(user_id, tool_name, rev)
    active = {"revision": rev, "activated_at": _now(), "base_sha256": manifest.get("base_sha256"),
              "activated_by": user_id, "source_path": manifest.get("source_path"), "repair_kind": repair_kind,
              "target_kind": manifest.get("target_kind", "library"), "artifact_digest": digest}
    await repair_storage(user_id).write(f"{_tool_key(tool_name)}/active.json", json.dumps(active).encode())
    _write_active_marker(user_id, tool_name, active)
    manifest["status"] = "active"
    manifest["activated_at"] = active["activated_at"]
    await write_manifest(user_id, manifest)
    return {**active, "revision_file": str(revision_file)}


async def rollback(user_id: str, tool_name: str) -> dict[str, Any]:
    """Remove ``active.json`` so the vendored file is used again (restart recovery is automatic)."""
    active = await read_active(user_id, tool_name)
    await repair_storage(user_id).delete(f"{_tool_key(tool_name)}/active.json")
    _write_active_marker(user_id, tool_name, None)
    if active is not None:
        manifest = await read_manifest(user_id, tool_name, str(active.get("revision", "")))
        if manifest is not None:
            manifest["status"] = "rolled_back"
            manifest["rolled_back_at"] = _now()
            await write_manifest(user_id, manifest)
    return {"tool_name": tool_name, "previous": active, "rolled_back_at": _now()}


async def restore_active_markers(user_id: str) -> int:
    """After a restart: materialize every active revision from storage so the sync loader finds it."""
    count = 0
    for manifest in await list_repairs(user_id):
        if manifest.get("active"):
            active = await read_active(user_id, manifest["tool_name"])
            if active is None:
                continue
            await materialize_revision(user_id, manifest["tool_name"], manifest["revision"])
            _write_active_marker(user_id, manifest["tool_name"], active)
            count += 1
    return count


def revision_notice_render(user_id: str) -> Callable[[InjectionContext], str | None]:
    """The ``ContextInjector`` render: announce each activated revision once per live session.

    Delivery is tracked in ``agent.state[REPAIR_NOTICES_STATE_KEY]``; the text is folded into the
    next user-turn model call only and never written to ``agent.messages``.
    """

    def render(context: InjectionContext) -> str | None:
        announced = set(context.state.get(REPAIR_NOTICES_STATE_KEY) or [])
        pending: list[str] = []
        root = _active_dir(user_id)
        if root.is_dir():
            for marker in root.glob("*/active.json"):
                try:
                    active = json.loads(marker.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                token = f"{marker.parent.name}@{active.get('revision')}"
                if token not in announced:
                    pending.append(f"`{marker.parent.name}` was repaired and the user-scoped revision "
                                   f"{active.get('revision')} is active in this session from the next invocation.")
                    announced.add(token)
        if not pending:
            return None
        context.state.set(REPAIR_NOTICES_STATE_KEY, sorted(announced))
        return "\n".join(pending)

    return render


def revision_notice(user_id: str) -> ContextInjector:
    """``ContextInjector(trigger="userTurn")`` over :func:`revision_notice_render`."""
    return ContextInjector(revision_notice_render(user_id), trigger="userTurn", name="ron:tool-repair-notice")


__all__ = [
    "ADAPTER_HOOKS", "DEFAULT_FIXER_EFFORT", "DEFAULT_FIXER_MODELS", "FIXER_HOSTED_NAMES", "FIX_TYPES",
    "fixer_a2a_provider", "fixer_hosted_tools", "MCP_SERVER_PACKAGE", "REPAIR_KINDS", "TARGET_KINDS", "active_adapter_file",
    "active_server_dirs", "adapt_tool", "browser_server_env", "fixer_sources", "load_adapter", "mcp_server_package_dir",
    "target_kind", "validate_adapter_source", "REPAIR_CONTEXT_STATE_KEY", "REPAIR_COUNTS_STATE_KEY", "REPAIR_HOOK_ORDER", "REPAIR_NOTICES_STATE_KEY",
    "REPAIR_REQUEST_STATE_KEY", "REVISION_STATUSES", "RepairConfig", "RepairRun", "RepairService", "RepairEvidence",
    "Investigation", "NON_REPAIRABLE_TOOLS", "approval_token", "artifact_digest", "fixer_paths", "sandbox_run_args",
    "RevisionConflict", "SOP_NAME", "ToolRepairTrigger", "activate", "active_revision_file", "build_fixer", "sop_parameters", "sop_task",
    "create_sandbox", "destroy_sandbox", "diagnose", "is_side_effecting", "list_repairs", "materialize_revision", "pending_proposal",
    "read_active", "read_manifest", "repair_storage", "restore_active_markers", "revision_notice", "revision_notice_render", "revision_resolver",
    "rollback", "route_fix", "select_context_examples", "write_manifest",
]
