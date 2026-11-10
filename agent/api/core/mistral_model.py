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
next turn.

The streaming loop is Ron's, not the vended one, because the vended loop (and
the first version of this override) grouped tool-call fragments by
``ToolCall.id``. On the documented wire (chat-completions OpenAPI: ``ToolCall.id``
is *optional*, default ``"null"``; ``ToolCall.index`` identifies the call a
fragment belongs to; ``FunctionCall.arguments`` is a string **or** an object)
only the first fragment of a call carries ``id``/``name``; the argument
fragments repeat ``index`` and omit ``id``, which the installed SDK fills with
the literal ``"null"``. Grouping by id therefore produced one named call with
``{}`` arguments plus a phantom ``"null"`` call holding the real arguments
(reproduced in ``agent/tests/test_mistral_tool_stream.py``). ``_ToolCallAssembler``
correlates by ``index``, keeps the validated identity, concatenates string
fragments, serializes object arguments, and refuses ambiguous associations;
``_terminate`` only emits executable calls for ``finish_reason == "tool_calls"``
(or ``stop`` with complete calls) — ``error``, ``length`` and an EOF without a
finish reason never dispatch a tool.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator, Mapping, Sequence
from typing import Any, TypeVar, cast

import httpx
from mistralai.client import Mistral
from mistralai.client._hooks.types import BeforeRequestContext, BeforeRequestHook
from mistralai.client.errors import MistralError
from pydantic import BaseModel
from strands.agent.agent_metadata import AgentMetadata
from strands.models.mistral import MistralModel
from strands.types.content import Messages
from strands.types.exceptions import ContextWindowOverflowException, ModelThrottledException
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolChoice, ToolResult, ToolSpec
from typing_extensions import override

from agent.api.core.media_capabilities import cached_tool_result_images, has_tool_result_images, load_capability

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

#: Effort values the pinned ``mistralai`` ``ReasoningEffort`` literal serializes itself.
SDK_REASONING_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh")

#: The installed SDK's default for an omitted ``ToolCall.id`` (``mistralai/client/models/toolcall.py``).
SDK_MISSING_TOOL_CALL_ID = "null"

#: HTTP statuses the SDK reports that mean "slow down", not "your request is wrong".
THROTTLE_STATUS_CODES = frozenset({429, 503})


class MistralStreamError(RuntimeError):
    """The provider stream cannot be turned into an executable assistant message.

    Raised instead of dispatching a tool for: ``finish_reason == "error"``; an EOF without a
    finish reason while a tool call is buffered; tool-call fragments that cannot be attributed
    to one call (no identity, two identities on one index); argument JSON that does not parse
    or is not an object. This is a transport/argument-assembly failure of the model turn —
    never a defect of the tool that was about to be called — so it surfaces as the run's
    error and the native tool executor (and the repair trigger behind it) never sees it.
    """


