"""Offline native Strands 1.56 integration; no provider credentials or network."""

import asyncio
import copy
import json
import threading
import time
from unittest.mock import AsyncMock, Mock

import pytest
from strands import Agent, tool
from pydantic import BaseModel
from strands.agent.agent_result import AgentResult
from strands.hooks.events import AfterToolCallEvent, BeforeToolCallEvent
from strands.event_loop._retry import ModelRetryStrategy
from strands.agent.conversation_manager import NullConversationManager
from strands.types.exceptions import ContextWindowOverflowException, ModelThrottledException
from strands.interrupt import Interrupt
from strands.models.model import Model
from strands.multiagent.base import MultiAgentResult, NodeResult
from strands.storage import InMemoryStorage
from strands.telemetry.metrics import EventLoopMetrics
from strands.vended_plugins.goal import GoalLoop

from agent.api.core.panel_runtime import (
    STEERING_STATE_KEY, PanelRuntimeManager, ReplayOverflow, RuntimeConflict, _wire,
)


class OfflineModel(Model):
    def __init__(self, *, tools=(), entered=None, release=None, on_call=None):
        self.tools = tools
        self.entered, self.release, self.on_call = entered, release, on_call
        self.calls = []

    def get_config(self):
        return {"model_id": "offline"}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls.append(copy.deepcopy(messages))
        if self.entered:
            self.entered.set()
        if self.release:
            await self.release.wait()
        if self.on_call:
            await self.on_call(len(self.calls))
        uses = self.tools if not any("toolResult" in b for m in messages for b in m["content"]) else ()
        yield {"messageStart": {"role": "assistant"}}
        if uses:
            for index, name in enumerate(uses):
                yield {"contentBlockStart": {"contentBlockIndex": index,
                    "start": {"toolUse": {"toolUseId": f"call-{index}", "name": name}}}}
                yield {"contentBlockDelta": {"contentBlockIndex": index, "delta": {"toolUse": {"input": "{}"}}}}
                yield {"contentBlockStop": {"contentBlockIndex": index}}
        else:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"reasoningContent": {"text": "thinking"}}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"contentBlockDelta": {"contentBlockIndex": 1, "delta": {"text": "answer"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 1}}
        yield {"messageStop": {"stopReason": "tool_use" if uses else "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 3, "outputTokens": 2, "totalTokens": 5},
                            "metrics": {"latencyMs": 1}}}


def factory_for(model, *, tools=(), hooks=(), plugins=(), checkpointing=False, background_tasks=None, constructed=None, **agent_options):
    async def factory(*, user_id, session_id, selection, options, runtime_options):
        runtime_options = {**runtime_options, "hooks": [*runtime_options["hooks"], *hooks],
                           "plugins": [*runtime_options["plugins"], *plugins]}
        agent = await asyncio.to_thread(Agent, model=model, tools=list(tools), checkpointing=checkpointing,
                                       background_tasks=background_tasks, **runtime_options, **agent_options)
        if constructed is not None:
            constructed.append(agent)
        return agent
    return factory


def manager_for(factory, **kwargs):
    users = {}
    storage_factory = lambda user: users.setdefault(user, InMemoryStorage())
    return PanelRuntimeManager(factory=factory, storage_factory=storage_factory, **kwargs)


async def finished(session, after=0):
    await session.wait()
    events = [event async for event in session.events(after, run_id=session.run_id)]
    assert events[-1]["type"] == "run_finished", events
    return events


def test_reservation_disconnect_reconnect_and_long_lived_agent():
    async def scenario():
        startup, construct = asyncio.Event(), asyncio.Event()
        entered, release = asyncio.Event(), asyncio.Event()
        agents = []
        build = factory_for(OfflineModel(entered=entered, release=release), constructed=agents)

        async def factory(**kwargs):
            startup.set()
            await construct.wait()
            return await build(**kwargs)

        manager = manager_for(factory)
        session = await manager.start("u", "s", "hello", selection={"model_id": "offline", "provider": "test"})
        await startup.wait()
        with pytest.raises(RuntimeConflict, match="reserved"):
            await manager.start("u", "s", "second")
        construct.set()
        await entered.wait()
        snapshot = await manager.snapshot("u", "s")
        assert snapshot["messages"] == []
        assert snapshot["input"] == "hello"
        assert snapshot["replay_after"] == 0
        stream = session.sse(snapshot["replay_after"], run_id=session.run_id)
        assert "run_started" in await anext(stream)
        await stream.aclose()  # HTTP disconnect does not own the native task.
        waiter = asyncio.create_task(session.wait())
        await asyncio.sleep(0)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        assert not session.task.done()
        release.set()
        events = await finished(session)
        assert [e["data"] for e in events if e["type"] == "text_delta"] == ["answer"]
        assert [e["data"] for e in events if e["type"] == "reasoning_delta"] == ["thinking"]
        assert not any(e["type"] == "background_event" for e in events)
        assert events[-1]["result"]["metrics"]["accumulated_usage"]["totalTokens"] == 5
        cursor = session.sequence
        same = await manager.start("u", "s", "next")
        assert same is session
        second = await finished(same, cursor)
        assert second[0]["sequence"] == cursor + 1
        assert len(agents) == 1
        snap = await same.snapshot()
        assert snap["replay_after"] == same.sequence
        assert len(snap["messages"]) == 4
        with pytest.raises(RuntimeConflict, match="selection"):
            await manager.start("u", "s", "no", selection={"model_id": "other"})
        await manager.shutdown()

    asyncio.run(scenario())


def test_user_isolation_and_parallel_sessions():
    async def scenario():
        manager = manager_for(factory_for(OfflineModel()))
        a, b = await asyncio.gather(manager.start("a", "same", "A"), manager.start("b", "same", "B"))
        await asyncio.gather(a.wait(), b.wait())
        assert a.agent is not b.agent
        assert (await a.snapshot())["messages"][0]["content"] == [{"text": "A"}]
        assert (await b.snapshot())["messages"][0]["content"] == [{"text": "B"}]
        assert await manager.get("unknown", "same") is None
        with pytest.raises(KeyError):
            await manager.cancel("unknown", "same")
        await manager.shutdown()

    asyncio.run(scenario())


