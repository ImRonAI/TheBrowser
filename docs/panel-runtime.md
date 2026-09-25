# Panel runtime: setup, configuration and verified boundaries

## Setup

Use the project `venv/` and `agent/api/requirements.txt`. The native integration
requires **`strands-agents[a2a,mistral,openai,anthropic,gemini]==1.56.0`** and
**`huggingface_hub==1.20.1`**, both pinned and verified in the project environment.
`requirements-full.txt` is not the authoritative dependency list.

```bash
./venv/bin/python -m pip install -r agent/api/requirements.txt
npm install
npm run electron:dev
```

`npm install` needs the sibling `../electron-playwright-mcp` package. Put provider
credentials in the root `.env`: `PERPLEXITY_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, or `MISTRAL_API_KEY` as needed.
The API runs on port 8765; Electron automation, Playwright MCP and CDP use
3000/8931/9222. The Vite renderer port may drift. For manual Electron launches,
unset `ELECTRON_RUN_AS_NODE`; npm scripts handle this.

All agent tools run on the host through the Strands `strands_tools` package; there
is no shell sandbox, Shell MCP server, or `sandbox.toml`. The browser MCP server
path (`venv/bin/electron-playwright-mcp`) is repo-relative and owned by
`agent/api/core/panel_browser.py`, which defines the two browser targets
(`user` = the user's Ron window via SSH reverse tunnel, `cloud` = the server-side
headless Ron). See [`deploy-vps.md`](deploy-vps.md) for the 24/7 server layout.

## Native execution and sessions

`create_panel_agent()` supplies explicit provider models and `tools=[catalog]`
to `config_to_agent`. All six provider JSON files contain `"tools": []`; their
names/prompts remain configuration metadata. The SDK owns streaming, tool
execution, retries, snapshots, memory and plugin invocation.

The endpoint offloads construction to a worker thread and passes trusted
`runtime_options` from `PanelRuntimeManager`: agent ID, native
`SnapshotSessionManager`, callback and runtime hooks. Application and
runtime hooks/plugins are merged. A standalone constructor also uses native
snapshots but does not supply the runtime journal or reconnect lifecycle.

The manager owns one live agent per user/session and server-side invocation tasks.
Disconnecting SSE does not cancel execution. Native snapshots plus an application
journal support restoration; event replay is bounded and process-local. An
unclean restart reports `recovery_required` instead of automatically repeating
tools. Run **one manager-owning API worker**; storage and session writes have no
cross-process locking.

Ordinary provider/factory failures do not require recovery. Their error is
included in both SSE and session snapshots, and a subsequent message is allowed.
Failed native invocations save their completed history before the terminal
journal entry so reconnect/reload cannot silently discard completed tool work.
Forced shutdown, an unclean restart, or failure to save that history still
requires recovery; the renderer displays the underlying error alongside the
recovery explanation.

Browser context and queued steering are delivered as a separate ephemeral user
message at Strands' `InvokeModelStage.Input` boundary, after the complete tool
result batch. The stock `ContextInjector(trigger="everyTurn")` folds text into
tool-result messages; the pinned Mistral and Responses formatters emit text from
such mixed messages before tool replies. Avoiding that mixed input fixes the
ordering at its source. Mistral and OpenAI use their native model classes without
formatting subclasses. Perplexity retains only its pre-existing streaming-event
compatibility implementation, not an ordering override.

The runtime registers this input middleware through `AgentInitializedEvent`,
using the same SDK boundary as `ContextInjector`. The middleware API is internal
in pinned Strands 1.56 (`strands._middleware`); revalidate it on SDK upgrades.
It changes only the SDK's defensive per-call input copy, never durable messages,
system prompts or provider requests. Native streaming, tool execution, retries,
interrupts and snapshots are unchanged.

HTTP entrypoints:

* `POST /chat`: message, checkpoint resume or interrupt response.
* `GET /sessions/{session_id}`: canonical snapshot and replay cursor.
* `GET /sessions/{session_id}/events`: replay/reconnect stream.
* `POST /sessions/{session_id}/steer`: queued user steering.
* `POST /sessions/{session_id}/cancel`: cancellation request.

Selection and options are immutable for an existing session. Use a new session to
change them. Pass an authenticated user identity from the surrounding application;
the `user_id` field itself is not an authentication mechanism.

### Request options

```json
{
  "session_id": "example",
  "provider": "openai",
  "model": "gpt-4o",
  "message": "Analyze the supplied material",
  "options": {
    "context": "auto",
    "tool_execution": "concurrent",
    "checkpointing": false,
    "background": false,
    "goal": ""
  }
}
```

| Option | Supported behavior |
| --- | --- |
| `context` | `auto` or `agentic` native context manager; `sliding` uses `SlidingWindowConversationManager` with the context plugin disabled. |
| `tool_execution` | Native `concurrent` (default) or `sequential` executor. |
| `checkpointing` | Root native checkpoints; default false. Resume through the runtime. |
| `background` | Native background execution; default false. Always waits for completion. Discovery/loading, editor, questions, skills, subagents and formations stay foreground-only. |
| `goal` | Nonempty text enables native GoalLoop with a fresh judge model, no attempt/time cutoff and preserved history. User cancellation remains available. |

`ask_user(question)` uses native `ToolContext.interrupt`; there is no custom
handoff package. GoalLoop 1.56 may validate a paused invocation and incur a judge
call. The final-result gate prevents goal feedback from bypassing an interrupt or
checkpoint. Its timeout is checked between validations, not a hard provider-call
deadline (Ron leaves it unbounded). Callable goals are supported by trusted Python construction, not JSON
HTTP options.

Ron imposes no per-turn tool-call quota or overall root-run deadline. Native
context management remains enabled so long conversations can offload/compact
content rather than fail at the provider's context window. Host files are not
reset between turns. In-memory session storage is still lost on backend restart;
this is distinct from host-file persistence.

Perplexity has no read-idle timeout by default, allowing long reasoning and
server-side tool execution. `PERPLEXITY_READ_TIMEOUT=0` also disables it; a
positive number opts into a retryable read-idle watchdog in seconds. Connection
and write timeouts and finite transient-error retries remain. A genuinely hung
stream now requires user cancellation unless the watchdog is explicitly set.
Provider context/output caps and provider-managed tool/sandbox lifecycles are
not controlled by these settings. Unbounded work can incur ongoing API costs.

Retries use the public `from strands import ModelRetryStrategy` facade. Optional
`PANEL_RETRY_MAX_ATTEMPTS`, `PANEL_RETRY_INITIAL_DELAY` and `PANEL_RETRY_MAX_DELAY`
override native defaults 6/4/240 seconds. Provider client retries are separate.

## Storage and memory

* **Default `PANEL_STORAGE=memory` is ephemeral across process restarts.** It shares
  native `InMemoryStorage` within the process; it is not disk persistence.
* `PANEL_STORAGE=huggingface` uses an existing `HF_BUCKET_ID=namespace/bucket-name`
  and optional `HF_TOKEN`. It does not create a bucket or silently fall back to
  memory. Restart after changing storage environment settings.
* Session snapshots, runtime journals and cross-session memory are user-scoped.
  Native memory search/add tools and injection are enabled. Add writes are awaited;
  **automatic model-based memory extraction is disabled**.
* Memory search is keyword-based over the scoped namespace, not vector search.
  Per-user append locks coordinate writers within one process only.

See [storage implementation details](../agent/docs/panel-storage.md).

## Tools

The agent always carries the mandated core set, registered from the installed
`strands_tools` package (sync bodies offloaded via `adapt_native_tool`) plus the
vendored Strands `@tool`:

| Tool | Source | Purpose |
| --- | --- | --- |
| `mcp_client` | `strands_tools.mcp_client` | connect to MCP servers (stdio / streamable HTTP) and load their tools into the registry |
| `editor` | `strands_tools.editor` | view/create/edit files on the host |
| `shell` | `strands_tools.shell` | run shell commands on the host |
| `environment` | `strands_tools.environment` | read/manage environment variables |
| `http_request` | `strands_tools.http_request` | HTTP requests |
| `perplexity_search` | `agent/tools/strands_tools/research/perplexity_search_api.py` (async `@tool`, official `perplexityai` SDK, exposed under this name) | live web search |
| `tool_catalog` | `panel_tools.create_tool_catalog` | `list` / `search` / `describe` / `load` over the project library, and `load` of a configured MCP server by name (`user_browser` / `cloud_browser`) |
| `ask_user` | native `ToolContext.interrupt` | pause for user input |

### Browser target per chat

`POST /chat` takes `browser: "user" | "cloud"` (omitted → `RON_BROWSER_DEFAULT`,
default `user`). The value is pinned into the immutable session `selection`; a
different value later is `409`, an invalid one `422`. `create_panel_agent(browser=...)`
configures **only** that target's MCP server (`browser_server_config`) with a
prefixed, unstarted `MCPClient` whose `elicitation_callback` is
`accept_browser_elicitation` (electron-playwright-mcp elicits on mutating tools
regardless of Electron's own approval flag). The prompt's `## Browser automation`
section is generated per target by `browser_prompt_section()` and tells the agent to
stage it with `tool_catalog(action="load", name="<browser>_browser")`, replacing the
old `mcp_client(action="connect", ...)` ritual. Tools arrive as
`<browser>_browser_playwright_*`; they are parent-only (`is_parent_only_tool`) so
`think` children and formations cannot bypass the availability hook.

