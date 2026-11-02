# Panel runtime: setup, configuration and verified boundaries

## Setup

Use the project `venv/` and `agent/api/requirements.txt`. The native integration
uses the complete Python Strands package from GitHub commit
`563f57d7a387931760a2c3106014cd7c0db4c9bc`, plus the recorded native Bidi patch,
and **`huggingface_hub==1.20.1`**.
`requirements-full.txt` is not the authoritative dependency list.

```bash
bash deploy/prepare-strands.sh
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

Run installation commands from the repository root. The SDK checkout lives at
`agent/api/core/harness-sdk` beside Ron's Bidi composition. Both
`strands-py/src/strands/experimental/bidi` (upstream import shims) and
`strands-py/src/strands/bidi` (implementation) are preserved.
The checkout is ignored by Git/rsync and reconstructed from the pinned remote
plus `deploy/strands-bidi.patch`. Preparation refuses mismatched revisions/origins
and never resets an existing checkout. Local modifications to native SDK source
must be recorded in that patch before deployment.

The panel Live agent and Teach Ron import `strands.bidi.BidiAgent` and
`strands.bidi.models.google.GoogleGeminiLiveModel` from that editable checkout.
`experimental/bidi` is only the upstream deprecation shim; Ron does not import it.
There is no tracked `live_bidi` duplicate. Do not edit the clone by hand: record
SDK changes in `deploy/strands-bidi.patch`. The text panel, issue agents and
`panel_runtime.py` keep the SDK's `strands.session.SnapshotSessionManager`, which
matches `strands.bidi.BidiAgent`.

### Live Verification

The opt-in provider test uses one harmless delayed diagnostic tool and synthetic
text, never microphone, camera, or screen input. It can incur provider usage:

```bash
RON_TEST_LIVE_BIDI=1 ./venv/bin/python -m pytest agent/tests/test_bidi_live.py -q
```

The ordinary `agent/tests` run skips these tests. Regular Live must deliver native
speech and exactly one completed tool call. Extended Thinking must additionally
deliver audio while the tool is pending and report `interaction_status=IDLE` after
completion. Passing mocked protocol tests or establishing a WebSocket connection
alone does not prove these live behaviors. Connection/account/provider failures
are failures of acceptance, not skipped or substituted model results.

The native Google provider/event and execution-loop tests can run against the
installed checkout without optional Bedrock or local audio drivers:

```bash
./venv/bin/python -m pytest agent/api/core/harness-sdk/strands-py/tests/strands/bidi/models/test_google.py agent/api/core/harness-sdk/strands-py/tests/strands/bidi/types -q -o addopts=''
./venv/bin/python -m pytest agent/api/core/harness-sdk/strands-py/tests/strands/bidi/agent -q -o addopts='' -k 'not test_bidi_agent_init_with_default_model and not test_bidi_agent_init_with_model_id'
```

Upstream tests require `moto` in the test environment. The excluded constructor
tests require the optional Bedrock Nova Sonic package, not Gemini credentials.

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

Browser context and queued steering are delivered by the SDK's
`ContextInjector(trigger="everyTurn")` plugin (runtime options), after the complete
tool result batch. The SDK appends the text to the last user message for that model
call only. On a tool-result turn that message also holds the tool results, and the
pinned Mistral and Responses formatters serialize the text before the tool replies;
provider acceptance of that order must be confirmed live. Steering still queued at
the end of an invocation becomes the native `AfterInvocationEvent.resume` input.

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

In the panel prompt, type `/` to choose a configuration command. Arrow keys
select a suggestion, Enter/Tab inserts it, and Escape dismisses suggestions.
Submit the completed command before sending the first message:

* `/goal <objective>` (or `/goal off`)
* `/background on|off`
* `/tools concurrent|sequential`
* `/context auto|agentic|sliding`
* `/checkpoints on|off`

These are local UI commands that set the existing request options below; they
are not model prompts or an alternative execution layer. Existing chats keep
their immutable configuration and show a new-chat instruction if a command
tries to change it. Native checkpoint pauses render with the existing
AI Elements checkpoint component; Resume sends `checkpoint_resume` through
`POST /chat` to the SDK, without replaying the prompt. No checkpoint data or
execution loop is manufactured by the renderer.

The **Teach Ron** button for the panel agent lives in the browser chrome beside
the agent-panel toggle, not inside the conversation. Its teaching studio stays
mounted when the panel is closed; minimizing keeps explicit capture alive and
closing the studio stops capture. Issue-agent teaching remains scoped to its
issue workspace.

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

### Memory: journal, dreaming (SDK extraction), everyTurn injection, recall subagent

Memory is the SDK's own wiring (the strands_harness `resolve_memory` shape) over **two**
user-scoped `SerializedFileMemoryStore`s (`create_memory_config`):

* **`journal`** — the only `add_memory` target (`MemoryAddToolConfig(stores=["journal"],
  wait_for_writes=True)`). Every `<start_entry>` the agent writes is **server-stamped**
  (UTC `<created_at>`; the model's value is a placeholder) and filed as its own object
  `<topic>/<stamp>-<subject>.md`. The store publishes the nested-filter `search_memories`
  tool through the native `MemoryStore.get_tools()` extension point (`order/since/until/
  tags/topic/subject`, searching journal and long-term memory, newest first), which the
  `MemoryManager` registers beside `search_memory`.
* **`panel-memory`** — long-term memory. Its native `ExtractionConfig` is **dreaming**
  (`core/dreaming.py`): `DreamExtractor` renders the journal `add_memory` calls into the
  transcript (`MemoryMessageFilter(exclude=[])` keeps `toolUse` blocks), lists the
  existing `# Topic | Subject` headings and delegates to the SDK `ModelExtractor` on the
  panel Agent's `aux_model` (the first `RON_MEMORY_AGENT_MODELS` id). The SDK's default
  `IntervalTrigger(5)` and `memory_manager.flush()` at session close/shutdown run it; the
  `ExtractionCoordinator` high-water mark is the incremental checkpoint. Results are
  tagged (10–12 from `DEFAULT_TAGS`/`RON_MEMORY_TAGS`) entries headed `# Topic | Subject`;
  `FileMemoryStore.add` slug-merges them into that subject's file, newest block last, so a
  correction that reuses the heading wins by recency. There is no idle tick, timer or
  endpoint.

