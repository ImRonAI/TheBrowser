"""Threads: the Supabase read model of a user's native Strands sessions.

The source of truth is the SDK snapshot (``ThreadSessionManager`` under the user's HF storage). This
module projects ``agent.messages`` into ``public.threads`` / ``public.thread_messages``
(``supabase/migrations/014_threads.sql``) so the renderer can list threads and read them in order,
and both agent kinds -- the Chat ``Agent`` and the Live ``BidiAgent`` -- land in the same thread.

``ThreadProjection`` is a native ``HookProvider``: it listens to ``MessageAddedEvent`` and
``MessageUpdatedEvent`` (the same events the session manager saves on) and ``AfterInvocationEvent`` /
``BidiAgentStopEvent``, coalescing writes so a long tool loop produces one upsert at a time. Guests
(non-UUID ``user_id``) are never projected: Supabase RLS keys rows by ``auth.users``.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Literal

from strands.hooks.events import AfterInvocationEvent, MessageAddedEvent, MessageUpdatedEvent
from strands.hooks.registry import HookRegistry

from agent.api.core.panel_tools import serializable_event

logger = logging.getLogger(__name__)

AgentKind = Literal["chat", "live"]
MessageKind = Literal["user_prompt", "assistant_output", "reasoning", "tool_call", "tool_result"]


def owner_uuid(user_id: str) -> str | None:
    """A signed-in Supabase user id, or None for guests (``default``, ``guest:*``, ``dev-user``)."""
    try:
        return str(uuid.UUID(user_id))
    except (TypeError, ValueError):
        return None


def message_rows(messages: list[dict[str, Any]], agent: AgentKind) -> list[dict[str, Any]]:
    """Flatten native ``agent.messages`` into ordered rows: one per (seq, kind)."""
    rows: list[dict[str, Any]] = []
    for seq, message in enumerate(messages):
        role = message.get("role")
        if role not in ("user", "assistant"):
            continue
        by_kind: dict[str, list[dict[str, Any]]] = {}
        for block in message.get("content") or []:
            if not isinstance(block, dict):
                continue
            if "text" in block:
                kind = "user_prompt" if role == "user" else "assistant_output"
            elif "reasoningContent" in block:
                kind = "reasoning"
            elif "toolUse" in block:
                kind = "tool_call"
            elif "toolResult" in block:
                kind = "tool_result"
            else:
                continue
            by_kind.setdefault(kind, []).append(block)
        for kind, blocks in by_kind.items():
            # Same JSON-safe form the panel SSE uses: binary blocks (screenshots, documents) become
            # {encoding: base64, data}; Supabase's jsonb column takes nothing else.
            rows.append({"seq": seq, "role": role, "kind": kind, "agent": agent, "content": serializable_event(blocks)})
    return rows


def thread_title(messages: list[dict[str, Any]]) -> str:
    """First user text line, trimmed to the column limit.

    A pasted prompt (the panel's fixed instruction, then the paste as an attachment) is titled by the
    attachment's card name instead of the instruction.
    """
    from agent.api.core.prompt_attachments import PASTED_PROMPT_INSTRUCTION, parse_attachment_title

    for message in messages:
        if message.get("role") != "user":
            continue
        texts = [block["text"] for block in message.get("content") or []
                 if isinstance(block, dict) and isinstance(block.get("text"), str)]
        for text in texts:
            if text.strip() and not text.startswith("[handoff]"):
                if text.strip().startswith(PASTED_PROMPT_INSTRUCTION):
                    pasted = next((parsed[1] for parsed in map(parse_attachment_title, texts)
                                   if parsed and parsed[0] == "pasted"), None)
                    if pasted:
                        return pasted[:200]
                return text.strip().splitlines()[0][:200]
    return ""


async def project_thread(client: Any, *, owner: str, session_id: str, destination: str, agent: AgentKind,
                         browser: str, messages: list[dict[str, Any]]) -> None:
    """Upsert the thread row and replace its messages with the current native list."""
    rows = message_rows(messages, agent)
    thread = (await client.table("threads").upsert({
        "owner_id": owner, "session_id": session_id, "destination": destination, "title": thread_title(messages),
        "last_agent": agent, "browser": browser, "message_count": len(messages), "updated_at": "now()",
    }, on_conflict="owner_id,session_id").execute()).data[0]
    thread_id = thread["id"]
    # Keep each row's original writer: a Chat takeover re-projects rows Live wrote, and those must stay
    # tagged `live`. Only rows beyond what is already stored take the current agent.
    existing = (await client.table("thread_messages").select("seq,kind,agent").eq("thread_id", thread_id).execute()).data
    writers = {(row["seq"], row["kind"]): row["agent"] for row in existing}
    for row in rows:
        row["agent"] = writers.get((row["seq"], row["kind"]), agent)
    # The whole list is re-projected (bidi edits pending placeholders in place; conversation
    # management can rewrite the head), bounded by the agent's context management.
    await client.table("thread_messages").delete().eq("thread_id", thread_id).execute()
    if rows:
        await client.table("thread_messages").insert(
            [{"thread_id": thread_id, "owner_id": owner, **row} for row in rows]).execute()


async def list_threads(client: Any, owner: str, *, destination: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    query = client.table("threads").select(
        "id,session_id,destination,title,last_agent,browser,message_count,created_at,updated_at").eq("owner_id", owner)
    if destination:
        query = query.eq("destination", destination)
    return (await query.order("updated_at", desc=True).limit(limit).execute()).data


async def read_thread(client: Any, owner: str, session_id: str) -> dict[str, Any] | None:
    threads = (await client.table("threads").select("*").eq("owner_id", owner).eq("session_id", session_id).limit(1).execute()).data
    if not threads:
        return None
    thread = threads[0]
    rows = (await client.table("thread_messages").select("seq,role,kind,agent,content,created_at")
            .eq("thread_id", thread["id"]).order("seq").execute()).data
    return {**thread, "messages": rows}


class ThreadProjection:
    """Native hook: mirror this agent's thread into Supabase whenever its messages change.

    Registered on the Chat ``Agent`` (``hooks=[...]``) and the Live ``BidiAgent`` (same ``hooks``
    parameter). Writes are coalesced: a change schedules one projection after ``debounce`` seconds;
    ``AfterInvocationEvent`` (Chat) and the Live stop flush immediately.
    """

    def __init__(self, *, user_id: str, session_id: str, destination: str, agent: AgentKind, browser: str,
                 client_factory: Any = None, debounce: float = 1.0) -> None:
        self.owner = owner_uuid(user_id)
        self.session_id, self.destination, self.agent, self.browser = session_id, destination, agent, browser
        self._client_factory = client_factory
        self._debounce = debounce
        self._pending: asyncio.Task[None] | None = None
        self._messages: list[dict[str, Any]] | None = None

    @property
    def enabled(self) -> bool:
        return self.owner is not None

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        if not self.enabled:
            return
        registry.add_callback(MessageAddedEvent, self._on_change)
        registry.add_callback(MessageUpdatedEvent, self._on_change)
        registry.add_callback(AfterInvocationEvent, self._flush_now)
        try:
            from strands.bidi.types.events import BidiAgentStopEvent

            registry.add_callback(BidiAgentStopEvent, self._flush_now)
        except Exception:  # pragma: no cover - bidi events are always present in the pinned SDK
            pass

    async def _client(self) -> Any:
        if self._client_factory is not None:
            return await self._client_factory()
        from agent.api.core.live_music import supabase_client

        return await supabase_client()

    def _on_change(self, event: Any) -> None:
        self._messages = list(event.agent.messages)
        if self._pending is None or self._pending.done():
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return
            self._pending = loop.create_task(self._later())

    async def _later(self) -> None:
        await asyncio.sleep(self._debounce)
        await self.flush()

    async def _flush_now(self, event: Any) -> None:
        self._messages = list(event.agent.messages)
        if self._pending is not None and not self._pending.done():
            self._pending.cancel()
        await self.flush()

    async def flush(self) -> None:
        if not self.enabled or self._messages is None:
            return
        messages, self._messages = self._messages, None
        try:
            client = await self._client()
            await project_thread(client, owner=self.owner or "", session_id=self.session_id, destination=self.destination,
                                 agent=self.agent, browser=self.browser, messages=messages)
        except Exception:
            logger.exception("session=<%s> | thread projection failed", self.session_id)
