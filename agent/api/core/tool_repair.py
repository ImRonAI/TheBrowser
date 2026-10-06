"""Per-user tool repair (CAT-50/51) on native SDK, harness, evals and vendored-tool surfaces.

Tenant = ``user_id``. A repaired tool is a **user-scoped revision** stored under the user's HF
namespace (``panel/users/<sha256(user_id)>/tool-repairs/<tool>/``); other users keep importing
the vendored library file. There is no global activation and no maintainer promotion path.

Pipeline (each piece is a public surface that already exists in this repo):

1. ``ToolRepairTrigger`` (``AfterToolCallEvent``, order 310, after ``ToolObservation``) counts
   repeated ``(tool_name, exception class)`` failures of **library** tools in one live session and,
   at ``RON_TOOL_REPAIR_THRESHOLD``, records a ``repair_request`` in ``agent.state`` so the runtime
   can emit ``tool_repair_proposed``. Nothing runs without the user's click.
2. ``start_repair`` (``POST /tools/repairs``) runs one **fixer** per user: a fresh ``create_harness``
   child (same pattern as ``recall``) on a ``ModelRouter(FallbackStrategy)`` over the Perplexity
   chain, whose tools are the harness built-ins ``shell``/``read``/``write``/``edit`` routed through
   the SDK ``Agent(sandbox=)`` seam (a per-run ``DockerSandbox``: the library at ``/sources/tools``,
   ``agent/api/core`` at ``/sources/core`` for the wrapper audit, the repair workspace at
   ``/workspace``; the ``NotASandboxLocalEnvironment`` fallback is flagged), read-only memory
   search, and two application ``@tool``s: ``record_demonstration`` and ``submit_repair``.
3. Diagnosis = ``strands_evals.detectors.diagnose_session`` over the in-memory exporter spans
   (``RON_TOOL_OBSERVATION=1``) or, without it, the ``agent.state`` outcomes — redacted by
   ``tool_observation.redact_outcome`` before anything leaves the session. The **wrapper audit**
   and the reflection checklist are SOP steps (``agent/sops/repairing-a-broken-tool.sop.md``,
   retrieved through the pinned ``strands_agents_sops`` server by ``native_sop_prompt``).
4. Activate re-checks ``base_sha256`` (409 on drift), writes ``active.json`` and swaps the tool in
   every live session of that user via ``PanelToolCatalog.reload_tool`` (native
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
from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry
from strands.models.routing import FallbackStrategy, ModelRouter
from strands.types.tools import AgentTool
from strands.vended_plugins.context_injector import ContextInjector, InjectionContext
from strands_harness import create_harness
from strands_harness.memory import resolve_memory

from agent.api.core import config
from agent.api.core.native_sop import native_sop_prompt
from agent.api.core.panel_storage import SerializedFileMemoryStore, _ScopedStorage, _user_scope, get_panel_storage
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
REVISION_STATUSES = ("proposed", "verified", "failed", "unverified", "not_reproducible", "needs_maintainer",
                     "active", "rolled_back")
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
    ``a2a_list_discovered_agents``, ``a2a_send_message``) over Ron's native A2A endpoints
    (``a2a_tools.a2a_agent_urls``: the panel A2A server plus ``RON_A2A_AGENTS``; ``urls`` /
    ``RON_TOOL_REPAIR_A2A_AGENTS`` add fixer-specific peers). ``None`` when A2A is disabled."""
    from agent.api.core.a2a_tools import a2a_agent_urls

    extra = list(urls) if urls is not None else [u.strip() for u in config.RON_TOOL_REPAIR_A2A_AGENTS.split(",") if u.strip()]
    known = a2a_agent_urls(extra)
    if not known:
        return None
    from strands_tools.a2a_client import A2AClientToolProvider

    return A2AClientToolProvider(known_agent_urls=known)


