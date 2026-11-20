# Panel runtime: setup, configuration and verified boundaries

## Setup

Use the project `venv/` and `agent/api/requirements.txt`. The native integration
uses the complete Python Strands (`strands-py`) and Strands Harness (`harness-py`)
packages from GitHub commit `563f57d7a387931760a2c3106014cd7c0db4c9bc`, plus the
recorded native patch `deploy/strands-subagent-async.patch` (the bidi package
is unpatched), and **`huggingface_hub==1.20.1`**.
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
plus `deploy/strands-subagent-async.patch`. Preparation refuses mismatched revisions/origins
and never resets an existing checkout. Local modifications to native SDK source
must be recorded in that patch before deployment.

The panel Live agent and Teach Ron import `strands.bidi.BidiAgent` and
`strands.bidi.models.google.GoogleGeminiLiveModel` from that editable checkout.
`experimental/bidi` is only the upstream deprecation shim; Ron does not import it.
There is no tracked `live_bidi` duplicate. Do not edit the clone by hand; the bidi
package is used exactly as pinned upstream. The text panel, issue agents and
`panel_runtime.py` keep the SDK's `strands.session.SnapshotSessionManager`, which
matches `strands.bidi.BidiAgent`.

### Live Verification

The opt-in provider test uses one harmless delayed diagnostic tool and synthetic
text, never microphone, camera, or screen input. It can incur provider usage:

```bash
RON_TEST_LIVE_BIDI=1 ./venv/bin/python -m pytest agent/tests/test_bidi_live.py -q
```

The ordinary `agent/tests` run skips these tests. Regular Live must deliver native
speech and exactly one completed tool call. Passing mocked protocol tests or establishing a WebSocket connection
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
journal support restoration; event replay is bounded and process-local. The
session manager saves the native `snapshot_latest` after every message
(`save_latest_on="message"`), so a run that a restart or shutdown interrupted
continues in the same run on the first access to the session (see Recovery). Run **one manager-owning API worker**; storage and session writes have no
cross-process locking.

Ordinary provider/factory failures do not require recovery. Their error is
included in both SSE and session snapshots, and a subsequent message is allowed.
Failed native invocations save their completed history before the terminal
journal entry so reconnect/reload cannot silently discard completed tool work.
No failure closes a session: `recovery_required` is always `false`, and the next
message continues on a fresh agent from the saved conversation. The renderer shows a failure as people read it
(`failureText` in `src/lib/panel-stream.ts`: the serialized exception's
`message`, or a gRPC provider's own `details = "…"` sentence, such as xAI's
"…used all available credits…") and keeps the raw payload as `errorDetails`
behind a *Details* toggle in a height-bounded alert.

### Recovery: stalls, timeouts and context overflow (seamless agent respawn)

Three failures are recovered **inside the same run**, with no `error` envelope, no new run
and no change to the thread:

- **Stall.** `PanelRuntimeManager` runs one loop-local watchdog (started by the first
  `start()`, cancelled in `shutdown()`). Every emitted event refreshes a run's activity clock;
  a `starting`/`running` run silent past `PANEL_RUN_STALL_SECONDS` (default 120s; `0`
  disables the watchdog) is stalled. A tool call in flight gets the longer
  `PANEL_RUN_TOOL_STALL_SECONDS` (default 480s, above song generation's 420s); tool ids enter
  the in-flight set at their deduplicated `tool_input` and leave at `AfterToolCallEvent`. The
  watchdog cancels only the run's current stream attempt (`SessionRun._attempt_task`; a wedged
  agent does not heed the cooperative cancel event).
- **Timeout.** The panel agent's `TimeoutRetryStrategy` is the native `ModelRetryStrategy`
  with its documented `is_retryable` extended to timeouts (`is_model_timeout`: `TimeoutError`,
  an httpx timeout, or gRPC `DEADLINE_EXCEEDED`, anywhere on the cause chain). A timeout that
  outlasts those native backoff attempts reaches the runtime.
- **Context overflow.** The SDK first runs the conversation manager's `reduce_context`
  (`SummarizingConversationManager`, `preserve_recent_messages=4`, the SDK's own
  `overflow_protection` floor) and retries; only an overflow it could not reduce reaches the
  runtime.

