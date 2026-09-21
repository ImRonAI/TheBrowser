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
"""

import logging
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Any

import httpx
import openai
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


class PerplexityResponsesModel(OpenAIResponsesModel):
    """OpenAIResponsesModel with tool-call argument capture per the Perplexity Agent API spec."""

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

        async with openai.AsyncOpenAI(**self._resolve_client_args()) as client:
            try:
                response = await client.responses.create(**request)

                logger.debug("streaming response from Perplexity Agent API model")

                yield self._format_chunk({"chunk_type": "message_start"})

                tool_calls: dict[str, _ToolCallInfo] = {}
                final_usage = None
                data_type: str | None = None
                stop_reason: str | None = None

                async for event in response:
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
                            if hasattr(event, "response") and hasattr(event.response, "usage"):
                                final_usage = event.response.usage
                            break
            except (openai.APIError, _OpenAIResponsesStreamError, httpx.TimeoutException) as error:
                error_kind = classify_openai_error(error)
                # A pre-response timeout arrives as openai.APITimeoutError; a stall
                # while iterating the SSE body arrives as a raw httpx.ReadTimeout
                # (the OpenAI client does not wrap transport errors mid-stream).
                if isinstance(error, (openai.APITimeoutError, httpx.TimeoutException)):
                    # A stalled Agent API stream (no bytes within the configured read
                    # timeout) is transient upstream behaviour, not a caller error.
                    # Surface it as throttling so the native ModelRetryStrategy
                    # re-issues the call instead of failing the turn.
                    logger.warning("Perplexity Agent API stream stalled; retrying via ModelRetryStrategy")
                    raise ModelThrottledException(f"Perplexity Agent API stream stalled: {error}") from error
                if error_kind == "throttling":
                    logger.warning(_RATE_LIMIT_MSG)
                    raise ModelThrottledException(str(error)) from error
                if error_kind == "context_overflow":
                    logger.warning(_CONTEXT_WINDOW_OVERFLOW_MSG)
                    raise ContextWindowOverflowException(str(error)) from error
                raise

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
