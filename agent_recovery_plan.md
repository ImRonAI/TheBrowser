# Strands Agent Implementation — Damage Assessment & Recovery Plan

## 1. Executive Summary

The `agent/` implementation is **massively over-engineered, partially non-compliant with the Strands SDK, and mixes unrelated concerns**. It contains ~27 Python files (including duplicated/legacy files), ~4,000+ lines of backend agent code, and a parallel front-end TypeScript layer that reinvents event parsing that the SDK already provides.

The core user-facing requirement appears to be:

> A browser sidebar "Panel Agent" that can see the active tab, chat with the user via streaming, use a curated set of tools, and optionally remember things.

Almost everything else — Bidi voice, SuperAgent meta-tooling, snapshot/rollover subsystems, MCP/OpenAPI registries, project/task CRUD, Bedrock KB, LanceDB, multi-provider orchestration, Vercel AI SDK transport shimming — is **unnecessary scaffolding** that is either broken, unused, or directly contradicts the Strands SDK patterns.

## 2. What the Strands SDK Actually Says (the "Bible")

Verified against the installed SDK (`strands` package in the project venv):

* `Agent.__init__` accepts: `model`, `messages`, `tools`, `system_prompt`, `structured_output_model`, `callback_handler`, `conversation_manager`, `record_direct_tool_call`, `load_tools_from_directory`, `trace_attributes`, `agent_id`, `name`, `description`, `state`, `context_manager`, `plugins`, `hooks`, `interventions`, `session_manager`, `memory_manager`, `structured_output_prompt`, `tool_executor`, `retry_strategy`, `concurrent_invocation_mode`, `checkpointing`, `sandbox`.
* `Agent.stream_async(prompt, *, invocation_state=None, structured_output_model=None, structured_output_prompt=None, limits=None, **kwargs)`.
* Tools are passed to `Agent(tools=[...])` as either `DecoratedFunctionTool` instances or modules with a `TOOL_SPEC` dict. There is **no need** for a runtime catalog manager, AST parser, or manual tool registry seeding.
* `@tool(context=True)` injects a `ToolContext`; per-request context is passed as keyword args to `stream_async`/invocation and read via `tool_context.invocation_state`.
* `BidiAgent` is a separate class in `strands.experimental.bidi` with `start/send/receive/stop`. It does **not** support `structured_output_model` and is not required for a text sidebar agent.
* `MemoryManager(stores=[...], search_tool_config=..., add_tool_config=..., injection=...)` can be passed to `Agent(memory_manager=...)` to give the agent memory tools automatically.
* `FileSessionManager(session_id=..., storage_dir=...)` and conversation managers (`SlidingWindowConversationManager`, `SummarizingConversationManager`, `NullConversationManager`) are standard and work out of the box.

## 3. Damage Assessment by File

### 3.1 `agent/api/core/config.py` — HIGH SEVERITY

* **Hardcoded AWS credentials** (lines 52-53). This is a security incident waiting to happen and is almost certainly invalid/expired.
* **Hardcoded Bedrock KB IDs / bucket / data-source IDs** (lines 65-68). Same problem.
* `AGENT_TIMEOUT_SECONDS = 14400` (4 hours), `AGENT_STREAM_HARD_TIMEOUT_SECONDS = 900`. These are reckless defaults that will leave HTTP requests and streams dangling.
* `SUPERAGENT_MODEL_PROVIDER=gemini` with `SUPERAGENT_GEMINI_MODEL_ID=gemini-3.5-flash-preview` — non-existent model IDs.
* Creates `AGENT_SANDBOX_ROOT` and writes into `~/Library/Application Support/RonBrowser/agent-sandbox`. This is fine, but then `TOOLS_SRC_DIR` points *inside* the sandbox, meaning the runtime is expected to have copied tool source there. In reality the installed `strands_tools` package is in the venv, so the path is wrong.
* Sets two env vars for the discovery manifest path. Manifest-based tool discovery is not a Strands SDK feature; it is home-grown complexity.

