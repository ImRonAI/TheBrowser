"""Perplexity Agent API model provider.

Extends the vended ``OpenAIResponsesModel`` (the SDK-documented custom model
provider path: subclass and override ``stream()``) to match the Perplexity
Agent API's *documented* streaming spec.

Authoritative sources:

- Perplexity Agent API OpenAPI (docs.perplexity.ai/api-reference/agent-post):
  the ``EventType`` enum contains exactly 14 stream events. There are NO
  ``response.function_call_arguments.delta`` / ``.done`` events. Function
  calls arrive as complete ``FunctionCallOutputItem`` payloads on
  ``response.output_item.added`` / ``response.output_item.done``, where
  ``arguments`` ("JSON string of arguments") is a REQUIRED field.
- Strands custom model provider guide
  (user-guide/concepts/model-providers/custom_model_provider): extend the
  model class and override ``stream()``, which "handles request formatting,
  model invocation, and response processing internally".

The vended provider only fills tool-call arguments from the OpenAI-dialect
``response.function_call_arguments.delta/.done`` events, which Perplexity
never emits, so every tool call reached the executor with empty input. This
subclass captures ``item.arguments`` from the two documented output_item
events instead. The OpenAI-dialect delta events are still honored when
present, so the provider remains correct for servers that emit them.

Server-side (native) tools -- ``web_search``, ``fetch_url``, ``sandbox``,
``people_search``, ``finance_search``, ``mcp``, connectors, skills -- run
inside the Agent API's own loop. Their results arrive as Perplexity-only
``response.reasoning.*`` events and as ``response.output_item.done`` items
whose ``type`` is in ``NATIVE_OUTPUT_ITEM_TYPES``; the OpenAI SDK's typed
stream has no branch for them and drops them. The only observation point is
the raw SSE body, so an httpx response hook taps every ``data:`` line and the
matching payloads are re-yielded verbatim as ``{"perplexity": payload}``
StreamEvents, interleaved with the parent's chunks, for the panel to render.

Agent-API-only request fields (``max_steps``, ``skills``, ``preset``,
``background``, ``language_preference``) are not ``AsyncResponses.create``
kwargs; they ride in ``extra_body``, the SDK's verbatim JSON passthrough.
The API also rejects a function schema whose ``object`` node lacks
``properties`` (400 invalid request); ``_ensure_object_properties`` repairs
those the way ``ensure_strict_json_schema`` does for Bedrock.
"""

import asyncio
import inspect
import json
import logging
import re
from collections.abc import AsyncGenerator, AsyncIterator
from contextvars import ContextVar
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import httpx
import openai
from openai.resources.responses import AsyncResponses
from typing_extensions import override

from strands.models.openai_responses import (
    OpenAIResponsesModel,
    _CONTEXT_WINDOW_OVERFLOW_MSG,
    _RATE_LIMIT_MSG,
    _OpenAIResponsesStreamError,
    _ToolCallInfo,
)
from strands.models._openai_errors import classify_openai_error
from strands.types.content import Messages
from strands.types.exceptions import (
    ContextWindowOverflowException,
    ModelThrottledException,
)
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolChoice, ToolSpec

logger = logging.getLogger(__name__)

#: Perplexity-only ``response.output_item.done`` item types: the server-side tool
#: payloads in the Agent API OutputItem union that the OpenAI Responses stream loop
#: has no branch for. ``message`` is absent on purpose (its text already streams as
#: output_text deltas) and so is ``function_call`` (handled as a normal toolUse).
#: https://docs.perplexity.ai/api-reference/agent-post
NATIVE_OUTPUT_ITEM_TYPES: frozenset[str] = frozenset({
    "search_results", "people_search_results", "finance_results", "fetch_url_results",
    "sandbox_results", "sandbox_glob", "sandbox_grep", "sandbox_read_file", "sandbox_write_file",
    "sandbox_edit_file", "sandbox_apply_patch", "share_file", "mcp_call", "mcp_list_tools",
    "skill_loaded", "advisor_result",
})