`MemoryInjectionConfig(trigger="everyTurn")` injects relevant memories from both stores
before every model call of the tool loop.

Recall is the `recall` tool (`core/memory_agent.py`), a native strands_harness
`make_subagent` (every axis `Fixed`; the model passes only `task`). Each call builds a
fresh `create_harness()` child with every built-in off over
`resolve_memory(stores, writable=False)` read-only views (the harness's `_ReadOnlyStore`:
no `add`, no extraction, no `get_tools`, so the stores' `search_memories` is passed
explicitly), on a native `ModelRouter(FallbackStrategy)` of fast Perplexity Agent API
models with `retry_strategy=None`. The child's events arrive as native `ToolStreamEvent`s;
`_translate` re-emits them under `node_path=[<recall toolUseId>]` and the panel groups them
into an AI Elements `ChainOfThought` block ("Memory" / "Task" / "Recalled";
`panel-stream.ts` `CHAIN_TOOLS = {recall, think}`). `RON_MEMORY_AGENT=0` drops the tool.

* **Default `PANEL_STORAGE=memory` is ephemeral across process restarts.** It shares
  native `InMemoryStorage` within the process; it is not disk persistence.
* `PANEL_STORAGE=huggingface` is the production authority: it **requires** `HF_TOKEN`
  and `HF_BUCKET_ID=namespace/bucket-name`, creates the private bucket on first use
  (`HfApi.create_bucket(exist_ok=True)`), and never falls back to memory; `main.py` warms
  it in the lifespan so misconfiguration fails at boot. `HuggingFaceBucketStorage`
  implements the native `Storage` Protocol with a pluggable `search_strategy`
  (`write` indexes, `search` delegates; default `KeywordSearchStrategy`) and a bounded
  read cache keyed by the bucket's `xet_hash` from the latest listing (own writes and
  deletes invalidate immediately). Restart after changing storage environment settings.
