# Strands Harness (`strands-harness==0.1.2`) & Pinned Strands SDK (`563f57d7`) Source-Verified Reference

> **Ground truth for Ren (`RonBrowserRebuild`)** — Verified line-by-line against installed `./venv/lib/python3.14/site-packages/strands_harness/` (`strands-harness==0.1.2`) and editable `./agent/api/core/harness-sdk/strands-py/src/strands/` (commit `563f57d7a387931760a2c3106014cd7c0db4c9bc` = Python SDK `v1.57.2` + `deploy/strands-bidi.patch`).

---

## 1. Package Versions & Critical Differences vs Upstream Docs (`upstream/*.md`)

Upstream `strandsagents.com/docs/user-guide/harness/` (saved in `./upstream/`) reflects `strands-harness` `v0.3.4` + newer `strands-agents`. **Ren pins `strands-harness==0.1.2` and `strands` SHA `563f57d7`.** Never import post-`0.1.2` module paths shown in `upstream/*.md`:

| Area | Installed in Ren (`strands-harness==0.1.2` + `strands@563f57d7`) | Upstream Docs (`v0.3.4` / `v1.58+`) |
|---|---|---|
| `make_subagent` & axis policies (`Preset`, `Choice`, `Fixed`, `Inherit`, `Open`, `Option`, `AgentSpec`) | **`from strands_harness.tools import make_subagent, Preset, Choice, Fixed, Inherit, Open, Option, AgentSpec`** (`strands_harness/tools/subagent.py`) | Moved in later SDK to `strands.vended_tools.subagent` & `strands.multiagent.spec` (**DOES NOT EXIST** in `563f57d7`!) |
| `builtin_plugins` default | **`("todos", "environment")`** (`strands_harness/defaults.py:7` — BOTH enabled by default!) | Changed to `["environment"]` (`todos` became opt-in later) |
| `ContextOffloader` | Auto-attached by `create_harness` when `context_manager` is `"auto"` or `"agentic"` unless consumer already passed one (`strands_harness/agent.py:493-499`). Uses `FileStorage(tempfile.mkdtemp(prefix="strands-harness-offload-"))` when `session` has no `dir`! | Removed in `v0.2.0` in favor of `ContextManager` stash |
| `memory` injection frequency | `injection="everyTurn"` (`strands_harness/memory.py:130`) | Changed to `"userTurn"` in `v0.3.2` |
| `Agent.shutdown()` | **Does not exist** in `563f57d7` (use `agent.cleanup()` for MCP cleanup if needed) | Added in `v0.2.0` |
| Formation wrappers in `strands_harness` | **NONE.** `create_harness(...)` returns a plain `strands.Agent`. Multi-agent formations (`GraphBuilder`, `Graph`, `Swarm`, `MultiAgentBase`, `MultiAgentPlugin`) live strictly in `strands.multiagent`. | Same |

---

## 2. Complete `strands_harness` (`0.1.2`) Public API Surface

### 2.1 Root Exports (`strands_harness/__init__.py`)

```python
from strands_harness import (
    # Core factory & prompt contract
    create_harness,                  # -> strands.Agent
    build_system_prompt,             # (instructions=None, context=None) -> str
    HARNESS_CONTRACT,                # str (model-neutral behavioral contract)

    # Portable JSON config helpers (strands_harness/config.py)
    DEFAULT_HARNESS_AGENT_CONFIG,    # dict[str, Any]
    define_harness_agent_config,     # (config=None, **overrides) -> dict[str, Any]
    normalize_harness_agent_config,  # (config=None) -> dict[str, Any]
    harness_agent_kwargs_from_config,# (config=None, *, base_dir=None) -> dict[str, Any]

    # Built-in defaults (strands_harness/defaults.py)
    BUILTIN_PLUGIN_NAMES,            # ("todos", "environment")
    BUILTIN_TOOL_NAMES,              # ("shell", "read", "write", "edit", "web_fetch", "web_search", "programmatic_tool_caller", "subagent")

    # Resolution helpers
    resolve_interventions,           # (spec, *, model=None) -> list[Any]
    resolve_memory,                  # (memory, *, model, effort, caching) -> MemoryManager | None
    supports_thinking,               # (provider: str, name: str) -> bool
    supports_web_search,             # (provider: str, name: str) -> bool

    # Types (strands_harness/types/agent.py & interventions.py)
    BuiltinPluginName,               # Literal["todos", "environment"]
    BuiltinToolName,                 # Literal["shell", "read", "write", "edit", "web_fetch", "web_search", "programmatic_tool_caller", "subagent"]
    BuiltinToolsConfig,              # TypedDict
    ContextManagerConfig,            # TypedDict (mode, budget, context_window)
    ContextManagerOption,            # Literal["auto", "agentic"] | bool | ContextManagerConfig
    Effort,                          # Literal["auto", "off", "low", "medium", "high", "xhigh", "max"] | None
    InterventionAsk,                 # Literal["all", "smart"]
    InterventionValue,               # Any
    InterventionsOption,             # InterventionValue | Sequence[InterventionValue] | None
    MemoryConfig,                    # TypedDict (dir, stores)
    ProgrammaticToolCallerConfig,    # TypedDict (allowed_tools, timeout_seconds)
    ReadConfig,                      # TypedDict (max_output_size, default_line_limit)
    SessionConfig,                   # TypedDict (id, dir)
    ShellConfig,                     # TypedDict (timeout)
    SubagentConfig,                  # TypedDict (max_depth)
    WebFetchConfig,                  # TypedDict (model, transport, max_chars)
    WebFetchTransport,               # Callable[[str], str]
)
```

### 2.2 Submodule Exports