`BrowserAvailabilityHook` (`BeforeToolCallEvent`, async) probes the selected
target's Electron URL before each `<browser>_browser_*` call. Unreachable →
native interrupt `browser_unavailable:<attempt>` with
`reason = {browser, tool, url, question}`; the response `cancel` sets
`event.cancel_tool` (error tool result *Browser unavailable; user cancelled this
action.*), anything else re-probes and either proceeds or interrupts again with the
next attempt number (kept in `agent.state`). No automatic retry, replay or browser
switching. The renderer detects this interrupt by `reason.browser` and offers
**Continue** / **Cancel action**.

The legacy `mcp_client` route still works for ad-hoc servers; composition installs
the elicitation-capable `MCPClient` factory on the installed `strands_tools.mcp_client`
module once (`accept_browser_elicitation`).

### Tool library and `tool_catalog`

Everything else under `agent/tools/strands_tools/` (≈170 tools across
`agent_orchestration`, `browser`, `devops`, `healthcare`, `multimodal`,
`omni_channel_comms`, `research`, ...) is discoverable and loadable at runtime.
`tool_catalog` AST-scans the tree without importing (so `list`/`search`/`describe`
never execute library code) and hides names that collide with core tools.
`load` imports the file as a submodule of the synthetic package
`ron_vendored_tools.<category>.<module>` so the library's relative imports
(`from ..tool_catalog_manager import ...`, `from .errors import ...`) resolve
**without** adding the directory to `sys.path` or shadowing the installed
`strands_tools` distribution, then stages it through the catalog and publishes it
at the `AfterTools` boundary: the tool is callable in the model's next step.
Import failures (missing optional dependencies) are returned as tool errors.