class _ToolCallAssembler:
    """Correlate streamed ``ToolCall`` fragments by ``index`` into complete calls.

    One entry per stream index, in first-seen order. A fragment contributes identity
    (``id``/``name``) only when it actually carries one: an ``id`` the SDK defaulted to
    ``"null"`` (``"id" not in model_fields_set``) or an empty ``name`` is a continuation.
    String arguments are concatenated; an object argument is serialized once and may not be
    mixed with string fragments on the same call.
    """

    def __init__(self) -> None:
        self._calls: dict[int, dict[str, Any]] = {}

    @property
    def active(self) -> bool:
        return bool(self._calls)

    def add(self, fragment: Any) -> None:
        fields_set = set(getattr(fragment, "model_fields_set", None) or ())
        raw_index = getattr(fragment, "index", None)
        # ``index`` is 0 by SDK default; treat an omitted index as 0 explicitly (the single-fragment
        # non-streaming shape) rather than as "unknown".
        index = int(raw_index) if isinstance(raw_index, int) else 0
        raw_id = getattr(fragment, "id", None)
        tool_id = raw_id if ("id" in fields_set and isinstance(raw_id, str) and raw_id and raw_id != SDK_MISSING_TOOL_CALL_ID) else None
        function = getattr(fragment, "function", None)
        name = getattr(function, "name", None) or None
        arguments = getattr(function, "arguments", None)

        call = self._calls.get(index)
        if call is None:
            empty: dict[str, Any] = {"id": None, "name": None, "text": None, "object": None}
            call = self._calls[index] = empty
        if tool_id is not None:
            if call["id"] is not None and call["id"] != tool_id:
                raise MistralStreamError(
                    f"tool call index {index} carries two ids ({call['id']!r}, {tool_id!r}); "
                    "the stream cannot be attributed to one call"
                )
            call["id"] = tool_id
        if name:
            if call["name"] is not None and call["name"] != name:
                raise MistralStreamError(
                    f"tool call index {index} carries two names ({call['name']!r}, {name!r}); "
                    "the stream cannot be attributed to one call"
                )
            call["name"] = name
        if isinstance(arguments, dict):
            if call["text"] or call["object"] is not None:
                raise MistralStreamError(f"tool call index {index} mixes object and string arguments")
            call["object"] = arguments
        elif isinstance(arguments, str) and arguments:
            if call["object"] is not None:
                raise MistralStreamError(f"tool call index {index} mixes object and string arguments")
            call["text"] = (call["text"] or "") + arguments

    def complete(self) -> list[tuple[str, str, str]]:
        """``(id, name, arguments_json)`` per call, validated. Raises ``MistralStreamError``."""
        out: list[tuple[str, str, str]] = []
        for index, call in self._calls.items():
            if not call["id"] or not call["name"]:
                raise MistralStreamError(
                    f"tool call index {index} never received a tool id and name; "
                    f"arguments={_preview(call['text'] if call['text'] is not None else call['object'])}"
                )
            if call["object"] is not None:
                arguments = json.dumps(call["object"], ensure_ascii=False)
            else:
                text = (call["text"] or "").strip()
                if not text:
                    arguments = "{}"
                else:
                    try:
                        parsed = json.loads(text)
                    except ValueError as exc:
                        raise MistralStreamError(
                            f"tool call {call['name']} ({call['id']}) has incomplete or invalid argument JSON: "
                            f"{_preview(text)}"
                        ) from exc
                    if not isinstance(parsed, dict):
                        raise MistralStreamError(
                            f"tool call {call['name']} ({call['id']}) arguments are not a JSON object: {_preview(text)}"
                        )
                    arguments = text
            out.append((call["id"], call["name"], arguments))
        return out


def _preview(value: Any, limit: int = 160) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + "…"


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


def _chunk_signature(chunk: Any) -> str | None:
    """A ``ThinkChunk.signature`` ("Signature to replay some reasoning blocks across turns")."""
    value = chunk.get("signature") if isinstance(chunk, dict) else getattr(chunk, "signature", None)
    return value if isinstance(value, str) and value else None