- **`strands_harness.plugins`** (`plugins/__init__.py`):
  - `Todos(Plugin)` (`name = "harness:todos"`, state key `"todos"`): registers `@tool todos(todos: list[TodoItem] | None = None)` and injects current `[x]/[ ]` checklist via `<system-reminder>` on every `BeforeModelCallEvent`.
  - `TodoItem(TypedDict)`: `{"id": str, "content": str, "status": Literal["pending", "in_progress", "completed"]}`.
  - `EnvironmentContext(Plugin)` (`name = "harness:environment"`): on `AgentInitializedEvent`, runs `uname -s` + `pwd` in `agent.sandbox` and reads `AGENTS.md` from working directory (up to `max_agents_md_bytes = 32_768`), appending an `Environment:` block + `Project instructions (from .../AGENTS.md):` block to `agent.system_prompt`.
- **`strands_harness.tools`** (`tools/__init__.py` & `tools/subagent.py`):
  - Subagent factory & policies: `make_subagent`, `build_default_subagent`, `GENERALIST`, `AgentSpec`, `Preset`, `Option`, `Fixed`, `Inherit`, `Open`, `Choice`.
  - Monty sandbox tool orchestrator: `make_programmatic_tool_caller`, `programmatic_tool_caller`, `DEFAULT_PROGRAMMATIC_TOOL_CALLER_DESCRIPTION` (`pydantic_monty==0.0.23`, executes Python snippet calling allowed sibling tools, returning only `stdout`).
  - Sandbox file tools: `read`, `make_read`, `write`, `edit` (all route through `tool_context.agent.sandbox`).
  - Web tools: `make_web_fetch` (urllib + HTML-to-text + secondary `Agent` summarizer), `exa_web_search`, `make_exa_web_search` (Exa MCP JSON-RPC `https://mcp.exa.ai/mcp`).
- **`strands_harness.telemetry`** (`telemetry.py`):
  - `setup_tracer()`: configures `StrandsTelemetry` (`OTEL_EXPORTER_OTLP_ENDPOINT` -> OTLP exporter; `STRANDS_HARNESS_CONSOLE_EXPORT=1` -> console exporter). Called automatically inside `create_harness()`.

---

## 3. `create_harness(...)` Exact Signature, Mechanics & Multi-Tenant Rules

### 3.1 Exact Signature (`strands_harness/agent.py:310-328`)

```python
def create_harness(
    *,
    model: str | Model | None = None,
    effort: Effort = "auto",
    instructions: str | None = None,
    tools: Sequence[Any] | None = None,
    plugins: Sequence[Plugin] | None = None,
    mcp_servers: str | Path | Mapping[str, Any] | None = None,
    builtin_tools: Sequence[BuiltinToolName] | BuiltinToolsConfig | None = None,
    background_tasks: BackgroundTasksConfig | bool | None = None,
    caching: Literal["auto"] | bool | None = _UNSET,  # defaults to "auto" unless model is a Model instance
    context_manager: ContextManagerOption | None = "auto",
    session: bool | str | SessionConfig | None = True,
    skills: bool | str | Path | Sequence[str | Path] | AgentSkills | None = True,
    memory: bool | MemoryConfig | MemoryManager | None = True,
    builtin_plugins: Sequence[BuiltinPluginName] | None = None,
    interventions: InterventionsOption = None,
    **agent_kwargs: Any,
) -> Agent:
```

### 3.2 Option-by-Option Behavior (`strands_harness/options.py` & `agent.py`)

1. **`model` & `effort` & `caching`** (`models.py`):
   - Default `model=None` resolves `STRANDS_MODEL` env var or `"bedrock/global.anthropic.claude-opus-4-6-v1"`.
   - Accepts `"provider/model_id"` (`anthropic`, `bedrock`, `bedrock-converse`, `bedrock-mantle`, `google`, `gemini`, `mistral`, `ollama`, `openai`, `openai-responses`, `sagemaker`, `vertexai`, `writer`), bare Bedrock IDs, or a pre-built `strands.models.Model` (including `ModelRouter`).
   - **Pre-built `Model` instance gotcha**: if `model` is a `Model` instance, `effort` other than `"auto"` logs a warning and is ignored; `caching` explicitly passed as `"auto"`/`True` logs a warning (`models.py:436`). **Always pass `caching=False` when passing Ren's `build_model(...)` or `ModelRouter(...)`.**
2. **`instructions` vs `system_prompt`** (`prompt.py`, `agent.py:446-455`):
   - If `system_prompt` is NOT in `agent_kwargs`, `create_harness` sets `system_prompt = build_system_prompt(instructions)`, which joins `HARNESS_CONTRACT` + `instructions` with `\n\n`.
   - If `system_prompt` IS passed in `agent_kwargs`, it overrides `build_system_prompt(instructions)` completely (`instructions` is ignored with a warning).
   - If `caching` is enabled on Anthropic or Bedrock Converse, `system_prompt` is converted to `[SystemContentBlock(text=...), SystemContentBlock(cachePoint={"type": "default"})]`.
3. **`builtin_tools`** (`options.py:85-120`, `agent.py:249-307`):
   - Default `None`: enables ALL 8 tools in `BUILTIN_TOOL_NAMES`: `("shell", "read", "write", "edit", "web_fetch", "web_search", "programmatic_tool_caller", "subagent")`.
   - List form: e.g. `builtin_tools=[]` (disables all) or `builtin_tools=["programmatic_tool_caller"]` (enables only listed). Unknown tool names raise `ValueError`.
   - Dict form (`BuiltinToolsConfig`):
     - Without `"*"`: starts from all 8 enabled, then toggles/configures named keys (e.g. `{"subagent": False, "web_fetch": {"model": ...}}`).
     - With `"*": False`: starts from empty set and enables only keys set to `True` or a config dict (e.g. `{"*": False, "subagent": {"max_depth": 2}}`).
   - **Sandbox tool stripping (`_drop_sandbox_tools`, `agent.py:52-69, 551`)**: `Agent(sandbox=...)` auto-registers `LocalSandbox`'s own `bash` tool; `create_harness` removes `agent.sandbox.get_tools()` from `agent.tool_registry.registry` right before returning `agent` so only harness's configured tools remain.
