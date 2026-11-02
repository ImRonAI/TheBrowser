"""xAI (Grok) model for the Agent Panel: bounded encrypted-state history.

Extends the installed ``strands_xai.xAIModel`` (0.6.1) so a long Grok thread stays
inside the context window instead of dying with
``[input_too_large] The prompt is too long for this model's context window``.

What the community adapter does (``strands_xai/xai.py``):

- With server-side tools or encrypted reasoning it serializes the **entire** xAI
  protobuf conversation after every assistant turn and appends it to that turn as
  ``reasoningContent.redactedContent`` (``<!--XAI_STATE:...-->``). On the next
  turn ``_extract_xai_state`` reads only the **newest** blob and replays it as the
  chat history. Every older blob is dead weight that is never read again, yet it
  stays in ``agent.messages``, is written to every snapshot, and inflates the
  SDK's cold-start ``count_tokens`` estimate. A 68-turn thread carried 68 copies
  of a growing history: 47 MB of a 47.6 MB snapshot (0.3 MB of real transcript).
- ``_handle_stream_error`` maps only ``"context length" | "maximum context" |
  "token limit"`` to ``ContextWindowOverflowException``. xAI's actual message is
  ``input_too_large ... too long for this model's context window``, so the SDK's
  reactive summarization (``SummarizingConversationManager.reduce_context``)
  never ran and the raw ``AioRpcError`` reached the panel.
- ``_CONTEXT_WINDOW_LIMITS`` has no entry for ``grok-4.7``, so the SDK fell back
  to its 200k default for the proactive-compression ratio.

This subclass:

1. **Prunes superseded state** on the agent (``MessageAddedEvent`` hook):
   whenever a new ``XAI_STATE`` blob is appended, every older blob is removed
   from ``agent.messages``. One copy of the history remains, so storage and the
   token estimate are linear in the conversation, not quadratic.
2. **Restores the newest blob only** when formatting a request: ``stream()``
   receives a view of ``messages`` with all older blobs stripped, so the request
   never carries stale state even if a snapshot predates the pruning hook.
3. **Maps ``input_too_large``/``too long for this model's context window`` to
   ``ContextWindowOverflowException``** so the SDK summarizes and retries.
4. **Fills the context-window table** for ``grok-4.7`` (500k per docs.x.ai/docs/models)
   so proactive compression (``proactive_compression=True`` on the panel agent's
   ``SummarizingConversationManager``) uses the real limit.

Nothing about the wire protocol, tool handling or encrypted-content capture is
changed; everything else is the vended implementation.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from strands.hooks import HookProvider, HookRegistry, MessageAddedEvent
from strands.types.content import ContentBlock, Message, Messages, SystemContentBlock
from strands.types.exceptions import ContextWindowOverflowException
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolChoice, ToolSpec
from strands_xai import xAIModel
from strands_xai import xai as _xai
from typing_extensions import override

logger = logging.getLogger(__name__)

#: Context windows missing from strands_xai 0.6.1's ``_CONTEXT_WINDOW_LIMITS``.
#: https://docs.x.ai/docs/models — grok-4.7 shares grok-4.6's 500k window.
EXTRA_CONTEXT_WINDOW_LIMITS: dict[str, int] = {
    "grok-4.7": 500_000,
}

#: xAI overflow phrasings the community adapter does not recognise.
OVERFLOW_PHRASES: tuple[str, ...] = (
    "input_too_large",
    "too long for this model's context window",
    "prompt is too long",
)


def _install_context_limits() -> None:
    for model_id, limit in EXTRA_CONTEXT_WINDOW_LIMITS.items():
        _xai._CONTEXT_WINDOW_LIMITS.setdefault(model_id, limit)


_install_context_limits()


def is_xai_state_block(block: ContentBlock | dict[str, Any]) -> bool:
    """True when ``block`` is the adapter's serialized ``<!--XAI_STATE:...-->`` blob."""
    reasoning = block.get("reasoningContent")
    if not isinstance(reasoning, dict) or "redactedContent" not in reasoning:
        return False
    redacted = reasoning["redactedContent"]
    if isinstance(redacted, (bytes, bytearray)):
        head = bytes(redacted[: len(_xai.XAI_STATE_MARKER)])
        return head == _xai.XAI_STATE_MARKER.encode("utf-8")
    return isinstance(redacted, str) and redacted.startswith(_xai.XAI_STATE_MARKER)