def test_native_checkpoint_restart_resume_and_queued_steering():
    async def scenario():
        calls = []

        @tool
        async def work() -> str:
            """Record the tool invocation."""
            calls.append("work")
            return "done"

        model = OfflineModel(tools=("work",))
        factory = factory_for(model, tools=[work], checkpointing=True)
        first = manager_for(factory)
        session = await first.start("u", "checkpoint", "work", selection={"model_id": "offline"}, options={"checkpointing": True})
        events = await finished(session)
        assert session.status == "checkpointed", events
        assert session.checkpoint["position"] == "after_model"
        assert calls == []
        await first.steer("u", "checkpoint", "prefer brief output", steering_id="direction")
        await first.shutdown()

        # A fresh registry restores with a factory selected using persisted config.
        received = []
        async def restore_factory(**kwargs):
            received.append((kwargs["selection"], kwargs["options"]))
            return await factory(**kwargs)

        second = PanelRuntimeManager(storage_factory=first.storage_factory)
        restored = await second.get("u", "checkpoint", factory=restore_factory)
        assert restored is not None
        assert received == [({"model_id": "offline"}, {"checkpointing": True})]
        assert len(model.calls) == 1  # GET never invokes.
        assert restored.agent.state.get(STEERING_STATE_KEY)[0]["status"] == "queued"
        cursor = restored.sequence
        await second.start("u", "checkpoint", action="resume")
        await finished(restored, cursor)
        assert restored.checkpoint["position"] == "after_tools"
        assert calls == ["work"]
        assert restored.steering[0]["status"] == "queued"
        cursor = restored.sequence
        await second.start("u", "checkpoint", action="resume")
        events = await finished(restored, cursor)
        assert restored.status == "completed", events
        assert calls == ["work"]
        assert "prefer brief output" in json.dumps(model.calls[-1])
        assert "prefer brief output" not in json.dumps(restored.agent.messages)
        assert [e["id"] for e in events if e["type"] == "steering_applied"] == ["direction"]
        await second.shutdown()

    asyncio.run(scenario())


def test_native_interrupt_restart_resume_without_rerunning_model_or_tools():
    async def scenario():
        calls = []

        @tool
        async def approve() -> str:
            """Do approved work."""
            calls.append("approved")
            return "done"

        def approval(event: BeforeToolCallEvent):
            if event.tool_use["name"] == "approve":
                assert event.interrupt("approval", reason={"question": "Proceed?"}) == "yes"

        model = OfflineModel(tools=("approve",))
        factory = factory_for(model, tools=[approve], hooks=[approval])
        manager = manager_for(factory)
        session = await manager.start("u", "interrupt", "go")
        events = await finished(session)
        assert session.status == "interrupted", events
        assert calls == []
        await manager.steer("u", "interrupt", "be concise")
        with pytest.raises(RuntimeConflict, match="paused"):
            await manager.start("u", "interrupt", "new")
        with pytest.raises(ValueError, match="exactly one"):
            await manager.start("u", "interrupt", action="interrupt", interrupt_responses=[{"interruptResponse": {"interruptId": "wrong", "response": "yes"}}])
        await manager.shutdown()
        restored_manager = PanelRuntimeManager(factory=factory, storage_factory=manager.storage_factory)
        restored = await restored_manager.get("u", "interrupt")
        assert restored.status == "interrupted"
        cursor = restored.sequence
        await restored_manager.start("u", "interrupt", action="interrupt", interrupt_responses=[
            {"interruptResponse": {"interruptId": restored.interrupts[0]["id"], "response": "yes"}},
        ])
        events = await finished(restored, cursor)
        assert restored.status == "completed", events
        assert calls == ["approved"]
        assert len(model.calls) == 2
        assert "be concise" in json.dumps(model.calls[-1])
        await restored_manager.shutdown()

    asyncio.run(scenario())


def test_steering_waits_for_entire_tool_batch_and_results_are_deduplicated():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        count = 0

        @tool
        async def left() -> str:
            """First concurrent tool."""
            nonlocal count
            count += 1
            if count == 2:
                entered.set()
            await release.wait()
            return "left result"

        @tool
        async def right() -> str:
            """Second concurrent tool."""
            nonlocal count
            count += 1
            if count == 2:
                entered.set()
            await release.wait()
            return "right result"

        model = OfflineModel(tools=("left", "right"))
        manager = manager_for(factory_for(model, tools=[left, right]))
        session = await manager.start("u", "batch", "go")
        await entered.wait()
        accepted = await manager.steer("u", "batch", "change direction", steering_id="s1")
        assert accepted["status"] == "queued"
        assert await manager.steer("u", "batch", "change direction", steering_id="s1") == accepted
        assert len(model.calls) == 1
        assert session.agent.state.get(STEERING_STATE_KEY)[0]["status"] == "queued"
        release.set()
        events = await finished(session)
        results = [e for e in events if e["type"] == "tool_result"]
        assert {e["id"] for e in results} == {"call-0", "call-1"}
        assert len(results) == 2
        applied = next(e for e in events if e["type"] == "steering_applied")
        assert applied["sequence"] > max(e["sequence"] for e in results)
        assert "change direction" in json.dumps(model.calls[1])
        assert "change direction" not in json.dumps(session.agent.messages)
        await manager.shutdown()

    asyncio.run(scenario())


def test_late_steering_preserves_goal_loop_resume_content():
    async def scenario():
        validating, release = asyncio.Event(), asyncio.Event()
        attempts = 0

        async def validate(response, agent):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                validating.set()
                await release.wait()
                return {"passed": False, "feedback": "goal feedback"}
            return True

        goal = GoalLoop(goal=validate, max_attempts=2, resume_prompt_template=lambda feedback: [{"text": feedback}])
        model = OfflineModel()
        manager = manager_for(factory_for(model, plugins=[goal]))
        session = await manager.start("u", "goal", "go")
        await validating.wait()
        await manager.steer("u", "goal", "late direction")
        release.set()
        events = await finished(session)
        assert session.status == "completed", events
        assert len(model.calls) == 2
        assert "goal feedback" in json.dumps(model.calls[1])
        assert "late direction" in json.dumps(model.calls[1])
        assert len([e for e in events if e["type"] == "steering_applied"]) == 1
        await manager.shutdown()

    asyncio.run(scenario())