4. **`builtin_plugins`** (`options.py:123-135`, `agent.py:468-473`):
   - Default `None` in `0.1.2`: enables **`["todos", "environment"]`**.
   - **Multi-tenant rule**: NEVER leave `builtin_plugins=None` on Ren's API server because `EnvironmentContext` runs `uname -s && pwd` on the host and injects the repo's `AGENTS.md` into the model prompt! Pass `builtin_plugins=["todos"]` (or `[]`).
5. **`skills`** (`options.py:163-184`, `agent.py:474-480`):
   - `skills=True` (default): checks if `Path.cwd() / ".agent" / "skills"` is a directory; if it exists and contains skills, attaches `AgentSkills(skills=[...])`.
   - `skills=False` or `None` or `[]`: disables `AgentSkills`.
   - `skills=<str | Path | Sequence[str | Path]>`: loads directory/directories into `AgentSkills(skills=existing_paths)` (silently skips non-existent paths or empty skill sets; logs warning if `AgentSkills` raises `ValueError`).
   - `skills=AgentSkills(...)`: attaches the consumer-constructed `AgentSkills` plugin instance directly! (Works with programmatic `Skill(...)` objects, `SKILL.md` paths, or URLs.)
6. **`session`** (`options.py:138-160`, `agent.py:482-490`):
   - `session=True` (default): sets `session_dir = ./.agent/sessions` (used for `ContextOffloader` storage), no `SnapshotSessionManager` unless `"id"` is given.
   - `session="my-id"` or `{"id": "my-id", "dir": "..."}`: creates `SnapshotSessionManager(session_id=..., storage=FileStorage(session_dir), save_latest_on="trigger")` unless `session_manager` was passed directly in `agent_kwargs`.
   - `session=False`: disables local `.agent/sessions` directory. Pass `session=False` + `session_manager=...` in `agent_kwargs` when using Ren's user/issue `SnapshotSessionManager` / `ThreadSessionManager`.
7. **`context_manager`** (`options.py:187-206`, `agent.py:492-511`):
   - `"auto"` (default) or `True`: attaches `ContextManager(mode="auto")` + `ContextOffloader(storage=FileStorage(offload_dir))` (unless consumer already passed `conversation_manager` or a `ContextOffloader` in `plugins`).
   - `"agentic"`: attaches `ContextManager(mode="agentic")` + `ContextOffloader`.
   - `{"mode": "auto"|"agentic", "budget": float, "context_window": int}`: forwards `budget` and `context_window` to `ContextManager`.
   - `False` or `None`: disables both `ContextManager` and `ContextOffloader`.
   - **Temp-dir note**: When `context_manager` is active and `session=False` (so `session_dir is None`), `create_harness` creates `tempfile.mkdtemp(prefix="strands-harness-offload-")` unless a `ContextOffloader(storage=...)` is already included in `plugins=[...]`!
8. **`memory`** (`memory.py:55-135`, `agent.py:432-444`):
   - `memory=True` (default): creates `FileMemoryStore(base_dir="./.agent/memory")` + `MemoryManager(stores=[store], extractor=ModelExtractor(model=small_model), injection="everyTurn")` (unless `memory_manager` is in `agent_kwargs`).
   - `memory={"dir": ...}` or `{"stores": [...]}`: uses custom directory or `MemoryStore` list with harness's `ModelExtractor`.
   - `memory=MemoryManager(...)`: uses that `MemoryManager` directly.
   - `memory=False` or `None`: disables harness memory.
9. **`background_tasks`** (`agent.py:72, 221-246, 540-541`):
   - `_ALWAYS_BACKGROUND_TOOL_NAMES = frozenset({"subagent"})`.
   - `background_tasks=None` or `True` (default): configures `{"agentic": ["*"], "always": ["subagent"]}` (if `subagent` is present; `{"agentic": ["*"]}` otherwise).
   - `background_tasks=False`: passes `background_tasks=None` to `Agent` (completely disables `_BackgroundTasks` plugin and `strands_manage_background_task` tool).
   - `background_tasks={...}` (`BackgroundTasksConfig` dict): preserves your policy (`agentic`, `always`, `never`, `wait_for_completion`, `max_concurrency`, `timeout`) and merges `"subagent"` into `always` if built-in `subagent` is enabled.
10. **Tool Name Collision Guard (`_check_name_collisions`, `agent.py:186-208`)**:
    - Collects all `AgentTool` instances across `builtin`, `tools`, `harness_plugins`, `consumer_plugins`, and `memory_manager.get_tools()`. Normalizes `tool_name.replace("-", "_")`. Raises `ValueError` at construction if any two share a normalized name.
11. **`**agent_kwargs` Passthrough (`agent.py:523-549`)**:
    - Forwarded directly to `strands.Agent(...)`: `name`, `description`, `agent_id`, `callback_handler`, `hooks`, `session_manager`, `conversation_manager`, `memory_manager`, `structured_output_model`, `retry_strategy`, `sandbox`, `trace_attributes`, `state`, etc.

### 3.3 Portable JSON Config Schema (`strands_harness/config.py`)