### 3.2 `agent/api/core/agent_factory.py` — CRITICAL SEVERITY

* **Non-compliant `Agent` construction for panel agent**: passes `memory_manager=memory_manager` (line 964) but then **also** appends `mem0_memory` to `tools` (lines 946-947). If `memory_manager` is configured correctly the mem0 tool is redundant; if not, it is a workaround.
* **Duplicate panel agent implementation**: `create_panel_agent` is ~120 lines and almost identical to the inline panel agent in `agent/api/endpoints/agents.py` (lines 248-345). Both construct Bedrock KB + MemoryManager + OpenAIResponsesModel. This is copy-paste bloat.
* **Bidi superagent** (`create_super_bidi_agent`, `_create_superagent_bidi`) is a huge block of code for a feature not used by the sidebar. It tries to build `BidiOpenAIRealtimeModel`, `BidiGeminiLiveModel`, `BidiNovaSonicModel` depending on env vars. The sidebar only uses text.
* **Tool loading is absurdly complex**: `_get_tools()` tries to import 14 different `strands_tools` modules via string names with try/except, then instantiates `LocalChromiumBrowser` and `LocalCodeInterpreter` (the latter is an abstract class and will actually fail — see below), then calls `_sync_tools_with_catalog` and `_seed_external_tool_catalog`. The catalog manager (`strands_tools.tool_catalog_manager`) **does not exist** in the installed package, so the sync code is dead on arrival.
* **Search agent calls `_get_tool_by_name("think")`** but the `think` tool exists as `strands_tools.think.think`, not via a special helper.
* **Duplicate search agent tool loading**: `create_search_agent` manually imports `http_request`, `tavily_search`, `mcp_client`, `mem0_memory` instead of passing the standard tool list.
* **Class-based tool instantiation bug**: `LocalCodeInterpreter()` (line 266) is abstract and cannot be instantiated. The SDK provides `AgentCoreCodeInterpreter`, not `LocalCodeInterpreter`. `browser_instance.browser` works, but `interp_instance.code_interpreter` will raise `TypeError`.
* **ModelRetryStrategy** is instantiated with positional args (`max_attempts=6, initial_delay=4, max_delay=240`) which matches the SDK signature, but it is unnecessary unless the deployment actually needs retries.
* **No per-request isolation**: `AgentFactory._agents` caches agents by `(agent_type, session_id)`. This is reasonable, but the `panel` agent takes `user_id` and the cache key does not include it, so a session-scoped panel agent is reused even if a different user logs in on the same session.

### 3.3 `agent/api/core/superagent.py` — HIGH SEVERITY

* **Self-built tool discovery registry** (~350 lines) duplicates the SDK's own tool loading. It scans `pkgutil.iter_modules`, imports modules, looks for `DecoratedFunctionTool` and `TOOL_SPEC`. The SDK already does this when you pass the module to `Agent(tools=[...])`.
* **Meta-tooling helpers** (`discover_strands_tools`, `load_strands_tool`, `unload_tool`) are unnecessary: the SDK's native `load_tool` does exactly this, and the system prompt should simply tell the model to use `load_tool`.
* **Snapshot subsystem** (~200 lines) writes JSON snapshots to disk. Not a Strands feature, not requested by the user, adds state mutation inside hooks.
* **Interrupt subsystem** uses `threading.Event` keyed by session id. Hooks already receive invocation state; this is a homemade cancellation mechanism that competes with SDK cancellation.
* **`Agent(..., load_tools_from_directory=False)`** (line 891) is passed explicitly. This is correct, but the reason it is needed is because the code put a `tools/` directory inside the sandbox and the SDK would try to auto-load it otherwise. A simpler fix: don't put a `tools/` directory on the path.
* **Gemini model construction** uses `google.genai.types.ThinkingConfig` and `thinking_level`. The SDK's `GeminiModel` accepts these via `params`, but `gemini-3.5-flash-preview` is not a real model.
* **NVIDIA NIM fallback** uses `model_id=NVIDIA_NIM_MODEL_ID` default `"nvidia_nim/moonshotai/kimi-k2.5"`. This is a LiteLLM provider string, not a Strands-native model, and requires the NVIDIA key.