def test_nested_translation_ids_results_and_background_callback_threads():
    async def scenario():
        manager = manager_for(factory_for(OfflineModel()))
        session = await manager.start("u", "nested", "go")
        await session.wait()
        before = session.sequence
        use = {"toolUseId": "parent", "name": "formation", "input": {}}
        nested = {"tool_stream_event": {"tool_use": use, "data": {"formation": "team", "event": {
            "type": "multiagent_node_stream", "node_id": "graph", "event": {
                "type": "multiagent_node_stream", "node_id": "child", "event": {"data": "child text", "delta": {}}}}}}}
        await session._translate(nested)
        await session._translate({"tool_stream_event": {"tool_use": use, "data": {"type": "progress", "percent": 50}}})
        await session._translate({"event": {"contentBlockDelta": {"delta": {"text": "duplicate raw"}}}})
        result = {"toolUseId": "same-id", "status": "success", "content": [{"text": "ok"}]}
        await session._translate({"tool_result": result}, ("a",))
        await session._translate({"message": {"content": [{"toolResult": result}]}}, ("a",))
        await session._translate({"tool_result": result}, ("b",))
        session.agent.state.set("strands.background_tasks", [{"tool_use_id": "parent", "task_id": "background-1"}])
        await asyncio.to_thread(session._callback, tool_stream_event={"tool_use": use, "data": "background progress"})
        await asyncio.sleep(0)
        if session._callback_tasks:
            await asyncio.gather(*session._callback_tasks)
        events = [e async for e in session.events(before)]
        assert events[0]["node_path"] == ["parent", "team", "graph", "child"]
        assert events[0]["data"] == "child text"
        assert events[1]["type"] == "tool_progress"
        assert events[1]["data"] == {"type": "progress", "percent": 50}
        assert len([e for e in events if e["type"] == "tool_result"]) == 2
        assert len([e for e in events if e["type"] == "text_delta"]) == 1
        assert events[-1]["type"] == "background_event"
        session.agent.state.delete("strands.background_tasks")
        await manager.shutdown()

    asyncio.run(scenario())


class OverflowOnce(OfflineModel):
    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        if not self.calls:
            self.calls.append(copy.deepcopy(messages))
            raise ContextWindowOverflowException("full")
        async for event in super().stream(messages, tool_specs=tool_specs, system_prompt=system_prompt, **kwargs):
            yield event


def test_context_overflow_reopens_the_same_session():
    async def scenario():
        agents = []
        model = OverflowOnce()
        factory = factory_for(model, constructed=agents, conversation_manager=NullConversationManager())
        manager = manager_for(factory)
        session = await manager.start("u", "overflow-session", "remember this")
        events = await finished(session)
        assert session.status == "completed"
        assert events[-1]["status"] == "completed"
        assert len(agents) == 2
        assert agents[0] is not agents[1]
        assert agents[1]._session_manager is session.session_manager
        assert agents[0]._session_manager is session.session_manager
        user_texts = [
            block["text"] for message in agents[1].messages if message["role"] == "user"
            for block in message["content"] if "text" in block
        ]
        assert user_texts.count("remember this") == 1
        assert any(
            block.get("text") == "answer"
            for message in agents[1].messages if message["role"] == "assistant"
            for block in message["content"]
        )
        await manager.shutdown()

    asyncio.run(scenario())


def test_overflow_is_explicit_in_iterator_and_active_snapshot():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        manager = manager_for(factory_for(OfflineModel(entered=entered, release=release)), history_limit=2)
        session = await manager.start("u", "overflow", "go")
        await entered.wait()
        await manager.steer("u", "overflow", "one")
        await manager.steer("u", "overflow", "two")
        with pytest.raises(ReplayOverflow):
            await anext(session.events(0))
        snapshot = await session.snapshot()
        assert snapshot["history_incomplete"] is True
        assert snapshot["replay_status"] == "gap"
        assert snapshot["replay_after"] == session.sequence
        assert snapshot["input"] is None
        release.set()
        await session.wait()
        assert (await session.snapshot())["replay_after"] == session.sequence
        assert len(session._history) == 2
        await manager.shutdown()

    asyncio.run(scenario())


def test_cancel_during_startup_and_flush_before_provider_cleanup():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        order = []
        model = OfflineModel()
        async def factory(**kwargs):
            entered.set()
            await release.wait()
            agent = await factory_for(model)(**kwargs)
            agent.memory_manager = Mock(flush=AsyncMock(side_effect=lambda: order.append("flush")))
            agent.cleanup = Mock(side_effect=lambda: order.append("cleanup"))
            return agent

        manager = manager_for(factory)
        session = await manager.start("u", "cancel", "go")
        await entered.wait()
        await manager.cancel("u", "cancel")
        release.set()
        events = await finished(session)
        assert events[-1]["status"] == "cancelled"
        assert model.calls == []
        await manager.shutdown()
        assert order[:2] == ["flush", "cleanup"]
        with pytest.raises(RuntimeConflict, match="shut down"):
            await manager.start("u", "another", "go")

    asyncio.run(scenario())


def test_native_cancel_during_model_and_restart_sequence():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        model = OfflineModel(entered=entered, release=release)
        factory = factory_for(model)
        manager = manager_for(factory)
        session = await manager.start("u", "cancel-model", "go")
        await entered.wait()
        await manager.cancel("u", "cancel-model")
        release.set()
        events = await finished(session)
        assert events[-1]["stop_reason"] == "cancelled"
        cursor = session.sequence
        await manager.shutdown()
        second = PanelRuntimeManager(factory=factory, storage_factory=manager.storage_factory)
        restored = await second.get("u", "cancel-model")
        assert restored.sequence == cursor
        await second.start("u", "cancel-model", "next")
        events = await finished(restored, cursor)
        assert events[0]["sequence"] == cursor + 1
        assert restored.status == "completed"
        await second.shutdown()

    asyncio.run(scenario())


