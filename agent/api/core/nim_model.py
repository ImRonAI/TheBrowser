"""NVIDIA NIM OpenAI-compatible Chat Completions model provider.

Extends the vended ``strands.models.openai.OpenAIModel`` (subclass and override, matching
``RonGeminiModel``, ``RonMistralModel``, ``RonXAIModel``, and ``PerplexityResponsesModel``)
to enforce OpenAI Chat Completions and NVIDIA NIM wire invariants:

1. **Tool-result images gated on ``media_capabilities``**:
   The vended ``OpenAIModel`` unconditionally extracts every ``image`` block from ``toolResult``
   into a synthetic ``role: "user"`` ``image_url`` message (``strands/models/openai.py:259-339``).
   NIM's ``/v1/models`` exposes no input modalities (``media_capabilities.py`` marks ``nim``
   ``tool_result_images=False``), and sending screenshot PNGs to non-vision NIM endpoints fails
   with ``HTTP 422 input rejected by content safety screening``. As in ``RonMistralModel``,
   ``RonGeminiModel``, and ``RonXAIModel``, ``toolResult`` images are dropped unless
   ``cached_tool_result_images("nim", model_id)`` is true; standard ``image_url`` parts also omit
   the vended formatter's non-OpenAI ``"format"`` key.
2. **``role: "tool"`` precedes injected ``role: "user"`` content**:
   During a tool loop, Strands injection middleware (``ContextInjector``, ``Todos``, memory
   injection) appends ``text`` blocks onto the trailing ``user`` message carrying ``toolResult``
   blocks. ``OpenAIModel._format_regular_messages`` (``openai.py:439-456``) emits the ``user``
   message before the ``tool`` messages (``assistant(tool_calls) -> user -> tool``), violating
   Chat Completions ordering. Tool messages are emitted immediately after ``assistant(tool_calls)``,
   followed by any user content.
3. **Omit empty ``tools`` array**:
   ``OpenAIModel.format_request`` (``openai.py:523-533``) sends ``"tools": []`` when ``tool_specs``
   is empty or ``None``. NVIDIA NIM rejects ``"tools": []`` with ``HTTP 400 Validation: tools array
   cannot be empty; omit the field entirely to disable tool use`` on tool-less calls
   (``SummarizingConversationManager``, ``GoalLoop`` judge, ``MemoryManager`` ``ModelExtractor``,
   ``structured_output``).
4. **Preserve reasoning-only ``assistant`` turns**:
   ``OpenAIModel`` skips ``reasoningContent`` blocks (``openai.py:419``) and drops ``assistant``
   messages with neither ``content`` nor ``tool_calls`` (``openai.py:482``), collapsing an
   interrupted thinking-only assistant turn into consecutive ``user -> user`` messages.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
import logging
from typing import Any

import openai
from strands.agent.agent_metadata import AgentMetadata
from strands.models._validation import _has_location_source
from strands.models.openai import OpenAIModel
from strands.types.content import ContentBlock, Messages, SystemContentBlock
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolChoice, ToolResult, ToolResultContent, ToolSpec
from typing_extensions import override

from agent.api.core.media_capabilities import cached_tool_result_images

logger = logging.getLogger(__name__)

OMITTED_TOOL_IMAGE_NOTE = "[image omitted: model does not accept tool-result images]"


class RonNIMModel(OpenAIModel):
    """``OpenAIModel`` tailored to NVIDIA NIM's strict OpenAI Chat Completions wire contract."""

    @classmethod
    @override
    def format_request_message_content(cls, content: ContentBlock, **kwargs: Any) -> dict[str, Any]:
        part = super().format_request_message_content(content, **kwargs)
        if part.get("type") == "image_url" and isinstance(part.get("image_url"), dict):
            part = {**part, "image_url": {k: v for k, v in part["image_url"].items() if k != "format"}}
        return part

    @classmethod
    def _format_nim_tool_message(
        cls,
        tool_result: ToolResult,
        *,
        model_id: str = "",
        allow_images: bool = False,
    ) -> dict[str, Any]:
        items = list(tool_result["content"])
        images = [item for item in items if "image" in item]
        if images and not allow_images:
            logger.debug(
                "model=<%s>, images=<%d> | model reads no images: tool-result images dropped",
                model_id,
                len(images),
            )
            rest: list[ToolResultContent] = [item for item in items if "image" not in item]
            if not rest:
                rest = [{"text": OMITTED_TOOL_IMAGE_NOTE}]
            return cls.format_request_tool_message({**tool_result, "content": rest})
        return cls.format_request_tool_message(tool_result)

    @classmethod
    @override
    def _format_regular_messages(cls, messages: Messages, **kwargs: Any) -> list[dict[str, Any]]:
        model_id = str(kwargs.get("model_id", ""))
        allow_tool_images = (
            bool(kwargs["allow_tool_images"])
            if "allow_tool_images" in kwargs
            else bool(cached_tool_result_images("nim", model_id))
        )
        formatted_messages: list[dict[str, Any]] = []

        for message in messages:
            contents = message["content"]
            filtered_contents: list[ContentBlock] = []
            for content in contents:
                if any(block_type in content for block_type in ("toolResult", "toolUse", "reasoningContent")):
                    continue
                if _has_location_source(content) or "cachePoint" in content:
                    continue
                filtered_contents.append(content)

            formatted_contents = [cls.format_request_message_content(content) for content in filtered_contents]
            formatted_tool_calls = [
                cls.format_request_message_tool_call(content["toolUse"])
                for content in contents
                if "toolUse" in content
            ]
            formatted_tool_messages = [
                cls._format_nim_tool_message(
                    content["toolResult"],
                    model_id=model_id,
                    allow_images=allow_tool_images,
                )
                for content in contents
                if "toolResult" in content
            ]

            if message["role"] != "assistant" and formatted_tool_messages:
                image_parts: list[dict[str, Any]] = []
                for tool_msg in formatted_tool_messages:
                    tool_msg_clean, user_msg_with_images = cls._split_tool_message_images(tool_msg)
                    formatted_messages.append(tool_msg_clean)
                    if user_msg_with_images:
                        image_parts.extend(user_msg_with_images["content"])
                trailing_content = [*image_parts, *formatted_contents]
                if trailing_content:
                    formatted_messages.append({"role": message["role"], "content": trailing_content})
                continue

            if (
                message["role"] == "assistant"
                and not formatted_contents
                and not formatted_tool_calls
                and any("reasoningContent" in content for content in contents)
            ):
                formatted_messages.append({"role": "assistant", "content": ""})
                continue

            formatted_message: dict[str, Any] = {
                "role": message["role"],
                **({"content": formatted_contents} if formatted_contents else {}),
                **({"tool_calls": formatted_tool_calls} if formatted_tool_calls else {}),
            }
            formatted_messages.append(formatted_message)

        return formatted_messages

    @classmethod
    @override
    def format_request_messages(
        cls,
        messages: Messages,
        system_prompt: str | None = None,
        *,
        system_prompt_content: list[SystemContentBlock] | None = None,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        formatted_messages = cls._format_system_messages(system_prompt, system_prompt_content=system_prompt_content)
        formatted_messages.extend(cls._format_regular_messages(messages, **kwargs))
        return [message for message in formatted_messages if "content" in message or "tool_calls" in message]

    @override
    def format_request(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        tool_choice: ToolChoice | None = None,
        *,
        system_prompt_content: list[SystemContentBlock] | None = None,
        agent_metadata: AgentMetadata | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        model_id = str(self.config.get("model_id", ""))
        request = super().format_request(
            [],
            tool_specs,
            None,
            tool_choice,
            agent_metadata=agent_metadata,
            **kwargs,
        )
        request["messages"] = self.format_request_messages(
            messages,
            system_prompt,
            system_prompt_content=system_prompt_content,
            model_id=model_id,
            allow_tool_images=bool(cached_tool_result_images("nim", model_id)),
        )
        if not request.get("tools"):
            request.pop("tools", None)
            request.pop("tool_choice", None)
        return request

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
        model_id = str(self.config.get("model_id", ""))
        try:
            async for chunk in super().stream(
                messages,
                tool_specs,
                system_prompt,
                tool_choice=tool_choice,
                agent_metadata=agent_metadata,
                **kwargs,
            ):
                yield chunk
        except openai.APITimeoutError as error:
            timeout = self.client_args.get("timeout")
            read_s = getattr(timeout, "read", None)
            bound = f" after {read_s:g}s" if isinstance(read_s, (int, float)) else ""
            raise RuntimeError(
                f"NVIDIA NIM endpoint timed out{bound} waiting for {model_id!r} "
                "(integrate.api.nvidia.com accepted the request and sent 0 bytes; "
                "upstream model container is stalled or out of capacity)."
            ) from error
        except openai.APIStatusError as error:
            headers = getattr(error.response, "headers", None) or {}
            nvcf_bits = [
                f"{key}={headers[key]}"
                for key in ("nvcf-status", "nvcf-error-source", "nvcf-reqid")
                if key in headers
            ]
            if nvcf_bits and not getattr(error, "body", None):
                raise RuntimeError(
                    f"NVIDIA NIM HTTP {error.status_code} for {model_id!r} ({', '.join(nvcf_bits)})."
                ) from error
            raise


__all__ = ["OMITTED_TOOL_IMAGE_NOTE", "RonNIMModel"]
