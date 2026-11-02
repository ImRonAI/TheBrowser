"""Mistral chat-completions model with ``reasoning_effort``.

Extends the vended ``strands.models.mistral.MistralModel`` (the SDK-documented
custom provider path: subclass and override) so the Agent Panel's per-model
effort reaches ``POST /v1/chat/completions`` and the returned thinking trace
renders as chain of thought.

Authoritative sources:

- https://docs.mistral.ai/studio/conversations/reasoning: ``reasoning_effort``
  is a top-level chat-completion field. With ``high`` the assistant content is a
  list of ``ThinkChunk`` (``type: "thinking"``, whose ``thinking`` is a list of
  ``TextChunk``) followed by ``TextChunk``; while streaming, ``delta.content`` is
  a list during the thinking phase and a plain string afterwards. Multi-turn
  callers must replay the full assistant message including ``ThinkChunk``.
- The installed ``mistralai`` 2.10.1 ``ReasoningEffort`` literal is
  ``none|minimal|low|medium|high|xhigh``; ``zai-glm-5-3`` additionally takes
  ``max`` (documented and live-verified). The SDK marshaller drops a literal it
  does not know (``UnrecognizedStr`` serializes to nothing), so ``max`` is
  re-inserted on the wire by a ``BeforeRequestHook`` instead of a request field.

The pinned ``MistralModel`` forwards only ``max_tokens``/``temperature``/``top_p``
/``stream`` and reads ``delta.content`` as a string, so a list delta would be
dropped silently. This subclass adds the request field, converts ``ThinkChunk``
deltas into ``reasoningContent`` stream events (the same shape the Gemini
adapter emits for ``part.thought``), passes the final text through unchanged,
and replays stored ``reasoningContent`` blocks as ``thinking`` chunks on the
next turn. Everything else is the vended implementation.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

import httpx
from mistralai.client import Mistral
from mistralai.client._hooks.types import BeforeRequestContext, BeforeRequestHook
from strands.agent.agent_metadata import AgentMetadata
from strands.models.mistral import MistralModel
from strands.types.content import Messages
from strands.types.exceptions import ContextWindowOverflowException, ModelThrottledException
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolChoice, ToolSpec
from typing_extensions import override

logger = logging.getLogger(__name__)

#: Effort values the pinned ``mistralai`` ``ReasoningEffort`` literal serializes itself.
SDK_REASONING_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh")


class _MistralReasoningEffortHook(BeforeRequestHook):
    """Re-insert a ``reasoning_effort`` the SDK marshaller dropped (``max``)."""

    def __init__(self, effort: str) -> None:
        self.effort = effort

    def before_request(self, hook_ctx: BeforeRequestContext, request: httpx.Request) -> httpx.Request:
        if hook_ctx.operation_id not in ("chat_completion_v1_chat_completions_post", "stream_chat"):
            if not request.url.path.endswith("/v1/chat/completions"):
                return request
        try:
            body = json.loads(request.content or b"{}")
        except ValueError:
            return request
        if body.get("reasoning_effort") == self.effort:
            return request
        body["reasoning_effort"] = self.effort
        headers = dict(request.headers)
        headers.pop("content-length", None)
        return httpx.Request(
            request.method,
            request.url,
            headers=headers,
            content=json.dumps(body, separators=(",", ":")).encode("utf-8"),
            extensions=request.extensions,
        )


def _thinking_text(chunk: Any) -> str:
    """Flatten a ``ThinkChunk`` (or its dict form) into its text."""
    inner = chunk.get("thinking", []) if isinstance(chunk, dict) else getattr(chunk, "thinking", None) or []
    parts: list[str] = []
    for item in inner:
        text = item.get("text") if isinstance(item, dict) else getattr(item, "text", None)
        if text:
            parts.append(text)
    return "".join(parts)


def _chunk_type(chunk: Any) -> str | None:
    return chunk.get("type") if isinstance(chunk, dict) else getattr(chunk, "type", None)


def _chunk_text(chunk: Any) -> str | None:
    return chunk.get("text") if isinstance(chunk, dict) else getattr(chunk, "text", None)


class RonMistralModel(MistralModel):
    """``MistralModel`` + ``reasoning_effort`` + thinking-chunk streaming."""

    def __init__(self, *args: Any, reasoning_effort: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.reasoning_effort = reasoning_effort

    def _client(self) -> Mistral:
        client = Mistral(**self.client_args)
        if self.reasoning_effort and self.reasoning_effort not in SDK_REASONING_EFFORTS:
            client.sdk_configuration.__dict__["_hooks"].register_before_request_hook(
                _MistralReasoningEffortHook(self.reasoning_effort)
            )
        return client

    @override
    def format_request(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        agent_metadata: AgentMetadata | None = None,
    ) -> dict[str, Any]:
        request = super().format_request(messages, tool_specs, system_prompt, agent_metadata)
        if self.reasoning_effort:
            # Values outside the SDK literal (``max``) are added on the wire by the hook.
            request["reasoning_effort"] = self.reasoning_effort
        self._replay_reasoning(messages, request["messages"])
        return request

    @staticmethod
    def _replay_reasoning(messages: Messages, formatted: list[dict[str, Any]]) -> None:
        """Replay stored ``reasoningContent`` as ``thinking`` chunks on assistant messages.

        The vended formatter skips ``reasoningContent`` blocks. Mistral asks callers
        to replay the full assistant message (thinking included) across turns.
        """
        assistant_formatted = [m for m in formatted if m.get("role") == "assistant"]
        assistant_source = [m for m in messages if m["role"] == "assistant"]
        if len(assistant_formatted) != len(assistant_source):
            return
        for source, target in zip(assistant_source, assistant_formatted):
            thoughts: list[str] = []
            for block in source["content"]:
                reasoning = block.get("reasoningContent") if "reasoningContent" in block else None
                text = ((reasoning or {}).get("reasoningText") or {}).get("text") if reasoning else None
                if text:
                    thoughts.append(text)
            if not thoughts:
                continue
            content = target.get("content")
            text_chunks: list[dict[str, Any]]
            if isinstance(content, str):
                text_chunks = [{"type": "text", "text": content}] if content else []
            else:
                text_chunks = list(content or [])
            target["content"] = [
                {"type": "thinking", "thinking": [{"type": "text", "text": "".join(thoughts)}]},
                *text_chunks,
            ]

    @override
    async def stream(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        *,
        tool_choice: ToolChoice | None = None,
        agent_metadata: AgentMetadata | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[StreamEvent, None]:
        if not self.config.get("stream", True):
            async for event in super().stream(
                messages, tool_specs, system_prompt, tool_choice=tool_choice, agent_metadata=agent_metadata, **kwargs
            ):
                yield event
            return

        request = self.format_request(messages, tool_specs, system_prompt, agent_metadata)
        logger.debug("request=<%s>", request)

        try:
            async with self._client() as client:
                stream_response = await client.chat.stream_async(**request)

                yield self.format_chunk({"chunk_type": "message_start"})

                # None | "text" | "reasoning"
                open_block: str | None = None
                tool_calls: dict[str, list[Any]] = {}

                def start(kind: str) -> list[StreamEvent]:
                    nonlocal open_block
                    out: list[StreamEvent] = []
                    if open_block == kind:
                        return out
                    if open_block is not None:
                        out.append(self.format_chunk({"chunk_type": "content_stop", "data_type": "text"}))
                    out.append(self.format_chunk({"chunk_type": "content_start", "data_type": "text"}))
                    open_block = kind
                    return out

                async for chunk in stream_response:
                    data = getattr(chunk, "data", None)
                    if data is None or not getattr(data, "choices", None):
                        continue
                    choice = data.choices[0]
                    delta = getattr(choice, "delta", None)

                    if delta is not None:
                        content = getattr(delta, "content", None)
                        if isinstance(content, str) and content:
                            for ev in start("text"):
                                yield ev
                            yield self.format_chunk({"chunk_type": "content_delta", "data_type": "text", "data": content})
                        elif isinstance(content, list):
                            for piece in content:
                                kind = _chunk_type(piece)
                                if kind == "thinking":
                                    text = _thinking_text(piece)
                                    if not text:
                                        continue
                                    for ev in start("reasoning"):
                                        yield ev
                                    yield {"contentBlockDelta": {"delta": {"reasoningContent": {"text": text}}}}
                                elif kind == "text":
                                    text = _chunk_text(piece)
                                    if not text:
                                        continue
                                    for ev in start("text"):
                                        yield ev
                                    yield self.format_chunk(
                                        {"chunk_type": "content_delta", "data_type": "text", "data": text}
                                    )

                        if getattr(delta, "tool_calls", None):
                            for tool_call in delta.tool_calls:
                                tool_calls.setdefault(tool_call.id, []).append(tool_call)

                    finish_reason = getattr(choice, "finish_reason", None)
                    if finish_reason:
                        if open_block is not None:
                            yield self.format_chunk({"chunk_type": "content_stop", "data_type": "text"})
                            open_block = None

                        for tool_deltas in tool_calls.values():
                            yield self.format_chunk(
                                {"chunk_type": "content_start", "data_type": "tool", "data": tool_deltas[0]}
                            )
                            for tool_delta in tool_deltas:
                                if hasattr(tool_delta.function, "arguments"):
                                    yield self.format_chunk(
                                        {
                                            "chunk_type": "content_delta",
                                            "data_type": "tool",
                                            "data": tool_delta.function.arguments,
                                        }
                                    )
                            yield self.format_chunk({"chunk_type": "content_stop", "data_type": "tool"})

                        yield self.format_chunk({"chunk_type": "message_stop", "data": finish_reason})

                        if getattr(data, "usage", None):
                            yield self.format_chunk({"chunk_type": "metadata", "data": data.usage})

        except Exception as e:
            if any(message in str(e).lower() for message in self.OVERFLOW_MESSAGES):
                raise ContextWindowOverflowException(str(e)) from e
            if "rate" in str(e).lower() or "429" in str(e):
                raise ModelThrottledException(str(e)) from e
            raise

        logger.debug("finished streaming response from model")