def test_native_tool_retry_discards_first_result_and_emits_final_once():
    async def scenario():
        attempts = []

        @tool
        async def flaky() -> str:
            """A tool with an application retry policy."""
            attempts.append(len(attempts) + 1)
            return f"attempt {len(attempts)}"

        def retry(event: AfterToolCallEvent):
            if len(attempts) == 1:
                event.retry = True
            else:
                event.result = {**event.result, "content": [{"text": "transformed final"}]}

        manager = manager_for(factory_for(OfflineModel(tools=("flaky",)), tools=[flaky], hooks=[retry]))
        session = await manager.start("u", "retry", "go")
        events = await finished(session)
        assert attempts == [1, 2]
        results = [e for e in events if e["type"] == "tool_result"]
        assert len(results) == 1
        assert results[0]["content"] == [{"text": "transformed final"}]
        assert len([e for e in events if e["type"] == "retry"]) == 1
        await manager.shutdown()

    asyncio.run(scenario())


def test_late_steering_without_goal_uses_native_resume():
    async def scenario():
        model = OfflineModel()
        manager = manager_for(factory_for(model))

        async def on_call(count):
            if count == 1:
                await manager.steer("u", "late", "late instruction")

        model.on_call = on_call
        session = await manager.start("u", "late", "go")
        events = await finished(session)
        assert session.status == "completed", events
        assert len(model.calls) == 2
        assert "late instruction" not in json.dumps(model.calls[0])
        assert "late instruction" in json.dumps(model.calls[1])
        assert len([e for e in events if e["type"] == "steering_applied"]) == 1
        await manager.shutdown()

    asyncio.run(scenario())


def test_native_background_stream_is_thread_safe_and_waited():
    async def scenario():
        threads = []

        @tool
        async def background_work():
            """Stream progress from the native background task runtime."""
            threads.append(threading.get_ident())
            yield {"progress": "working"}
            await asyncio.sleep(0.02)
            yield {"status": "success", "content": [{"text": "background finished"}]}

        manager = manager_for(factory_for(OfflineModel(tools=("background_work",)), tools=[background_work],
                              background_tasks={"always": ["background_work"], "wait_for_completion": True}))
        session = await manager.start("u", "background", "go")
        await asyncio.wait_for(session.wait(), 5)
        events = [e async for e in session.events()]
        assert session.status == "completed", events
        assert threads  # Native async background work is dispatched to the origin loop.
        background = [e for e in events if e["type"] == "background_event"]
        assert background
        assert "background finished" in json.dumps(background)
        assert "background finished" in json.dumps(session.agent.messages)
        assert not session.agent.state.get("strands.background_tasks")
        await manager.shutdown()

    asyncio.run(scenario())


def test_forced_shutdown_has_terminal_status_and_cleans_provider():
    async def scenario():
        entered, blocked = asyncio.Event(), asyncio.Event()
        agents = []
        manager = manager_for(factory_for(OfflineModel(entered=entered, release=blocked), constructed=agents),
                              shutdown_timeout=0.01)
        session = await manager.start("u", "shutdown", "go")
        await asyncio.wait_for(entered.wait(), 3)
        cleanup = agents[0].cleanup = Mock()
        await manager.shutdown()
        assert session.task.done()
        assert session.status == "cancelled"
        assert session.recovery_required
        cleanup.assert_called_once()
        await manager.shutdown()
        cleanup.assert_called_once()

    asyncio.run(scenario())


def test_unclean_restart_restores_committed_snapshot_not_incomplete_latest():
    async def scenario():
        manager = manager_for(factory_for(OfflineModel()))
        session = await manager.start("u", "crash", "first")
        await session.wait()
        baseline = copy.deepcopy(session.messages)
        # Simulate a crash journal and a newer, uncommitted native latest snapshot.
        session.agent.messages.append({"role": "user", "content": [{"text": "uncommitted"}]})
        await session.session_manager.save_snapshot(session.agent, is_latest=True)
        session.status = "running"
        async with session._lock:
            await session._persist()
        cursor = session.sequence
        second = PanelRuntimeManager(factory=manager.factory, storage_factory=manager.storage_factory)
        restored = await second.get("u", "crash")
        assert restored.messages == baseline
        assert restored.recovery_required
        assert restored.status == "failed"
        assert restored.sequence == cursor + 1
        with pytest.raises(RuntimeConflict, match="recovery"):
            await second.start("u", "crash", "do not repeat")
        await manager.shutdown()
        await second.shutdown()

    asyncio.run(scenario())


def test_native_background_cancel_on_shutdown():
    async def scenario():
        entered, stopped = asyncio.Event(), asyncio.Event()

        @tool
        async def slow_background() -> str:
            """Background work that must be cancelled at shutdown."""
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()
            return "unreachable"

        manager = manager_for(factory_for(OfflineModel(tools=("slow_background",)), tools=[slow_background],
                              background_tasks={"always": ["slow_background"], "wait_for_completion": True}),
                              shutdown_timeout=0.5)
        session = await manager.start("u", "background-cancel", "go")
        await asyncio.wait_for(entered.wait(), 3)
        await asyncio.wait_for(manager.shutdown(), 3)
        await asyncio.wait_for(stopped.wait(), 1)
        assert session.task.done()
        assert session.status == "cancelled"

    asyncio.run(scenario())


def test_factory_failure_is_terminal_and_releases_reservation():
    async def scenario():
        async def failure(**kwargs):
            raise ValueError("invalid provider config")

        manager = manager_for(failure)
        session = await manager.start("u", "bad-factory", "go")
        events = await finished(session)
        assert session.status == "failed"
        assert not session.active
        assert events[0]["error"]["message"] == "invalid provider config"
        assert not session.recovery_required
        manager.factory = session.factory = factory_for(OfflineModel())
        await manager.start("u", "bad-factory", "try again")
        await finished(session)
        assert session.status == "completed"
        assert (await manager.snapshot("u", "bad-factory"))["error"] is None
        await manager.shutdown()

    asyncio.run(scenario())


