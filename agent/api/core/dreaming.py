"""Dreaming = native memory extraction on the long-term store.

The SDK's ``ExtractionCoordinator`` buffers every message of the panel agent and, on the default
``IntervalTrigger(5)`` (and ``MemoryManager.flush()`` at session close/shutdown), runs this
``ModelExtractor`` on ``agent.aux_model`` (the first ``RON_MEMORY_AGENT_MODELS`` id) over the
unsaved slice of the transcript. ``MemoryMessageFilter(exclude=[])`` keeps ``toolUse`` blocks, so the
extractor sees the journal ``add_memory`` calls verbatim and consolidates them into the
``panel-memory`` store: each result is headed ``# <topic> | <subject>`` so
``FileMemoryStore.add`` slug-merges it into that subject's file, newest block last. The
``ExtractionCoordinator`` high-water mark is the incremental checkpoint; there is no idle tick,
endpoint or timer.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from strands.memory import ExtractionConfig, ExtractionResult, ExtractorContext, MemoryMessageFilter, ModelExtractor
from strands.types.content import ContentBlock, Message

if TYPE_CHECKING:
    from strands.storage import Storage

#: Fixed vocabulary the dreaming pass draws 10-12 tags from (``RON_MEMORY_TAGS`` overrides).
DEFAULT_TAGS = (
    "todo", "deadline", "reminder", "preference", "dislike", "family", "friend", "work", "project",
    "health", "finance", "purchase", "travel", "food", "home", "schedule", "birthday", "anniversary",
    "feedback", "correction", "instruction", "habit", "goal", "decision", "question", "fact",
    "contact", "location", "account", "tool", "browser", "research", "shopping", "entertainment",
    "learning", "communication", "style", "privacy", "security", "recurring",
)


def tag_vocabulary() -> tuple[str, ...]:
    raw = os.getenv("RON_MEMORY_TAGS", "")
    tags = tuple(tag.strip() for tag in raw.split(",") if tag.strip())
    return tags or DEFAULT_TAGS


def dream_prompt(tags: tuple[str, ...] | None = None) -> str:
    """The extractor system prompt: consolidate journal entries into tagged ``# Topic | Subject`` entries."""
    vocabulary = ", ".join(tags or tag_vocabulary())
    return f"""You are Ron's memory consolidator ("dreaming"). You read the tail of a conversation
between the user and Ron, including Ron's tool calls, and distill what is worth remembering
long-term into memory entries.

Sources, in priority order:
1. add_memory tool calls: each entry Ron journaled (<start_entry> ... <end_entry/>) with its
   topic_name, subject and created_at. Keep these three fields VERBATIM.
2. Facts the user stated about themselves, their preferences, feedback, to-dos and decisions that
   Ron did not journal. Give these a topic from the list below, a two-to-eight word subject and the
   created_at of the journal entry nearest in the transcript (or omit created_at when none exists).

Return ONLY a JSON array of objects: {{"content": string}}. Each content is EXACTLY:
# <topic_name> | <subject>
<start_entry>
<topic_name>...<topic_name/>
<subject>...<subject/>
<created_at>YYYY-MM-DDTHH:MM:SS<created_at/>
<tags>10 to 12 comma-separated words chosen ONLY from: {vocabulary}</tags>
...one or two factual sentences...
<end_entry/>

Rules:
- topic_name is one of: ToDo's, LearnedAboutUser, Feedback, UserStatement, WorthyMemory.
- The user prompt may list existing topics (headings already in memory). When a new fact
  corrects or updates one of them, REUSE that exact heading (same topic and subject) so the
  newer entry is appended below the older one; the newest line wins. Never rewrite history.
- Skip anything already covered by an existing topic unless it is a correction or an update.
- Skip chit-chat, questions, transient page content and anything Ron merely searched for.
- If there is nothing worth remembering, return []."""


#: The manager's journal write tool, as it appears in ``toolUse`` blocks.
JOURNAL_TOOL_NAME = "add_memory"


def _render_tool_blocks(message: Message) -> Message:
    """Render tool traffic as text so the native ``ModelExtractor`` (which reads only ``text``
    blocks) sees the journal entries verbatim; other tool calls are reduced to one line."""
    content: list[ContentBlock] = []
    for block in message["content"]:
        use = block.get("toolUse")
        if use is not None:
            if use.get("name") == JOURNAL_TOOL_NAME:
                entries = (use.get("input") or {}).get("entries") or []
                joined = "\n".join(str(entry) for entry in entries)
                content.append({"text": f"[journaled with {JOURNAL_TOOL_NAME}]\n{joined}"})
            else:
                content.append({"text": f"[tool call {use.get('name', '')}]"})
            continue
        if "toolResult" in block:
            continue
        content.append(block)
    rendered: Message = {"role": message["role"], "content": content}
    return rendered


class DreamExtractor:
    """``Extractor`` that renders journal ``add_memory`` calls into the transcript, lists the
    store's existing ``# Topic | Subject`` headings (the SDK's key-aware pattern) and delegates
    the model call and parsing to a native ``ModelExtractor``.

    No ``model``: ``ModelExtractor`` resolves ``agent.aux_model`` > ``agent.model``.
    """

    def __init__(self, storage: Storage, tags: tuple[str, ...] | None = None) -> None:
        self._storage = storage
        self._prompt = dream_prompt(tags)

    async def extract(self, messages: list[Message], context: ExtractorContext | None = None) -> list[ExtractionResult]:
        headings = [key.rsplit("/", 1)[-1].removesuffix(".md").replace("-", " ")
                    for key in await self._storage.list("") if key.endswith(".md")]
        prompt = self._prompt
        if headings:
            prompt += ("\n\nExisting topics (reuse the exact heading when a fact updates or corrects one): "
                       + ", ".join(sorted(headings)))
        rendered = [_render_tool_blocks(message) for message in messages]
        return await ModelExtractor(system_prompt=prompt).extract(rendered, context)


def dream_extraction(storage: Storage, tags: tuple[str, ...] | None = None) -> ExtractionConfig:
    """The long-term store's ``ExtractionConfig``: dreaming on the SDK's default cadence.

    ``storage`` is the store's own namespaced storage (its subject files are the existing
    topics). The empty filter keeps ``toolUse``/``toolResult`` blocks so journal ``add_memory``
    calls are visible to the extractor.
    """
    return ExtractionConfig(
        extractor=DreamExtractor(storage, tags),
        filter=MemoryMessageFilter(exclude=[]),
    )


__all__ = ["DEFAULT_TAGS", "DreamExtractor", "dream_extraction", "dream_prompt", "tag_vocabulary"]