Recovery (`SessionRun._respawn`, at most `PANEL_RUN_MAX_RECOVERIES` = 2 consecutive recoveries;
a completed tool call resets the count): the old
instance is saved as `snapshot_latest` and disposed (bounded memory flush + cleanup); the same
factory builds a fresh agent on the same `ThreadSessionManager`, whose construction restores
it, so it has the same conversation manager, `ContextOffloader`, `ContextInjector` and tools.
The run continues with `[]` once its input is in the saved conversation; the SDK then answers
a `toolUse` the old instance never finished with its own "Tool was interrupted." result
(`Agent._convert_prompt_to_messages`), and the runtime emits that `tool_result` so the live
tool card closes. The runtime emits one `retry` with `silent: true`, which the renderer uses
to discard the failed attempt's partial text without drawing a retry line (the
`XAIStatePruner` overflow retry is silent too). The `ContextInjector` adds a `[recovery]` note
to every later model call of the run; it is never stored. After an overflow the request's
browser context is shortened to `RECOVERY_CONTEXT_SHARE` (25%) of the model's real window
(`count_tokens` + `estimate_utilization`). The respawn runs inside the cancellable attempt, so
a disposal or factory that hangs is itself recovered. A run that spends the budget, or whose
startup I/O stays silent for a whole window, fails with that error like any provider error: its
history is saved, the instance is dropped, and the next message builds a fresh agent on the same
session. A run that ignores asyncio cancellation is left to shutdown semantics.

**Restart.** A run that was active when the process stopped (crash, or a shutdown that cancelled
it) keeps its journal entry active. The first access to the session in the next process
(`GET /sessions/{id}` or `/chat`) continues it under the same `run_id`: a fresh agent restores
`snapshot_latest`, the run goes on with `[]` (or with its input when that had not been saved
yet), an unanswered `toolUse` gets the SDK's "Tool was interrupted." result, and a run whose
answer was already saved is committed without another model call. Restarts count against the
same budget, which is stored in the journal.