#: Named kwargs of ``AsyncOpenAI.responses.create``. Anything else the request carries
#: (``max_steps``, ``skills``, ``preset``, ``background``, ...) is Agent-API-only and
#: must travel in ``extra_body``.
_OPENAI_FIELDS: frozenset[str] = frozenset(inspect.signature(AsyncResponses.create).parameters) - {"self"}

#: Errors no retry can fix. HTTP client statuses, plus the symbolic codes the Agent API
#: puts on a `response.failed` / SSE `error` event after a 200 (it does not set a status
#: there). Everything else the stream raises is treated as transient and retried by the
#: native ModelRetryStrategy -- the policy the working reference adapter uses.
PERMANENT_HTTP_STATUSES: frozenset[int] = frozenset({400, 401, 403, 404, 422, 424})
PERMANENT_API_ERROR_TYPES: frozenset[str] = frozenset({
    "invalid_request", "invalid_request_error", "external_connector_error", "invalid_api_key",
    "authentication_error", "permission_error", "not_found_error", "insufficient_quota",
})


def is_permanent_error(error: BaseException) -> bool:
    """Whether a stream/API error is a client error that retrying cannot fix."""
    status = getattr(error, "status_code", None)
    if isinstance(status, int) and status in PERMANENT_HTTP_STATUSES:
        return True
    for attr in ("code", "type"):
        value = getattr(error, attr, None)
        if isinstance(value, str) and value.lower() in PERMANENT_API_ERROR_TYPES:
            return True
        if isinstance(value, int) and value in PERMANENT_HTTP_STATUSES:
            return True
        if isinstance(value, str) and value.isdigit() and int(value) in PERMANENT_HTTP_STATUSES:
            return True
    body = getattr(error, "body", None)
    if isinstance(body, dict):
        for key in ("code", "type"):
            value = body.get(key)
            if isinstance(value, str) and value.lower() in PERMANENT_API_ERROR_TYPES:
                return True
    return False


@dataclass
class _Invocation:
    """Per-turn tap state: queued native events for the in-flight ``stream()`` call."""

    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=asyncio.Queue)


def is_native_event(payload: Any) -> bool:
    """Whether a decoded SSE payload is a Perplexity-only server-side tool event."""
    if not isinstance(payload, dict) or not isinstance(kind := payload.get("type"), str):
        return False
    if kind.startswith("response.reasoning.") or kind == "response.skill.loaded":
        return True
    # Output items render once, on .done; .added would duplicate them.
    item = payload.get("item") if kind == "response.output_item.done" else None
    return isinstance(item, dict) and item.get("type") in NATIVE_OUTPUT_ITEM_TYPES


def ensure_object_properties(schema: Any) -> Any:
    """Add ``properties: {}`` to every ``object`` node lacking one (the API 400s otherwise)."""
    if isinstance(schema, dict):
        normalized = {key: ensure_object_properties(value) for key, value in schema.items()}
        if normalized.get("type") == "object" and "properties" not in normalized:
            normalized["properties"] = {}
        return normalized
    if isinstance(schema, list):
        return [ensure_object_properties(item) for item in schema]
    return schema


def _enqueue_native(queue: asyncio.Queue[dict[str, Any]], raw: bytes) -> None:
    """Queue one ``data:`` line iff it is a native event. Total: bad lines are dropped."""
    if not (line := raw.strip()).startswith(b"data:"):
        return
    try:
        payload = json.loads(line[len(b"data:"):])
    except (ValueError, UnicodeDecodeError):
        return
    if is_native_event(payload):
        queue.put_nowait(payload)


