"""Telnyx Inference adapters on the SDK's OpenAI Responses and Chat Completions models.

Telnyx serves OpenAI-compatible endpoints under ``https://api.telnyx.com/v2/ai/openai``:
- Most default-tier models serve ``POST /responses`` (``OpenAIResponsesModel`` with ``stateful=False``,
  https://developers.telnyx.com/api-reference/openai-chat/create-an-openai-compatible-response).
- ``moonshotai/Kimi-K3.1-Pro`` (``TELNYX_CHAT_COMPLETIONS_MODELS``) serves ``POST /chat/completions`` only
  (``POST /responses`` returns ``422 {"code": "10027", "detail": "Error code: 404"}``, verified live 2026-11-14)
  and streams ``delta.reasoning``, ``delta.content``, ``delta.tool_calls``, ``structured_output``, and multimodal
  ``image_url`` blocks via ``RonTelnyxChatModel`` (subclassing ``RonNIMModel`` / ``OpenAIModel``).

NOT NATIVE, tool-result images: gated per model using Telnyx's ``is_vision_supported`` catalogue flag
(``media_capabilities``) so non-vision models receive ``OMITTED_TOOL_IMAGE_NOTE`` instead of failing on image data.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
import logging
from typing import Any

import openai
from strands.agent.agent_metadata import AgentMetadata
from strands.models.openai_responses import OpenAIResponsesModel
from strands.types.content import ContentBlock, Message, Messages, SystemContentBlock
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolChoice, ToolResultContent, ToolSpec
from typing_extensions import override

from agent.api.core.media_capabilities import cached_tool_result_images, has_tool_result_images, load_capability
from agent.api.core.nim_model import OMITTED_TOOL_IMAGE_NOTE, RonNIMModel

logger = logging.getLogger(__name__)

#: Telnyx models whose upstream deployment serves ``POST /chat/completions`` rather than ``POST /responses``.
TELNYX_CHAT_COMPLETIONS_MODELS: frozenset[str] = frozenset({
    "moonshotai/Kimi-K3.1-Pro",
})


def without_tool_result_images(messages: Messages) -> Messages:
    """A copy of ``messages`` whose tool-result images are text notes; ``messages`` itself is left as it is."""
    def block_without_images(block: ContentBlock) -> ContentBlock:
        if "toolResult" not in block:
            return block
        tool_result = block["toolResult"]
        content: list[ToolResultContent] = [
            {"text": OMITTED_TOOL_IMAGE_NOTE} if "image" in item else item for item in tool_result["content"]
        ]
        return {**block, "toolResult": {**tool_result, "content": content}}

    return [Message(role=message["role"], content=[block_without_images(block) for block in message["content"]])
            for message in messages]


class RonTelnyxChatModel(RonNIMModel):
    """``OpenAIModel`` on Telnyx ``POST /v2/ai/openai/chat/completions`` (used by ``moonshotai/Kimi-K3.1-Pro``)."""

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
        request = super(RonNIMModel, self).format_request(
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
            allow_tool_images=bool(cached_tool_result_images("telnyx", model_id)),
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
        if has_tool_result_images(messages):
            await load_capability("telnyx", model_id)
        try:
            async for chunk in super(RonNIMModel, self).stream(
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
                f"Telnyx Inference endpoint timed out{bound} waiting for {model_id!r}."
            ) from error


class RonTelnyxModel(OpenAIResponsesModel):
    """``OpenAIResponsesModel`` on Telnyx Inference; tool-result images reach vision models only."""

    @override
    async def stream(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        *,
        tool_choice: ToolChoice | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[StreamEvent, None]:
        model_id = str(self.config["model_id"])
        raw_messages = messages
        if has_tool_result_images(messages):
            capability = await load_capability("telnyx", model_id)
            if not capability.tool_result_images:
                logger.debug("model=<%s> | model reads no images: tool-result images replaced by a note", model_id)
                messages = without_tool_result_images(messages)
        emitted = False
        try:
            async for event in super().stream(messages, tool_specs, system_prompt, tool_choice=tool_choice, **kwargs):
                emitted = True
                yield event
        except openai.UnprocessableEntityError as error:
            if emitted or "404" not in str(error):
                raise
            logger.info("model=<%s> | Telnyx /responses returned 422/404; falling back to /chat/completions", model_id)
            raw_params = self.config.get("params")
            params: dict[str, Any] = dict(raw_params) if isinstance(raw_params, dict) else {}
            reasoning = params.pop("reasoning", None)
            if isinstance(reasoning, dict) and reasoning.get("effort"):
                params["reasoning_effort"] = reasoning["effort"]
            fallback = RonTelnyxChatModel(
                client_args=dict(self.client_args),
                model_id=model_id,
                params=params or None,
            )
            async for event in fallback.stream(
                raw_messages, tool_specs, system_prompt, tool_choice=tool_choice, **kwargs
            ):
                yield event


__all__ = ["RonTelnyxChatModel", "RonTelnyxModel", "TELNYX_CHAT_COMPLETIONS_MODELS", "without_tool_result_images"]