`DEFAULT_HARNESS_AGENT_CONFIG` (`config.py:48-73`) defines the 23 valid keys for `define_harness_agent_config` / `normalize_harness_agent_config` / `harness_agent_kwargs_from_config`:

```python
DEFAULT_HARNESS_AGENT_CONFIG = {
    "name": "agent",
    "description": None,
    "instructions": None,
    "model": None,
    "modelModule": None,            # "pkg.mod:factory" -> Model
    "effort": "auto",
    "tools": [],                    # list of "pkg.mod:tool" or "./file.py:tool"
    "subagents": [],                # list of "pkg.mod:agent_or_factory" -> invoked if callable, wrapped via .as_tool()!
    "mcpServers": {},               # dict[name, server_spec] or JSON path (rejects tasksConfig in Python)
    "builtinTools": list(BUILTIN_TOOL_NAMES),
    "caching": "auto",
    "contextManager": "auto",       # "auto" | "agentic" | "off" (mapped to False) | bool | dict
    "session": False,               # NOTE: False in portable config default (vs True in create_harness!)
    "skills": True,
    "memory": False,                # NOTE: False in portable config default (vs True in create_harness!)
    "memoryStores": [],             # merged into memory={"stores": ...}
    "plugins": [],                  # list of "pkg.mod:PluginClassOrFactory" (invoked!)
    "builtinPlugins": list(BUILTIN_PLUGIN_NAMES),
    "interventions": None,
    "interventionModules": [],
    "sandbox": None,                # passed in agent_kwargs["sandbox"]
    "agentConfigModules": [],       # list of callables returning dict merged into agent_kwargs
    "dependencies": {"python": [], "npm": []},
    "agentConfig": {},              # raw passthrough kwargs merged into create_harness(**kwargs)
}
```
- Unknown top-level keys raise `ValueError: Unknown harness agent config key(s): ...`.
- `harness_agent_kwargs_from_config(config, base_dir=...)` resolves module specs and returns exact kwargs for `create_harness(**kwargs)`.

---

## 4. `AgentSkills`, `Skill`, `SKILL.md` Frontmatter & `use_skill` Subagent Mechanics

### 4.1 Native `Skill` Dataclass & `SKILL.md` Frontmatter Parser (`strands/vended_plugins/skills/skill.py`)

```python
from strands import AgentSkills, Skill  # re-exported from strands.vended_plugins.skills

@dataclass
class Skill:
    name: str                                     # 1-64 chars: ^[a-z0-9]+(-[a-z0-9]+)*$ ; should match parent dir name
    description: str                              # 1-1024 chars; injected into <available_skills> XML
    instructions: str = ""                        # Markdown body of SKILL.md after closing ---
    path: Path | None = None                      # Skill directory path (parent of SKILL.md), or None if programmatic/URL
    allowed_tools: list[str] | None = None        # Parsed from frontmatter `allowed-tools` (space-delimited str or YAML list) or `allowed_tools`
    metadata: dict[str, Any] = field(default_factory=dict)  # Parsed ONLY from frontmatter `metadata:` dict!
    license: str | None = None                    # Frontmatter `license`
    compatibility: str | None = None              # Frontmatter `compatibility` (<=500 chars)
```

- **Classmethods**:
  - `Skill.from_file(skill_path: str | Path, *, strict: bool = False) -> Skill` (accepts directory containing `SKILL.md`/`skill.md` or file path directly).
  - `Skill.from_directory(skills_dir: str | Path, *, strict: bool = False) -> list[Skill]` (loads all immediate child directories containing `SKILL.md`/`skill.md`, sorted by directory name).
  - `Skill.from_content(content: str, *, strict: bool = False, path: Path | None = None) -> Skill`.
  - `Skill.from_url(url: str, *, strict: bool = False, timeout: int = 30) -> Skill` (`https://` only).
- **CRITICAL Frontmatter Parsing Facts (`skill.py:169-208`)**:
  1. `_build_skill_from_frontmatter` ONLY extracts `name`, `description`, `allowed-tools` / `allowed_tools`, `metadata`, `license`, and `compatibility`.
  2. **Any extra top-level YAML keys (such as `context:`, `agent:`, `model:`) are NOT stored on `Skill` unless nested under `metadata:` in `SKILL.md`!** Example:
     ```yaml
     ---
     name: source-verifier
     description: Verify primary sources and extract verbatim citations
     allowed-tools: web_search http_request
     metadata:
       context: none
       model: fast
       agent: verifier
     ---
     ```
     Then `skill.allowed_tools == ["web_search", "http_request"]` and `skill.metadata == {"context": "none", "model": "fast", "agent": "verifier"}`!
  3. **`allowed_tools` is NOT enforced by `AgentSkills` (`skill.py:238`: `Experimental: not yet enforced`)** — when using `AgentSkills` alone on a single agent, `allowed_tools` is merely printed as `"Allowed tools: ..."` in the text returned by the `skills` tool (`agent_skills.py:486-487`). **Hard tool scoping happens when a skill runs in a subagent (`make_subagent` / `Agent.as_tool()`), where the child `Agent` is constructed with ONLY those tools!**

### 4.2 Native `AgentSkills` Plugin (`strands/vended_plugins/skills/agent_skills.py`)

```python
class AgentSkills(Plugin):
    name = "agent_skills"

    def __init__(
        self,
        skills: SkillSource | Sequence[SkillSource],  # str | Path | Skill | Sequence[...]
        state_key: str = "agent_skills",
        max_resource_files: int = 20,
        strict: bool = False,
    ) -> None: ...
```