@dataclass(frozen=True)
class RepairConfig:
    enabled: bool = True
    threshold: int = 2
    models: tuple[str, ...] = DEFAULT_FIXER_MODELS
    effort: str | None = DEFAULT_FIXER_EFFORT
    timeout_s: int = 900
    hosted_tools: tuple[str, ...] | None = None   # None -> RON_TOOL_REPAIR_HOSTED_TOOLS
    a2a_agents: tuple[str, ...] | None = None     # None -> RON_TOOL_REPAIR_A2A_AGENTS / PANEL_A2A_URL

    @classmethod
    def from_env(cls) -> RepairConfig:
        raw = os.getenv("RON_TOOL_REPAIR_MODELS", "") or config.RON_TOOL_REPAIR_MODELS
        models = tuple(m.strip() for m in raw.split(",") if m.strip()) or DEFAULT_FIXER_MODELS
        effort = (os.getenv("RON_TOOL_REPAIR_EFFORT", config.RON_TOOL_REPAIR_EFFORT) or "").strip() or None
        threshold = int(os.getenv("RON_TOOL_REPAIR_THRESHOLD", str(config.RON_TOOL_REPAIR_THRESHOLD)))
        return cls(enabled=os.getenv("RON_TOOL_REPAIR", "1") != "0", threshold=max(1, threshold), models=models,
                   effort=effort, timeout_s=int(os.getenv("RON_TOOL_REPAIR_TIMEOUT_S", str(config.RON_TOOL_REPAIR_TIMEOUT_S))))


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


class ToolRepairTrigger(HookProvider):
    """Propose a repair after ``threshold`` identical failures of a library tool in one session."""

    def __init__(self, config_: RepairConfig | None = None) -> None:
        self.config = config_ or RepairConfig.from_env()

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(AfterToolCallEvent, self.after_tool_call, order=REPAIR_HOOK_ORDER)

    def after_tool_call(self, event: AfterToolCallEvent) -> None:
        if not self.config.enabled:
            return
        outcome = tool_outcome(event)
        _record_context(event.agent, dict(event.tool_use), outcome)
        failed = outcome["status"] != "success" or outcome["exception"] is not None
        if not failed or outcome["cancelled"] or outcome["retry"]:
            return
        # Every tool failure counts. The KIND decides what the fixer can deliver: a user-scoped
        # revision (library) or a diagnosed proposal for the maintainer (mcp/core/other).
        kind = target_kind(event.selected_tool)
        key = f"{outcome['tool_name']}|{_exception_class(outcome)}"
        counts = dict(event.agent.state.get(REPAIR_COUNTS_STATE_KEY) or {})
        counts[key] = int(counts.get(key, 0)) + 1
        event.agent.state.set(REPAIR_COUNTS_STATE_KEY, counts)
        if counts[key] < self.config.threshold:
            return
        existing = event.agent.state.get(REPAIR_REQUEST_STATE_KEY) or {}
        if existing.get("tool_name") == outcome["tool_name"] and existing.get("status") in ("proposed", "running"):
            return
        event.agent.state.set(REPAIR_REQUEST_STATE_KEY, {
            "id": uuid.uuid4().hex, "tool_name": outcome["tool_name"], "exception_class": _exception_class(outcome),
            "kind": kind, "count": counts[key], "status": "proposed", "proposed_at": _now(),
            "failing_tool_use_id": outcome["toolUseId"],
            "outcome": redact_outcome(outcome, dict(event.tool_use)),
            "observation": bool(os.getenv("RON_TOOL_OBSERVATION", "").strip().lower() in {"1", "true", "yes"}),
        })
        logger.warning("tool_name=<%s>, kind=<%s>, count=<%d> | repeated failure, repair proposed",
                       outcome["tool_name"], kind, counts[key])


def pending_proposal(agent: Agent) -> dict[str, Any] | None:
    """The proposal the runtime should surface, or ``None``."""
    request = agent.state.get(REPAIR_REQUEST_STATE_KEY)
    return dict(request) if isinstance(request, dict) and request.get("status") == "proposed" else None


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
SANDBOX_IMAGE = os.getenv("RON_TOOL_REPAIR_SANDBOX_IMAGE", "python:3.12-slim")
SANDBOX_WORKDIR = "/workspace"