* Session snapshots, runtime journals and cross-session memory are user-scoped.
* Memory search is keyword-based over the scoped namespace, not vector search.
  Per-user append locks coordinate writers within one process only.

See [storage implementation details](../agent/docs/panel-storage.md).

## Tools

The agent always carries the mandated core set, registered from the installed
`strands_tools` package (registered as the native tool objects; the SDK offloads sync bodies) plus the
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

With `provider=perplexity` the agent also gets `think`: the vendored strands_tools
`research/think.py`, loaded unchanged through the native loader (`load_vendored_think`).
It runs `cycle_count` cycles, each a child `Agent` over the parent's model and tools
with the model-chosen `system_prompt`; it reports to the parent's `callback_handler`
(none in the panel), so its steps do not stream and the panel shows the call and its
conclusion. `ThinkToolsGuard` (native `BeforeToolCallEvent`) rewrites the call's
`tools` argument to the parent's registry minus parent-only tools (`think`, `ask_user`,
`tool_catalog`, `strands_*`, browser tools). The child inherits `recall`, so memory
reaches think through the same tool. Other providers render provider reasoning deltas
(Gemini thoughts, xAI) in the same component.

### Tool observation and tool repair (CAT-49 / CAT-50 / CAT-51)

`ToolObservation` (`core/tool_observation.py`, `AfterToolCallEvent`, order 300) records every
tool call's outcome as a `ron.tool.outcome` span event and flags failures in
`agent.state["panel.tool_failures"]`. Each outcome carries **provenance**: `implementation`
(the registered tool's class), `wrapped` (Ron's facade chain through `.wrapped`) and `source`
(`{path, sha256}` of the innermost implementation file; vendored paths are relative to
`agent/tools/strands_tools`, stamped by `stamp_source` on catalog-loaded tools).
`redact_outcome` is the only shape that leaves a session: tool name, argument keys/types,
exception class/message, status, duration, provenance.

**Tool repair is per user.** The tenant is `user_id`; a repaired tool is a user-scoped revision
in the user's storage namespace (`panel/users/<sha256(user_id)>/tool-repairs/<tool>/...`), never a
change to the shared library and never promoted to other users.