class PerplexityResponsesModel(OpenAIResponsesModel):
    """OpenAIResponsesModel with argument capture and native server-side tool events."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        # One tap state per in-flight stream(); a ContextVar keeps concurrent
        # sessions sharing this model instance from seeing each other's events.
        self._invocation: ContextVar[_Invocation | None] = ContextVar("perplexity_invocation", default=None)

    @override
    def _resolve_client_args(self) -> dict[str, Any]:
        """Parent client args plus the SSE tap on whatever http client is in use."""
        args = dict(super()._resolve_client_args())
        client = args.get("http_client")
        if not isinstance(client, httpx.AsyncClient):
            client = httpx.AsyncClient(timeout=args.get("timeout", 120))
            args.pop("timeout", None)
        client.event_hooks["response"] = [*client.event_hooks.get("response", []), self._tap_sse]
        args["http_client"] = client
        return args

    async def _tap_sse(self, response: httpx.Response) -> None:
        """Observe Perplexity-only events on the raw SSE body, forwarding every byte unchanged."""
        if not response.headers.get("content-type", "").startswith("text/event-stream"):
            return
        state = self._invocation.get()
        if state is None:
            return
        original, queue = response.aiter_bytes, state.queue

        async def tapped(chunk_size: int | None = None) -> AsyncIterator[bytes]:
            buffer = b""
            async for chunk in (original() if chunk_size is None else original(chunk_size)):
                *lines, buffer = re.split(rb"\r\n|\r|\n", buffer + chunk)
                for line in lines:
                    _enqueue_native(queue, line)
                yield chunk
            if buffer:
                _enqueue_native(queue, buffer)

        response.aiter_bytes = tapped  # type: ignore[method-assign]

    def _drain(self) -> list[StreamEvent]:
        """Every native event observed since the last parent chunk."""
        state = self._invocation.get()
        if state is None:
            return []
        events: list[StreamEvent] = []
        while not state.queue.empty():
            events.append({"perplexity": state.queue.get_nowait()})  # type: ignore[typeddict-unknown-key]
        return events

    @override
    def _format_request(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        """Parent request, retargeted at the Agent API envelope."""
        request = super()._format_request(*args, **kwargs)
        request["tools"] = [
            ensure_object_properties(tool) if tool.get("type") == "function" else tool
            for tool in request.get("tools", [])
        ]
        if extra := {key: request.pop(key) for key in list(request) if key not in _OPENAI_FIELDS}:
            request["extra_body"] = {**request.get("extra_body", {}), **extra}
        return request

    @override
    async def stream(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        *,
        tool_choice: ToolChoice | None = None,
        model_state: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream conversation with the Perplexity Agent API.

        Identical to ``OpenAIResponsesModel.stream`` except tool-call arguments
        are read from ``response.output_item.added`` / ``response.output_item.done``
        (Perplexity's documented ``FunctionCallOutputItem``, where ``arguments``
        is required) in addition to the OpenAI-dialect argument delta events.
        """
        logger.debug("formatting request for Perplexity Agent API")
        request = self._format_request(messages, tool_specs, system_prompt, tool_choice, model_state)
        logger.debug("formatted request=<%s>", request)

        logger.debug("invoking Perplexity Agent API model")
        # Fresh tap state per turn: a retried model call must not replay the previous
        # attempt's native events. Set BEFORE the client is built so the hook sees it.
        token = self._invocation.set(_Invocation())
        try:
            async for chunk in self._stream_with_tap(request, model_state):
                yield chunk
        finally:
            self._invocation.reset(token)

    async def _stream_with_tap(
        self, request: dict[str, Any], model_state: dict[str, Any] | None
    ) -> AsyncGenerator[StreamEvent, None]:
        """The parent's stream loop with native events drained between chunks."""
        async with openai.AsyncOpenAI(**self._resolve_client_args()) as client:
            try:
                response = await client.responses.create(**request)

                logger.debug("streaming response from Perplexity Agent API model")

                yield self._format_chunk({"chunk_type": "message_start"})

                tool_calls: dict[str, _ToolCallInfo] = {}
                final_usage = None
                data_type: str | None = None
                stop_reason: str | None = None
                terminated = False  # a terminal event (completed/incomplete) closed the stream

                async for event in response:
                    for native in self._drain():
                        yield native
                    if hasattr(event, "type"):
                        if event.type == "response.created":
                            if hasattr(event, "response"):
                                response_id = getattr(event.response, "id", None)
                                if model_state is not None and response_id:
                                    model_state["response_id"] = response_id

                        elif event.type in (
                            "response.reasoning_text.delta",
                            "response.reasoning_summary_text.delta",
                        ):
                            chunks, data_type = self._stream_switch_content("reasoning_content", data_type)
                            for chunk in chunks:
                                yield chunk
                            if hasattr(event, "delta") and isinstance(event.delta, str):
                                yield self._format_chunk(
                                    {
                                        "chunk_type": "content_delta",
                                        "data_type": "reasoning_content",
                                        "data": event.delta,
                                    }
                                )

                        elif event.type == "response.output_text.delta":
                            chunks, data_type = self._stream_switch_content("text", data_type)
                            for chunk in chunks:
                                yield chunk
                            if hasattr(event, "delta") and isinstance(event.delta, str):
                                yield self._format_chunk(
                                    {"chunk_type": "content_delta", "data_type": "text", "data": event.delta}
                                )

                        elif event.type == "response.output_text.annotation.added":
                            if hasattr(event, "annotation"):
                                if event.annotation.get("type") == "url_citation":
                                    yield self._format_chunk(
                                        {
                                            "chunk_type": "content_delta",
                                            "data_type": "citation",
                                            "data": event.annotation,
                                        }
                                    )
                                else:
                                    logger.warning(
                                        "annotation_type=<%s> | unsupported annotation type",
                                        event.annotation.get("type"),
                                    )

                        elif event.type in ("response.output_item.added", "response.output_item.done"):
                            # Perplexity Agent API spec: OutputItemAdded/DoneEvent carry a complete
                            # FunctionCallOutputItem where `arguments` is a required JSON string.
                            if (
                                hasattr(event, "item")
                                and hasattr(event.item, "type")
                                and event.item.type == "function_call"
                            ):
                                call_id = getattr(event.item, "call_id", "unknown")
                                arguments = getattr(event.item, "arguments", None) or ""
                                existing = tool_calls.get(call_id)
                                if existing is None:
                                    tool_calls[call_id] = {
                                        "name": getattr(event.item, "name", ""),
                                        "arguments": arguments,
                                        "call_id": call_id,
                                        "item_id": getattr(event.item, "id", ""),
                                    }
                                elif arguments:
                                    # output_item.done carries the completed item: source of truth.
                                    existing["arguments"] = arguments

                        elif event.type == "response.function_call_arguments.delta":
                            # OpenAI-dialect argument streaming (not in Perplexity's spec; kept for
                            # compatibility with servers that emit it).
                            if hasattr(event, "delta") and hasattr(event, "item_id"):
                                for _call_id, call_info in tool_calls.items():
                                    if call_info["item_id"] == event.item_id:
                                        call_info["arguments"] += event.delta
                                        break

                        elif event.type == "response.function_call_arguments.done":
                            if hasattr(event, "arguments") and hasattr(event, "item_id"):
                                for _call_id, call_info in tool_calls.items():
                                    if call_info["item_id"] == event.item_id:
                                        call_info["arguments"] = event.arguments
                                        break

                        elif event.type == "response.failed":
                            error = getattr(event.response, "error", None)
                            raise _OpenAIResponsesStreamError(
                                getattr(error, "message", None), getattr(error, "code", None)
                            )

                        elif event.type == "error":
                            raise _OpenAIResponsesStreamError(
                                getattr(event, "message", None), getattr(event, "code", None)
                            )

                        elif event.type == "response.incomplete":
                            terminated = True
                            if hasattr(event, "response"):
                                if hasattr(event.response, "usage"):
                                    final_usage = event.response.usage
                                if (
                                    hasattr(event.response, "incomplete_details")
                                    and event.response.incomplete_details
                                    and getattr(event.response.incomplete_details, "reason", None)
                                    == "max_output_tokens"
                                ):
                                    stop_reason = "length"
                            break

                        elif event.type == "response.completed":
                            terminated = True
                            if hasattr(event, "response") and hasattr(event.response, "usage"):
                                final_usage = event.response.usage
                            break
                if not terminated:
                    # Observed live: the SSE body ends after deltas with no terminal event.
                    # Same class as a stall -- retry rather than commit a half-turn.
                    raise httpx.RemoteProtocolError("Perplexity Agent API stream ended without a terminal event")
            except (openai.APIError, _OpenAIResponsesStreamError, httpx.TimeoutException, httpx.RemoteProtocolError) as error:
                error_kind = classify_openai_error(error)
                # A pre-response timeout arrives as openai.APITimeoutError and a transient
                # connect failure as openai.APIConnectionError ("Connection error."); a
                # stall while iterating the SSE body arrives as a raw httpx.ReadTimeout,
                # and an upstream close mid-body as httpx.RemoteProtocolError ("peer
                # closed connection without sending complete message body"). The OpenAI
                # client does not wrap transport errors mid-stream.
                if isinstance(error, (openai.APITimeoutError, openai.APIConnectionError,
                                      httpx.TimeoutException, httpx.RemoteProtocolError)):
                    # Transient upstream behaviour, not a caller error. Surface it as
                    # throttling so the native ModelRetryStrategy re-issues the call
                    # instead of failing the turn.
                    logger.warning("Perplexity Agent API stream stalled, closed early or failed to connect; retrying via ModelRetryStrategy")
                    raise ModelThrottledException(f"Perplexity Agent API stream stalled or closed early: {error}") from error
                # The Agent API reports upstream provider saturation as a `response.failed`
                # event ("upstream model is overloaded, please try again later") with no
                # HTTP 429, so the generic classifier sees a plain error. Retry it.
                if error_kind == "throttling" or "overloaded" in str(error).lower():
                    logger.warning(_RATE_LIMIT_MSG)
                    raise ModelThrottledException(str(error)) from error
                if error_kind == "context_overflow":
                    logger.warning(_CONTEXT_WINDOW_OVERFLOW_MSG)
                    raise ContextWindowOverflowException(str(error)) from error
                if is_permanent_error(error):
                    raise
                # Any other stream-level failure (SSE `error` event -> APIError("Stream error
                # from backend"), unclassified response.failed, ...) is transient upstream
                # behaviour: retry it rather than failing the turn.
                logger.warning("Perplexity Agent API stream error treated as transient; retrying via ModelRetryStrategy: %s", error)
                raise ModelThrottledException(str(error)) from error

            for native in self._drain():
                yield native
            if data_type:
                yield self._format_chunk({"chunk_type": "content_stop", "data_type": data_type})

            # Emit tool calls with complete arguments (single full-argument delta per tool).
            for call_info in tool_calls.values():
                tool_call = SimpleNamespace(
                    function=SimpleNamespace(name=call_info["name"], arguments=call_info["arguments"]),
                    id=call_info["call_id"],
                )

                yield self._format_chunk({"chunk_type": "content_start", "data_type": "tool", "data": tool_call})
                yield self._format_chunk({"chunk_type": "content_delta", "data_type": "tool", "data": tool_call})
                yield self._format_chunk({"chunk_type": "content_stop", "data_type": "tool"})

            if tool_calls:
                finish_reason = "tool_calls"
            elif stop_reason == "length":
                finish_reason = "length"
            else:
                finish_reason = "stop"
            yield self._format_chunk({"chunk_type": "message_stop", "data": finish_reason})

            if final_usage:
                yield self._format_chunk({"chunk_type": "metadata", "data": final_usage})

        logger.debug("finished streaming response from Perplexity Agent API model")