### 3.4 `agent/api/core/streaming.py` — CRITICAL SEVERITY

* **Reinvents the Vercel AI SDK UIMessageStream protocol from scratch**. ~1,100 lines of manual event parsing, heartbeat logic, timeout handling, bidi fallback, and structured-output extraction. This is the single largest piece of over-engineering.
* **`stream_async` is called with `invocation_state=invocation_state`** (line 681). The SDK signature supports this, so this part is okay.
* **Structured output is extracted twice**: once from `event["structured_output"]` and once from `event["result"].structured_output`. The SDK only emits structured output inside the `result` event (verified by docs).
* **`ModelStreamChunkEvent` handling assumes `event["event"]` contains `contentBlockStart/Delta/Stop`**. The SDK docs show these fields exist, but the code does not handle the case where the chunk is a plain `data` delta, which is the common path for text models.
* **Bidi stream fallback** (`_stream_bidi_agent_response`) is ~250 lines for a feature the sidebar does not use. It tries to fall back to a standard agent on timeout/error by clearing the cache and recreating the agent, which will likely cause session/state loss.
* **Heartbeat/timeout logic** wraps the async generator in `asyncio.wait` with manual heartbeat comments. SSE keep-alive is a transport concern and should be handled by the ASGI server / `StreamingResponse`, not by re-implementing the generator.
* **`_safe_get_agent_loop_state` reads `agent.state.get("agent_loop")`** that was written by a custom hook. This couples streaming to a non-SDK convention.
* **Returns `data: [DONE]`** at the end. The UIMessageStream spec does not require this; it may confuse the AI SDK transport.

### 3.5 `agent/api/endpoints/agents.py` — HIGH SEVERITY

* **Duplicate panel agent construction**: the `/panel/stream` endpoint builds the panel agent inline (lines 248-345) instead of delegating to `AgentFactory.create_panel_agent`. The inline version is a near-copy.
* **Non-standard request schema**: `ChatMessage`, `ChatMessagePart`, `StreamRequest` try to mimic the Vercel AI SDK message format but the backend then calls `parse_ai_sdk_message` to collapse it back to a string. The frontend uses `useChat` which already serializes messages; the backend should accept a simple `message` string and optional `messages` history if needed.
* **Schema registry** (`register_schema`, `resolve_schema`) is unused in practice; `DEFAULT_STRUCTURED_OUTPUT_MODEL` defaults to empty string.
* **`/super-bidi/stream` returns 410** (lines 169-181) — the endpoint exists only to say it is disabled. Remove it.
* **`_build_invocation_state` merges request metadata** (request id, session id, path, user-agent) into `invocation_state`. This is okay but unnecessary for most tools.
* **No authentication / user binding**: `user_id` comes from the request body or defaults to `"default"`. There is no JWT or session validation.

### 3.6 `agent/api/endpoints/tools.py`, `mcp_servers.py`, `openapi_specs.py` — MEDIUM SEVERITY

* These are CRUD/registry endpoints for tools, MCP servers, and OpenAPI specs. They parse source code with `ast`, manage JSON manifests, and expose source code via HTTP.
* They are **not needed** for the core sidebar agent. The SDK's `load_tool` and `mcp_client` tools already allow the agent to load tools and MCP servers at runtime.
* They introduce filesystem traversal risks (`get_tool_source` resolves paths from user input) and arbitrary JSON file I/O.
* `mcp_servers.py` imports `mcp_client` tool and calls it synchronously inside an async endpoint via `mcp_client(**connect_kwargs)`. The tool itself may be async; this is unsafe.