- **Mode of operation: Foreground progressive disclosure (NOT a subagent)**:
  1. **BeforeInvocationEvent hook (`_on_before_invocation`)**: Appends `<available_skills>\n<skill>\n<name>...</name>\n<description>...</description>\n<location>...</location>\n</skill>\n</available_skills>` to `agent.system_prompt` (preserving `list[SystemContentBlock]` cache points if present). Stores `last_injected_xml` and `activated_skills: list[str]` in `agent.state[state_key]`.
  2. **Registered tool (`skills`)**:
     ```python
     @tool(context=True)
     async def skills(self, skill_name: str, tool_context: ToolContext) -> str
     ```
     - Dynamic `ToolSpec` description lists `<name>: <description>` for every loaded skill (`_build_tool_spec`).
     - Returns `<skill_Activation>` markdown string containing `# Skill: <name> activated`, `skill.instructions`, `Allowed tools: ...`, `Compatibility: ...`, `Location: <skill.path>`, and `Available resources:` listing up to `max_resource_files` (20) files discovered up to depth 3 inside `scripts/`, `references/`, and `assets/` via `agent.sandbox` (or local filesystem fallback).
  3. **Runtime API**: `get_available_skills() -> list[Skill]`, `set_available_skills(skills)`, `get_activated_skills(agent) -> list[str]`.

### 4.3 How Subagent / Forked Skill Execution Works Natively (`make_subagent` & `Agent.as_tool()`)

Neither `strands` nor `strands_harness` ships a built-in function literally named `use_skill`. Instead, `strands_harness` and `strands` provide **two 100% native subagent mechanisms** that execute skills in isolated or forked subagents with hard tool scoping, streaming events, interrupt propagation, and skill guidance:

#### Mechanism A: `strands_harness.tools.make_subagent` (Multi-Skill `use_skill` Dispatcher with Axis Policies & Forked Context Support)

Source: `./venv/lib/python3.14/site-packages/strands_harness/tools/subagent.py` (lines 72–660).

```python
from strands_harness.tools import (
    AgentSpec, Choice, Fixed, Inherit, Open, Option, Preset, make_subagent
)

@dataclass(frozen=True)
class Preset:
    instructions: str | None = None
    tools: Sequence[str] | None = None
    mcp_servers: Sequence[str] | None = None
    model: Any = None
    context: Literal["none", "all", "no_tools"] | None = None
    last_messages: int | None = None
    description: str | None = None

@dataclass
class AgentSpec:
    task: str
    instructions: str | None = None
    tools: list[Any] | None = None
    mcp_servers: dict[str, Any] | None = None
    model: Any = None
    messages: list[Any] | None = None
    agent_type: str | None = None
    parent: Agent | None = None

def make_subagent(
    *,
    presets: Mapping[str, Preset] | None = None,
    instructions: Fixed | Inherit | Open | Choice | None = None,
    tools: Fixed | Inherit | Choice | None = None,
    mcp_servers: Fixed | Inherit | Choice | None = None,
    model: Fixed | Inherit | Choice | None = None,
    context: Fixed | Choice | None = None,
    allowed_tools: Sequence[Any] | Mapping[str, Any] | None = None,
    allowed_mcp: Mapping[str, Any] | None = None,
    max_depth: int = 3,
    builder: Callable[[AgentSpec], Any] | None = None,
    name: str = "subagent",
    description: str | None = None,
) -> AgentTool:
```

- **How `make_subagent(name="use_skill", ...)` works at runtime (`_SubagentTool.stream`, lines 435–573)**:
  1. **Schema control via Axis Policies**:
     - When `presets={skill.name: Preset(instructions=skill.instructions, tools=skill.allowed_tools, context=..., description=skill.description)}` is combined with `instructions=Fixed(None)`, `tools=Fixed(None)`, `mcp_servers=Fixed(None)`, `model=Inherit()` (or `Fixed`), and `context=Fixed("none")` (or `Choice(["none", "no_tools", "all"])`), the generated `ToolSpec` exposes **ONLY**:
       - `agent_type`: `{"type": "string", "enum": [<skill names>], "description": "Specialist preset to use..."}` (required when no `Open`/`Choice` overrides exist — line 354!)
       - `task`: `{"type": "string", "description": "Self-contained task for the child agent..."}`
       - (plus `context` / `last_messages` ONLY if `context=Choice(...)` is enabled).
     - The model **cannot** invent ad-hoc system prompts or escalate tools beyond the skill's `Preset.tools`!
  2. **Foreground Isolated vs Forked History (`_slice_messages`, lines 270–316)**:
     - `context="none"` (default): Child starts with empty `messages=[]` (clean subagent context; intermediate tool calls never pollute parent).
     - `context="all"` (forked full context): Child receives a copy of parent `agent.messages` (with any trailing in-flight `toolUse` turn stripped so message history is valid for model APIs), optionally sliced to `last_messages`.
     - `context="no_tools"` (forked text-only context): Child receives parent's conversational text turns with all `toolUse`/`toolResult` blocks stripped (`_text_only`).
  3. **Hard Tool Scoping (`_resolve_tools`, lines 236–267)**:
     - Looks up tool names from `Preset.tools` in `allowed_tools` pool (the curated pool of `AgentTool` instances passed to `make_subagent(allowed_tools=...)`, NOT needing those leaf tools to be registered on the parent orchestrator agent!). Excludes `self._name` and `"strands_manage_background_task"` automatically.
  4. **Skill Guidance + Resources via `builder` (`spec: AgentSpec -> Agent`)**:
     - `builder` receives `spec` (`spec.agent_type` = skill name, `spec.instructions` = `skill.instructions`, `spec.tools` = scoped `list[AgentTool]`, `spec.model`, `spec.messages`, `spec.parent`) and returns `create_harness(...)` with `skills=AgentSkills(skills=[skill_by_name[spec.agent_type]])` (or `system_prompt=build_system_prompt(spec.instructions)` + `AgentSkills`), `tools=spec.tools`, `builtin_tools=[]`, `builtin_plugins=["todos"]`, `caching=False`, `session=False`, `memory=False`, `background_tasks=False`!
  5. **Depth guard, streaming, HITL interrupts, cancellation & return type**:
     - Reads/increments `agent.state.get("subagent_depth")`; if `depth >= max_depth`, yields error `ToolResult` without spawning.
     - Copies `invocation_state`, strips `cancel_signal`, forwards parent `cancel_signal` into `child.stream_async(spec.task, invocation_state=child_inv_state, cancel_signal=cancel_signal)`.
     - Streams every child event upstream wrapped in `ToolStreamEvent(tool_use, event)`.
     - If `result.stop_reason == "interrupt"`, yields `ToolInterruptEvent(tool_use, list(result.interrupts))` and resumes cleanly on HITL response (`tool_context._interrupt_state`).
     - Yields final `ToolResultEvent({"toolUseId": ..., "status": "success", "content": [{"text": str(result).strip() or "(subagent produced no text output)"}]})`.

