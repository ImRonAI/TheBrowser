# Panel tools — Strands 1.56.0

Verified against the actual installed `strands-agents==1.56.0`,
`strands-agents-tools==0.8.6`, and `a2a-sdk==0.3.22`. The four owned files provide
composition helpers; the parent owns `create_panel_agent`, configuration, lifespan,
provider selection, and SSE framing.

## Exact parent wiring

```python
from pathlib import Path
from agent.api.core.panel_tools import (
    PanelToolCatalog, ManagedMCP, create_catalog_tools,
    create_formation_tool, create_skill_tool, skills_from_env,
)

# Inputs supplied by the parent: model, child_model_factory, formation_spec,
# system_prompt, session_manager, shell_mcp (UNSTARTED), configured_mcp_servers,
# application_tools, explicit_skill_assignments, project_tools_dir.
skills = skills_from_env()
catalog = PanelToolCatalog(
    tools=application_tools,
    managed_mcp=[ManagedMCP(shell_mcp)],  # Connect on native registry initialization.
    mcp_servers=configured_mcp_servers,  # Optional lazy, named mcpServers config.
)
catalog.add_tools(create_catalog_tools(catalog, Path(project_tools_dir)))
catalog.add_tools([create_formation_tool(
    formation_spec,
    model_factory=child_model_factory,
    description="Run the application's configured formation",
)])
if skills is not None:
    catalog.add_tools([create_skill_tool(
        skills=skills,
        model_factory=child_model_factory,
        tool_assignments=explicit_skill_assignments,
    )])

# Supply as overrides to Agent/config_to_agent, not config string tools.
agent = Agent(
    model=model,
    system_prompt=system_prompt,
    session_manager=session_manager,
    tools=[catalog],
    plugins=[skills] if skills is not None else [],
    callback_handler=None,
    load_tools_from_directory=False,
    background_tasks={
        "agentic": ["*"],
        "never": ["load_tool", "load_mcp_server", "discover_tools", "editor"],
        "wait_for_completion": True,
    },
)
catalog.bind(agent)
```

The identifiers described as inputs are not built-in capabilities. Do not merge
the old synchronous config strings for `editor`, `load_tool`, discovery or the
global `mcp` tool with this catalog: those names either collide or bypass catalog
ownership. Build agents off the event loop if provider/plugin initialization may
block. Drain native work before provider cleanup. Do not register the same MCP
client both directly on the parent and through the catalog.

## Dynamic meta-tools

```python
create_catalog_tools(catalog: PanelToolCatalog, project_tools_dir: Path) -> list[AgentTool]
adapt_native_tool(value: AgentTool) -> AgentTool
```

The returned list contains:

| Tool | Model-facing inputs | Behavior |
| --- | --- | --- |
| `discover_tools` | `query: str = ""` | Recursively parses `.py` ASTs under the project tools root without importing them. Reports decorated function names/descriptions, literal `TOOL_SPEC` declarations, configured MCP names, and active catalog names. |
| `load_tool` | `path: str, name: str` | Loads a named export from a `.py` file under the project tools root into an isolated staging registry; queues publication after the tool batch. Relative paths resolve against that root. |
| `editor` | Native editor schema | Async streaming facade over installed `strands_tools.editor`; native validation, results and sync-body `asyncio.to_thread` offload are preserved. Supports create/view/replace/insert/search/undo. |
| `load_mcp_server` | `name: str` | Starts only a server in the application-configured `mcpServers` mapping, with native registry ownership; queues its tools after the batch. No transport config or executable supplied by the model. |

This preserves the usable creation flow: **editor create → discover → load → use**
within one native agent invocation. `load_tool` returns `activation="after_tools_batch"`;
it does not claim the new tool is available to a sibling call in the current batch.
Direct calls outside an agent invocation stay queued until the next invocation.

`load_tool` executes `ToolRegistry.load_tool_from_filepath` in a worker thread on
a **staging registry**, not the active parent. That native API is deprecated for
SDK 2.0 but still present in 1.56. Only the explicitly named export is published.
Both `@tool` functions and legacy `TOOL_SPEC` modules are supported. Re-loading a
previously loaded name replaces it at the boundary. Static tools, foreign plugin
tools, normalized `-`/`_` collisions and provider-owned names cannot be overwritten.
The returned adapter is marked dynamic and appears in both registry maps.

