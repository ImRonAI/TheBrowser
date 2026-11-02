"""Live -> Chat takeover: native thread sharing between BidiAgent and Agent, and the one custom trigger."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from strands import Agent, tool
from strands.bidi import BidiAgent
from strands.bidi.models.model import BidiModel
from strands.bidi.types.events import (
    BidiConnectionStartEvent, BidiResponseStartEvent, BidiResponseStopEvent, BidiTextDeltaEvent, BidiTextStartEvent,
    BidiTextStopEvent, BidiToolUseBlocksEvent,
)
from strands.storage import InMemoryStorage

from agent.api.core.live_takeover import TAKEOVER_PROMPT, pending_work, start_takeover, takeover_selection
from agent.api.core.panel_storage import ThreadSessionManager, thread_agent_id
from agent.tests.test_panel_runtime import OfflineModel


def user(text: str) -> dict[str, Any]:
    return {"role": "user", "content": [{"text": text}]}


def assistant_text(text: str) -> dict[str, Any]:
    return {"role": "assistant", "content": [{"text": text}]}


def assistant_tool() -> dict[str, Any]:
    return {"role": "assistant", "content": [{"toolUse": {"toolUseId": "t1", "name": "x", "input": {}}}]}


def tool_result() -> dict[str, Any]:
    return {"role": "user", "content": [{"toolResult": {"toolUseId": "t1", "status": "success", "content": [{"text": "ok"}]}}],
            "metadata": {"custom": {"bidi": {"kind": "tool_result"}}}}


def test_pending_work_reads_the_thread_tail() -> None:
    assert pending_work([]) is False
    assert pending_work([user("hi"), assistant_text("hello")]) is False, "a finished exchange owes nothing"
    assert pending_work([user("do it")]) is True, "a user turn with no reply"
    assert pending_work([user("do it"), assistant_tool()]) is True, "tool call with no result"
    assert pending_work([user("do it"), assistant_tool(), tool_result()]) is True, "result with no assistant conclusion"
    streaming = {"role": "assistant", "content": [{"text": "Let me"}], "metadata": {"custom": {"bidi": {"kind": "text", "status": "pending"}}}}
    assert pending_work([user("do it"), streaming]) is True, "an unfinished assistant stream"


def test_takeover_selection_pins_the_cloud_browser() -> None:
    assert takeover_selection("panel", "xai", "grok-4.5") == {
        "destination": "panel", "provider": "xai", "model_id": "grok-4.5", "reasoning_effort": None, "browser": "cloud"}


@pytest.mark.asyncio
async def test_start_takeover_reserves_a_server_owned_run_on_the_same_session() -> None:
    calls: list[dict[str, Any]] = []

    class Manager:
        async def start(self, user_id, session_id, message, action="message", **kwargs):
            calls.append({"user_id": user_id, "session_id": session_id, "message": message, "action": action, **kwargs})
            return "run"

    assert await start_takeover(Manager(), user_id="u", session_id="s", destination="panel", provider="xai",
                                model_id="grok-4.5", reason="the app disconnected") == "run"
    call = calls[0]
    assert (call["user_id"], call["session_id"], call["action"]) == ("u", "s", "message")
    assert call["message"] == TAKEOVER_PROMPT.format(reason="the app disconnected")
    assert call["selection"]["browser"] == "cloud"


class ScriptedBidiModel(BidiModel):
    """A BidiModel that answers one text turn with one tool call, then a text reply; records what it was started with."""

    def __init__(self) -> None:
        self.started_with: list[dict[str, Any]] = []
        self._queue: asyncio.Queue[Any] = asyncio.Queue()
        self._open = False

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "scripted-bidi"}

    def update_config(self, **kwargs: Any) -> None:
        pass

    async def start(self, system_prompt=None, tools=None, messages=None, **kwargs) -> None:
        self.started_with.append({"system_prompt": system_prompt, "tools": [t["name"] for t in tools or []], "messages": list(messages or [])})
        self._open = True
        await self._queue.put(BidiConnectionStartEvent(connection_id="c1", model="scripted-bidi"))

    async def stop(self) -> None:
        self._open = False
        await self._queue.put(None)

    async def receive(self):
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def send(self, content: Any) -> None:
        blocks = content.content if hasattr(content, "content") else []
        first = blocks[0] if blocks else None
        if first is not None and getattr(first, "tool_use_id", None) is not None:
            # Tool result came back: finish with a text reply.
            await self._queue.put(BidiResponseStartEvent(response_id="r2"))
            await self._queue.put(BidiTextStartEvent(content_id="x2"))
            await self._queue.put(BidiTextDeltaEvent(delta="Stored.", content_id="x2"))
            await self._queue.put(BidiTextStopEvent(content_id="x2"))
            await self._queue.put(BidiResponseStopEvent(response_id="r2"))
            return
        text = getattr(first, "text", None)
        if text:
            await self._queue.put(BidiResponseStartEvent(response_id="r1"))
            await self._queue.put(BidiToolUseBlocksEvent(tool_uses=[{"toolUseId": "call-1", "name": "remember", "input": {"fact": text}}]))
            await self._queue.put(BidiResponseStopEvent(response_id="r1"))


@tool
def remember(fact: str) -> str:
    """Store a fact."""
    return f"stored {fact}"


class OneText:
    def __init__(self, text: str) -> None:
        self.text, self.sent, self.hold = text, False, asyncio.Event()

    async def start(self, agent: Any) -> None: ...
    async def stop(self) -> None: ...

    async def __call__(self) -> Any:
        if not self.sent:
            self.sent = True
            return {"text": self.text}
        await self.hold.wait()
        raise asyncio.CancelledError


class UntilReply:
    def __init__(self) -> None:
        self.done = asyncio.Event()

    async def start(self, agent: Any) -> None: ...
    async def stop(self) -> None: ...

    async def __call__(self, event: Any) -> None:
        if event.get("type") == "bidi_text_block" and "Stored" in (event.get("text") or ""):
            self.done.set()


@pytest.mark.asyncio
async def test_live_thread_restores_natively_into_a_chat_agent_with_the_same_session_and_agent_id() -> None:
    storage = InMemoryStorage()
    session_id, agent_id = "thread-1", thread_agent_id("user-1")

    # 1. Live writes the thread natively (SnapshotSessionManager, every message).
    live = BidiAgent(model=ScriptedBidiModel(), tools=[remember], system_prompt="live prompt", agent_id=agent_id,
                     session_manager=ThreadSessionManager(session_id, storage=storage))
    out, inp = UntilReply(), OneText("my cat is Biscuit")
    task = asyncio.create_task(live.run(inputs=[inp], outputs=[out]))
    await asyncio.wait_for(out.done.wait(), 5)
    await asyncio.sleep(0.05)
    inp.hold.set(); live.cancel(); task.cancel()
    try:
        await task
    except BaseException:
        pass
    await live.stop()
    kinds = [(m["role"], next(iter(m["content"][0]))) for m in live.messages]
    assert kinds[0] == ("user", "text") and ("assistant", "toolUse") in kinds and kinds[-1] == ("assistant", "text")
    assert await storage.list("") == [f"session/{session_id}/scopes/agent/{agent_id}/snapshots/snapshot_latest.json"]
    assert pending_work(live.messages) is False

    # 2. A Chat Agent on the SAME session_id + agent_id restores those messages on construction (native).
    chat_model = OfflineModel()
    chat = Agent(model=chat_model, tools=[remember], system_prompt="chat prompt", agent_id=agent_id,
                 session_manager=ThreadSessionManager(session_id, storage=storage), callback_handler=None)
    assert [m["role"] for m in chat.messages] == [m["role"] for m in live.messages]
    assert chat.system_prompt == "chat prompt", "the Chat agent keeps its own prompt; only messages/state come from the thread"

    # 3. It continues the thread; the model sees the Live history (text agent whitelists role/content).
    result = await chat.invoke_async("what did I tell you?")
    assert str(result).strip() == "answer"
    seen = chat_model.calls[0]
    assert seen[0]["content"][0]["text"] == "my cat is Biscuit"
    assert all(set(m) <= {"role", "content"} for m in seen), "bidi metadata never reaches the provider"
    assert pending_work(chat.messages) is False


@pytest.mark.asyncio
async def test_unattended_guard_cancels_ask_user_and_fixer_contact_but_nothing_else() -> None:
    from strands.hooks.events import BeforeToolCallEvent

    from agent.api.core.live_takeover import UnattendedRunGuard

    @tool
    def ask_user(question: str) -> str:
        """Would interrupt."""
        return "asked"

    @tool
    def a2a_send_message(target_agent_url: str, message_text: str) -> str:
        """Would need HITL approval for the fixer."""
        return "sent"

    @tool
    def plain(x: str) -> str:
        """Ordinary tool."""
        return f"ok {x}"

    agent = Agent(model=OfflineModel(tools=("ask_user", "a2a_send_message", "plain")), tools=[ask_user, a2a_send_message, plain],
                  hooks=[UnattendedRunGuard()], callback_handler=None)
    # Drive the hook directly with the native event (the OfflineModel sends empty inputs, so target the hook).
    guard = UnattendedRunGuard()
    cancelled: dict[str, Any] = {}
    for name, inputs in (("ask_user", {"question": "ok?"}), ("a2a_send_message", {"target_agent_url": "http://127.0.0.1:8765/a2a/fixer/x"}),
                         ("a2a_send_message", {"target_agent_url": "http://127.0.0.1:8765/a2a/agents/spec"}), ("plain", {"x": "1"})):
        event = BeforeToolCallEvent(agent=agent, selected_tool=agent.tool_registry.registry[name],
                                    tool_use={"toolUseId": "t", "name": name, "input": inputs}, invocation_state={})
        guard.before_tool_call(event)
        cancelled[f"{name}:{inputs.get('target_agent_url', '')}"] = event.cancel_tool
    assert "unattended" in str(cancelled["ask_user:"])
    assert "fixer" in str(cancelled["a2a_send_message:http://127.0.0.1:8765/a2a/fixer/x"])
    assert cancelled["a2a_send_message:http://127.0.0.1:8765/a2a/agents/spec"] is False, "specialists over A2A stay allowed"
    assert cancelled["plain:"] is False