@pytest.mark.parametrize("failure_call", [1, 2])
def test_provider_failure_preserves_history_and_error_across_reload(failure_call):
    async def scenario():
        tool_calls = []

        @tool
        async def work() -> str:
            """Record a completed side effect."""
            tool_calls.append("done")
            return "done"

        async def fail_once(count):
            if count == failure_call:
                raise RuntimeError("503 Service Unavailable")

        model = OfflineModel(tools=("work",), on_call=fail_once)
        manager = manager_for(factory_for(model, tools=[work]))
        session = await manager.start("u", "provider-failure", "go")
        events = await finished(session)
        assert session.status == "failed"
        assert not session.recovery_required
        assert events[-2]["recovery_required"] is False
        before = await session.snapshot()
        assert "503 Service Unavailable" in before["error"]["message"]
        assert tool_calls == (["done"] if failure_call == 2 else [])
        await manager.shutdown()

        restored_manager = PanelRuntimeManager(factory=manager.factory, storage_factory=manager.storage_factory)
        restored = await restored_manager.get("u", "provider-failure")
        assert restored.messages == before["messages"]
        assert (await restored.snapshot())["error"] == before["error"]
        assert not restored.recovery_required
        await restored_manager.start("u", "provider-failure", "continue")
        await finished(restored, restored.replay_after)
        assert restored.status == "completed"
        assert (await restored.snapshot())["error"] is None
        assert tool_calls == ["done"]  # Completed tool calls were not replayed.
        await restored_manager.shutdown()

    asyncio.run(scenario())


@pytest.mark.parametrize("provider", ["mistral", "openai", "perplexity"])
@pytest.mark.parametrize("tool_count", [1, 2])
def test_browser_context_and_steering_survive_native_tool_roundtrip(monkeypatch, provider, tool_count):
    from agent.api.core.panel_agent import build_model

    monkeypatch.setenv(f"{provider.upper()}_API_KEY", "offline-test-key")
    model_ids = {"mistral": "mistral-large-latest", "openai": "gpt-5", "perplexity": "xai/grok-4.5"}
    native_model = build_model(provider, model_ids[provider])

    async def scenario():
        requests = []

        class StrictModel(OfflineModel):
            async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
                original = copy.deepcopy(messages)
                # Native serialization of the SDK ContextInjector's per-call fold.
                formatted = (native_model.format_request(messages)["messages"] if provider == "mistral"
                             else native_model._format_request_messages(messages))
                assert messages == original
                requests.append((copy.deepcopy(messages), formatted))
                async for event in super().stream(messages, tool_specs, system_prompt, **kwargs):
                    yield event

        model = StrictModel(tools=("work",) * tool_count)

        @tool
        async def work() -> str:
            """Queue steering while executing a tool."""
            await manager.steer("u", "context-order", "Be brief")
            return "done"

        manager = manager_for(factory_for(model, tools=[work]))
        session = await manager.start("u", "context-order", "go", request_context="Browser context: example.test")
        events = await finished(session)
        assert session.status == "completed", events
        assert len(requests) == 2
        # ContextInjector(trigger="everyTurn") appends ONE text block to the last user message
        # (the tool-result turn) for this call only; every tool reply is still serialized.
        internal, formatted = requests[1]
        last = internal[-1]["content"]
        assert [next(iter(block)) for block in last] == ["toolResult"] * tool_count + ["text"]
        assert last[-1]["text"].strip().startswith("Browser context: example.test\n\nBe brief")
        replies = [m for m in formatted if m.get("type", m.get("role")) in ("tool", "function_call_output")]
        assert len(replies) == tool_count
        assert "Browser context: example.test" in json.dumps(formatted)
        assert "Browser context: example.test" not in json.dumps(session.messages)
        assert all(record["status"] == "applied" for record in session.steering)
        await manager.shutdown()

    asyncio.run(scenario())


def test_context_and_steering_retry_remain_ephemeral():
    async def scenario():
        async def fail_once(count):
            if count == 2:
                raise ModelThrottledException("retry tool-result turn")

        model = OfflineModel(tools=("work",), on_call=fail_once)

        @tool
        async def work() -> str:
            """Queue direction before a retryable model call."""
            await manager.steer("u", "context-retry", "Be brief")
            return "done"

        manager = manager_for(factory_for(model, tools=[work],
            retry_strategy=ModelRetryStrategy(max_attempts=2, initial_delay=0, max_delay=0)))
        session = await manager.start("u", "context-retry", "go", request_context="Private browser context")
        events = await finished(session)
        assert session.status == "completed", events
        assert len(model.calls) == 3
        assert model.calls[1] == model.calls[2]
        assert model.calls[2][-1]["content"][-1]["text"].strip() == "Private browser context\n\nBe brief"
        assert all("toolResult" in block for block in model.calls[2][-1]["content"][:-1])
        assert len([event for event in events if event["type"] == "steering_applied"]) == 1
        assert "Private browser context" not in json.dumps(await session.snapshot())
        assert "Be brief" not in json.dumps(session.agent.messages)
        cursor = session.sequence
        await manager.start("u", "context-retry", "next")
        await finished(session, cursor)
        assert "Private browser context" not in json.dumps(model.calls[-1])
        assert "Be brief" not in json.dumps(model.calls[-1])
        await manager.shutdown()

    asyncio.run(scenario())


def test_live_result_serialization_preserves_nested_extras():
    class Answer(BaseModel):
        answer: str

    result = AgentResult(
        stop_reason="interrupt", message={"role": "assistant", "content": [{"text": "hello"}]},
        metrics=EventLoopMetrics(), state={"request": "state"},
        interrupts=[Interrupt("id", "name", {"question": "yes?"})],
        structured_output=Answer(answer="structured"),
    )
    payload = _wire(MultiAgentResult(results={"child": NodeResult(result=result)}))
    child = payload["results"]["child"]["result"]
    assert child["structured_output"] == {"answer": "structured"}
    assert child["interrupts"][0]["id"] == "id"
    assert "state" not in child
    assert "metrics" in child
    json.dumps(payload)


def test_simultaneous_same_session_start_has_one_constructor():
    async def scenario():
        agents = []
        entered, release = asyncio.Event(), asyncio.Event()
        manager = manager_for(factory_for(OfflineModel(entered=entered, release=release), constructed=agents))
        outcomes = await asyncio.gather(*(manager.start("u", "race", str(i)) for i in range(8)), return_exceptions=True)
        assert sum(isinstance(item, RuntimeConflict) for item in outcomes) == 7
        await asyncio.wait_for(entered.wait(), 3)
        assert len(agents) == 1
        release.set()
        session = next(item for item in outcomes if not isinstance(item, Exception))
        await session.wait()
        await manager.shutdown()

    asyncio.run(scenario())