#### Mechanism B: `Agent.as_tool(...)` (`strands/agent/_agent_as_tool.py:33-365`)

Every `create_harness(...)` skill specialist is a `strands.Agent` and natively exposes `.as_tool(...)`:

```python
skill_tool = skill_harness_agent.as_tool(
    name=skill.name.replace("-", "_"),          # defaults to sanitize(agent.name)
    description=skill.description,              # defaults to agent.description
    preserve_context=False,                     # False = stateless baseline snapshot restored after each call; True = stateful across calls
    delegate=False,                             # False = standard tool result (parallel & background-compatible); True = immediate turn handoff
)
```
- Input schema: `{"type": "object", "properties": {"input": {"type": "string", "description": "Input text for the agent."}}, "required": ["input"]}`.
- Streams `ToolStreamEvent(tool_use, event)` (when `delegate=False`), propagates child `interrupts` cleanly (`__agent_tool_snapshot` stored in `interrupt_state.context` when `preserve_context=False`), forwards `cancel_signal`, and returns `str(result)`.
- Note on `delegate=True`: invokes `_AgentDelegation` (`_agent_delegation.py`), which forces single-tool-call-per-turn, ends the parent's turn immediately (`event.end_turn`), is incompatible with `model.stateful=True` or `structured_output_model`, and **cannot** run in `background_tasks` (`_executor.py:381`). Use `delegate=False` (default) for Deep Research subagents so parallel fan-out and background execution work!

#### Mechanism C: Existing Ren Repo Conventions (Read-Only Cross-Reference)
- `agent/api/core/live_tools.py:92-104`: Attaches native `AgentSkills(skills=[LYRIA_SKILL_DIR])` directly to `Agent` / `BidiAgent` for progressive disclosure of `lyria-realtime-prompting/SKILL.md`.
- `agent/api/core/panel_tools.py:1043-1090` (`create_skill_tool`): Wraps an `AgentSkills` plugin + `tool_assignments` dict into `@tool(name="run_skill", context=True)` spawning an isolated child `Agent(..., plugins=[AgentSkills(skills=[skill])])`.
- `agent/api/core/teaching.py:1032-1126` (`create_learned_skill_tools`): Exposes `@tool async def use_skill(skill_name: str, request: str)` for user-taught Agent SOP skills and `PANEL_SKILLS_DIR` skills.
- `agent/api/core/harness_agents.py`: Persists user-created `define_harness_agent_config` configs in Supabase `harness_agents` and mounts each via native `A2AServer(agent_factory=...)` at `/a2a/agents/<id>`.
- `agent/api/core/issue_agents.py:315-391`: Canonical `create_harness(...)` setup in Ren (`caching=False`, `session=False`, `builtin_tools=[]`, `builtin_plugins=["todos"]`, explicit `skills=...`, explicit `memory=MemoryManager(...)`, `ContextOffloader` on user storage).

### 4.4 Canonical Pattern: Configuring `create_harness` Nodes in `Graph` & Nested `Swarm`/`Graph` Formations Under 100% Skill Guidance

To guarantee that **every node in the Deep Research `Graph` (and every nested `Graph` / `Swarm` `MultiAgentBase` formation node) operates under Agent Skill guidance at all times and ONLY acts via `use_skill` subagents**:

1. **Orchestrator / Formation Lead `Agent` Nodes (Zero Raw Leaf Tools!)**:
   - Created with `create_harness`:
     - `builtin_tools=[]` (ZERO raw `shell`, `read`, `write`, `edit`, `web_fetch`, `web_search`, or generalist `subagent`).
     - `builtin_plugins=["todos"]` (native task tracking; NO host `environment` leak).
     - `skills=AgentSkills(skills=[node_orchestrator_skill])` + `instructions=node_orchestrator_skill.instructions` (so the node lead itself is 100% governed by its stage `Skill`, with `<available_skills>` + `skills` progressive disclosure for any reference files in its skill folder).
     - `tools=[use_skill]` — where `use_skill = make_subagent(name="use_skill", presets=stage_skill_presets, instructions=Fixed(None), tools=Fixed(None), mcp_servers=Fixed(None), model=Inherit(), context=Fixed("none"), allowed_tools=leaf_tool_pool, builder=skill_subagent_builder)` (or `[s_agent.as_tool() for s_agent in stage_skill_subagents]`).
     - Because `tools` contains **ONLY** `use_skill` (and `todos` / `skills`), the node agent is structurally incapable of executing unscoped tools outside a skill subagent!