### 3.7 `agent/api/core/context_builder.py` — MEDIUM SEVERITY

* Calls Supabase to fetch a `profiles` table and Mem0 to search memories on every panel request. This adds latency and requires credentials that may not exist.
* `Mem0ServiceClient.search_memories` signature is `(query, user_id, agent_id)` but is called with `agent_id="ron"` hardcoded.
* Builds a large context dict that is passed as `invocation_state`. Much of it (profile, memories) is unused by the panel tools.

### 3.8 `agent/api/core/hooks.py` — MEDIUM SEVERITY

* Custom hooks are actually implemented correctly against the SDK `HookProvider` interface (`register_hooks(registry, **kwargs)`).
* However, `AgentLoopObserverHook`, `MaxToolCallsHook`, and `ToolHealthQuarantineHook` are guardrails that could be replaced by simpler SDK features (e.g. `Limits` parameter on `stream_async`) or omitted until needed.
* `ExperimentalHookAliasObserver` and `LLMSteeringHandler` are disabled by default but add import noise and dependency on `strands.experimental`.

### 3.9 `agent/api/core/prompts/agent_panel.py` — LOW SEVERITY

* The prompt references `search_memory` and `load_tool` paths inside the sandbox. There is no `search_memory` tool registered (it would come from `MemoryManager` injection, not a tool name). The path references are also wrong because `strands_tools` is installed in the venv, not the sandbox.
* It tells the agent to use `emit_jsx` for Gen-UI. The frontend does render JSX from `data-jsx` parts, but this is a side-channel not a Strands feature.

### 3.10 `agent/api/main.py` — LOW SEVERITY

* Reasonably clean FastAPI entry point. Imports all endpoint modules; some are unnecessary (tools, mcp_servers, openapi_specs) but harmless.
* Lifespan seeds the MCP manifest on startup. Not needed.

### 3.11 `agent/api/endpoints/projects.py`, `chat_sessions.py`, `browser_sessions.py` — MEDIUM SEVERITY

* `projects.py` is a full Supabase CRUD API for projects/tasks/documents/initiatives. Not related to the agent.
* `chat_sessions.py` reads the `FileSessionManager` on-disk format (`session_{id}/agents/agent_{type}/messages/message_{n}.json`). This is fragile and tied to implementation details of `FileSessionManager`.
* `browser_sessions.py` wraps the `strands_tools.browser.LocalChromiumBrowser` class in HTTP endpoints. The agent already has the browser tool; this wrapper duplicates it and stores state in-memory.

### 3.12 `agent/superagent_with_rollover.py` — CRITICAL SEVERITY (legacy/dead)

* Imports `strands_tools.tool_catalog` (does not exist), `strands.tools.mcp.MCPClient` (likely does not exist), `mcp` package (may not be installed).
* Implements a homemade context rollover wrapper. Not used by the FastAPI app and likely fails to import.

### 3.13 `agent/docker/*`, `agent/lancedb_session_repository.py`, `agent/aisdk_stream.py` — CRITICAL SEVERITY (dead code)

* These files are not imported by the main app. They contain duplicate/older implementations.

### 3.14 Frontend (`src/components/agent-panel/AgentPanel.tsx`, etc.) — HIGH SEVERITY

* Uses `@ai-sdk/react` `useChat` with `DefaultChatTransport` pointing at `http://localhost:8765/agents/panel/stream`. This is a Vercel AI SDK v6 transport shimmed over a custom SSE backend.
* The backend emits custom SSE event types (`text-start`, `text-delta`, `tool-input-start`, etc.) that `DefaultChatTransport` may or may not understand. The AI SDK expects the UIMessageStream protocol exactly; any deviation breaks the UI.
* `ChainOfThoughtMessage` is ~560 lines of manual part parsing for `text`, `reasoning`, `dynamic-tool`, `data-*` parts. The AI SDK `useChat` already parses parts; this component duplicates that logic.
* `orchestration-stream.ts` is ~700 lines parsing tool-specific payloads (`workflow`, `swarm`, `graph`) that the agent may emit. This is visualization code for multi-agent orchestration that is not part of the sidebar's core job.
* `handleLoadHistorySession` reads `/chat-sessions/{sid}` and tries to hydrate messages into UIMessage parts. The session storage format is raw SDK messages, not UIMessage parts, so the hydration is lossy and likely wrong.