1. **Proposal.** `ToolRepairTrigger` (order 310; `RON_TOOL_REPAIR=0` disables) counts identical
   `(tool, exception class)` failures of **every** tool; at `RON_TOOL_REPAIR_THRESHOLD` (2) it
   writes `agent.state["panel.tool_repair.request"]` tagged with `target_kind`: `library`
   (vendored file → can become this user's revision), `mcp` (browser/MCP server tool), `core`
   (installed host tool) or `other` (plugin/agent tool). **Every kind is repaired per user**; the
   kind selects the `repair_kind`: `file` (repaired copy of the vendored module; library only),
   `adapter` (a module with `transform_input(input)` / `transform_result(result, input)` that
   `_AdaptedTool` wraps around the registered tool in this user's registry — works for any tool,
   including MCP/browser tools, without editing shared code) or `server` (a repaired copy of the
   `electron_playwright_mcp` package that this user's browser MCP server process runs via
   `PYTHONPATH`, `browser_client_factory(extra_env=browser_server_env(user_id))`). The sandbox
   never talks to the browser or an MCP server: adapter/server logic is unit-tested directly and
   live-server demonstrations are dry runs. After the native stream ends the runtime
   emits the durable envelope `tool_repair_proposed {id, tool, kind, exception_class, count,
   observation, outcome}`; the renderer shows a Catalyst `Alert` with **Repair / Not now**
   (the text names the repair kind that applies). Nothing runs yet.
2. **Fixer run.** `POST /tools/repairs {user_id, session_id, tool_name}` (loopback only; the session
   must be idle) starts one fixer per user+tool: a fresh `create_harness` child (`memory=False`,
   `session=False`) on `ModelRouter(FallbackStrategy)` over `RON_TOOL_REPAIR_MODELS` (default
   `openai/gpt-6.1-sol`) at `RON_TOOL_REPAIR_EFFORT` (default `max`). Server-side Perplexity tools
   ride on the model params (`fixer_hosted_tools`, `RON_TOOL_REPAIR_HOSTED_TOOLS`): `web_search`,
   `fetch_url`, `image_search`, `sandbox`, the managed GitHub connector (`type: connector`,
   `id: connector_github`; connect it on the Perplexity Project connectors page) and Context7's
   remote MCP server (`type: mcp`, `CONTEXT7_MCP_URL`, `CONTEXT7_API_KEY` as `authorization`).
   Agent-to-agent: like every Ron agent, the fixer carries the native A2A client tools from
   `core/a2a_tools.py` (see "A2A everywhere" in AGENTS.md); `RON_TOOL_REPAIR_A2A_AGENTS` adds
   fixer-only peers.
   Tools: the harness built-ins `shell`/`read`/`write`/`edit`, all routed through the SDK
   `Agent(sandbox=)` seam — a per-run `DockerSandbox` (`python:3.12-slim`) with the repair
   workspace writable at `/workspace` and the library, Ron's core, installed `strands_tools` and
   the MCP server package read-only under `/sources/*` (the SDK's local no-isolation environment
   is the fallback, reported as sandbox `local`); the harness `todos` plugin; read-only memory
   search; and the application tools `record_demonstration` / `submit_repair`.
   The fixer's input **is** the native Agent SOP: `agent/sops/repairing-a-broken-tool.sop.md`
   (package `agent-sop-format`: Overview / Parameters / Steps with RFC2119 constraints / Examples /
   Troubleshooting) rendered by the pinned `strands_agents_sops` MCP server as
   `Run this SOP: <agent-sop …><content>…</content><user-input>…</user-input></agent-sop>`, where
   `user_input` is `sop_parameters(...)`: tool name and kind, source path and base sha, sandbox
   kind, the redacted outcome, the exact failing `tool_use`, up to four context examples from this
   user's session (the fixer synthesizes the rest from `tool_spec` as `synthetic`; side-effecting
   tools are `dry_run`), the tool spec and the `strands_evals` diagnosis (`diagnose_session` over
   retained spans when `RON_TOOL_OBSERVATION=1`, else stated absent).
   The SOP order is fixed: reproduce → wrapper audit (direct vs wrapped call; a wrapper-only
   failure is `WRAPPER_FIX` on `core/*` → `needs_maintainer`, never re-wrapped) → reflection 1–7 →
   smallest diff → pytest → five demonstrations in the sandbox → `submit_repair`.
   The fixer's events stream as `ToolStreamEvent`s under the synthetic root tool `repair:<rev>`
   (ChainOfThought "Repair"); the result is the durable `tool_repair_ready {tool, rev, status,
   summary, demonstrations, sandbox, route}` → Catalyst `Alert` + `Table` with **Activate /
   Discard**. Statuses: `verified` (failing + four context demonstrations passed in an isolated
   sandbox), `unverified` (local sandbox only; Activate disabled), `failed`, `not_reproducible`,
   `needs_maintainer` (only a system-prompt defect or a Ron wrapper defect no adapter can sit in
   front of; patch + test stored in the manifest only).
3. **Activate / rollback.** `POST /tools/repairs/{tool}/activate {user_id, rev}` re-reads the
   vendored file (`base_sha256` mismatch → 409), writes `active.json`, materializes the revision
   under `<SESSION_STORAGE_DIR>/repairs/active/<scope>/` and calls `PanelToolCatalog.reload_tool`
   on every live session of that user: the copy is executed under the vendored module name
   (`import_vendored_revision`) and handed to native `ToolRegistry.replace`, which the SDK applies
   at the **next** invocation — an in-flight call finishes on the old code. A userTurn
   `ContextInjector` (`revision_notice`) tells each live session once. `adapter` revisions use
   `PanelToolCatalog.replace_tool` (same `replace` semantics; also updates the MCP provider list so a
   refresh re-applies the wrapper); `server` revisions restart this user's browser MCP server in
   each live session (`PanelToolCatalog.restart_mcp_server`: the old stdio process is stopped, a
   new one is spawned with the user's current `PYTHONPATH`, tools re-published at the next
   boundary). New sessions load the active
   `file` revision through the catalog's `revision_resolver(user_id)`, wrap tools through
   `set_tool_adapter(adapt_tool)`, and spawn the browser server with the user's `PYTHONPATH`; other
   users are untouched. `/rollback` removes `active.json` and reverses the same path. Restart
   recovery: `restore_active_markers`.