def _reasoning_aware_content(blocks: Sequence[Mapping[str, Any]], vended: Any) -> list[dict[str, Any]] | None:
    """Rebuild an assistant message's ``content`` with ``ThinkChunk``s in their original order.

    Returns ``None`` when the message holds no reasoning (the vended rendering stands).
    Text blocks are rendered from the native blocks in order; image chunks the vended
    formatter produced are appended after their surrounding text when present.
    """
    if not any("reasoningContent" in b for b in blocks):
        return None
    vended_chunks: list[dict[str, Any]] = []
    if isinstance(vended, list):
        vended_chunks = [c for c in vended if isinstance(c, dict) and c.get("type") != "text"]
    content: list[dict[str, Any]] = []
    for block in blocks:
        if "reasoningContent" in block:
            reasoning = block["reasoningContent"] or {}
            reasoning_text = reasoning.get("reasoningText") or {}
            text = reasoning_text.get("text")
            if not text:
                continue  # redactedContent / empty: nothing Mistral can replay
            think: dict[str, Any] = {"type": "thinking", "thinking": [{"type": "text", "text": text}]}
            signature = reasoning_text.get("signature")
            if signature:
                think["signature"] = signature
            content.append(think)
        elif "text" in block and block["text"]:
            content.append({"type": "text", "text": block["text"]})
    content.extend(vended_chunks)
    return content


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

    @override
    def _format_request_tool_message(self, tool_result: ToolResult) -> dict[str, Any]:
        """Vended tool message plus the result's images as ``image_url`` chunks, for vision models.

        The vended formatter keeps only text/json. ``ToolMessage.content`` is ``str | List[ContentChunk]``
        (``mistralai/client/models/toolmessage.py``) and a vision model reads an image chunk in a ``tool``
        message; a model without ``capabilities.vision`` answers ``400 Image input is not enabled for this
        model``, so its tool-result images stay dropped (``media_capabilities``).
        """
        message = super()._format_request_tool_message(tool_result)
        images = [self._format_request_message_content(item) for item in tool_result["content"] if "image" in item]
        if not images:
            return message
        if not cached_tool_result_images("mistral", self.config["model_id"]):
            logger.debug("model=<%s>, images=<%d> | model reads no images: tool-result images dropped",
                         self.config["model_id"], len(images))
            return message
        text = message["content"]
        message["content"] = [*([{"type": "text", "text": text}] if text else []), *images]
        return message

    async def _load_media_capability(self, messages: Messages) -> None:
        if has_tool_result_images(messages):
            await load_capability("mistral", self.config["model_id"])

    @staticmethod
    def _replay_reasoning(messages: Messages, formatted: list[dict[str, Any]]) -> None:
        """Replay stored ``reasoningContent`` as ``thinking`` chunks on assistant messages.

        The vended formatter skips ``reasoningContent`` blocks. Mistral asks callers to replay
        the full assistant message (thinking included) across turns. The native message is
        walked in order so thinking/text interleaving and each block's ``signature`` are kept;
        a reasoning-only assistant message (which the vended formatter drops entirely) is
        re-inserted at its position as a thinking-only assistant message. Images in the same
        assistant message are passed through from the vended rendering. ``redactedContent``
        has no Mistral representation and is skipped.
        """
        # Re-derive the vended formatter's source -> target mapping instead of counting roles:
        # each source message yields one role message iff it has text/image/toolUse, then one
        # ``tool`` message per toolResult.
        cursor = 0
        for source in messages:
            blocks = list(source["content"])
            yields_role_message = any(("text" in b or "image" in b or "toolUse" in b) for b in blocks)
            tool_results = sum(1 for b in blocks if "toolResult" in b)
            target: dict[str, Any] | None = None
            if yields_role_message:
                if cursor >= len(formatted) or formatted[cursor].get("role") != source["role"]:
                    return  # unexpected shape: leave the vended request untouched
                target = formatted[cursor]
                cursor += 1
            insert_at = cursor
            cursor += tool_results
            if source["role"] != "assistant":
                continue
            rendered = _reasoning_aware_content(blocks, target.get("content") if target else None)
            if rendered is None:
                continue
            if target is not None:
                target["content"] = rendered
            else:
                formatted.insert(insert_at, {"role": "assistant", "content": rendered})
                cursor += 1

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
        await self._load_media_capability(messages)
        request = self.format_request(messages, tool_specs, system_prompt, agent_metadata)
        self._apply_tool_choice(request, tool_choice)
        logger.debug("request=<%s>", request)

        if not self.config.get("stream", True):
            # Same client (so the ``max`` hook applies), same content/tool-call handling as streaming.
            try:
                async with self._client() as client:
                    response = await client.chat.complete_async(**request)
            except Exception as e:
                classified = self._classify(e)
                if classified is e:
                    raise
                raise classified from e
            for event in self._complete_events(response):
                yield event
            return

        try:
            async with self._client() as client:
                stream_response = await client.chat.stream_async(**request)

                yield self.format_chunk({"chunk_type": "message_start"})

                # None | "text" | "reasoning"
                open_block: str | None = None
                assembler = _ToolCallAssembler()
                finished = False
                usage: Any = None

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
                    if getattr(data, "usage", None):
                        usage = data.usage
                    if finished:
                        # Trailing chunks after the terminal one carry usage only; nothing else is executable.
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
                                    signature = _chunk_signature(piece)
                                    if not text and not signature:
                                        continue
                                    for ev in start("reasoning"):
                                        yield ev
                                    if text:
                                        yield {"contentBlockDelta": {"delta": {"reasoningContent": {"text": text}}}}
                                    if signature:
                                        # Native reasoning signature: the loop stores it on this block only.
                                        yield {"contentBlockDelta": {"delta": {"reasoningContent": {"signature": signature}}}}
                                elif kind == "text":
                                    text = _chunk_text(piece)
                                    if not text:
                                        continue
                                    for ev in start("text"):
                                        yield ev
                                    yield self.format_chunk(
                                        {"chunk_type": "content_delta", "data_type": "text", "data": text}
                                    )

                        fragments = getattr(delta, "tool_calls", None)
                        if isinstance(fragments, list):
                            for fragment in fragments:
                                assembler.add(fragment)

                    finish_reason = getattr(choice, "finish_reason", None)
                    if finish_reason:
                        finished = True
                        if open_block is not None:
                            yield self.format_chunk({"chunk_type": "content_stop", "data_type": "text"})
                            open_block = None
                        for event in self._terminate(str(finish_reason), assembler):
                            yield event

                if not finished:
                    if assembler.active:
                        raise MistralStreamError(
                            "the provider closed the stream before a finish_reason while a tool call was buffered; "
                            "the call is incomplete and was not executed"
                        )
                    if open_block is not None:
                        yield self.format_chunk({"chunk_type": "content_stop", "data_type": "text"})
                    # Text-only EOF without a finish reason: the native loop defaults to end_turn.
                    yield self.format_chunk({"chunk_type": "message_stop", "data": "stop"})

                if usage is not None:
                    yield self.format_chunk({"chunk_type": "metadata", "data": usage})

        except MistralStreamError:
            raise
        except Exception as e:
            classified = self._classify(e)
            if classified is e:
                raise
            raise classified from e

        logger.debug("finished streaming response from model")

    @override
    async def structured_output(
        self, output_model: type[T], prompt: Messages, system_prompt: str | None = None, **kwargs: Any
    ) -> AsyncGenerator[dict[str, T | Any], None]:
        """Vended ``structured_output`` over Ron's client and tool-call validation.

        The inherited implementation builds its own ``Mistral`` client (so the ``max`` effort
        hook never applies) and trusts the first tool call's arguments. This keeps its request
        shape (``tool_choice="any"``, ``parallel_tool_calls=False``) and goes through
        ``_client`` / ``_ToolCallAssembler`` instead.
        """
        tool_spec: ToolSpec = {
            "name": f"extract_{output_model.__name__.lower()}",
            "description": f"Extract structured data in the format of {output_model.__name__}",
            "inputSchema": {"json": output_model.model_json_schema()},
        }
        await self._load_media_capability(prompt)
        request = self.format_request(messages=prompt, tool_specs=[tool_spec], system_prompt=system_prompt)
        request["tool_choice"] = "any"
        request["parallel_tool_calls"] = False
        request.pop("stream", None)
        try:
            async with self._client() as client:
                response = await client.chat.complete_async(**request)
        except Exception as e:
            classified = self._classify(e)
            if classified is e:
                raise
            raise classified from e
        choices = getattr(response, "choices", None) or []
        message = getattr(choices[0], "message", None) if choices else None
        assembler = _ToolCallAssembler()
        for fragment in getattr(message, "tool_calls", None) or []:
            assembler.add(fragment)
        try:
            calls = assembler.complete()
        except MistralStreamError as e:
            raise ValueError(f"Failed to parse tool call arguments into model: {e}") from e
        if not calls:
            raise ValueError("No tool calls found in response")
        try:
            yield {"output": output_model(**json.loads(calls[0][2]))}
        except (TypeError, ValueError) as e:
            raise ValueError(f"Failed to parse tool call arguments into model: {e}") from e

    def _complete_events(self, response: Any) -> list[StreamEvent]:
        """Stream-shaped events for a non-streaming ``ChatCompletionResponse``.

        Handles the documented chunk-list content (``ThinkChunk``/``TextChunk``) the vended
        ``_handle_non_streaming_response`` would pass to ``format_chunk`` as one text delta, and
        runs tool calls through the same validation as the streaming path.
        """
        events: list[StreamEvent] = [self.format_chunk({"chunk_type": "message_start"})]
        choices = getattr(response, "choices", None) or []
        if not choices:
            raise MistralStreamError("the provider returned no choices")
        choice = choices[0]
        message = getattr(choice, "message", None)
        content = getattr(message, "content", None)
        if isinstance(content, str) and content:
            events.append(self.format_chunk({"chunk_type": "content_start", "data_type": "text"}))
            events.append(self.format_chunk({"chunk_type": "content_delta", "data_type": "text", "data": content}))
            events.append(self.format_chunk({"chunk_type": "content_stop", "data_type": "text"}))
        elif isinstance(content, list):
            # One block per chunk, in order, so thinking/text interleaving and signatures survive.
            for piece in content:
                kind = _chunk_type(piece)
                if kind == "thinking":
                    text = _thinking_text(piece)
                    signature = _chunk_signature(piece)
                    if not text and not signature:
                        continue
                    events.append(self.format_chunk({"chunk_type": "content_start", "data_type": "text"}))
                    if text:
                        events.append({"contentBlockDelta": {"delta": {"reasoningContent": {"text": text}}}})
                    if signature:
                        events.append({"contentBlockDelta": {"delta": {"reasoningContent": {"signature": signature}}}})
                    events.append(self.format_chunk({"chunk_type": "content_stop", "data_type": "text"}))
                elif kind == "text":
                    text = _chunk_text(piece)
                    if not text:
                        continue
                    events.append(self.format_chunk({"chunk_type": "content_start", "data_type": "text"}))
                    events.append(self.format_chunk({"chunk_type": "content_delta", "data_type": "text", "data": text}))
                    events.append(self.format_chunk({"chunk_type": "content_stop", "data_type": "text"}))
        assembler = _ToolCallAssembler()
        for fragment in getattr(message, "tool_calls", None) or []:
            assembler.add(fragment)
        events.extend(self._terminate(str(getattr(choice, "finish_reason", None) or "stop"), assembler))
        usage = getattr(response, "usage", None)
        if usage is not None:
            events.append(self.format_chunk({"chunk_type": "metadata", "data": usage}))
        return events

    def _terminate(self, finish_reason: str, assembler: _ToolCallAssembler) -> list[StreamEvent]:
        """Events for the terminal chunk. Tool calls are emitted only when executable."""
        if finish_reason == "error":
            raise MistralStreamError("the provider reported finish_reason=error for this turn; nothing was executed")
        if finish_reason == "length":
            # Truncation. A partially streamed call is not executable; the native loop turns
            # ``max_tokens`` into MaxTokensReachedException and never dispatches a tool.
            return [self.format_chunk({"chunk_type": "message_stop", "data": "length"})]
        events: list[StreamEvent] = []
        if assembler.active:
            if finish_reason not in ("tool_calls", "stop"):
                raise MistralStreamError(
                    f"the provider ended the turn with finish_reason={finish_reason!r} while a tool call was buffered"
                )
            for tool_id, name, arguments in assembler.complete():
                events.append({"contentBlockStart": {"start": {"toolUse": {"name": name, "toolUseId": tool_id}}}})
                events.append({"contentBlockDelta": {"delta": {"toolUse": {"input": arguments}}}})
                events.append(self.format_chunk({"chunk_type": "content_stop", "data_type": "tool"}))
            events.append(self.format_chunk({"chunk_type": "message_stop", "data": "tool_calls"}))
            return events
        events.append(self.format_chunk({"chunk_type": "message_stop", "data": finish_reason}))
        return events

    @staticmethod
    def _apply_tool_choice(request: dict[str, Any], tool_choice: ToolChoice | None) -> None:
        """Translate the native ``ToolChoice`` onto the documented ``tool_choice`` field.

        ``auto`` -> ``"auto"``, ``any`` -> ``"any"``, ``tool`` -> ``{"type": "function",
        "function": {"name": ...}}`` (https://docs.mistral.ai/api/endpoint/chat). Anything else is
        rejected rather than silently weakened to the provider default.
        """
        if tool_choice is None:
            return
        if "auto" in tool_choice:
            request["tool_choice"] = "auto"
        elif "any" in tool_choice:
            request["tool_choice"] = "any"
        elif "tool" in tool_choice:
            name = cast(dict[str, Any], tool_choice)["tool"].get("name")
            if not name:
                raise ValueError("tool_choice.tool requires a name")
            request["tool_choice"] = {"type": "function", "function": {"name": name}}
        else:
            raise ValueError(f"unsupported tool_choice {tool_choice!r}")

    def _classify(self, error: Exception) -> Exception:
        """Map an SDK/transport error onto the native exception the event loop understands.

        The SDK exposes ``status_code`` on every HTTP error (``MistralError``); throttling is
        decided from it, not from the words ``rate``/``429`` in a message.
        """
        text = str(error).lower()
        if isinstance(error, MistralError):
            if error.status_code in THROTTLE_STATUS_CODES:
                return ModelThrottledException(str(error))
            body = (error.body or "").lower()
            if any(message in body or message in text for message in self.OVERFLOW_MESSAGES):
                return ContextWindowOverflowException(str(error))
            return error
        if any(message in text for message in self.OVERFLOW_MESSAGES):
            return ContextWindowOverflowException(str(error))
        return error