## 4. Root Causes

1. **Architecture by accretion**: every possible Strands feature was added as a separate module without a unifying design.
2. **Fear of the SDK**: instead of using `Agent(tools=[...])`, `load_tool`, `MemoryManager`, and the built-in streaming events, the code wraps them in layers of "helper" code that reimplements what the SDK does.
3. **Frontend/backend impedance mismatch**: the backend emits a custom SSE protocol, and the frontend parses it with custom code instead of using the SDK's native streaming shape or the Vercel AI SDK's expected protocol.
4. **No single source of truth for an agent**: panel agent is implemented twice; superagent is implemented in `agent_factory.py`, `superagent.py`, and `superagent_with_rollover.py`.
5. **Hardcoded secrets and imaginary model IDs**: AWS keys, Bedrock IDs, and Gemini model IDs were committed to source control.
6. **No tests for the actual agent loop**: `test_sandbox.py` only checks sandbox path escaping; there are no tests for streaming, tool calling, or panel agent behavior.

## 5. Recommended Recovery: Minimal Compliant Implementation

The goal is to get to a working sidebar Panel Agent with the least amount of code.

### 5.1 Core Backend (delete and replace)

* **Delete** the following files/directories entirely:
  * `agent/api/core/superagent.py`
  * `agent/api/core/agent_factory.py`
  * `agent/api/core/streaming.py`
  * `agent/api/core/context_builder.py`
  * `agent/api/core/hooks.py`
  * `agent/api/core/tools/panel_tools.py`
  * `agent/api/endpoints/agents.py`
  * `agent/api/endpoints/tools.py`
  * `agent/api/endpoints/mcp_servers.py`
  * `agent/api/endpoints/openapi_specs.py`
  * `agent/api/endpoints/projects.py`
  * `agent/api/endpoints/browser_sessions.py`
  * `agent/api/endpoints/chat_sessions.py`
  * `agent/api/schemas.py`
  * `agent/superagent_with_rollover.py`
  * `agent/lancedb_session_repository.py`
  * `agent/aisdk_stream.py`
  * `agent/docker/`
  * `agent/api/core/prompts/agent_panel.py`
* **Keep** only:
  * `agent/api/main.py` (simplified)
  * `agent/api/core/config.py` (simplified, no hardcoded secrets, no sandbox tool paths)
  * `agent/api/endpoints/__init__.py`
  * `agent/api/core/__init__.py`
  * `agent/tests/test_sandbox.py` (expand to cover agent behavior)

* **Create** a single new module: `agent/api/endpoints/chat.py` containing:
  * One `Agent` instance per `(session_id, user_id)` cached in memory.
  * Model selection driven by env vars (`OPENAI_API_KEY` → `OpenAIResponsesModel`, `GOOGLE_API_KEY` → `GeminiModel`, fallback to `LiteLLMModel` for NVIDIA NIM if configured).
  * A curated tool list passed directly to `Agent(tools=[...])`: `editor`, `shell`, `file_read`, `file_write`, `python_repl`, `http_request`, `browser` (`LocalChromiumBrowser().browser`), `code_interpreter` (`AgentCoreCodeInterpreter` if AWS configured, otherwise `CodeInterpreter` concrete subclass if available, or omitted), `think`, `load_tool`, `mem0_memory` (if configured), `mcp_client`.
  * `MemoryManager` only if Mem0/Bedrock credentials are present; otherwise omit it.
  * A single POST `/chat` endpoint that accepts `session_id`, `user_id`, `message`, and `browser_context`. It calls `agent.stream_async(message, invocation_state={...})` and yields the raw SDK events as Server-Sent Events (or JSON lines). No custom protocol.
  * Optional `DELETE /chat/{session_id}` to clear the cached agent.

