"""Threads read model: native hook projection of agent.messages into Supabase, and the list/read routes."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from strands import Agent

from agent.api.core.threads import ThreadProjection, message_rows, owner_uuid, thread_title
from agent.tests.test_panel_runtime import OfflineModel

OWNER = "f67117b6-82b3-4bcf-b20d-980d5e140af1"


class FakeQuery:
    def __init__(self, db: "FakeSupabase", table: str) -> None:
        self.db, self.table_name = db, table
        self.op: str | None = None
        self.payload: Any = None
        self.filters: list[tuple[str, Any]] = []

    def upsert(self, row, on_conflict=""):
        self.op, self.payload = "upsert", row; return self

    def insert(self, rows):
        self.op, self.payload = "insert", rows; return self

    def delete(self):
        self.op = "delete"; return self

    def select(self, *_):
        self.op = "select"; return self

    def in_(self, *_):
        return self

    def eq(self, key, value):
        self.filters.append((key, value)); return self

    def order(self, *_, **__):
        return self

    def limit(self, *_):
        return self

    async def execute(self):
        rows = self.db.tables.setdefault(self.table_name, [])
        if self.op == "upsert":
            match = next((r for r in rows if r["owner_id"] == self.payload["owner_id"] and r["session_id"] == self.payload["session_id"]), None)
            if match:
                match.update(self.payload)
            else:
                match = {"id": f"thread-{len(rows) + 1}", **self.payload}
                rows.append(match)
            return type("R", (), {"data": [match]})()
        if self.op == "insert":
            rows.extend(self.payload); return type("R", (), {"data": self.payload})()
        selected = [r for r in rows if all(r.get(k) == v for k, v in self.filters)]
        if self.op == "delete":
            rows[:] = [r for r in rows if r not in selected]
        return type("R", (), {"data": selected})()


class FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)


def test_owner_uuid_rejects_guests() -> None:
    assert owner_uuid(OWNER) == OWNER
    assert owner_uuid("default") is None and owner_uuid("guest:abc") is None and owner_uuid("dev-user") is None


def test_message_rows_flatten_every_native_block_kind_in_order() -> None:
    messages = [
        {"role": "user", "content": [{"text": "find flights"}]},
        {"role": "assistant", "content": [{"reasoningContent": {"reasoningText": {"text": "plan"}}}, {"toolUse": {"toolUseId": "t", "name": "search", "input": {}}}]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": "t", "status": "success", "content": [{"text": "DL145"}]}}]},
        {"role": "assistant", "content": [{"text": "Found DL145."}]},
    ]
    rows = message_rows(messages, "live")
    assert [(r["seq"], r["kind"]) for r in rows] == [(0, "user_prompt"), (1, "reasoning"), (1, "tool_call"), (2, "tool_result"), (3, "assistant_output")]
    assert all(r["agent"] == "live" for r in rows)
    assert thread_title(messages) == "find flights"
    assert thread_title([{"role": "user", "content": [{"text": "[handoff] continue"}]}, *messages]) == "find flights", "handoff prompts never title a thread"


@pytest.mark.asyncio
async def test_projection_is_a_native_hook_that_mirrors_agent_messages_after_each_invocation() -> None:
    db = FakeSupabase()

    async def client() -> FakeSupabase:
        return db

    projection = ThreadProjection(user_id=OWNER, session_id="s-1", destination="panel", agent="chat", browser="user",
                                  client_factory=client, debounce=0.01)
    agent = Agent(model=OfflineModel(), hooks=[projection], callback_handler=None, agent_id="a")
    await agent.invoke_async("hello")
    await asyncio.sleep(0.05)
    threads = db.tables["threads"]
    assert len(threads) == 1 and threads[0]["session_id"] == "s-1" and threads[0]["title"] == "hello"
    assert threads[0]["last_agent"] == "chat" and threads[0]["browser"] == "user" and threads[0]["message_count"] == len(agent.messages)
    kinds = [r["kind"] for r in sorted(db.tables["thread_messages"], key=lambda r: (r["seq"], r["kind"]))]
    assert kinds == ["user_prompt", "assistant_output", "reasoning"]


@pytest.mark.asyncio
async def test_guest_agents_are_never_projected() -> None:
    called = False

    async def client() -> Any:
        nonlocal called
        called = True
        return FakeSupabase()

    projection = ThreadProjection(user_id="default", session_id="s", destination="panel", agent="chat", browser="user", client_factory=client)
    assert projection.enabled is False
    agent = Agent(model=OfflineModel(), hooks=[projection], callback_handler=None)
    await agent.invoke_async("hi")
    await asyncio.sleep(0.02)
    assert called is False


@pytest.mark.asyncio
async def test_takeover_reprojection_keeps_each_rows_original_writer() -> None:
    from agent.api.core.threads import project_thread

    db = FakeSupabase()
    live_messages = [{"role": "user", "content": [{"text": "open example.com"}]},
                     {"role": "assistant", "content": [{"toolUse": {"toolUseId": "t", "name": "nav", "input": {}}}]}]
    await project_thread(db, owner=OWNER, session_id="s", destination="panel", agent="live", browser="user", messages=live_messages)
    chat_messages = [*live_messages, {"role": "user", "content": [{"text": "[handoff] continue"}]},
                     {"role": "assistant", "content": [{"text": "Done: heading is Example Domain."}]}]
    await project_thread(db, owner=OWNER, session_id="s", destination="panel", agent="chat", browser="cloud", messages=chat_messages)
    rows = sorted(db.tables["thread_messages"], key=lambda r: r["seq"])
    assert [(r["seq"], r["agent"]) for r in rows] == [(0, "live"), (1, "live"), (2, "chat"), (3, "chat")]
    thread = db.tables["threads"][0]
    assert thread["last_agent"] == "chat" and thread["browser"] == "cloud" and thread["title"] == "open example.com"


def test_message_rows_are_json_safe_for_binary_tool_results() -> None:
    import json

    messages = [{"role": "user", "content": [{"toolResult": {"toolUseId": "t", "status": "success",
                                                              "content": [{"image": {"format": "png", "source": {"bytes": b"\x89PNG"}}}]}}]}]
    rows = message_rows(messages, "chat")
    encoded = json.dumps(rows)  # must not raise
    assert "base64" in encoded and "iVBORw" not in encoded or "base64" in encoded