def _mount_sources(run: RepairRun) -> list[tuple[Path, str, bool]]:
    """``(host_path, container_path, read_only)`` binds: the repair workspace writable at /workspace,
    everything the fixer may read (library, Ron's core, installed strands_tools, the MCP server
    package) read-only under /sources."""
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR

    binds = [(run.workspace, SANDBOX_WORKDIR, False), (PROJECT_TOOLS_DIR, "/sources/tools", True)]
    for name, path in fixer_sources().items():
        binds.append((path, f"/sources/{name}", True))
    return binds


def create_sandbox(run: RepairRun) -> tuple[Any, str]:
    """A fresh SDK ``DockerSandbox`` for this run (``docker run -d`` of ``SANDBOX_IMAGE`` with the
    binds above), or the SDK's no-isolation local environment when Docker is unavailable —
    reported as ``"local"`` so the run is marked ``unverified``."""
    from strands.sandbox.docker import DockerSandbox
    from strands.sandbox.not_a_sandbox_local_environment import NotASandboxLocalEnvironment

    if shutil.which("docker"):
        container = f"ron-repair-{run.revision}"
        args = ["docker", "run", "-d", "--rm", "--name", container, "-w", SANDBOX_WORKDIR]
        for host, inside, read_only in _mount_sources(run):
            args += ["-v", f"{host.resolve()}:{inside}{':ro' if read_only else ''}"]
        args += [SANDBOX_IMAGE, "sleep", "infinity"]
        try:
            subprocess.run(args, check=True, capture_output=True, timeout=120)
            # Make a self-contained interpreter: pytest + the library's imports the tool under
            # repair needs are installed by the fixer itself with `pip install` via `shell`.
            subprocess.run(["docker", "exec", container, "pip", "install", "-q", "pytest"], check=False,
                           capture_output=True, timeout=300)
            run.container = container
            return DockerSandbox(container, working_dir=SANDBOX_WORKDIR), "docker"
        except (subprocess.SubprocessError, OSError) as error:
            logger.warning("error=<%s> | Docker sandbox unavailable; running without isolation", error)
    return NotASandboxLocalEnvironment(), "local"


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