### `think` (Perplexity Agent API configuration only)

With `provider=perplexity` the agent also gets `think`, an async-generator tool
that runs a **child Agent** with a fresh model from the same `build_model`
factory, the parent's current tools minus `think`/`ask_user`/`tool_catalog`, and
the parent's system prompt plus a think addendum. The child's native loop
interleaves reasoning and tool calls; each child event is streamed to the parent
as `{think: true, event}` tool progress, which the runtime re-emits under
`node_path=[<think toolUseId>]` and the panel renders as an AI Elements
`ChainOfThought` block (thought → reasoning/tool steps → conclusion). The parent
system prompt (`PERPLEXITY_THINK_ADDENDUM`) requires frequent use of `think` and
tells the model that `think` is an agent with its tools. Children are cleaned up
per call. Other providers render provider reasoning deltas (Gemini thoughts, xAI)
in the same component.

## Explicit child assignments

`PANEL_SKILLS_DIRS` (OS path-separator-delimited) or `PANEL_SKILLS_DIR` enables native
AgentSkills. `PANEL_SKILL_TOOLS` is a JSON object mapping a skill name to an exact
array of registered tool names:

```bash
export PANEL_SKILLS_DIR=/absolute/path/to/skills
export PANEL_SKILL_TOOLS='{"summarize": [], "edit-notes": ["editor"]}'
```

An empty array grants no tools. A missing assignment denies `run_skill` for that
skill; skill metadata is not a grant. Names must be registered when composition
runs. An on-demand server that has not yet been activated cannot be assigned in
startup JSON; inject its unstarted MCP client as a managed `extra_tools` provider
from trusted application code if its tools are needed at construction.

An MCP assignment now creates an **exact-name `ToolProvider` view**, not a grant
of the entire client. The view owns a separate native consumer on the shared
MCPClient and filters each load. Assigning `read_file` never registers `write_file`
or newly advertised tools in the child. Missing assigned tools fail child loading.
Cleanup releases that child consumer without closing a parent's or sibling's
connection. Parent-bound discovery/loading, skill dispatch, memory and context
retrieval tools cannot be assigned to children. The editor can be explicitly
assigned. Tool-name restrictions do not constrain the effects of a granted tool
such as editor or shell.