def test_token_stream_never_writes_storage_and_baseline_precedes_model():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        writes = []

        class RecordingStorage(InMemoryStorage):
            async def write(self, key, data):
                writes.append((key, json.loads(data)))
                await super().write(key, data)

        storage = RecordingStorage()

        class Tokens(OfflineModel):
            async def stream(self, messages, *args, **kwargs):
                assert writes[-1][1]["status"] == "running"
                assert writes[-1][1]["snapshot_id"]
                before = len(writes)
                yield {"messageStart": {"role": "assistant"}}
                for _ in range(400):
                    yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "token "}}}
                    assert len(writes) == before
                entered.set()
                await release.wait()
                yield {"contentBlockStop": {"contentBlockIndex": 0}}
                yield {"messageStop": {"stopReason": "end_turn"}}

        manager = PanelRuntimeManager(factory=factory_for(Tokens()), storage_factory=lambda _: storage, history_limit=500)
        session = await manager.start("u", "tokens", "go")
        await asyncio.wait_for(entered.wait(), 3)
        assert len([e for e in session._history if e["type"] == "text_delta"]) == 400
        assert session._retained_bytes == sum(session._event_sizes)
        # Initial journal, immutable baseline, latest baseline, running journal.
        assert len(writes) == 4
        release.set()
        await session.wait()
        assert len(writes) == 7
        assert "immutable_history" in writes[-3][0]
        assert "snapshot_latest" in writes[-2][0]
        assert writes[-1][1]["status"] == "completed"
        await manager.shutdown()

    asyncio.run(scenario())


def test_native_model_retry_scope_and_throttle_dedup_after_successful_cycle():
    async def scenario():
        @tool
        async def work() -> str:
            """Provide a successful first cycle."""
            return "done"

        class RetryModel(OfflineModel):
            def __init__(self):
                super().__init__(tools=("work",))
                self.requests = 0

            async def stream(self, messages, *args, **kwargs):
                self.requests += 1
                if self.requests == 2:
                    yield {"messageStart": {"role": "assistant"}}
                    yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "discard draft"}}}
                    raise ModelThrottledException("offline throttle")
                async for event in super().stream(messages, *args, **kwargs):
                    if self.requests == 1 and "contentBlockStart" in event:
                        # First cycle text must never be attributed to the retried cycle.
                        yield {"contentBlockDelta": {"contentBlockIndex": 4, "delta": {"text": "retained first cycle"}}}
                        yield {"contentBlockStop": {"contentBlockIndex": 4}}
                    yield event

        model = RetryModel()
        manager = manager_for(factory_for(model, tools=[work], retry_strategy=ModelRetryStrategy(initial_delay=0)))
        session = await manager.start("u", "model-retry", "go")
        events = await finished(session)
        assert session.status == "completed", events
        retry = [event for event in events if event["type"] == "retry"]
        assert len(retry) == 1  # AfterModel + compatibility throttle are one retry.
        assert retry[0]["model_attempt"] == 1
        assert retry[0]["attempt"] == 2
        text = [event for event in events if event["type"] == "text_delta"]
        first, discarded, replacement = text
        assert first["cycle"] != discarded["cycle"]
        assert discarded["cycle"] == replacement["cycle"] == retry[0]["cycle"]
        assert discarded["model_attempt"] == 1
        assert replacement["model_attempt"] == 2
        reasoning = next(event for event in events if event["type"] == "reasoning_delta")
        assert reasoning["cycle"] == replacement["cycle"]
        assert reasoning["model_attempt"] == 2
        await manager.shutdown()

    asyncio.run(scenario())


def test_idle_steering_autostarts_once_preserving_ids_and_configuration():
    async def scenario():
        agents = []
        model = OfflineModel()
        manager = manager_for(factory_for(model, constructed=agents))
        session = await manager.start("u", "idle-steer", "go", selection={"model_id": "offline"}, options={"setting": 1})
        await session.wait()
        old_run = session.run_id
        cursor = session.sequence
        first, duplicate, second = await asyncio.gather(
            manager.steer("u", "idle-steer", "direction one", steering_id="one"),
            manager.steer("u", "idle-steer", "direction one", steering_id="one"),
            manager.steer("u", "idle-steer", "direction two", steering_id="two"),
        )
        assert first["id"] == duplicate["id"] == "one"
        assert second["id"] == "two"
        assert session.run_id != old_run
        await asyncio.wait_for(session.wait(), 3)
        assert len(model.calls) == 2
        assert len(agents) == 1
        assert session.options == {"setting": 1}
        assert "direction one" in json.dumps(model.calls[-1])
        assert "direction two" in json.dumps(model.calls[-1])
        events = [event async for event in session.events(cursor, run_id=session.run_id)]
        assert [e["id"] for e in events if e["type"] == "steering_applied"] == ["one", "two"]
        await manager.shutdown()

    asyncio.run(scenario())


def test_finishing_steering_is_admitted_after_native_stream_exits():
    async def scenario():
        model = OfflineModel()
        manager = manager_for(factory_for(model))
        session = await manager.start("u", "finish-steer", "go")
        original = session._drain_callbacks
        entered, release = asyncio.Event(), asyncio.Event()

        async def drain():
            if session.status == "finishing" and not entered.is_set():
                entered.set()
                await release.wait()
            await original()

        session._drain_callbacks = drain
        await asyncio.wait_for(entered.wait(), 3)
        old_task, old_run = session.task, session.run_id
        await manager.steer("u", "finish-steer", "finish arrival", steering_id="late")
        assert session.task is old_task
        assert len(model.calls) == 1
        release.set()
        await asyncio.wait_for(session.wait(), 3)
        assert session.run_id != old_run
        assert old_task.done()
        assert len(model.calls) == 2
        assert session.steering[0]["status"] == "applied"
        assert "finish arrival" in json.dumps(model.calls[-1])
        await manager.shutdown()

    asyncio.run(scenario())