`register_dynamic_tool()` is not used alone: it writes only `dynamic_tools`.
Native `register_tool()` with `mark_dynamic()` and `replace()` keep lookup and
model specifications consistent across both maps. Native `load_tool_from_filepath`
loads code; it is not a sandbox. `STRANDS_DISABLE_LOAD_TOOL=true` is honored.
The editor operates on host paths and preserves its existing consent behavior;
it does not globally change environment flags. Native tools 0.8.6 deprecates
`editor` in favor of vended `file_editor`; the compatibility adapter retains the
requested editor interface. For non-interactive deployments the parent must
configure existing editor consent behavior appropriately.

`adapt_native_tool` delegates only known native `DecoratedFunctionTool` and
`PythonAgentTool` streams. Both inspected implementations offload sync function
bodies via `asyncio.to_thread`. It does not invoke the agent, wrap an old recursive
discovery agent, invent a scheduler, or monkeypatch any module. Other AgentTools
must implement async streaming themselves. An arbitrary loaded tool can still
contain application logic; this adapter does not audit its source or dependencies.

## Catalog lifecycle and safe boundaries

```python
ModelFactory = Callable[[str], Model]
AsyncToolLoader = Callable[[], Awaitable[Sequence[AgentTool]]]
ToolAssignment = AgentTool | MCPClient

ManagedMCP(client: MCPClient, refresh: AsyncToolLoader | None = None)
PanelToolCatalog(
    *, tools: Sequence[AgentTool] = (),
    managed_mcp: Sequence[ManagedMCP] = (),
    loader: AsyncToolLoader | None = None,
    mcp_servers: Mapping[str, Any] | None = None,
    mcp_client_factories: Mapping[str, Callable[[], MCPClient]] | None = None,
)
catalog.add_tools(tools: Sequence[AgentTool]) -> None  # Before registration only.
catalog.bind(agent: Agent) -> None
catalog.request_refresh() -> None  # Thread-safe dirty notification only.
catalog.child_tools(names: Sequence[str]) -> tuple[ToolAssignment, ...]
async catalog.stage_tool(path: Path, name: str, *, agent: Agent) -> list[str]
async catalog.stage_mcp_server(name: str, *, agent: Agent) -> list[str]
async list_mcp_tools(
    client: MCPClient, *, prefix: str | None = None, tool_filters: Any = None,
) -> list[AgentTool]
```

`stage_tool` is the lower-level trusted application API; the model-facing wrapper
enforces project-root confinement. A catalog belongs to one parent and implements
the native `ToolProvider` lifecycle (`load_tools`, `add_consumer`, `remove_consumer`).
Its internal native registries own MCP consumer references and cleanup.

Two native hooks apply pending generations:

1. `BeforeInvocationEvent`, under the parent invocation lock.
2. **`AfterToolsEvent`**, after all foreground tools in a batch have finished and
   before the next model call obtains tool specs.

`AfterToolCallEvent` is per tool and can overlap sibling tools in the parallel
executor, so it is deliberately not a reconciliation boundary. Catalog mutation
tools must be in native background policy `never`. Background tasks otherwise
retain their selected tool instance; do not perform live provider teardown while
background work is using it. Provider membership is retained until parent cleanup.

Validation occurs before active-registry changes. Discovery/collision failures
preserve the active catalog, leave the generation dirty, and propagate an error
from the boundary hook; they do not falsely advertise success. Removal reconciles
both public maps (`registry` and `dynamic_tools`), preventing stale ghost tools.
All commit mutations are contiguous with no `await`. A newer notification arriving
during discovery remains dirty for the next boundary. The optional `loader`
returns the complete dynamic application list; imperative `load_tool` additions
are retained separately. This integration does not unload file tools individually.

### MCP 1.56 change notifications

The catalog sets/chains `MCPClient.on_tools_changed(previous_names, new_tools)`
**before** native registry startup. Protocol 2026-07-28 opens the list-change
subscription only when the callback is present at startup. Already-started clients
are rejected instead of silently claiming notifications will work. The SDK performs
debounced, paginated re-listing and applies configured prefixes/filters. The callback
only records the refreshed list and generation under a thread lock; it never touches
the parent registry. Existing callbacks are preserved and restored on cleanup.