### Formations

Defaults are `research_review` (research → review graph), `reasoning_swarm` (two
reasoning agents), and `nested_research_review` (graph → swarm). Their children
have no assigned local tools. Native swarm handoff decides which agents actually
run; two configured agents does not mean both are invoked every time. Provider
hosted capabilities remain model-dependent, not filesystem grants.

`PANEL_FORMATIONS_FILE=/absolute/path/formations.json` replaces those defaults:

```json
[
  {
    "type": "graph",
    "name": "notes_review",
    "nodes": {
      "draft": {"type": "agent", "name": "drafter", "system_prompt": "Draft from supplied notes.", "tools": []},
      "review": {"type": "agent", "name": "reviewer", "system_prompt": "Check the draft.", "tools": []}
    },
    "edges": [["draft", "review"]],
    "entry_points": ["draft"],
    "max_node_executions": 20,
    "execution_timeout": 900,
    "node_timeout": 300
  }
]
```

Graphs accept recursive graph/swarm/agent nodes. Swarms use `children` containing
agent specs, with optional `max_handoffs` and `max_iterations`. Omitted or null
formation count/time limits are unbounded by default; positive values explicitly
opt into limits (the example above is bounded). Native Graph uses `None`; SDK
1.56 Swarm requires numeric comparisons, so omitted counts use `sys.maxsize`,
total time uses infinity, and node timeout uses `None`. Agent specs require
explicit `tools`. Unknown fields are rejected. `[]` removes default formations;
formations only. Formation and skill runs stream through
native executors and clean up their children, but **have no durable child resume**.
Incomplete/checkpointed child results are reported as errors rather than completion.

## Provider and A2A boundaries

Provider construction supports Perplexity, OpenAI, Anthropic, Gemini, xAI and
Mistral. Configured credentials indicate availability, not successful live model
validation. Provider-hosted tools belong on model configuration, not `Agent.tools`.
Hosted tools are enabled by default where the installed adapter supports them and
the provider documents them (see `NATIVE_PROVIDER_CAPABILITIES`): Perplexity
`web_search`/`fetch_url`/`sandbox` (`PERPLEXITY_HOSTED_TOOLS`,
`PERPLEXITY_SEARCH_CONTEXT_SIZE`), OpenAI `web_search` (`OPENAI_HOSTED_TOOLS`,
`OPENAI_VECTOR_STORE_IDS` for file_search), Anthropic `web_search_20250305` +
`web_fetch_20250910` via `anthropic_tools` (`ANTHROPIC_HOSTED_TOOLS`), Gemini
`google_search`/`url_context`/`code_execution` (`GEMINI_HOSTED_TOOLS`), xAI
`web_search`/`x_search`/`code_execution` + `inline_citations`. An env var set to
an empty string disables that provider's hosted tools. Mistral has none: its
connectors are Conversations/Agents-API only, not `/v1/chat/completions`. Consult
`panel_agent.py` for adapter-specific event and citation limitations.

A2A is opt-in: `PANEL_A2A_ENABLED=true`, optionally
`PANEL_A2A_URL=http://localhost:8765/a2a`. A provider must be configured. The current
server uses separate context agents with managed shell tools, not the full panel
composition. Its agent-card metadata instance has no shell tools/connections.
A2A contexts do not inherit panel sessions, skills or durable checkpoint resume.

The external AgentSkills and `async-agentic-tools` samples were previously
inspected at pinned commits, **not installed or integrated**. Native background
tasks own execution; there is no second external scheduler. See
[the recorded sample review](panel-tools.md#native-background-ownership-and-pinned-external-references).

## Verification

```bash
./venv/bin/python -m pytest agent/tests -q
node --experimental-strip-types --test src/lib/panel-stream.test.ts
npm run typecheck
npm run build
```

Offline tests exercise the actual 1.56 composition root and native runtime with
deterministic model implementations. Coverage includes browser callback-before-
startup wiring and disabled settings, exact MCP child grants and ownership,
question/resume, goal pause gating, formation execution, memory/storage, provider
configuration and A2A lifecycle. Browser transports, provider generation and HF
network calls are mocked; these tests do not establish live service compatibility
or a completed interactive Electron/browser acceptance run.