def test_goal_background_and_queued_steering_native_combination():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        validations = []

        @tool
        async def background_work():
            """Wait for steering while executing as a native background task."""
            entered.set()
            yield {"progress": "working"}
            await release.wait()
            yield {"status": "success", "content": [{"text": "background combined done"}]}

        async def validate(response, agent):
            validations.append(response)
            return True if len(validations) > 1 else {"passed": False, "feedback": "goal correction"}

        model = OfflineModel(tools=("background_work",))
        goal = GoalLoop(goal=validate, max_attempts=3)
        manager = manager_for(factory_for(model, tools=[background_work], plugins=[goal],
                              background_tasks={"always": ["background_work"], "wait_for_completion": True}))
        session = await manager.start("u", "combined", "go")
        await asyncio.wait_for(entered.wait(), 3)
        await manager.steer("u", "combined", "queued combined direction", steering_id="combined-id")
        release.set()
        await asyncio.wait_for(session.wait(), 3)
        events = [e async for e in session.events()]
        assert session.status == "completed", events
        assert len(validations) >= 2
        assert any("goal correction" in json.dumps(call) for call in model.calls)
        assert any("queued combined direction" in json.dumps(call) for call in model.calls)
        assert len([e for e in events if e["type"] == "steering_applied"]) == 1
        assert "background combined done" in json.dumps(session.agent.messages)
        completions = [e for e in events if e["type"] == "background_event" and "tool_result" in e["event"]]
        assert len(completions) == 1
        await manager.shutdown()

    asyncio.run(scenario())


def test_checkpoint_goal_gate_leaves_late_steering_queued():
    async def scenario():
        tools_called = []

        @tool
        async def work() -> str:
            """Work behind a checkpoint."""
            tools_called.append(True)
            return "done"

        model = OfflineModel(tools=("work",))
        manager = None
        validations = 0

        async def validate(response, agent):
            nonlocal validations
            validations += 1
            if validations == 1:
                await manager.steer("u", "goal-checkpoint", "pause direction", steering_id="paused")
            return False

        goal = GoalLoop(goal=validate, max_attempts=2)
        manager = manager_for(factory_for(model, tools=[work], plugins=[goal], checkpointing=True))
        session = await manager.start("u", "goal-checkpoint", "go")
        await asyncio.wait_for(session.wait(), 3)
        assert session.status == "checkpointed"
        assert session.checkpoint["position"] == "after_model"
        assert session.steering[0]["status"] == "queued"
        assert len(model.calls) == 1
        assert tools_called == []
        await manager.start("u", "goal-checkpoint", action="resume")
        await asyncio.wait_for(session.wait(), 3)
        assert session.checkpoint["position"] == "after_tools"
        assert session.steering[0]["status"] == "queued"
        assert tools_called == [True]
        await manager.shutdown()

    asyncio.run(scenario())


def test_foreground_tool_task_callbacks_are_not_background_duplicates():
    async def scenario():
        @tool
        async def progress():
            """Stream identical foreground progress chunks."""
            for _ in range(2):
                yield {"progress": "same"}
            yield {"status": "success", "content": [{"text": "finished"}]}

        manager = manager_for(factory_for(OfflineModel(tools=("progress",)), tools=[progress]))
        session = await manager.start("u", "foreground-callback", "go")
        events = await finished(session)
        assert not any(e["type"] == "background_event" for e in events)
        assert len([e for e in events if e["type"] == "tool_progress" and e["data"] == {"progress": "same"}]) == 2
        assert len([e for e in events if e["type"] == "tool_result"]) == 1
        cursor = session.sequence
        use = {"toolUseId": "call-0", "name": "progress", "input": {}}
        # Explicit callbacks from separate tasks/threads must also be ignored.
        await asyncio.to_thread(session._callback, tool_stream_event={"tool_use": use, "data": "duplicate"})
        await session._drain_callbacks()
        assert session.sequence == cursor
        await manager.shutdown()

    asyncio.run(scenario())


def test_overflow_snapshot_can_attach_and_recover_canonical_completed_text():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        class ManyTokens(OfflineModel):
            async def stream(self, messages, *args, **kwargs):
                yield {"messageStart": {"role": "assistant"}}
                for _ in range(30):
                    yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "a"}}}
                entered.set()
                await release.wait()
                yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "last"}}}
                yield {"contentBlockStop": {"contentBlockIndex": 0}}
                yield {"messageStop": {"stopReason": "end_turn"}}

        manager = manager_for(factory_for(ManyTokens()), history_limit=4)
        session = await manager.start("u", "overflow-attach", "go")
        await asyncio.wait_for(entered.wait(), 3)
        snapshot = await manager.snapshot("u", "overflow-attach")
        assert snapshot["replay_status"] == "gap"
        assert snapshot["history_incomplete"]
        assert snapshot["messages"][0]["content"] == [{"text": "go"}]
        assert "a" * 30 not in json.dumps(snapshot["messages"])

        async def attach():
            return [e async for e in session.events(snapshot["replay_after"], run_id=session.run_id)]

        reader = asyncio.create_task(attach())
        await asyncio.sleep(0)
        release.set()
        events = await asyncio.wait_for(reader, 3)
        assert events[0]["type"] == "text_delta" and events[0]["data"] == "last"
        assert events[-1]["type"] == "run_finished"
        await session.wait()
        canonical = await session.snapshot()
        assert not canonical["history_incomplete"]
        assert "a" * 30 + "last" in json.dumps(canonical["messages"])
        await manager.shutdown()

    asyncio.run(scenario())


def test_per_tool_completion_arrives_before_sibling_and_has_no_callback_duplicate():
    async def scenario():
        waiting, release = asyncio.Event(), asyncio.Event()

        @tool
        async def fast() -> str:
            """Finish before the sibling tool."""
            return "fast result"

        @tool
        async def slow() -> str:
            """Hold the tool batch open."""
            waiting.set()
            await release.wait()
            return "slow result"

        manager = manager_for(factory_for(OfflineModel(tools=("fast", "slow")), tools=[fast, slow]))
        session = await manager.start("u", "individual-results", "go")
        await asyncio.wait_for(waiting.wait(), 3)

        async def until_fast():
            async for event in session.events(run_id=session.run_id):
                if event["type"] == "tool_result" and event["id"] == "call-0":
                    return event

        result = await asyncio.wait_for(until_fast(), 3)
        assert result["content"] == [{"text": "fast result"}]
        assert session.active
        assert not any(e["type"] == "tool_result" and e["id"] == "call-1" for e in session._history)
        release.set()
        events = await finished(session)
        assert len([e for e in events if e["type"] == "tool_result"]) == 2
        assert not any(e["type"] == "background_event" for e in events)
        await manager.shutdown()

    asyncio.run(scenario())