### 5.2 Streaming Protocol

* **Do not** implement UIMessageStream or custom heartbeat logic.
* Stream raw Strands events as NDJSON or SSE `data:` lines. Each event is a JSON object. The frontend can render the parts it cares about (`data` for text, `current_tool_use` for tool usage, `result` for completion).
* If Vercel AI SDK integration is required, use the AI SDK's protocol exactly, or better: stop using the AI SDK for this endpoint and use a simple `fetch`/`EventSource` consumer that appends text to React state.

### 5.3 Frontend (simplify)

* Replace `DefaultChatTransport` + `useChat` with a simple fetch-to-SSE hook in `AgentPanel.tsx`.
* Remove `ChainOfThoughtMessage` complexity; render plain text and an expandable tool log.
* Remove `orchestration-stream.ts` and the multi-agent visualization stores unless the user explicitly wants orchestration later.
* Keep only `panelAgentStore.ts` for panel width/mode; move message state into local component state.

### 5.4 Configuration

* Remove all hardcoded AWS/Bedrock/Gemini IDs and keys from `config.py`.
* Required env vars: one model key (`OPENAI_API_KEY` or `GOOGLE_API_KEY` or `NVIDIA_NIM_API_KEY`).
* Optional: `MEM0_*` keys, `SUPABASE_*` keys, `AWS_*` keys. If absent, disable the corresponding feature gracefully.
* Remove the sandbox tool path logic; tools come from the installed `strands_tools` package.

### 5.5 Tests

* Add tests that actually run the agent loop against a dummy model or mock.
* Test that tools receive `invocation_state` correctly.
* Test streaming event shapes.
* Test that the panel agent can be created without credentials (graceful degradation).

## 6. Verification Plan

1. `npm run typecheck` and `npm run build` pass.
2. `pytest agent/` passes, including new agent loop tests.
3. Backend starts with `npm run dev:backend` without errors when only `OPENAI_API_KEY` is set.
4. A curl to `/chat` with a simple message returns streamed text events.
5. Frontend `AgentPanel` connects to `/chat`, sends a message, and displays the response.
6. No hardcoded secrets remain in `config.py`.

## 7. Files That Must Be Modified or Created

* `agent/api/main.py` — simplify router includes.
* `agent/api/core/config.py` — remove secrets, sandbox tool paths, and unused config.
* `agent/api/endpoints/chat.py` — new, minimal chat endpoint.
* `src/components/agent-panel/AgentPanel.tsx` — replace useChat/transport with simple SSE.
* `src/components/ai-elements/chain-of-thought-message.tsx` — delete or massively simplify.
* `src/utils/orchestration-stream.ts` — delete.
* `agent/tests/test_sandbox.py` — expand to test agent loop.

## 8. Handoff Note for Code Simplifier

Start from the assumption that the user only needs a **text-based sidebar Panel Agent** with a curated tool set and streaming. Strip everything else. Use the Strands SDK directly:

```python
from strands import Agent
from strands.models.openai_responses import OpenAIResponsesModel

agent = Agent(
    model=OpenAIResponsesModel(model_id="gpt-4o", client_args={"api_key": key}),
    system_prompt=PROMPT,
    tools=TOOLS,
    session_manager=FileSessionManager(session_id=session_id, storage_dir=".sessions"),
    conversation_manager=SlidingWindowConversationManager(window_size=40),
)

async for event in agent.stream_async(message, invocation_state={"user_id": user_id, "browser_context": ctx}):
    yield event
```

That's the entire agent. Everything else is waste.
