"""xAI (Grok) model for the Agent Panel: bounded encrypted-state history and native tool streaming.

Extends the installed ``strands_xai.xAIModel`` (0.6.1) so a long Grok thread stays
inside the context window instead of dying with
``[input_too_large] The prompt is too long for this model's context window``, and
surfaces xAI's built-in ``web_search``, ``x_search``, and image search/understanding
server-side tools as structured ``native_tool`` events instead of inline text strings.

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
- Server-side tool calls (``web_search``, ``x_search``, ``search_images``, etc.)
  were formatted as ``\n[xAI Tool: name(args)]\n`` inside the assistant text stream,
  breaking active ``reasoning`` content blocks and ignoring ``chunk.tool_outputs``
  (per-call citation URLs) and ``img-*`` image citations.

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
4. **Keeps per-call context out of the state blob.** The SDK marks the trailing blocks of the
   last user message that injection middleware (``ContextInjector``, memory injection) adds for
   one call only as ``dynamic_trailing_blocks`` (``strands/event_loop/streaming.py``). The
   vended adapter appended them to the chat and serialized that chat into the blob, so every
   model call of a tool loop stored another copy of the injected browser context (2026-11-07:
   three 360,442-character copies in one blob, 552,995 tokens > grok-4.7's 500,000). The blob
   is captured from the durable messages only; the model still sees the injected text.
5. **Drops the blob on overflow** (``XAIStatePruner``, native ``AfterModelCallEvent.retry``):
   the newest blob replays the whole xAI conversation and overrides any reduction the
   conversation manager makes to ``agent.messages``, so on ``ContextWindowOverflowException``
   it is removed and the call is retried from the durable messages, which the
   ``SummarizingConversationManager`` can then reduce.
   The model's real context window comes from xAI's own ``GET /v1/models`` ``context_length``
   (``context_windows.py``), not a table.
6. **Streams structured ``{"xai": payload}`` native tool events** for xAI
   ``web_search`` (``search_results``), ``x_search`` (``x_search_results``), and
   image search / image understanding / image generation (``image_search_results``)
   without polluting the assistant text stream.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from collections.abc import AsyncGenerator
from typing import Any, cast
from urllib.parse import unquote, urlsplit

from strands.hooks import AfterModelCallEvent, HookProvider, HookRegistry, MessageAddedEvent
from strands.types.content import ContentBlock, Message, Messages, SystemContentBlock
from strands.types.exceptions import ContextWindowOverflowException
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolChoice, ToolSpec
from strands_xai import xAIModel
from strands_xai import xai as _xai
from typing_extensions import override

from agent.api.core.media_capabilities import cached_tool_result_images, has_tool_result_images, load_capability

logger = logging.getLogger(__name__)

_BASE_XAI_STREAM = _xai.xAIModel.stream

#: xAI overflow phrasings the community adapter does not recognise.
OVERFLOW_PHRASES: tuple[str, ...] = (
    "input_too_large",
    "too long for this model's context window",
    "prompt is too long",
)

IMAGE_TOOL_FUNCTIONS: frozenset[str] = frozenset({
    "search_images",
    "view_image",
    "generate_image",
    "image_generation",
    "imagine_text_to_image",
    "imagine_image_to_image",
})

X_SEARCH_TOOL_FUNCTIONS: frozenset[str] = frozenset({
    "x_keyword_search",
    "x_semantic_search",
    "x_user_search",
    "x_thread_fetch",
    "view_x_video",
})

WEB_SEARCH_TOOL_FUNCTIONS: frozenset[str] = frozenset({
    "web_search",
    "web_search_with_snippets",
    "browse_page",
    "open_page",
    "open_page_with_find",
})

_X_STATUS_RE = re.compile(r"^https?://(?:www\.)?(?:x|twitter)\.com/([^/]+)/status/(\d+)", re.IGNORECASE)
_X_PROFILE_RE = re.compile(r"^https?://(?:www\.)?(?:x|twitter)\.com/([^/?#]+)", re.IGNORECASE)
_MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(\s*([^\s)]+)\s*\)")



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
    """Keep only the newest xAI encrypted-state blob in ``agent.messages``; drop it on overflow."""

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(MessageAddedEvent, self._on_message_added)
        registry.add_callback(AfterModelCallEvent, self._on_after_model_call)

    def _on_after_model_call(self, event: AfterModelCallEvent) -> None:
        """On overflow, retry from the durable messages: the blob would replay the full history again."""
        if event.retry or not isinstance(event.exception, ContextWindowOverflowException):
            return
        positions = _state_positions(event.agent.messages)
        for i, j in reversed(positions):
            del event.agent.messages[i]["content"][j]
        if positions:
            logger.warning("removed=<%d> | xAI state blob overflowed the context window; retrying from the "
                           "durable messages", len(positions))
            event.retry = True

    def _on_message_added(self, event: MessageAddedEvent) -> None:
        message: Message = event.message
        if message.get("role") != "assistant":
            return
        if not any(is_xai_state_block(block) for block in message.get("content", [])):
            return
        removed = prune_superseded_xai_state(event.agent.messages)
        if removed:
            logger.debug("removed=<%d> | pruned superseded xAI state blobs", removed)


def _tool_call_type(tool_call: Any) -> str:
    """Resolve xAI tool call type string from a proto or test stub."""
    raw_type = getattr(tool_call, "type", None)
    if isinstance(raw_type, str) and raw_type:
        return raw_type.removeprefix("TOOL_CALL_TYPE_").lower()
    try:
        return _xai.get_tool_call_type(tool_call)
    except Exception:
        return ""


def _tool_call_status(tool_call: Any) -> str:
    """Resolve xAI tool call status string (``in_progress``, ``completed``, ``failed``)."""
    raw_status = getattr(tool_call, "status", None)
    if isinstance(raw_status, str) and raw_status:
        return raw_status.removeprefix("TOOL_CALL_STATUS_").lower()
    if isinstance(raw_status, int):
        try:
            return _xai.xai_chat_pb2.ToolCallStatus.Name(raw_status).removeprefix("TOOL_CALL_STATUS_").lower()
        except Exception:
            return ""
    return ""


def _parse_tool_arguments(raw_args: Any) -> dict[str, Any]:
    """Parse JSON tool arguments into a dictionary."""
    if isinstance(raw_args, dict):
        return raw_args
    if isinstance(raw_args, str) and raw_args.strip():
        try:
            parsed = json.loads(raw_args)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def _x_status_id(url: str) -> str | None:
    match = _X_STATUS_RE.match(url.strip())
    return match.group(2) if match else None


def _title_from_url(url: str) -> str:
    """Derive a concise display label for a web or X URL."""
    cleaned = url.strip()
    status_match = _X_STATUS_RE.match(cleaned)
    if status_match:
        handle, status_id = status_match.group(1), status_match.group(2)
        if handle.lower() != "i":
            return f"@{handle} · {status_id}"
        return f"X post · {status_id}"
    profile_match = _X_PROFILE_RE.match(cleaned)
    if profile_match:
        handle = profile_match.group(1)
        if handle.lower() not in ("i", "search", "explore", "home", "hashtag"):
            return f"@{handle}"
    try:
        parts = urlsplit(cleaned)
        host = (parts.hostname or "").removeprefix("www.")
        path = parts.path.rstrip("/")
        if path and path != "/":
            slug = unquote(path.split("/")[-1]).strip()
            if slug and len(slug) <= 64:
                return f"{host} · {slug}" if host else slug
        return host or cleaned
    except Exception:
        return cleaned


def _classify_server_tool(tool_type: str, fn_name: str) -> str | None:
    """Classify an xAI server-side tool call into ``web_search``, ``x_search``, or ``image_search``."""
    name = (fn_name or "").strip()
    if name in IMAGE_TOOL_FUNCTIONS or tool_type == "image_generation_tool":
        return "image_search"
    if tool_type == "x_search_tool" or name in X_SEARCH_TOOL_FUNCTIONS:
        return "x_search"
    if tool_type in ("web_search_tool", "collections_search_tool", "attachment_search_tool") or name in WEB_SEARCH_TOOL_FUNCTIONS:
        return "web_search"
    return None


class _XAINativeToolTracker:
    """Accumulates xAI server-side tool calls, tool outputs, and image citations into panel ``native_tool`` events."""

    def __init__(self) -> None:
        self._call_bucket: dict[str, str] = {}

        self.web_active = False
        self.web_call_ids: set[str] = set()
        self.web_done_ids: set[str] = set()
        self.web_failed_ids: set[str] = set()
        self.web_queries: list[str] = []
        self.web_urls: list[str] = []
        self.web_results: list[dict[str, Any]] = []
        self.web_error: str | None = None

        self.x_active = False
        self.x_call_ids: set[str] = set()
        self.x_done_ids: set[str] = set()
        self.x_failed_ids: set[str] = set()
        self.x_queries: list[str] = []
        self.x_urls: list[str] = []
        self.x_results: list[dict[str, Any]] = []
        self.x_error: str | None = None

        self.image_active = False
        self.image_call_ids: set[str] = set()
        self.image_done_ids: set[str] = set()
        self.image_failed_ids: set[str] = set()
        self.image_search_requested = False
        self.image_queries: list[str] = []
        self.image_results: list[dict[str, Any]] = []
        self.image_error: str | None = None

        self._emitted_snapshots: dict[str, str] = {}

    @staticmethod
    def _append_unique(target: list[str], value: Any) -> None:
        if isinstance(value, str):
            text = value.strip()
            if text and text not in target:
                target.append(text)
        elif isinstance(value, list):
            for entry in value:
                if isinstance(entry, str) and entry.strip() and entry.strip() not in target:
                    target.append(entry.strip())

    def _add_web_result(self, url: str, title: str | None = None) -> None:
        cleaned = url.strip()
        if not cleaned:
            return
        self._append_unique(self.web_urls, cleaned)
        resolved_title = (title or "").strip() or _title_from_url(cleaned)
        for existing in self.web_results:
            if existing.get("url") == cleaned:
                if title and title.strip():
                    existing["title"] = title.strip()
                return
        self.web_results.append({"url": cleaned, "title": resolved_title, "source": "web"})

    def _add_x_result(self, url: str, title: str | None = None) -> None:
        cleaned = url.strip()
        if not cleaned:
            return
        status_id = _x_status_id(cleaned)
        resolved_title = (title or "").strip() or _title_from_url(cleaned)
        for existing in self.x_results:
            existing_url = str(existing.get("url") or "")
            if existing_url == cleaned or (status_id and _x_status_id(existing_url) == status_id):
                # Prefer author-qualified URL (e.g. /elonmusk/status/123) over /i/status/123.
                if "/i/status/" in existing_url and "/i/status/" not in cleaned:
                    existing["url"] = cleaned
                    existing["title"] = resolved_title
                    if cleaned not in self.x_urls:
                        try:
                            idx = self.x_urls.index(existing_url)
                            self.x_urls[idx] = cleaned
                        except ValueError:
                            self.x_urls.append(cleaned)
                elif title and title.strip():
                    existing["title"] = title.strip()
                return
        self._append_unique(self.x_urls, cleaned)
        self.x_results.append({"url": cleaned, "title": resolved_title, "source": "x"})

    def _add_image_result(self, image_url: str, *, origin_url: str | None = None, title: str | None = None) -> None:
        cleaned = image_url.strip()
        if not cleaned:
            return
        self.image_active = True
        resolved_origin = (origin_url or "").strip() or (cleaned if cleaned.startswith(("http://", "https://")) else None)
        resolved_title = (title or "").strip() or (_title_from_url(cleaned) if cleaned.startswith(("http://", "https://")) else "Image result")
        for existing in self.image_results:
            if existing.get("image_url") == cleaned:
                if title and title.strip() and existing.get("title") in (None, "", _title_from_url(cleaned), "Image result"):
                    existing["title"] = title.strip()
                if resolved_origin and not existing.get("origin_url"):
                    existing["origin_url"] = resolved_origin
                return
        row: dict[str, Any] = {"image_url": cleaned, "title": resolved_title}
        if resolved_origin:
            row["origin_url"] = resolved_origin
        self.image_results.append(row)

    def record_server_tool_call(self, tool_call: Any, tool_type: str) -> None:
        fn = getattr(tool_call, "function", None)
        fn_name = str(getattr(fn, "name", "") or "")
        raw_args = getattr(fn, "arguments", "")
        call_id = str(getattr(tool_call, "id", "") or "")
        bucket = _classify_server_tool(tool_type, fn_name)
        if not bucket:
            return
        if call_id:
            self._call_bucket[call_id] = bucket
        args = _parse_tool_arguments(raw_args)

        if bucket == "web_search":
            self.web_active = True
            if call_id:
                self.web_call_ids.add(call_id)
            self._append_unique(self.web_queries, args.get("query") or args.get("search_query") or args.get("q"))
            self._append_unique(self.web_queries, args.get("queries"))
            url_arg = args.get("url") or args.get("page_url")
            self._append_unique(self.web_urls, url_arg)
            self._append_unique(self.web_urls, args.get("urls"))
            if isinstance(url_arg, str) and url_arg.strip():
                self._add_web_result(url_arg.strip())

        elif bucket == "x_search":
            self.x_active = True
            if call_id:
                self.x_call_ids.add(call_id)
            self._append_unique(self.x_queries, args.get("query") or args.get("search_query") or args.get("q"))
            self._append_unique(self.x_queries, args.get("queries"))
            for handle_key in ("username", "handle", "user"):
                handle_val = args.get(handle_key)
                if isinstance(handle_val, str) and handle_val.strip():
                    h = handle_val.strip().lstrip("@")
                    self._append_unique(self.x_queries, f"@{h}")
            self._append_unique(self.x_queries, [f"@{h.lstrip('@')}" for h in (args.get("allowed_x_handles") or []) if isinstance(h, str) and h.strip()])
            post_id = args.get("post_id") or args.get("tweet_id")
            if isinstance(post_id, (str, int)) and str(post_id).strip():
                pid = str(post_id).strip()
                self._append_unique(self.x_queries, f"post:{pid}")
                self._add_x_result(f"https://x.com/i/status/{pid}")
            for url_key in ("url", "video_url", "post_url"):
                u_val = args.get(url_key)
                if isinstance(u_val, str) and u_val.strip():
                    self._add_x_result(u_val.strip())

        elif bucket == "image_search":
            self.image_active = True
            if call_id:
                self.image_call_ids.add(call_id)
            if fn_name == "search_images":
                self.image_search_requested = True
            self._append_unique(
                self.image_queries,
                args.get("image_description") or args.get("query") or args.get("prompt") or args.get("description"),
            )
            self._append_unique(self.image_queries, args.get("queries"))
            for img_key in ("image_url", "url"):
                img_val = args.get(img_key)
                if isinstance(img_val, str) and img_val.strip():
                    self._add_image_result(
                        img_val.strip(),
                        origin_url=args.get("origin_url") if isinstance(args.get("origin_url"), str) else None,
                        title=args.get("title") if isinstance(args.get("title"), str) else None,
                    )

    def record_tool_output(self, tool_output: Any) -> None:
        """Process a ``ROLE_TOOL`` chunk from ``chunk.tool_outputs``."""
        output_calls = getattr(tool_output, "tool_calls", None) or []
        buckets_in_chunk: list[str] = []
        for tc in output_calls:
            tc_id = str(getattr(tc, "id", "") or "")
            tc_type = _tool_call_type(tc)
            fn = getattr(tc, "function", None)
            fn_name = str(getattr(fn, "name", "") or "")
            bucket = self._call_bucket.get(tc_id) or _classify_server_tool(tc_type, fn_name)
            if not bucket:
                continue
            self.record_server_tool_call(tc, tc_type)
            buckets_in_chunk.append(bucket)
            status = _tool_call_status(tc)
            err = str(getattr(tc, "error_message", "") or "").strip()
            if status == "completed":
                if bucket == "web_search" and tc_id:
                    self.web_done_ids.add(tc_id)
                elif bucket == "x_search" and tc_id:
                    self.x_done_ids.add(tc_id)
                elif bucket == "image_search" and tc_id:
                    self.image_done_ids.add(tc_id)
            elif status == "failed":
                if bucket == "web_search":
                    if tc_id:
                        self.web_failed_ids.add(tc_id)
                    self.web_error = err or "web_search_failed"
                elif bucket == "x_search":
                    if tc_id:
                        self.x_failed_ids.add(tc_id)
                    self.x_error = err or "x_search_failed"
                elif bucket == "image_search":
                    if tc_id:
                        self.image_failed_ids.add(tc_id)
                    self.image_error = err or "image_search_failed"

        # Extract per-call citations from output_chunk.proto.delta.citations (or output_chunk.citations).
        delta_citations = (
            getattr(getattr(getattr(tool_output, "proto", None), "delta", None), "citations", None)
            or getattr(tool_output, "citations", None)
            or []
        )
        for cit in delta_citations:
            self._record_citation_proto(cit, preferred_buckets=buckets_in_chunk)

        # Handle server-side image generation output envelope if present.
        content = getattr(tool_output, "content", None)
        if isinstance(content, str) and "image_generation_result" in content:
            try:
                envelope = json.loads(content)
                if isinstance(envelope, dict) and envelope.get("__type") == "image_generation_result":
                    data_url = envelope.get("result")
                    if isinstance(data_url, str) and data_url.startswith("data:image/"):
                        self._add_image_result(data_url, title="Generated image")
            except Exception:
                pass

    def _record_citation_proto(
        self,
        cit: Any,
        *,
        preferred_buckets: list[str] | None = None,
        response_text: str = "",
    ) -> None:
        if isinstance(cit, str):
            url = cit.strip()
            if not url:
                return
            if _X_STATUS_RE.match(url) or _X_PROFILE_RE.match(url):
                if self.x_active or (preferred_buckets and "x_search" in preferred_buckets):
                    self.x_active = True
                    self._add_x_result(url)
            elif self.web_active or (preferred_buckets and "web_search" in preferred_buckets):
                self.web_active = True
                self._add_web_result(url)
            return

        cit_id = str(getattr(cit, "id", "") or "")
        web_cit = getattr(cit, "web_citation", None)
        web_url = str(getattr(web_cit, "url", "") or "").strip() if web_cit else ""
        x_cit = getattr(cit, "x_citation", None)
        x_url = str(getattr(x_cit, "url", "") or "").strip() if x_cit else ""

        if cit_id.startswith("img-") and web_url:
            caption: str | None = None
            if response_text:
                start_idx = getattr(cit, "start_index", 0) or 0
                end_idx = getattr(cit, "end_index", 0) or 0
                if 0 <= start_idx < end_idx <= len(response_text):
                    span = response_text[start_idx:end_idx]
                    m = _MARKDOWN_IMAGE_RE.search(span)
                    if m and m.group(1).strip():
                        caption = m.group(1).strip()
            self._add_image_result(web_url, origin_url=web_url, title=caption)
            return

        if x_url:
            if self.x_active or (preferred_buckets and "x_search" in preferred_buckets):
                self.x_active = True
                self._add_x_result(x_url)
            return

        if web_url:
            if _X_STATUS_RE.match(web_url):
                if self.x_active or (preferred_buckets and "x_search" in preferred_buckets):
                    self.x_active = True
                    self._add_x_result(web_url)
            elif self.web_active or (preferred_buckets and "web_search" in preferred_buckets):
                self.web_active = True
                self._add_web_result(web_url)

    def record_inline_citations(self, inline_citations: Any, response_text: str = "") -> None:
        for cit in inline_citations or []:
            self._record_citation_proto(cit, response_text=response_text)
        if response_text and self.image_results:
            captions_by_url = {
                m.group(2).strip(): m.group(1).strip()
                for m in _MARKDOWN_IMAGE_RE.finditer(response_text)
                if m.group(1).strip() and m.group(2).strip()
            }
            for item in self.image_results:
                img_url = str(item.get("image_url") or "")
                if img_url in captions_by_url:
                    item["title"] = captions_by_url[img_url]

    def _bucket_status(
        self,
        call_ids: set[str],
        done_ids: set[str],
        failed_ids: set[str],
        results: list[dict[str, Any]],
        *,
        final: bool,
        await_results: bool = False,
    ) -> str:
        if not final:
            if call_ids and not call_ids.issubset(done_ids | failed_ids):
                return "in_progress"
            if await_results and not results and not failed_ids:
                return "in_progress"
        if failed_ids and not done_ids and not results:
            return "failed"
        return "completed"

    def drain_events(self, *, final: bool = False) -> list[StreamEvent]:
        """Return any new or updated ``{"xai": payload}`` stream events."""
        events: list[StreamEvent] = []

        if self.web_active:
            status = self._bucket_status(
                self.web_call_ids, self.web_done_ids, self.web_failed_ids, self.web_results, final=final
            )
            item: dict[str, Any] = {
                "type": "search_results",
                "provider": "xai",
                "id": "xai-web-search",
                "call_id": "xai-web-search",
                "status": status,
                "queries": list(self.web_queries),
                "urls": list(self.web_urls),
                "results": [dict(r) for r in self.web_results],
            }
            if self.web_error and status == "failed":
                item["error"] = self.web_error
            payload = {
                "type": "response.output_item.done" if status != "in_progress" else "response.output_item.added",
                "provider": "xai",
                "item": item,
            }
            snap = json.dumps(payload, sort_keys=True)
            if self._emitted_snapshots.get("web_search") != snap:
                self._emitted_snapshots["web_search"] = snap
                events.append(cast(StreamEvent, {"xai": payload}))

        if self.x_active:
            status = self._bucket_status(
                self.x_call_ids, self.x_done_ids, self.x_failed_ids, self.x_results, final=final
            )
            item = {
                "type": "x_search_results",
                "provider": "xai",
                "id": "xai-x-search",
                "call_id": "xai-x-search",
                "status": status,
                "queries": list(self.x_queries),
                "urls": list(self.x_urls),
                "results": [dict(r) for r in self.x_results],
            }
            if self.x_error and status == "failed":
                item["error"] = self.x_error
            payload = {
                "type": "response.output_item.done" if status != "in_progress" else "response.output_item.added",
                "provider": "xai",
                "item": item,
            }
            snap = json.dumps(payload, sort_keys=True)
            if self._emitted_snapshots.get("x_search") != snap:
                self._emitted_snapshots["x_search"] = snap
                events.append(cast(StreamEvent, {"xai": payload}))

        if self.image_active:
            status = self._bucket_status(
                self.image_call_ids,
                self.image_done_ids,
                self.image_failed_ids,
                self.image_results,
                final=final,
                await_results=self.image_search_requested,
            )
            item = {
                "type": "image_search_results",
                "provider": "xai",
                "id": "xai-image-search",
                "call_id": "xai-image-search",
                "status": status,
                "queries": list(self.image_queries),
                "results": [dict(r) for r in self.image_results],
            }
            if self.image_error and status == "failed":
                item["error"] = self.image_error
            payload = {
                "type": "response.output_item.done" if status != "in_progress" else "response.output_item.added",
                "provider": "xai",
                "item": item,
            }
            snap = json.dumps(payload, sort_keys=True)
            if self._emitted_snapshots.get("image_search") != snap:
                self._emitted_snapshots["image_search"] = snap
                events.append(cast(StreamEvent, {"xai": payload}))

        return events


#: "Supported image file types: jpg/jpeg or png" (https://docs.x.ai/docs/guides/image-understanding).
XAI_IMAGE_FORMATS = frozenset({"png", "jpeg", "jpg"})


class RonXAIModel(xAIModel):
    """``xAIModel`` whose requests carry one state blob, whose overflows are recoverable, and whose native tools stream as cards."""

    @override
    def _split_user_content(self, contents: list[Any]) -> tuple[list[tuple[str, str]], list[Any]]:
        """Vended split, plus a tool result's images as the next user message, for models that read images.

        ``strands_xai`` keeps only a tool result's text/json and ``xai_sdk.chat.tool_result`` takes a string,
        so the images follow the tool messages as ``image()`` parts of the user message the vended
        ``_append_messages_to_chat`` appends after them: the SDK's own pattern for OpenAI chat
        (``strands/models/openai.py`` ``_split_tool_message_images``). Each result names how many follow.
        """
        tool_results, user_parts = super()._split_user_content(contents)
        results = [content["toolResult"] for content in contents if "toolResult" in content]
        images = [[item for item in result["content"] if "image" in item and item["image"]["format"] in XAI_IMAGE_FORMATS]
                  for result in results]
        if not any(images) or not cached_tool_result_images("xai", self.config["model_id"].removeprefix("xai/")):
            return tool_results, user_parts
        parts: list[Any] = []
        for index, found in enumerate(images):
            if not found:
                continue
            tool_use_id, text = tool_results[index]
            note = f"[{len(found)} image(s) from this tool result follow in the next user message]"
            tool_results[index] = (tool_use_id, f"{text}\n{note}" if text else note)
            parts.extend(self._format_image_content(item) for item in found)
        return tool_results, [*parts, *user_parts]

    async def _stream_with_native_tools(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        tool_choice: ToolChoice | None = None,
        *,
        system_prompt_content: list[SystemContentBlock] | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[StreamEvent, None]:
        client = self._get_client()
        resolved_system_prompt = self._resolve_system_prompt(system_prompt, system_prompt_content)

        try:
            chat = self._build_chat(client, tool_specs, tool_choice)
            self._append_messages_to_chat(chat, messages, resolved_system_prompt)

            yield self._format_chunk({"chunk_type": "message_start"})

            tool_calls_pending: list[dict[str, Any]] = []
            server_tool_calls: list[dict[str, Any]] = []
            current_content_type: str | None = None
            final_response: Any = None
            citations: Any = None
            inline_citations: Any = None
            tracker = _XAINativeToolTracker()

            async for response, chunk in chat.stream():
                final_response = response

                if hasattr(response, "citations") and response.citations:
                    citations = response.citations

                if getattr(response, "inline_citations", None):
                    inline_citations = response.inline_citations

                if hasattr(chunk, "reasoning_content") and chunk.reasoning_content:
                    if current_content_type != "reasoning":
                        if current_content_type:
                            yield self._format_chunk({"chunk_type": "content_stop"})
                        yield self._format_chunk({"chunk_type": "content_start", "data_type": "reasoning"})
                        current_content_type = "reasoning"
                    yield self._format_chunk(
                        {
                            "chunk_type": "content_delta",
                            "data_type": "reasoning_content",
                            "data": chunk.reasoning_content,
                        }
                    )

                if hasattr(chunk, "tool_calls") and chunk.tool_calls:
                    for tool_call in chunk.tool_calls:
                        tool_type = _tool_call_type(tool_call)
                        fn = getattr(tool_call, "function", None)
                        tool_data = {
                            "id": getattr(tool_call, "id", ""),
                            "name": getattr(fn, "name", ""),
                            "arguments": getattr(fn, "arguments", "") or "",
                        }
                        if tool_type == "client_side_tool":
                            tool_calls_pending.append(tool_data)
                        else:
                            logger.debug(
                                "tool_type=<%s>, tool_name=<%s> | server-side tool executed by xAI",
                                tool_type,
                                tool_data["name"],
                            )
                            server_tool_calls.append(tool_data)
                            tracker.record_server_tool_call(tool_call, tool_type)

                if getattr(chunk, "tool_outputs", None):
                    for tool_output in chunk.tool_outputs:
                        tracker.record_tool_output(tool_output)

                chunk_inline = getattr(chunk, "inline_citations", None)
                if chunk_inline:
                    response_text = str(getattr(response, "content", "") or "")
                    tracker.record_inline_citations(chunk_inline, response_text=response_text)

                for native_event in tracker.drain_events(final=False):
                    yield native_event

                if hasattr(chunk, "content") and chunk.content:
                    if current_content_type != "text":
                        if current_content_type:
                            yield self._format_chunk({"chunk_type": "content_stop"})
                        yield self._format_chunk({"chunk_type": "content_start", "data_type": "text"})
                        current_content_type = "text"
                    yield self._format_chunk(
                        {
                            "chunk_type": "content_delta",
                            "data_type": "text",
                            "data": chunk.content,
                        }
                    )

            if current_content_type:
                yield self._format_chunk({"chunk_type": "content_stop"})

            final_text = str(getattr(final_response, "content", "") or "") if final_response else ""
            if inline_citations:
                tracker.record_inline_citations(inline_citations, response_text=final_text)
            if citations:
                for cit_url in citations:
                    tracker._record_citation_proto(cit_url, response_text=final_text)
            if final_response:
                try:
                    for img_out in getattr(final_response, "image_outputs", None) or []:
                        data_url = getattr(img_out, "data_url", None)
                        if isinstance(data_url, str) and data_url:
                            tracker._add_image_result(data_url, title="Generated image")
                except Exception:
                    pass
            for native_event in tracker.drain_events(final=True):
                yield native_event

            for citation in self._iter_citations(citations, inline_citations):
                yield self._format_chunk({"chunk_type": "content_start", "data_type": "citation"})
                yield self._format_chunk({"chunk_type": "content_delta", "data_type": "citation", "data": citation})
                yield self._format_chunk({"chunk_type": "content_stop"})

            for tool_call in tool_calls_pending:
                yield self._format_chunk({"chunk_type": "content_start", "data_type": "tool", "data": tool_call})
                yield self._format_chunk({"chunk_type": "content_delta", "data_type": "tool", "data": tool_call})
                yield self._format_chunk({"chunk_type": "content_stop", "data_type": "tool"})

            has_encrypted_reasoning = (
                final_response and hasattr(final_response, "encrypted_content") and final_response.encrypted_content
            )
            needs_xai_state = server_tool_calls or has_encrypted_reasoning

            if final_response and needs_xai_state:
                # The blob is durable history: capture it without the blocks the SDK marks as
                # per-call (dynamic_trailing_blocks), which the model saw but must never persist.
                dynamic = kwargs.get("dynamic_trailing_blocks", 0)
                if dynamic and messages:
                    last = messages[-1]
                    chat = self._build_chat(client, tool_specs, tool_choice)
                    self._append_messages_to_chat(
                        chat, [*messages[:-1], {**last, "content": list(last["content"])[:-dynamic]}],
                        resolved_system_prompt)
                xai_state = self._capture_xai_state(chat, final_response)
                if xai_state:
                    state_json = json.dumps({"messages": xai_state})
                    state_b64 = base64.b64encode(state_json.encode("utf-8")).decode("utf-8")
                    state_text = f"{_xai.XAI_STATE_MARKER}{state_b64}{_xai.XAI_STATE_MARKER_END}"

                    yield self._format_chunk({"chunk_type": "content_start", "data_type": "xai_state"})
                    yield {
                        "contentBlockDelta": {
                            "delta": {"reasoningContent": {"redactedContent": state_text.encode("utf-8")}}
                        }
                    }
                    yield self._format_chunk({"chunk_type": "content_stop"})

            stop_reason = "tool_use" if tool_calls_pending else "end_turn"
            yield self._format_chunk({"chunk_type": "message_stop", "data": stop_reason})

            if final_response and hasattr(final_response, "usage") and final_response.usage:
                yield self._format_chunk(
                    {
                        "chunk_type": "metadata",
                        "data": final_response.usage,
                        "citations": citations,
                        "server_tool_calls": server_tool_calls if server_tool_calls else None,
                    }
                )

        except Exception as error:
            self._handle_stream_error(error)

        logger.debug("finished streaming response from xAI")

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
        if has_tool_result_images(messages):
            await load_capability("xai", self.config["model_id"].removeprefix("xai/"))
        trimmed = without_superseded_xai_state(messages)
        if trimmed is not messages:
            logger.debug("messages=<%d> | stripped superseded xAI state before request", len(messages))
        stream_impl = (
            super().stream
            if _xai.xAIModel.stream is not _BASE_XAI_STREAM
            else self._stream_with_native_tools
        )
        try:
            async for event in stream_impl(
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