def _state_positions(messages: Messages) -> list[tuple[int, int]]:
    """``(message_index, block_index)`` of every xAI state blob, in order."""
    positions: list[tuple[int, int]] = []
    for i, message in enumerate(messages):
        for j, block in enumerate(message.get("content", [])):
            if is_xai_state_block(block):
                positions.append((i, j))
    return positions


def prune_superseded_xai_state(messages: Messages) -> int:
    """Drop every xAI state blob except the newest one, in place.

    The adapter only ever reads the latest blob (``_extract_xai_state`` searches in
    reverse and returns on the first hit), and each blob already contains the full
    protobuf history up to its turn, so older blobs carry no information.

    Returns:
        Number of blobs removed.
    """
    positions = _state_positions(messages)
    if len(positions) <= 1:
        return 0
    stale = positions[:-1]
    for i, j in reversed(stale):
        del messages[i]["content"][j]
    return len(stale)


def without_superseded_xai_state(messages: Messages) -> Messages:
    """Copy of ``messages`` with every xAI state blob except the newest removed.

    Shallow per-message copies so the caller's history is untouched.
    """
    positions = _state_positions(messages)
    if len(positions) <= 1:
        return messages
    stale = {(i, j) for i, j in positions[:-1]}
    out: Messages = []
    for i, message in enumerate(messages):
        if not any(pos[0] == i for pos in stale):
            out.append(message)
            continue
        content = [block for j, block in enumerate(message.get("content", [])) if (i, j) not in stale]
        out.append({**message, "content": content})
    return out


class XAIStatePruner(HookProvider):
    """Keep only the newest xAI encrypted-state blob in ``agent.messages``."""

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(MessageAddedEvent, self._on_message_added)

    def _on_message_added(self, event: MessageAddedEvent) -> None:
        message: Message = event.message
        if message.get("role") != "assistant":
            return
        if not any(is_xai_state_block(block) for block in message.get("content", [])):
            return
        removed = prune_superseded_xai_state(event.agent.messages)
        if removed:
            logger.debug("removed=<%d> | pruned superseded xAI state blobs", removed)


class RonXAIModel(xAIModel):
    """``xAIModel`` whose requests carry one state blob and whose overflows are recoverable."""

    @override
    async def stream(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        tool_choice: ToolChoice | None = None,
        *,
        system_prompt_content: list[SystemContentBlock] | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[StreamEvent, None]:
        trimmed = without_superseded_xai_state(messages)
        if trimmed is not messages:
            logger.debug("messages=<%d> | stripped superseded xAI state before request", len(messages))
        try:
            async for event in super().stream(
                trimmed, tool_specs, system_prompt, tool_choice,
                system_prompt_content=system_prompt_content, **kwargs,
            ):
                yield event
        except ContextWindowOverflowException:
            raise
        except Exception as error:
            text = str(error).lower()
            if any(phrase in text for phrase in OVERFLOW_PHRASES):
                logger.warning("error=<%s> | xAI context window overflow (input_too_large)", error)
                raise ContextWindowOverflowException(str(error)) from error
            raise

    @override
    async def structured_output(self, output_model: Any, prompt: Messages, system_prompt: str | None = None, **kwargs: Any) -> AsyncGenerator[dict[str, Any], None]:  # type: ignore[override]
        try:
            async for event in super().structured_output(
                output_model, without_superseded_xai_state(prompt), system_prompt, **kwargs
            ):
                yield event
        except ContextWindowOverflowException:
            raise
        except Exception as error:
            text = str(error).lower()
            if any(phrase in text for phrase in OVERFLOW_PHRASES):
                raise ContextWindowOverflowException(str(error)) from error
            raise