Initial-discovery races are covered: a notification during startup can supersede
the initial list. Cleanup does not hold the catalog lock while joining MCP workers,
so a concurrent callback cannot deadlock teardown. An optional `ManagedMCP.refresh`
can provide explicit polling; otherwise the notification payload is authoritative.
`list_mcp_tools` remains an explicit fresh-pagination helper and uses 1.56's native
constructor defaults when prefix/filters are omitted.

Lazy MCP activation uses native `MCPClient.load_servers(...,
prefix_with_server_name=True)` and accepts flat mappings or `{"mcpServers": ...}`.
Disabled/skipped servers produce a clear error. Startup, failure and cancellation
have explicit registry cleanup. Config values/credentials are not returned by
discovery, only server names. Configuration is application-supplied, not loaded by
the model. No old global `strands_tools.mcp` manager or monkeypatch participates.

### Browser elicitation: explicit application policy

```python
MCPClientFactory = Callable[[], MCPClient]
async accept_browser_elicitation(
    context: RequestContext[ClientSession, Any], params: ElicitRequestParams,
) -> ElicitResult
```

The exported async callback returns `ElicitResult(action="accept", content={})`.
It is **never installed by default**. The parent may explicitly assign it only to
the trusted browser client to preserve Electron's existing `requireApproval: false`
policy (`electron/main.ts`). It does not fill forms or supply requested data.
Other MCP servers keep their own policy; no catalog-wide auto-accept is inferred.

Installed 1.56 `MCPClient.load_servers` constructs unstarted clients, has no
callback/options injection argument, and its builder constructs `MCPClient`
directly (not `cls`). `MCPServerConfig` is a TypedDict, not a public client builder.
There is no public elicitation setter. The catalog therefore supports named
application-owned factories rather than copying private fields or monkeypatching.

Exact parent wiring for the current root `mcp.json` (literal stdio browser entry):

```python
from mcp import StdioServerParameters, stdio_client
from strands.tools.mcp import MCPClient
from agent.api.core.panel_tools import PanelToolCatalog, accept_browser_elicitation

# root_mcp_config is read from root mcp.json by the parent composition.
browser_name = "electron-playwright-mcp"
browser = root_mcp_config["mcpServers"][browser_name]

def browser_client() -> MCPClient:
    params = StdioServerParameters(
        command=browser["command"], args=browser.get("args", []),
        env=browser.get("env"), cwd=browser.get("cwd"),
    )
    return MCPClient(
        lambda: stdio_client(params),
        prefix=browser_name, application_name=browser_name,
        elicitation_callback=accept_browser_elicitation,
    )

catalog = PanelToolCatalog(
    mcp_servers=root_mcp_config,
    mcp_client_factories={browser_name: browser_client},
    # tools/loader/managed_mcp as required by existing parent wiring
)
```

A factory is synchronous, runs off the calling loop, and must return a fresh,
unstarted native MCPClient using public constructor arguments. It owns that server's
full transport/options configuration. If the browser entry later gains placeholders,
`~` expansion, filters/prefix overrides, timeout or transport changes, its application
factory must explicitly implement those semantics. The example handles the current
literal stdio entry; it is not a replacement general config parser. Entries without
factories use native `load_servers` unchanged, preserving interpolation, transport,
prefix sanitization and regex filters. Existing `ManagedMCP` clients receive their
callback through their own public constructor, not retroactively.

Factory keys require matching configured entries. Disabled entries never call their
factory. Errors propagate with no callback-less fallback. The catalog installs
`on_tools_changed` before native startup, owns the client through its registry,
publishes tools at a safe boundary, and releases it on startup failure or parent
cleanup. The model can select configured names but cannot change approval policy.

## Skills, child assignments and formations

```python
skills_from_env(environ: Mapping[str, str] | None = None) -> AgentSkills | None
create_skill_tool(
    *, skills: AgentSkills, model_factory: ModelFactory,
    tool_assignments: Mapping[str, Sequence[ToolAssignment]],
) -> AgentTool
ChildSpec(
    name: str, system_prompt: str, tools: tuple[ToolAssignment, ...],
    description: str = "Delegated panel task", checkpointing: bool = False,
)
async create_child_agent(
    spec: ChildSpec, *, model_factory: ModelFactory, plugins: Sequence[Any] = (),
) -> Agent
async create_subagent_tool(spec: ChildSpec, *, model_factory: ModelFactory) -> AgentTool
GraphSpec(
    name: str, nodes: Mapping[str, ChildSpec | GraphSpec | SwarmSpec],
    edges: tuple[tuple[str, str], ...] = (), entry_points: tuple[str, ...] = (),
    max_node_executions: int = 20, execution_timeout: float = 900.0,
    node_timeout: float = 300.0,
)
SwarmSpec(
    name: str, children: tuple[ChildSpec, ...], max_handoffs: int = 20,
    max_iterations: int = 20, execution_timeout: float = 900.0,
    node_timeout: float = 300.0,
)
create_formation_tool(
    spec: GraphSpec | SwarmSpec, *, model_factory: ModelFactory, description: str,
) -> AgentTool
serializable_event(value: Any) -> Any
```