def test_perplexity_native_tool_events_reach_the_sse_stream():
    """Server-side Agent API tool items ({"perplexity": ...} and {"xai": ...} model chunks) become `native_tool` envelopes."""
    sandbox = {"type": "response.output_item.done", "item": {"type": "sandbox_results", "call_id": "sb1", "code": "print(1)",
               "status": "completed", "results": [{"stdout": "1\n", "stderr": "", "exit_code": 0}]}}
    reasoning = {"type": "response.reasoning.search_web", "queries": ["q"]}
    xai_search = {"type": "response.output_item.done", "provider": "xai", "item": {"type": "x_search_results", "call_id": "xai-x-search",
                  "status": "completed", "queries": ["Starship"], "results": [{"url": "https://x.com/elonmusk/status/1", "title": "@elonmusk · 1", "source": "x"}]}}

    class NativeModel(OfflineModel):
        async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
            yield {"messageStart": {"role": "assistant"}}
            yield {"perplexity": reasoning}
            yield {"perplexity": sandbox}
            yield {"xai": xai_search}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "done"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}

    async def scenario():
        manager = manager_for(factory_for(NativeModel()))
        session = await manager.start("u", "native", "go")
        events = await finished(session)
        assert session.status == "completed", events
        native = [e for e in events if e["type"] == "native_tool"]
        assert [n["event"] for n in native] == ["response.reasoning.search_web", "response.output_item.done", "response.output_item.done"]
        assert native[0]["item_type"] is None and native[0]["payload"] == reasoning
        assert native[1]["item_type"] == "sandbox_results"
        assert native[1]["payload"]["item"]["results"][0]["stdout"] == "1\n"
        assert native[2]["item_type"] == "x_search_results"
        assert native[2]["payload"]["item"]["results"][0]["url"] == "https://x.com/elonmusk/status/1"
        assert all(n["node_path"] == [] for n in native)
        # Never persisted into the agent's message history.
        assert "sandbox_results" not in json.dumps(session.messages)
        assert "x_search_results" not in json.dumps(session.messages)
        await manager.shutdown()

    asyncio.run(scenario())


def _respawn_factory(models, agents, tools=()):
    """A factory that hands out models[i] in construction order and records the agents."""
    async def factory(*, user_id, session_id, selection, options, runtime_options):
        agent = await asyncio.to_thread(Agent, model=models[len(agents)],
                                        tools=list(tools), **runtime_options)
        agents.append(agent)
        return agent
    return factory


async def _until(predicate, timeout=20.0):
    """Poll until predicate holds; the watchdog acts asynchronously of run completion."""
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "expected condition was not reached"
        await asyncio.sleep(0.05)


def test_stall_watchdog_respawns_fresh_agent_on_same_session():
    async def scenario():
        agents = []
        wedged = OfflineModel(release=asyncio.Event())  # never releases: silent stream
        healthy = OfflineModel()
        manager = manager_for(_respawn_factory([wedged, healthy], agents),
                              stall_seconds=1.0, tool_stall_seconds=1.0, max_recoveries=2)
        session = await manager.start("u", "s", "do the research", selection={"model_id": "offline"})
        await _until(lambda: session.status == "completed")
        assert session.recovery_required is False
        # A fresh agent instance was constructed on the same session.
        assert len(agents) == 2 and agents[0] is not agents[1]
        # The wedged run failed with the stall reason; the recovery run restates the request.
        events = [event async for event in session.events(0)]
        errors = [e for e in events if e["type"] == "error"]
        assert len(errors) == 1 and "Run stalled" in str(errors[0]["error"]), errors
        assert "[recovery]" in session.input and "do the research" in session.input
        # The completed recovery run resets the consecutive-stall budget.
        assert session._recoveries == 0
        await manager.shutdown()

    asyncio.run(scenario())


def test_stall_recovery_budget_exhausts_to_recovery_required():
    async def scenario():
        agents = []
        wedged = [OfflineModel(release=asyncio.Event()) for _ in range(3)]
        manager = manager_for(_respawn_factory(wedged, agents),
                              stall_seconds=0.5, tool_stall_seconds=0.5, max_recoveries=2)
        session = await manager.start("u", "s", "hang forever", selection={"model_id": "offline"})
        await _until(lambda: session.recovery_required and not session.active)
        # Initial run plus two respawns; the third stall is left failed.
        assert len(agents) == 3
        assert session.status in ("failed", "cancelled")
        with pytest.raises(RuntimeConflict, match="recovery"):
            await manager.start("u", "s", "try again")
        await manager.shutdown()

    asyncio.run(scenario())


def test_stall_watchdog_disabled_leaves_run_alone():
    async def scenario():
        agents = []
        wedged = OfflineModel(release=asyncio.Event())
        manager = manager_for(_respawn_factory([wedged], agents),
                              stall_seconds=0.0, shutdown_timeout=0.5)
        session = await manager.start("u", "s", "hang", selection={"model_id": "offline"})
        await asyncio.sleep(1.5)
        assert session.active and session.status == "running"
        assert len(agents) == 1
        await manager.shutdown()  # close() force-cancels the wedged run
        assert session.recovery_required is True

    asyncio.run(scenario())


def test_no_recovery_while_events_flow_or_tool_in_flight():
    async def scenario():
        @tool
        def slow_probe() -> str:
            time.sleep(2.5)
            return "ok"

        agents = []
        model = OfflineModel(tools=("slow_probe",))
        manager = manager_for(_respawn_factory([model], agents, tools=(slow_probe,)),
                              stall_seconds=1.0, tool_stall_seconds=10.0, max_recoveries=2)
        session = await manager.start("u", "s", "run the probe", selection={"model_id": "offline"})
        await _until(lambda: session.status == "completed")
        assert len(agents) == 1 and session.recovery_required is False
        events = [event async for event in session.events(0)]
        assert not [e for e in events if e["type"] == "error"]
        await manager.shutdown()

    asyncio.run(scenario())
