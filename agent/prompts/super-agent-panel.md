# Agent Panel Super Agent

This file documents the current Agent Panel implementation. Runtime code lives in
`agent/api/endpoints/chat.py`; this document is intentionally descriptive and
must not introduce alternate routes, model providers, or streaming adapters.

## Runtime Contract

- Provider: `strands.models.openai_responses.OpenAIResponsesModel`
- API base URL: `https://api.perplexity.ai/v1`
- Default model: `anthropic/claude-opus-4-8`
- Required key: `PERPLEXITY_API_KEY`
- Optional model override: `PERPLEXITY_MODEL`
- Frontend route: `POST /chat`
- Model list route: `GET /models`
- Streaming: `Agent.stream_async(...)` events are emitted as SSE `data:` lines.

The Agent Panel must not use `OpenAIModel`, `LiteLLMModel`, Chat Completions,
`@ai-sdk/react` transport wrappers, or a second backend streaming route for this
surface.

## SDK Primitives In Use

- `Agent`
- `OpenAIResponsesModel`
- `FileSessionManager`
- `context_manager="agentic"`
- `ModelRetryStrategy`
- `callback_handler`
- `HookProvider` callbacks
- `take_snapshot(...)` and `load_snapshot(...)` when model or slash-goal state changes
- `SteeringHandler` plugin
- `GoalLoop` plugin for `/goal ...`
- Agent tools: `http_request`, `think`, `load_tool`, `unload_tool`,
  `tool_execute`, `current_time`, `environment`, `editor`, `bash`,
  `use_agent`, `graph`, `batch`, `browser`, `mcp_client`

Do not pass a custom `conversation_manager` when using
`context_manager="agentic"`. Strands resolves the facade to its own default
conversation manager and context offloader. `summarize_context`,
`truncate_context`, and `pin_context` are Strands `@tool(context=True)` tools
injected for context management only; they are not normal application tools.

## Parameter Rules

Perplexity Agent API `ResponsesRequest` supports `max_output_tokens` and does not
support `temperature`. Do not send `temperature` from this runtime path.

Anthropic models require `max_output_tokens` through Perplexity. Set that value
to the model's verified maximum from Anthropic model docs:

- `anthropic/claude-opus-4-8`: `128000`
- `anthropic/claude-opus-4-7`: `128000`
- `anthropic/claude-opus-4-6`: `128000`
- `anthropic/claude-sonnet-4-6`: `128000`
- `anthropic/claude-opus-4-5`: `64000`
- `anthropic/claude-sonnet-4-5`: `64000`
- `anthropic/claude-haiku-4-5`: `64000`

Non-Anthropic models should not receive an output-token cap unless their provider
schema requires one and the model maximum has been verified.

## Audit Findings

Removed or avoided for the Agent Panel runtime:

- No custom model wrapper around `OpenAIResponsesModel`.
- No custom OpenAI/Perplexity transport provider.
- No Chat Completions fallback.
- No curated or truncated frontend model list.
- No hardcoded low `max_output_tokens` value.
- No `temperature` parameter on Agent API Responses requests.
- No `EventSource`; the panel uses POST streaming because the request carries
  session, browser context, user id, and model id.
- No Vercel AI SDK transport wrapper on the Agent Panel path.
- No standalone Agent Panel message bridge; renderer prompts enter through
  `AgentUiContext`.

Remaining intentionally thin app glue:

- `agent/tools` is inserted ahead of site-packages so the Agent Panel uses the
  moved RonBrowser `strands_tools` package directly.
- `ModelSelector.tsx` normalizes the live `/models` response for display without
  filtering provider IDs.

## Completion Evidence

A valid completion proof must include:

- `npm run typecheck`
- `venv/bin/pytest agent/tests -q`
- Live `POST /chat` smoke against `anthropic/claude-opus-4-8` showing streamed
  text from `Agent.stream_async`.
- Live `GET /models` showing the complete Perplexity model list returned by the
  backend.