`PANEL_SKILLS_DIRS` is `os.pathsep` separated and takes precedence over
`PANEL_SKILLS_DIR`. Empty configuration means no plugin. Native `AgentSkills`
provides async discovery/activation using the agent sandbox. `run_skill(skill_name,
prompt)` requires both a discovered skill and an explicit application assignment.
`allowed_tools` metadata is descriptive, **not permissions or an automatic grant**.
Native malformed skill handling may log/skip invalid files. Filesystem skill changes
require native cache invalidation at an idle boundary; catalog refresh does not
reload skill sources.

Child models are fresh explicit `Model` instances supplied by `model_factory(name)`;
no provider string inference, parent messages, or child session manager. Local
dynamic tools can be assigned by `catalog.child_tools(["loaded_name"])` after
activation. That is a snapshot, not blanket inheritance of future tools. This
helper rejects catalog-bound meta-tools and bare MCP tools: pass an explicitly
assigned `MCPClient` so the child's native registry owns its connection reference.
`ChildSpec` also rejects bare MCPAgentTools. For child-side loading, the application
must compose a separate child catalog/Agent; parent meta-tools close over the parent
and reject calls from a different agent. Do not share mutable agent-as-tool instances
between unrelated conversations.

`create_subagent_tool` uses native `Agent.as_tool(preserve_context=False)`; parent
composition owns eventual `returned_tool.agent.cleanup()`. Native concurrent use
returns a busy error. Formations instantiate native Graph/Swarm/nested Graphs per
call and consume `stream_async` **once**. No post-stream `invoke_async` reexecution.
Native scheduling/handoffs remain in the SDK. Their async generator's last yield
is the tool result. Intermediate envelopes retain nested node IDs/events; final
`MultiAgentResult.to_dict()` retains node results, statuses and aggregate metrics.
Use `MultiAgentResult.from_dict` to rehydrate. Unknown event objects become explicit
opaque type markers; bytes become base64-tagged data, not stringified handles.

Checkpointing children are disallowed until resume is implemented. Final nested
results are also checked, because native graph completion cannot be equated with
successful child completion. Interrupt/checkpoint/error/incomplete results are
reported as tool errors with the result preserved when available. Missing/duplicate
final results are errors. Formation and skill children are cleaned up in `finally`.
Conditional-edge configuration, durable formation/skill resume, and custom formation
plugin wiring are not exposed by these helpers.

## Native background ownership and pinned external references

Use **`Agent(background_tasks=...)` from SDK 1.56** for tool scheduling, native task
IDs, result delivery and management. It provides `strands_manage_background_task`
and continuation-aware result delivery. Keep catalog mutation tools in `never` as
shown above. The unused `BackgroundReferences` / `create_background_tools` additions
and their tests have been removed. There is no application-side scheduling
implementation or external AsyncToolManager integration in these helpers.

`LoopCallbackBridge(handler)` is a callback delivery utility, not an agent scheduler:
construct it on the receiving loop, call `bridge(**event)` from threads, and await
`bridge.aclose()` before loop shutdown. It queues serializable events with
`call_soon_threadsafe`, retains its worker, drains accepted callbacks and reports
handler errors. Avoid forwarding both native stream and callback copies to one sink.

The exact supplied commits were read via `gh api` (no installation):