def _repair_tools(run: RepairRun) -> list[AgentTool]:
    """``record_demonstration`` and ``submit_repair``: application tools writing the manifest."""

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
                ``needs_maintainer`` (only for a system-prompt defect or a Ron wrapper defect no
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
            if run.sandbox == "local":
                status = "unverified"
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
        run.manifest.update({
            "status": status, "fix_type": fix_type, "route": route, "repair_kind": repair_kind, "summary": summary,
            "reflection": reflection, "wrapper_audit": wrapper_audit, "diff": diff, "test_file": test_file,
            "demonstrations": run.demonstrations, "sandbox": run.sandbox, "submitted_at": _now(), "files": sorted(files),
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
    memory = resolve_memory(stores=list(stores), writable=False)
    tools: list[AgentTool] = [t for s in stores if isinstance(s, SerializedFileMemoryStore) for t in s.get_tools()]
    return [*tools, *memory.tools]


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
                hosted_tools: Sequence[str] | None = None, a2a_agents: Sequence[str] | None = None) -> Agent:
    """One ``create_harness`` call. The harness supplies the agent: built-in ``shell``/``read``/
    ``write``/``edit`` (all routed through the SDK ``Agent(sandbox=)`` seam, here a ``DockerSandbox``
    with the workspace writable and every source read-only), ``todos`` for the multi-step SOP, and
    the harness system-prompt contract. Ron adds only its domain: the two application tools
    ``record_demonstration``/``submit_repair`` and read-only memory search. The SOP itself is the
    agent's INPUT: the native Agent SOP server renders ``Run this SOP: <agent-sop>...<user-input>``
    with the repair parameters (``sop_task``). No host tools, no session, no memory writes."""
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
    sandbox, run.sandbox = (sandbox_factory or create_sandbox)(run)
    tools: list[Any] = [*_repair_tools(run)]
    try:
        tools.extend(_memory_search_tools(run.user_id))
    except Exception as error:  # memory is optional for a repair
        logger.info("error=<%s> | fixer runs without memory search", error)
    # Native A2A: the installed strands_tools provider (discover / list / send_message) over Ron's agents.
    a2a = fixer_a2a_provider(a2a_agents)
    if a2a is not None:
        tools.extend(a2a.tools)  # the provider vends plain AgentTools (not an SDK ToolProvider)
    return create_harness(
        model=router, instructions=FIXER_PROMPT, tools=tools,
        builtin_tools=["shell", "read", "write", "edit"], builtin_plugins=["todos"],
        sandbox=sandbox, memory=False, session=False, skills=False, caching=None, context_manager=False,
        background_tasks=False, interventions=None, callback_handler=None, load_tools_from_directory=False,
        retry_strategy=None, name="Ron Tool Fixer",
    )


FIXER_PROMPT = """You are Ron's tool fixer. Your input is a native Agent SOP ("Repairing a Broken Tool") with
its parameters in <user-input>; run it in order and finish by calling submit_repair exactly once.

Server-side (Perplexity) tools run inside your model turn: web_search, fetch_url, image_search for
documentation and prior art; the sandbox for scratch computation; the GitHub connector for upstream
source/issues/PRs of the tool's project; Context7 (MCP) for current library documentation. A2A tools
(a2a_discover_agent / a2a_send_message) reach Ron's other agents when you need their state.
Your shell, read, write and edit tools run inside one sandbox container. Read-only mounts:
/sources/tools (vendored tool library), /sources/core (Ron's wrapper code), /sources/strands_tools
(installed host tools), /sources/mcp (browser MCP server package). /workspace is the only writable
area. Install what you need with pip inside the sandbox. Never claim a run you did not perform."""


def sop_parameters(run: RepairRun, request: dict[str, Any], failing_use: dict[str, Any] | None,
                   context: list[dict[str, Any]], diagnosis: dict[str, Any] | None) -> str:
    """The SOP's ``user_input``: every parameter the SOP declares, as a readable block."""
    schema = run.manifest.get("tool_spec")
    kind = run.manifest.get("target_kind", "library")
    source_path = run.manifest.get("source_path")
    if kind == "library":
        location = f"Source: /sources/tools/{source_path} (sha256 {run.manifest['base_sha256']}). A copy is at /workspace/files/{source_path}."
    elif kind == "mcp":
        location = ("Target kind: MCP tool (browser/MCP server). Two user-scoped repairs are possible: "
                    f"(a) repair_kind=server — the server package is copied at /workspace/server/{MCP_SERVER_PACKAGE}/ "
                    "(read-only original at /sources/mcp); edit the copy; on activation this user's browser server process runs "
                    "it via PYTHONPATH. (b) repair_kind=adapter — write /workspace/adapter/<tool>.py with transform_input(input) "
                    "and/or transform_result(result, input) to fix the call boundary (argument shape, missing fields, result "
                    "shape) without touching the server. Audit Ron's wrapper in /sources/core (panel_browser.py, panel_tools.py). "
                    "The sandbox has no browser: demonstrations against the live server are dry runs that assert the "
                    "transformed call; unit-test the adapter/server logic directly with pytest.")
    elif kind == "core":
        location = (f"Target kind: core host tool (installed package file {source_path}, read-only at /sources/strands_tools). "
                    "Installed code is not edited per user: write /workspace/adapter/<tool>.py (repair_kind=adapter) with "
                    "transform_input/transform_result and verify it in the sandbox. Audit the wrapper in /sources/core.")
    else:
        location = ("Target kind: plugin/agent tool without a source file. Write /workspace/adapter/<tool>.py "
                    "(repair_kind=adapter) with transform_input/transform_result; audit /sources/core.")
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


class RepairService:
    """One active repair per user+tool; runs the fixer and tracks results for the endpoints."""

    def __init__(self, config_: RepairConfig | None = None) -> None:
        self.config = config_ or RepairConfig.from_env()
        self._active: dict[tuple[str, str], asyncio.Task[dict[str, Any]]] = {}
        self._results: dict[tuple[str, str], dict[str, Any]] = {}

    def status(self, user_id: str, tool_name: str) -> dict[str, Any]:
        key = (user_id, tool_name)
        task = self._active.get(key)
        if task is not None and not task.done():
            return {"state": "running"}
        return {"state": "idle", "last": self._results.get(key)}

    async def start(self, *, user_id: str, session_id: str, tool_name: str, session_messages: Sequence[dict[str, Any]],
                    agent: Agent | None, on_event: Callable[[dict[str, Any]], Any] | None = None,
                    build_model: Callable[..., Any] | None = None,
                    sandbox_factory: Callable[[RepairRun], tuple[Any, str]] | None = None,
                    sop_prompt: str | None = None) -> dict[str, Any]:
        if not self.config.enabled:
            raise RuntimeError("RON_TOOL_REPAIR=0: tool repair is disabled")
        key = (user_id, _tool_key(tool_name))
        if (task := self._active.get(key)) is not None and not task.done():
            raise RuntimeError(f"A repair of {tool_name!r} is already running for this user")
        request = (agent.state.get(REPAIR_REQUEST_STATE_KEY) if agent is not None else None) or {}
        if request.get("tool_name") != tool_name:
            request = {"tool_name": tool_name, "count": 0, "outcome": None, "failing_tool_use_id": None}
        registered = agent.tool_registry.registry.get(tool_name) if agent is not None else None
        if registered is None:
            raise ValueError(f"{tool_name!r} is not registered in this session")
        kind = target_kind(registered)
        source = tool_source(registered)
        run = self._prepare(user_id, session_id, tool_name, source, registered, request, kind)
        if agent is not None:
            agent.state.set(REPAIR_REQUEST_STATE_KEY, {**request, "status": "running", "revision": run.revision})
        coroutine = self._execute(run, request, session_messages, agent, on_event, build_model,
                                  sandbox_factory, sop_prompt)
        task = asyncio.create_task(coroutine, name=f"tool-repair-{user_id}-{tool_name}")
        self._active[key] = task
        return {"revision": run.revision, "tool_name": tool_name, "state": "running"}

    async def wait(self, user_id: str, tool_name: str) -> dict[str, Any] | None:
        task = self._active.get((user_id, tool_name))
        return await task if task is not None else None

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
            "session_id": session_id, "created_at": _now(), "status": "proposed", "sop": SOP_NAME,
            "request": {k: v for k, v in request.items() if k in ("count", "exception_class", "outcome", "observation")},
            "tool_spec": {"name": spec.get("name"), "inputSchema": spec.get("inputSchema")} if isinstance(spec, dict) else None,
            "demonstrations": [], "reflection": {}, "wrapper_audit": {}, "diagnosis": None,
        }
        return RepairRun(user_id=user_id, session_id=session_id, tool_name=tool_name, revision=revision,
                         workspace=workspace, manifest=manifest)

    async def _execute(self, run: RepairRun, request: dict[str, Any], messages: Sequence[dict[str, Any]],
                       agent: Agent | None, on_event: Callable[[dict[str, Any]], Any] | None,
                       build_model: Callable[..., Any] | None, sandbox_factory: Any,
                       sop_prompt: str | None) -> dict[str, Any]:
        key = (run.user_id, run.tool_name)
        fixer: Agent | None = None
        try:
            await write_manifest(run.user_id, run.manifest)
            diagnosis = None
            try:
                from agent.api.core import panel_agent
                diag_builder = build_model or panel_agent.build_model
                diagnosis = await diagnose(run.session_id, model=diag_builder("perplexity", self.config.models[0], None, hosted_tools=False))
            except Exception as error:
                logger.info("error=<%s> | diagnosis unavailable; fixer works from recorded outcomes", error)
            run.manifest["diagnosis"] = diagnosis
            failing_use = None
            for message in messages:
                for block in message.get("content", []) if isinstance(message, dict) else []:
                    use = block.get("toolUse") if isinstance(block, dict) else None
                    if isinstance(use, dict) and use.get("toolUseId") == request.get("failing_tool_use_id"):
                        failing_use = {"toolUseId": use.get("toolUseId"), "input": use.get("input", {})}
            context = select_context_examples(messages, run.tool_name, exclude_tool_use_id=request.get("failing_tool_use_id"))
            fixer = await asyncio.to_thread(build_fixer, run, models=self.config.models, effort=self.config.effort,
                                            build_model=build_model, sandbox_factory=sandbox_factory,
                                            hosted_tools=self.config.hosted_tools, a2a_agents=self.config.a2a_agents)
            task_text = await asyncio.to_thread(sop_task, run, request, failing_use, context, diagnosis, sop_prompt=sop_prompt)

            async def drive() -> None:
                async for event in fixer.stream_async(task_text):
                    if on_event is not None and "result" not in event:
                        await _maybe_await(on_event({"revision": run.revision, "tool_name": run.tool_name, "event": event}))

            await asyncio.wait_for(drive(), timeout=self.config.timeout_s)
            if not run.submitted:
                run.manifest.update({"status": "failed", "summary": "The fixer ended without calling submit_repair.",
                                     "demonstrations": run.demonstrations, "sandbox": run.sandbox})
                await write_manifest(run.user_id, run.manifest)
            result = {"revision": run.revision, "tool_name": run.tool_name, "status": run.manifest["status"],
                      "summary": run.manifest.get("summary", ""), "demonstrations": run.manifest.get("demonstrations", []),
                      "sandbox": run.sandbox, "route": run.manifest.get("route"), "repair_kind": run.manifest.get("repair_kind"),
                      "target_kind": run.manifest.get("target_kind")}
        except Exception as error:
            logger.exception("tool_name=<%s>, revision=<%s> | repair run failed", run.tool_name, run.revision)
            run.manifest.update({"status": "failed", "summary": f"{type(error).__name__}: {error}"[:500],
                                 "demonstrations": run.demonstrations, "sandbox": run.sandbox})
            try:
                await write_manifest(run.user_id, run.manifest)
            except Exception:
                logger.exception("manifest write failed")
            result = {"revision": run.revision, "tool_name": run.tool_name, "status": "failed",
                      "summary": run.manifest["summary"], "demonstrations": run.demonstrations, "sandbox": run.sandbox}
        finally:
            if fixer is not None:
                try:
                    await asyncio.to_thread(fixer.cleanup)
                except Exception:
                    logger.exception("fixer cleanup failed")
            await asyncio.to_thread(destroy_sandbox, run)
        self._results[key] = result
        if agent is not None:
            agent.state.set(REPAIR_REQUEST_STATE_KEY, {**(agent.state.get(REPAIR_REQUEST_STATE_KEY) or {}),
                                                       "status": "ready", "result": result})
        if on_event is not None:
            await _maybe_await(on_event({"revision": run.revision, "tool_name": run.tool_name, "ready": result}))
        return result


async def _maybe_await(value: Any) -> None:
    if asyncio.iscoroutine(value):
        await value


# --- Activate / rollback ------------------------------------------------------------------

class RevisionConflict(RuntimeError):
    """The vendored file changed since the repair was verified (HTTP 409)."""


async def activate(user_id: str, tool_name: str, rev: str) -> dict[str, Any]:
    """Re-check the vendored sha, write ``active.json`` and materialize the revision file."""
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR

    manifest = await read_manifest(user_id, tool_name, rev)
    if manifest is None:
        raise FileNotFoundError(f"Unknown revision {rev!r} for {tool_name!r}")
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
    revision_file = await materialize_revision(user_id, tool_name, rev)
    active = {"revision": rev, "activated_at": _now(), "base_sha256": manifest.get("base_sha256"),
              "activated_by": user_id, "source_path": manifest.get("source_path"), "repair_kind": repair_kind,
              "target_kind": manifest.get("target_kind", "library")}
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
    "REPAIR_REQUEST_STATE_KEY", "REVISION_STATUSES", "RepairConfig", "RepairRun", "RepairService",
    "RevisionConflict", "SOP_NAME", "ToolRepairTrigger", "activate", "active_revision_file", "build_fixer", "sop_parameters", "sop_task",
    "create_sandbox", "destroy_sandbox", "diagnose", "is_side_effecting", "list_repairs", "materialize_revision", "pending_proposal",
    "read_active", "read_manifest", "repair_storage", "restore_active_markers", "revision_notice", "revision_notice_render", "revision_resolver",
    "rollback", "route_fix", "select_context_examples", "write_manifest",
]