2. **Leaf `use_skill` Subagents (Built by `skill_subagent_builder` or `.as_tool()`)**:
   - Created with `create_harness`:
     - `instructions=skill.instructions`
     - `skills=AgentSkills(skills=[skill])` (so the subagent also sees `scripts/`, `references/`, `assets/` of its `SKILL.md` package)
     - `tools=spec.tools` (clamped strictly to `skill.allowed_tools` from `leaf_tool_pool`)
     - `builtin_tools=[]` (or `["programmatic_tool_caller"]` ONLY when a skill explicitly declares Monty orchestration over its scoped tools)
     - `builtin_plugins=["todos"]`, `caching=False`, `session=False`, `memory=False`, `background_tasks=False`, `callback_handler=None`.
3. **Nested Formation Nodes (`Graph` or `Swarm` inside outer `GraphBuilder`)**:
   - `GraphBuilder.add_node(executor: AgentBase | MultiAgentBase, node_id: str)` natively accepts `Agent` (from `create_harness`), nested `Graph`, or nested `Swarm` (`strands/multiagent/graph.py` & `base.py`)!
   - Inside a nested `Swarm([member_a, member_b, ...])`, Strands automatically injects `handoff_to_agent` onto each member `Agent`; each member `Agent` is itself constructed via the exact `create_harness` pattern above (governed by its `Skill` and acting solely through `use_skill` subagents + native `handoff_to_agent`)!

---

## 5. Native Async / Background Tool Execution & Status Polling

### 5.1 Native SDK `_BackgroundTasks` Plugin (`strands/background_tasks/`)

Enabled via `Agent(background_tasks=...)` or `create_harness(background_tasks=...)`.

#### Config Schema (`strands/background_tasks/_types.py:13-32`)

```python
class BackgroundTasksConfig(TypedDict, total=False):
    wait_for_completion: bool              # Default: True
    agentic: Sequence[AgentTool | str]     # Default: ["*"] (when neither always nor never has "*")
    always: Sequence[AgentTool | str]      # Tools ALWAYS dispatched to background without _background_execution flag
    never: Sequence[AgentTool | str]       # Tools NEVER backgrounded (even if matched by agentic/always "*")
    max_concurrency: int                   # Default: 4 (positive int; Semaphore in _BackgroundTaskEngine)
    timeout: float                         # Default: math.inf (seconds per background task)

BackgroundTaskStatus = Literal[
    "queued", "working", "input_required", "completed", "failed", "cancelled"
]
```

#### Exact Lifecycle & Status Polling Tool (`strands_manage_background_task`)

1. **Auto-Registered Status/Control Tool (`_background_tasks.py:155-184`)**:
   Attaching `background_tasks` automatically registers **`strands_manage_background_task`**:
   ```python
   @tool(name="strands_manage_background_task")
   async def _manage_background_task(
       self,
       mode: Literal["list", "get", "cancel"],
       task_id: str | None = None,
   ) -> dict[str, Any]:
   ```
   - `mode="list"` -> returns JSON `{"tasks": [{"task_id": "...", "tool_name": "...", "status": "queued"|"working"|"completed"|...}]}`.
   - `mode="get", task_id="..."` -> returns metadata JSON (`task_id`, `tool_name`, `status`, `created_at`, `updated_at`, `error`) PLUS the completed `ToolResult["content"]` blocks if settled!
   - `mode="cancel", task_id="..."` -> cancels the `asyncio.Future` in `_BackgroundTaskEngine` and transitions status to `"cancelled"`.
2. **Dispatch (`always` vs `agentic`)**:
   - Tools in `always` (e.g. `"subagent"` in `create_harness`, or `"deep_research"`) are ALWAYS backgrounded automatically.
   - Tools in `agentic` get `"_background_execution": {"type": "boolean", "description": "Run this tool in the background and continue without waiting for its result."}` injected into their `inputSchema` at `InvokeModelStage` (`_transform_tool_specs`, lines 281–308). Note: tools whose root `inputSchema` uses `$ref`, `allOf`, `anyOf`, `oneOf`, `not`, `if`, `then`, `else`, or `delegate=True` `_AgentAsTool` are skipped.
   - When backgrounded, `_ToolExecutor._execute_background` (`_executor.py:254-325`) calls `submit_tool_call(...)` and immediately emits `ToolResultEvent(result, backgrounded=True)` with:
     ```
     Background task dispatched.

     Task ID: <uuid4>
     Tool: <tool_name>
     Status: working
     ```
3. **Thread / Event Loop Execution (`_runtime.py` & `_engine.py`)**:
   - `_BackgroundTaskRuntime` runs a process-singleton daemon thread `"strands-background-tasks"` owning a persistent `asyncio` loop.
   - If the calling `Agent` is running on a live `asyncio` loop (`origin_loop` not closed and not the temporary `run_async` loop), `_execute_tool_task` schedules the coroutine back onto `origin_loop` via `asyncio.run_coroutine_threadsafe(execute_tool(), execution.origin_loop)` (`_engine.py:256-259`), preserving single-loop affinity for httpx/MCP clients!