1. [`aws-samples/sample-strands-agents-agentskills@c5564fcd2e7c249ec57b32027ffbea49e9abeb7b`](https://github.com/aws-samples/sample-strands-agents-agentskills/tree/c5564fcd2e7c249ec57b32027ffbea49e9abeb7b)
   — inspected `agentskills/tool/agent_skill.py` and `agentskills/models.py`.
   The sample streams an isolated child once and passes explicit `additional_tools`;
   `allowed_tools` is metadata. This implementation keeps those semantics with
   native AgentSkills, fresh model injection, serializable events, strict missing
   result handling, and cleanup rather than importing the sample.
2. [`mikegc-aws/async-agentic-tools@354f88484bdb053862313867fe3c825572ed83cf`](https://github.com/mikegc-aws/async-agentic-tools/tree/354f88484bdb053862313867fe3c825572ed83cf)
   — inspected `manager.py`, `agent.py`, and `decorator.py` under `strands_async_tools`.
   `AsyncToolManager.submit` dispatches **synchronous** functions to a thread pool;
   it does not await coroutine functions. `AsyncAgent` owns a separate busy/queue
   loop and calls `agent(...)` from completion callbacks. Cancellation marks a task
   cancelled even if its running Future cannot be cancelled; completion may overwrite
   that status, and cancelled Future completion is not specially handled.

Direct external-manager integration is therefore not enabled for native panel tools:
it would introduce competing dispatch/result ownership and misleading cancellation.
If an application already owns an audited manager at that commit, its independent
sync jobs may report serializable progress/completion through `LoopCallbackBridge`;
the application owns submission, owner/reference mapping, shutdown and any explicit
next-turn dispatch. Do not instantiate the external `AsyncAgent`, pass native async
tools to `submit`, or schedule the same job through native background tasks as well.
No unverified dependencies were installed and no optional capability is advertised.

## A2A exports and limitations

```python
create_a2a_agent_factory(
    *, model_factory: Callable[[str], Model],
    tools_factory: Callable[[str], Sequence[Any]],
    name: str, description: str, system_prompt: str,
) -> Callable[[str], Agent]
create_panel_a2a_server(
    *, agent_factory: Callable[[str], Agent], http_url: str, max_contexts: int = 1000,
) -> PanelA2A
mount_panel_a2a(
    app: FastAPI, integration: PanelA2A, *, enabled: bool = False, path: str = "/a2a",
) -> bool
async integration.aclose() -> None
create_panel_a2a_client(
    endpoint: str, *, name: str | None = None, description: str | None = None,
    timeout: int = 300, client_config: ClientConfig | None = None,
) -> A2AAgent
```

A2A factory mode creates isolated agents and enables compliant native artifact
streaming. Reused Agent instances and checkpoint-enabled agents are rejected.
The factory helper binds supplied PanelToolCatalog instances automatically; create
a fresh catalog per context. Native factories are synchronous, so avoid expensive
request-path initialization. The metadata-only agent's skills are snapshotted and
its providers cleaned up after server construction.

Mounting is off by default. Public URL path must match the explicit mount path;
the native subapp serves at its own root to prevent double prefixes. Root lifespan
must drain requests then call `integration.aclose()`. SDK 1.56 still uses LRU context
retention that can evict active contexts; it is not admission control. Context IDs
are conversation keys, not authenticated owner identities. Remaining agents are
weakly tracked so the wrapper does not defeat eviction. Native task store/context
retention is in-memory unless explicitly composed otherwise.

Native client construction is lazy. Caller-supplied `httpx` clients own their
timeout and shutdown. Native A2A events differ from panel SSE; they require parent
framing. Outgoing conversation continuity needs explicit native A2A Message inputs.
The A2A client is not a local `Agent.as_tool` adapter.

## Verification

```sh
./venv/bin/python -m pytest agent/tests/test_panel_tools.py -q
```

Offline tests exercise actual native Agents/Models, one-pass formations, native
skills, editor/create/discover/load/use in one invocation, dynamic reload across
both maps, sync-body worker-thread execution with ToolContext, startup notification
races and callback restoration, configured MCP ownership/failure cleanup, and native
A2A HTTP/SSE using in-process ASGI transport. No remote services or provider keys.

Inspected 1.56 sources include `tools/{registry,loader,decorator,tools}.py`,
`tools/mcp/mcp_client.py`, `hooks/events.py`, `event_loop/event_loop.py`,
`background_tasks/{_types,_background_tasks}.py`, native skills, formations, and
A2A server/executor/client. The API hook choice is based on actual batch timing,
not the name of a per-tool callback. Existing parent/session/provider files remain
outside this ownership boundary; parent wiring and SSE exposure are required.