Verification: `agent/tests/test_tool_repair.py` (offline, scripted models, fake shell/sandbox) and
the on-demand paid `agent/tests/evals/test_tool_repair_eval.py` (`RON_TOOL_REPAIR_EVAL=1`;
`strands_evals` `Experiment` with `ToolParameterAccuracy`/`ToolSelectionAccuracy` on baseline vs
revision → `eval.json` beside the manifest).

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
inspected at pinned commits, not installed. Native background tasks own text-panel
execution. Live function calls are `NON_BLOCKING` declarations on `GoogleGeminiLiveModel`. See
[the recorded sample review](panel-tools.md#native-background-ownership-and-pinned-external-references).

## Live (Gemini Bidi) sessions

The renderer uses `LIVE_API_BASE_URL` for both Panel Live `/bidi` and Teach Ron's
REST + `/teaching/sessions/{id}/observe` socket. It defaults to the same origin as
`API_BASE_URL` (`src/lib/api-base.ts`, overridable via `VITE_API_BASE_URL` /
`VITE_LIVE_API_BASE_URL`). Both surfaces probe `/bidi/settings` and report a
missing/outdated backend explicitly.

`npm run electron:dev` clears stale dev listeners, then: with the Mac SSH tunnel
on `8765`, **`VITE_API_BASE_URL` stays on the VPS** (chat, discover, search,
projects); if the VPS lacks Live routes it starts a local FastAPI on `8766` for
`VITE_LIVE_API_BASE_URL` only. Without a tunnel, one local API on `8765` serves
everything. Guest issue API pinning still takes precedence. Production builds
default to `http://localhost:8765` unless configured at build time.

Verified 2026-10-02 through the actual renderer and real model (not mocked sockets):
Panel Live received native audio and "Panel Live is connected."; Teach Ron received
native audio and "Learning agent is connected." from its own lesson endpoint.
Teaching capture used synthetic media; no user screen, microphone, or camera was
captured for that acceptance test. One journal-tool attempt received the provider's
spoken "system error"; transport acceptance does not establish full workflow/tool
acceptance.

`WebSocket /bidi` (`agent/api/endpoints/bidi.py`, `core/bidi_runtime.py`,
`core/bidi_agent.py`) runs one native `strands.bidi.BidiAgent` per socket on the
native `GoogleGeminiLiveModel` from `strands.bidi.models.google`; there is no provider subclass. Settings are query
parameters and every one is validated, never ignored: `model`
(`gemini-3.8-live` default | `gemini-3.8-live-extended-thinking`; the renderer's
`DEFAULT_LIVE_MODEL` matches. Extended Thinking usually announces a browser action, never
emits the `toolCall`, and then says "a system error occurred" — reproduced on the raw Live
WebSocket with the official doc declaration, so it is provider-side, not Ron's composition),
`voice`
(prebuilt Gemini voices), `effort` (`low|medium|high`, default `high`, **rejected**
with `invalid_settings` on the regular model), `agent_scope`
(`panel|search|build|issue:<uuid>`), `browser` (`user|cloud`), `conversation_id`,
`user_id`, `search` (`1|true` opts into the provider-executed `google_search` tool via the
native `hosted_tools` seam, appended beside the function declarations). `GET /bidi/settings`
advertises the catalogue.

- **Origin / ownership.** The socket is refused (1008, before accept) unless the `Origin` is
  loopback (`localhost`, `127.0.0.1`, `[::1]`), Electron's `null`/`file://`, or absent. One
  process-local lease per `(user, scope, conversation)` (`LiveLeases`): a second socket gets
  `{type:'error', code:'busy'}`; the lease is released in `finally`.
- **Handshake.** The client sends `auth` (issue scope) and then a `context` frame (possibly
  empty) in `onopen`; the server waits at most `HANDSHAKE_TIMEOUT_S` (15 s) per frame
  (`handshake_timeout` otherwise) and only then composes/starts the agent and emits `ready`.
- **Frame schema.** `validate_frame` allows exactly the documented keys per kind; input frames
  are exactly one of `text` (non-empty, ≤16 KiB), `audio_delta` (`format:'pcm'`,
  base64-validated, even byte count, ≤64 KiB) or `realtime_input:{audio_stream_end:true}`
  (also `{type:'audio_stream_end'}`). `toolResult`, `image`, raw message dicts and unknown
  fields never reach `BidiAgent.send`.

- **Identity / scope.** Panel scopes use `user_id` like `/chat`. `issue:<uuid>` requires
  a first frame `{type:'auth', token?|workspace?}` resolved through the Projects
  `project_identity` path (bearer or 64-hex guest workspace); the verified
  `identity.user_id` replaces the query value, issue access is checked via
  `ProjectService.issue`, `conversation_id` must equal the issue id, and the toolset
  is `issue_tools` + that issue's learned skills only. Missing/invalid credential →
  `unauthorized`; inaccessible issue → `forbidden`.
  Panel `user_id` is a trusted-local namespace, not authenticated multi-tenant isolation:
  another trusted local client can choose it. Never expose this host-execution API publicly.
  Issue credentials travel only in the auth frame, not the URL.
- **Tools are the text agent's tools except those `BidiAgent` cannot run**
  (`core/live_tools.py`). `BidiAgent` declares tools to the model once per connection
  (`bidi/agent/loop.py` `start`/`_restart_model`) and rejects tool interrupts, so Live
  has no `think`, `ask_user` (interrupt), `tool_catalog` or `mcp_client` (both register
  tools after the declaration). Host tools are the native `strands_tools`/vendored
  `@tool` objects, unwrapped. The browser is the Electron MCP server
  (`electron-playwright-mcp`) for the selected target: a native `MCPClient` passed in
  `BidiAgent(tools=[…])`, connected when the socket starts, whose native `tool_filters`
  drop `playwright_browser_take_screenshot` (its image result is rejected by
  `GoogleGeminiLiveModel._format_tool_result`, which would end the session) and
  `request_approval` (FastMCP's Approval app: it returns a UI card and tells the model
  to stop until an "I selected:" message that Ron never sends). An empty
  tool list from that server sends
  `{type:'warning', code:'browser_tools_unavailable'}`. `ready.tools` lists exactly
  what was declared. `GoogleGeminiLiveModel` declares them `NON_BLOCKING`. The bidi
  loop sends the function response when the tool stream finishes.
- **Input routes.** `{text}` is a `clientContent` user turn: it always interrupts and is
  recorded. `{audio_delta}` and video frames (WebM → ffmpeg → native
  `RealtimeInput(video=…)`) stream through the send gate and are not recorded.
  The handshake `context` seeds text-only history (`history_source: 'client'`; restored
  native history reports `'snapshot'` and receives new handoff text with native-state
  digest deduplication) with page/issue data appended as a trailing **user**
  message wrapped in `<reference source="browser" trust="untrusted">`; nothing client-supplied
  ever enters the system instruction. Later `context` frames are sent as
  `RealtimeInput(text=…)` when the interaction is idle, otherwise queued until idle
  (`context_applied.mode`: `initial|realtime|queued`). Realtime text is session context, not ephemeral, and has no
  ordering guarantee relative to audio. `turn_complete=false` clientContent is never used.
  Current scope system instructions replace the old snapshot's prompt after restore.
- **Completion.** `InteractionTracker` treats native `bidi_interaction_status` as
  authoritative; on extended thinking `bidi_response_stop` alone never means idle.
- **Stop.** `{type:'stop'}` with no pending tool group stops immediately; with tools
  running it calls native `cancel()` (which only takes effect after the group) and waits
  up to 10 s, then reports `{type:'stopped', pending_tools:[…]}` for results that are
  unknown. A `bidi_tool_cancel` from the server does not clear a pending host tool: it stays
  pending until the native executor reports its outcome. Unknown outcomes are persisted as
  a recovery record (`live-recovery/<scope>/<conversation>.json`); the next session for that
  conversation reports them once (`ready.recovery` + `warning code:'recovery_required'`),
  clears the record, and replays nothing.
  Provider-cancelled results also emit an explicit warning: the host action may finish
  even though Gemini no longer accepts its reply. The receive loop remains active while
  draining native tool results; a renderer timeout never acknowledges a successful stop.
- **Persistence.** `SnapshotSessionManager(conversation_id, bidi_agent_save_latest_on="message")`
  over `panel/users/<sha(user)>/live/` (its own prefix, so it never shares an index/alias
  writer with the text panel's manager) with agent id `live-<sha256(user\0scope)[:32]>`;
  the text panel keeps its `panel-…` agent under the same conversation id, so both agents
  share a conversation identity without sharing a native agent, storage writer, or tool
  blocks. The voice journal is keyed by scope + conversation.

Teach Ron (`endpoints/teaching_observe.py`, `core/teaching_journal.py`) is one native
`BidiAgent` per lesson with optional `model`/`voice`/`effort` query settings and the same
Origin policy. Its tools: Teach Ron's **own copy** of the `journal` tool
(`create_lesson_journal`: same `write/read/list/add_task` semantics and Markdown as
`agent/tools/strands_tools/devops/journal.py`, bound by closure to the lesson workspace
`<teaching root>/<scope>/workspaces/<session>/` instead of `cwd`/env, `YYYY-MM-DD`
validated, async file IO); `copy_into_lesson` (copies an existing file into the
workspace, never writes outside it, never overwrites); `finish_observation`; the scope's
learned skills; and, when the composition owner installs `set_scope_tool_supplier`, the
parent scope's tools under `LessonWorkspacePolicy` — a native `BeforeToolCallEvent`
`cancel_tool` hook that limits mutating `editor` commands to the workspace and denies
`shell`/`environment`/`mcp_client` outright because the native sandbox is
`NotASandboxLocalEnvironment` and cannot confine them (existing tools and skills are
therefore copy-only by construction). Every journal `write`/`add_task`/copy is mirrored
into `TeachingService.append_journal`, and user/assistant transcript blocks are journaled
automatically (`user_speech`/`assistant_speech`), so the service journal stays the single
evidence source for the review digest; the workspace Markdown is the agent-facing mirror.
The brief and prior journal are initial seed messages, frames go through `RealtimeInput`
video, notes and renderer `{type:'event', name, detail}` hints through `RealtimeInput`
text (journaled as `ui_event`, explicitly unverified: the model sees ~1 fps and must not
claim exact clicks), mic commentary (`{type:'audio'}`, `ready.audio: true`) through
`audio_delta`, `{type:'audio_stream_end'}` through the native signal, and Ron's spoken
replies (`bidi_audio_*`, `bidi_barge_in`, `bidi_interaction_status`, transcripts) are
relayed verbatim. `ready` lists `tools` and `workspace`. `STOP_DEMONSTRATION` is the only
interrupting turn, and the lesson is `recorded` only when `finish_observation` saved a
summary, the interaction is `idle` and no tools are pending. The review/approval digest
chain and SOP compilation in `core/teaching.py` are unchanged.

## Verification

```bash
./venv/bin/python -m pytest agent/tests -q
node --experimental-strip-types --test src/lib/panel-stream.test.ts
npm run typecheck
npm run build
```

Offline tests exercise the pinned GitHub composition root and native runtime with
deterministic model implementations. Coverage includes browser callback-before-
startup wiring and disabled settings, exact MCP child grants and ownership,
question/resume, goal pause gating, formation execution, memory/storage, provider
configuration and A2A lifecycle. Browser transports, provider generation and HF
network calls are mocked; these tests do not establish live service compatibility
or a completed interactive Electron/browser acceptance run.