4. **Automatic Continuation & `wait_for_completion` Semantics (`_background_tasks.py:312-345`)**:
   - **Mid-turn (`BeforeModelCallEvent`)**: While the agent is doing other work in the same turn, any background tasks that settle are automatically injected before the next model call as synthetic `strands_manage_background_task(mode="get", task_id=...)` toolUse/toolResult pairs via `agent._continuation.add_input(...)`. The agent can ALSO call `strands_manage_background_task(mode="list"|"get"|"cancel")` explicitly at any step.
   - **End-of-turn (`AfterInvocationEvent`)**:
     - When `wait_for_completion=True` (SDK default, and **required by Ren's `PanelRuntimeManager`** — `panel_runtime.py:43`): `_after_invocation` awaits `_await_next_settlement` until all tracked background tasks settle (or hit `input_required`), queues their results into `agent._continuation`, and re-enters the model loop so the turn finishes with the synthesized answer.
     - When `wait_for_completion=False`: `invoke_async` / `stream_async` returns while tasks continue in `InProcessTaskManager`. **Important SDK constraints**:
       1. `Agent.load_snapshot` raises `RuntimeError("Cannot load a snapshot while background tasks are still tracked")` (`agent.py:1098-1099`) if another turn tries to reload a snapshot on that `Agent` while an in-process task is still in-flight!
       2. If the process restarts, restored non-terminal tasks in `agent.state["strands.background_tasks"]` are marked `"failed"` (`Task did not finish before snapshot restore`).
       3. **`BidiAgent` (Gemini Live voice agent) does NOT support `Agent` `Plugin`s or `_BackgroundTasks`** (`BidiAgent` has no `_middleware_registry`, `_background_tasks`, or `BeforeModelCallEvent` continuation).

### 5.2 How ANY of Ren's Agents Invokes Deep Research Asynchronously & Checks Status

Ren has five agent surfaces:
1. **Agent Panel Chat (`Agent` in `PanelRuntimeManager`)** — `background_tasks.wait_for_completion=True` per turn; session restored across turns via `ThreadSessionManager`.
2. **Gemini Live Voice (`BidiAgent` in `endpoints/bidi.py` + `live_tools.py`)** — native `BidiAgent` (supports `@tool` / `AgentTool`, does NOT support `_BackgroundTasks` plugin).
3. **Issue Agents (`create_harness` in `issue_agents.py`)** — runs both via `IssueAgentRuntime` (A2A) and `PanelRuntimeManager` (`create_issue_chat_agent`), with `background_tasks={"agentic": ["*"], "wait_for_completion": True}`.
4. **Project Agents (`Agent` in `project_agent.py`)** — constructed per request inside `PanelRuntimeManager`.
5. **User Specialists (`create_harness` in `harness_agents.py`)** — served over `A2AServer(agent_factory=...)`.

**100% Native Dual-Mode Integration (Zero Non-Native Glue)**:

1. **Server-Owned Native `Graph` Execution + Native `@tool` Handle/Status Surface (Works Across ALL 5 Agent Surfaces, Multi-Turn & `BidiAgent`!)**:
   - The Deep Research `Graph` (`GraphBuilder` with `SnapshotSessionManager` / `GraphState`) runs asynchronously on the FastAPI event loop (just like `PanelRuntimeManager.start(...)` and `LiveMusicTools` in `live_music.py`).
   - Expose native Strands `@tool` tool(s) (e.g., `deep_research` with `action: Literal["start", "status", "result", "cancel"]` or paired `@tool` functions `start_deep_research` / `get_deep_research_status`):
     - **`start`**: Starts the native `Graph` (`graph.stream_async(...)` / `SnapshotSessionManager`) in an `asyncio.Task` and immediately returns `{research_id, status: "running", entry_points, nodes}`. Does NOT block `BidiAgent` voice turns or `PanelRuntimeManager` chat turns!
     - **`status` / `result`**: Reads the live native `GraphState` (`status`, `completed_nodes`, `failed_nodes`, `execution_order`, active node/subagent activity, and when completed, the `MultiAgentResult` / final report artifact) and returns it to the calling agent whenever the agent checks on it during its own tasking!
     - **`cancel`**: Signals the native Strands `cancel_signal` / cancels the task cleanly.
2. **In-Turn Native `BackgroundTasksConfig` Compatibility**:
   - For any `Agent` / `create_harness` (such as an Issue Agent on a long `/goal` run or a Specialist agent) that wants to dispatch Deep Research **and wait/check within the same multi-step invocation** using `strands_manage_background_task(mode="list"|"get"|"cancel")`, a foreground `@tool async def run_deep_research(...)` (or `action="run"`) streaming `ToolStreamEvent` over `graph.stream_async(...)` (the exact `create_formation_tool` pattern already in `panel_tools.py:1143-1219`) works **out of the box** with `background_tasks={"agentic": ["*"], "wait_for_completion": True}`: the agent passes `_background_execution=True`, continues other tool calls in parallel, polls `strands_manage_background_task(mode="list"|"get")`, and receives automatic continuation delivery upon completion!

### 5.3 Note on `A2AServer` & `MCPClient` Async Tasks in Pinned `563f57d7`
- **`A2AServer` (`strands/multiagent/a2a/server.py` & `executor.py`)**: Wraps `SAAgent` (`strands.Agent`), NOT `MultiAgentBase` (`Graph`/`Swarm`), unless the `Graph` is wrapped inside an `Agent` or exposed via `@tool`. `A2AClientToolProvider` (`strands/vended_tools/a2a_client/a2a_client.py`) exposes `a2a_discover_agent`, `a2a_list_discovered_agents`, and `a2a_send_message` (awaits `client.send_message` until terminal event; does not expose a separate `a2a_get_task` polling tool).
- **`MCPClient` Tasks (`strands/tools/mcp/mcp_tasks.py`)**: `ExperimentalMcpTasksConfig(ttl=..., poll_timeout=...)` polls MCP task status internally inside a single `mcp_call_tool_async` call until terminal status; from the Strands `Agent`'s perspective it is a single async tool call (which can itself be backgrounded by `_BackgroundTasks`).