**Context threshold.** `SummarizingConversationManager` compresses before a model call once the
projected input reaches `PANEL_CONTEXT_COMPRESSION_THRESHOLD` (default `0.87`) of the model's
real window (the SDK's `proactive_compression={"compression_threshold": …}`).

Model context windows are real: `build_model` sets `context_window_limit` from the provider's
own metadata (`core/context_windows.py`: xAI `GET /v1/models` `context_length`, Mistral
`GET /v1/models` `max_context_length`, Gemini `GET /v1beta/models/<id>` `inputTokenLimit`,
Perplexity `<vendor>/<model>` ids through that vendor). OpenAI and Anthropic publish no window
field, so the SDK's own table resolves them. A failed fetch is logged and not cached.

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
    "background": true,
    "goal": ""
  }
}
```

| Option | Supported behavior |
| --- | --- |
| `context` | `auto` (default): `ContextOffloader` on the session storage (`retrieve_offloaded_content`) and `SummarizingConversationManager` with proactive compression. Summaries are produced by a fresh `Agent` on the panel model and written back into this thread's session. `agentic`: native context-manager tools (`summarize_context`, `truncate_context`, `pin_context`, `retrieve_context`). `sliding`: `SlidingWindowConversationManager`, still with `ContextOffloader`. |
| `tool_execution` | Native `concurrent` (default) or `sequential` executor. |
| `checkpointing` | Root native checkpoints; default false. Resume through the runtime. |
| `background` | Native Strands `background_tasks` (`wait_for_completion=True`, `agentic=["*"]`); default `true`. Delegated subagents, skills and formations (`think`, `run_skill`, `use_skill`, `research_review`, `reasoning_swarm`, `nested_research_review`) run asynchronously in `always`, and every agent receives native `strands_manage_background_task(mode="list"\|"get"\|"cancel")` to poll or cancel in-flight tool calls and persist when tools fail or stall. Registry-mutating/interactive/handle tools (`tool_catalog`, `mcp_client`, `editor`, `ask_user`, `programmatic_tool_caller`, `deep_research_*`) stay in `never`. |
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
| `load_tool` | `strands_tools.load_tool` | load a Python `@tool` module into `agent.tool_registry` at runtime |
| `programmatic_tool_caller` | `strands_harness.tools.programmatic_tool_caller` (`hot_reload=True`) | Monty sandboxed Python orchestrating registered + hot-reloaded tools |
| `subagent` | `strands.vended_tools.subagent.make_subagent` (`background=True`) | non-blocking background subagent (`spawn` / `status` / `steer` / `recover` / `cancel`) |
| `perplexity_search` | `agent/tools/strands_tools/research/perplexity_search_api.py` (async `@tool`, official `perplexityai` SDK, exposed under this name) | live web search |
| `tool_catalog` | `panel_tools.create_tool_catalog` | `list` / `search` / `describe` / `load` over the project library, and `load` of a configured MCP server by name (`user_browser` / `cloud_browser`) |
| `ask_user` | native `ToolContext.interrupt` | pause for user input |

### Native async execution, subagent supervision and tool hot-reload

Every agent runs execution tools asynchronously by default (`background_tasks={"always": ["*"], "never": ["tool_catalog", "load_tool", "mcp_client", "ask_user", "subagent", "todo_write", ...], "wait_for_completion": True}`), so callers continue working while tools execute, poll or cancel hung tasks via `strands_manage_background_task(mode="list" | "get" | "cancel")`, and automatically settle completions at `AfterInvocationEvent`.

`subagent` runs with `background=True, stall_timeout=60.0, max_consecutive_errors=3`: `action="spawn"` returns `{subagent_id, status: "running"}` immediately, streams child `ToolStreamEvent`s via `SessionRun._callback`, injects live telemetry via `ContextInjector(trigger="everyTurn")`, wakes the parent via `AfterInvocationEvent.resume` on `[subagent-completed]` or `[subagent-hangup]` (emitted live over SSE via `MessageAddedEvent`), and supports mid-flight `steer`, `cancel`, and history-salvaging `recover` (`_SubagentTool._fork_messages`).

Agents also enable `load_tools_from_directory=True` (`ToolWatcher` watching `./tools/*.py` across `on_created`, `on_moved`, and `on_modified`), `load_tool`, and `make_programmatic_tool_caller(hot_reload=True)` (syncing newly loaded `@tool` functions into Monty's `external_lookup` and stripping `"event_loop_cycle_id"` so inner Monty `await` calls execute inline even under `always: ["*"]`).

### Agent per chat

`POST /chat` takes `agent: {kind: "ron" | "specialist" | "project", id}` (omitted → Ron;
`id` is a UUID for the other two, empty for Ron). Like the model it is sent on a
conversation's first turn and pinned into the immutable session `selection.agent`; a
different value later is `409`, a non-Ron agent outside `destination="panel"` is `422`.
`specialist` = one of the caller's stored `harness_agents` rows (signed-in only; unknown
→ `404`), built by `build_specialist` with the session's model/effort and the runtime's
`session_manager`, `agent_id`, `callback_handler` and `ContextInjector`; the runtime's
hooks and `ThreadProjection` are added with `agent.hooks.add_hook` after construction.
`project` = the panel composition plus `project_agent_prompt`/`project_agent_tools`;
each request must carry the caller's project credential (`Authorization: Bearer` or
`X-Ron-Workspace`), which `/chat` verifies with `project_identity` (401/403/404) and
binds for the session's tools, so the user's own RLS applies. Events, snapshots,
replay, steering and cancel are unchanged for every agent.

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
change to the shared library. The flow is: **a tool fails → one `create_harness` fixer runs in the
background → the user approves.**

1. **Trigger.** `RepairService.trigger()` (`ToolRepairTrigger`, `AfterToolCallEvent`, order 310) on
   every panel agent and the Live `BidiAgent`. One guided retry for an idempotent tool below
   `RON_TOOL_REPAIR_THRESHOLD` (2); at the threshold, or on the first failure of a side-effecting
   tool, it captures the evidence and calls `service.investigate()`, which starts the run as an
   asyncio task and returns at once. The `ContextInjector` tells the agent the phase
   (`investigating` → `approval` → `confirm` → `done`, or `declined`/`failed`).
2. **Fixer.** `build_fixer` = one `create_harness` (model router over `RON_TOOL_REPAIR_MODELS`,
   hosted Perplexity tools, built-in `shell`/`read`/`write`/`edit` through `Agent(sandbox=)`,
   `todos`/`environment`, read-only memory search, `record_demonstration`/`submit_repair`).
   `RepairService._run` streams `fixer.stream_async(sop_task(...))`; events render as the "Repair"
   chain under `repair:<rev>`. Sandbox: a bounded `DockerSandbox` when Docker works, otherwise the
   SDK local environment with absolute host paths (`sandbox: local`, shown to the user).
3. **Result.** `tool_repair_approval` (verified: summary, diff, demonstrations, sandbox,
   `approval_token`) or `tool_repair_ready` (failed / needs_maintainer / not_reproducible /
   cancelled).
4. **Approve = activate.** `POST /tools/repairs/{tool}/activate {user_id, rev, approval_token}`
   re-checks owner, base sha (409), artifact digest (409) and token (403), writes `active.json` and
   reloads the owner's live sessions through native `ToolRegistry.replace` (next invocation);
   adapters use `replace_tool`, server revisions `restart_mcp_server`. New sessions load the
   revision through `revision_resolver(user_id)`. `/decline`, `/cancel`, `/rollback`,
   `GET /tools/repairs/active`.

Verification: `agent/tests/test_tool_repair.py` (offline, scripted models, fake sandbox) and the
paid on-demand `agent/tests/evals/test_tool_repair_eval.py`.

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
execution. Live function calls use `GoogleGeminiLiveModel`'s own declarations. See
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

`WebSocket /bidi` (`agent/api/endpoints/bidi.py`, `core/live_tools.py`,
`core/live_io.py`) runs one documented `strands.bidi.BidiAgent` per socket on
`GoogleGeminiLiveModel(model_id, voice, client_args)` from the pinned, **unpatched** SDK
(owner 2026-11-20: Strands only; https://strandsagents.com/docs/user-guide/sdk/bidi/models/google/).
Settings are query parameters and every one is validated: `model` (`gemini-3.8-live` only:
Extended Thinking needs `NON_BLOCKING` declarations, which Strands never sets), `voice`
(prebuilt Gemini voices), `agent_scope` (`panel|search|build|issue:<uuid>`), `browser`
(`user|cloud`), `conversation_id`/`session_id`, `user_id`. `GET /bidi/settings` advertises them.

- **Origin.** The socket is refused (1008, before accept) unless the `Origin` is loopback,
  Electron's `null`/`file://`, or absent.
- **Handshake.** The client sends `auth` (issue scope) and then a `context` frame (possibly
  empty); the server waits at most 15 s per frame, appends the context (labelled untrusted)
  to the system prompt, builds the agent and emits `ready`.
- **Inputs** are the documented forms only (https://strandsagents.com/docs/user-guide/sdk/bidi/content/),
  returned by the Custom I/O input stream `LiveSocketInput`
  (https://strandsagents.com/docs/user-guide/sdk/bidi/io/): `{text}` → `TextBlock`, `{audio_delta}` →
  `AudioDelta`, a later `context` frame → `TextBlock`. Strands has no live video input and every
  image is a complete user turn, so the renderer's 1 fps `realtime_input.video` JPEG frames are kept
  server-side and the newest reaches the model as an `ImageBlock` when sharing starts and with each
  typed message (`[TextBlock, ImageBlock]`). `realtime_input.audio_stream_end` has no Strands input and
  is dropped: Gemini's own voice activity detection ends turns. Binary packets from an older
  renderer get one `unsupported_video` warning.
- **System prompt** is the text agent's prompt (`chat.live_system_prompt(browser)`, pinned by
  `test_panel_prompt.py::test_live_prompt_is_the_text_prompt_plus_live_deltas`).
- **Tools** are the text agent's tools except those `BidiAgent` cannot run (`think`, `ask_user`,
  `tool_catalog`, `mcp_client`) and those Gemini Live cannot declare: Strands'
  `GoogleGeminiLiveModel._format_tools_for_live_api` (pinned and upstream main) validates schemas
  as a genai `Schema`, so `$schema`/`$ref`/`$defs` fail and `additionalProperties` is refused by
  the Live API with 1007. `gemini_live_declarable` filters host tools and, as a callable in the
  browser `MCPClient`'s native `tool_filters`, browser tools. The browser client also rejects
  `playwright_browser_take_screenshot` (image results end the session) and `request_approval`.
  `ready.tools` lists exactly what was declared.
- **Stop.** `{type:'stop'}` calls native `cancel()`, reports `{type:'stopped'}` and closes.
- **Persistence / takeover.** With a thread id the agent uses the user's `thread_agent_id` and
  `ThreadSessionManager`, so the SDK restores and saves the thread (see *Session ownership*).

Teach Ron (`endpoints/teaching_observe.py`, `core/teaching_journal.py`) is one documented
`BidiAgent` per lesson seeded with `messages=` (SOP, brief, prior journal). Its input stream
`TeachingObserveInput` returns the same documented forms: mic audio as `AudioDelta`; the first
screen frame as an `ImageBlock`, then the newest frame with each note and with `finish_demo`
(`[TextBlock, ImageBlock]`), since every image is a user turn; `stop` as a `TextBlock`. Its tools
are its own `journal`, `copy_into_lesson`, `finish_observation`, the scope's learned skills and
memory search, under `LessonWorkspacePolicy` (native `BeforeToolCallEvent` `cancel_tool`).

### Live Music (Lyria RealTime)

The panel-scope Live agent carries the **Live Music API** as native class-based async
`@tool`s (`agent/api/core/live_music.py::LiveMusicTools`), one per client message of the
reference plus take management: `music_set_weighted_prompts` → `BidiGenerateMusicClientContent`
(text + non-zero weight, list replaces list), `music_set_generation_config` → the full
`BidiGenerateMusicGenerationConfig` (`temperature` 0–3, `top_k` 1–1000, `seed`, `guidance` 0–6,
`bpm` 60–200, `density`/`brightness` 0–1, `scale` enum, `mute_bass`, `mute_drums`,
`only_bass_and_drums`, `music_generation_mode` QUALITY|DIVERSITY|VOCALIZATION; the whole config
is sent each call and bpm/scale changes report `reset_context_required`), `music_playback_control`
→ `PLAY|PAUSE|STOP|RESET_CONTEXT`, `music_status`, `music_take_status`, `music_save`,
`music_discard_take`, `music_close`. The transport is the unmodified google-genai client:
`LiveMusicSession._run` enters `client.aio.live.music.connect(model=RON_LIVE_MUSIC_MODEL)` (the
client sends `setup` and awaits `setupComplete`) and a receive task forwards every
`LiveMusicServerMessage` on the same `/bidi` socket: `music_setup_complete`, `music_audio_delta`
(base64 PCM16; `sample_rate`/`channels` parsed from `audio/l16;rate=48000;channels=2`; `source` =
the chunk's `sourceMetadata`), `music_filtered_prompt`; Ron adds `music_ready`, `music_prompts`,
`music_config`, `music_playback`, `music_take`, `music_error`, `music_closed`, and `ready` carries
`music: true` + `agent_id`. The reference's `warning` field is dropped by google-genai 2.24.0's
model before `receive()` yields, so it cannot be surfaced. Verified live 2026-10-06 on `v1beta`
and `v1alpha`: 2 s chunks every ~2 s, pause/resume and `reset_context` round-trip, metadata
present on every chunk. The prompt guide is an Agent Skill (`agent/skills/lyria-realtime-prompting`)
whose native `skills` tool and `<available_skills>` block `live_music_tools` installs by hand
because `BidiAgent` has no plugins. **Saving**: `TakeRecorder` holds a rolling
`RON_LIVE_MUSIC_RECORD_SECONDS` of PCM segmented at every `sourceMetadata` change;
`music_save`/`POST /music/save` writes WAV to the private Supabase Storage bucket
`RON_LIVE_MUSIC_BUCKET` and a `songs` row (`supabase/migrations/012_songs.sql`, owner RLS);
guests cannot save. `/music/*` is loopback-only, signed-in only, and binds the per-socket random
`agent_id` to the caller's `user_id` (Projects identity): `control`
(deck Play/Pause/Stop/Reset through the same `playback_control`), `take`, `take/discard`,
`save`, `songs`, `DELETE songs/{id}`. The renderer plays the stream in `useMusicPlayback`
(48 kHz stereo `AudioContext`, 2 s lead, analyser tap) and renders
`MusicDeck` with AI Elements `Button`/`ButtonGroup` transport and the
`AudioPlayer` composition for saved songs. Saved songs can be grouped into **playlists or albums**
(`013_playlists.sql`; `/music/playlists*`; agent tools `music_library`, `music_playlists`,
`music_playlist_create|add|remove|reorder|delete`) and played continuously in order or shuffled with
repeat off/all/one (`src/lib/playlist.ts` queue, `usePlaylistPlayer`, `PlaylistShelf`).

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
