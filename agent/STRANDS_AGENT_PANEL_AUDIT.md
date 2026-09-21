# Strands Agent Panel Audit

## Verified Sources

- Installed `strands-agents==1.44.0` signatures for `Agent`, `OpenAIResponsesModel`,
  `FileSessionManager`, `ModelRetryStrategy`,
  snapshots, hooks, plugins, and sandbox interfaces.
- Strands docs for session management, conversation management, retries,
  hooks, steering, and `Agent.stream_async(...)`.
- Perplexity Agent API OpenAPI schema for `ResponsesRequest`.
- Perplexity `GET /v1/models` live response.
- Anthropic model overview for max output token limits.

## Runtime Contract

- Agent runtime: `strands.Agent`
- Provider: `strands.models.openai_responses.OpenAIResponsesModel`
- API base URL: `https://api.perplexity.ai/v1`
- Required key: `PERPLEXITY_API_KEY`
- Default model: `anthropic/claude-opus-4-8`
- Request route: `POST /chat`
- Model list route: `GET /models`
- Streaming primitive: `Agent.stream_async(...)`

## Requirement Matrix

| Requirement | Implementation |
| --- | --- |
| Session management | `FileSessionManager(session_id, storage_dir=.sessions)` |
| Context management | `context_manager="agentic"` |
| Conversation management | Strands resolves the agentic context-manager facade to its SDK default conversation manager and context offloader |
| Full event loop | `Agent.stream_async(...)` events are forwarded as SSE `data:` payloads |
| Retries | `ModelRetryStrategy(max_attempts=6, initial_delay=4, max_delay=240)` |
| Callback handler | `panel_callback_handler` passed directly to `Agent` |
| Hooks | `PanelLifecycleHook` registers SDK hook events |
| Virtual desktop tools | Local moved RonBrowser tools expose exactly one `editor` and one `bash`; both target the `ron-agent-desktop` container |
| Snapshots | `take_snapshot(preset="session", include=["system_prompt"], exclude=["model_state"])` before reconfiguration, then `load_snapshot(...)` |
| Agent config | `agent_id`, `name`, `description`, `state`, and `trace_attributes` are set on `Agent` |
| Steering | `PanelSteeringHandler` plugin |
| Slash goal | `/goal` state plus Strands `GoalLoop` plugin |
| MCP | Local moved `mcp_client` is available as an agent tool |
| Per-turn model selection | Frontend sends `model` in every `POST /chat`; backend reconfigures the same session with a snapshot |
| Full live model list | `/models` proxies Perplexity `GET /models` without curation or provider filtering |

## Context Manager Boundary

`summarize_context`, `truncate_context`, and `pin_context` are Strands
`@tool(context=True)` tools injected by `context_manager="agentic"`. They are
for framework-driven context management with injected `ToolContext`; they are not
normal app tools and are not listed in the Agent Panel's `_build_tools()` list.

## Parameter Rules

Perplexity Agent API `ResponsesRequest` supports `max_output_tokens` and does
not support `temperature`. The Agent Panel runtime sends no `temperature`.

For current Anthropic models exposed by Perplexity, `max_output_tokens` is set to
the verified model maximum. Non-Anthropic models are not capped unless a verified
maximum is added.

## Removed Or Avoided

- No Chat Completions provider on the Agent Panel path.
- No `temperature` parameter on Perplexity Agent API requests.
- No curated or truncated model selector.
- No arbitrary low max output token cap.
- No custom model wrapper around `OpenAIResponsesModel`.
- No custom tool registry manifest for the Agent Panel path.
- No Vercel AI SDK chat transport wrapper on the Agent Panel path.
- No standalone Agent Panel message bridge; renderer prompts enter through
  `AgentUiContext`.
- No duplicate Strands sandbox `file_editor`/`bash` tools on the Agent Panel
  runtime; the panel does not pass `WorkspaceSandbox` to `Agent`.

## Intentional App Glue

- The moved local `agent/tools/strands_tools` package is inserted ahead of
  site-packages so the panel uses the RonBrowser tool tree directly.
- Frontend SSE parsing is UI transport glue for a `POST /chat` stream carrying
  session, user, browser context, and selected model.
