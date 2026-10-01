"""Offline HTTP -> composition root -> native Strands 1.56 -> SSE integration.

Only model construction and the external shell provider are replaced. Storage,
memory, agent construction, hooks, retry, interrupts and runtime ownership are
real. Run with PYTHON_DOTENV_DISABLED=1 to also isolate collection of other tests.
"""

import asyncio
import copy
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import httpx
import pytest
from strands import tool
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.models.model import Model
from strands.storage import InMemoryStorage
from strands.types.exceptions import ModelThrottledException


@dataclass
class Script:
    uses: list = field(default_factory=lambda: [("offline_shell", {"value": "payload"})])
    models: list = field(default_factory=list)
    shell_builds: list = field(default_factory=list)
    executions: list = field(default_factory=list)
    throttle: bool = False
    failure: str | None = None
    tool_failure: bool = False
    entered: asyncio.Event | None = None
    release: asyncio.Event | None = None


class PanelModel(Model):
    """Native model events, including partial output followed by a real SDK retry.

    Like the existing OfflineModels, tool results drive the next model cycle.
    Inspect tool specs to distinguish the real root from its think/review children;
    this also proves memory and catalog tools reached the model unchanged.
    """

    def __init__(self, script):
        self.script = script
        self.calls = []

    def get_config(self):
        return {"model_id": "offline-panel", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls.append({"messages": copy.deepcopy(messages), "tools": copy.deepcopy(tool_specs)})
        root = any(spec["name"] == "ask_user" for spec in tool_specs or [])
        script = self.script
        if root and script.entered is not None:
            script.entered.set()
            await script.release.wait()
        if root and script.failure:
            raise RuntimeError(script.failure)
        yield {"messageStart": {"role": "assistant"}}
        if root and script.throttle and len(self.calls) == 2:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "discard draft"}}}
            raise ModelThrottledException("offline throttle")
        results = [b["toolResult"] for m in messages for b in m["content"] if "toolResult" in b]
        uses = script.uses if root and not results else []
        if uses:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "retained first cycle"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            for index, (name, inputs) in enumerate(uses, 1):
                yield {"contentBlockStart": {"contentBlockIndex": index,
                    "start": {"toolUse": {"toolUseId": f"use-{index}", "name": name}}}}
                yield {"contentBlockDelta": {"contentBlockIndex": index,
                    "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
                yield {"contentBlockStop": {"contentBlockIndex": index}}
        else:
            yield {"contentBlockDelta": {"contentBlockIndex": 0,
                "delta": {"reasoningContent": {"text": "offline reasoning"}}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"contentBlockDelta": {"contentBlockIndex": 1,
                "delta": {"text": "root answer" if root else "child answer"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 1}}
        yield {"messageStop": {"stopReason": "tool_use" if uses else "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 3, "outputTokens": 2, "totalTokens": 5},
                            "metrics": {"latencyMs": 1}}}


class MemoryChainModel(Model):
    """The memory agent's candidate: ends every recall with inject_memory("n/a")."""

    def get_config(self):
        return {"model_id": "offline-memory", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": "recall-na", "name": "inject_memory"}}}}
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps({"content": "n/a"})}}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "tool_use"}}


@pytest.fixture
def offline(monkeypatch, tmp_path):
    # No dotenv, real MCP configuration, saved credentials, skill config or disk
    # sessions. These are configuration/data isolation, not runtime mocks.
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "offline-not-a-credential")
    from agent.api.core import config as app_config
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "offline-not-a-credential")
    monkeypatch.setenv("PANEL_STORAGE", "memory")
    monkeypatch.setenv("PANEL_A2A_ENABLED", "false")
    monkeypatch.setenv("PANEL_RETRY_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("PANEL_RETRY_INITIAL_DELAY", "0")
    monkeypatch.setenv("PANEL_RETRY_MAX_DELAY", "0")
    for name in ("PANEL_SKILLS_DIR", "PANEL_SKILLS_DIRS", "PANEL_SKILL_TOOLS", "PANEL_FORMATIONS_FILE"):
        monkeypatch.delenv(name, raising=False)

    from agent.api import main
    from agent.api.core import panel_agent, panel_storage
    from agent.api.endpoints import chat

    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    monkeypatch.setattr(panel_agent, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(main, "SESSION_STORAGE_DIR", tmp_path)
    script = Script()

    def build_model(*args, hosted_tools=True):
        assert args[0] in ("openai", "perplexity")
        if args[1:] != ("offline-panel", None):
            # The shared Memory Agent's fast-model chain (memory_agent.build_model):
            # a quiet model that always declines to inject.
            return MemoryChainModel()
        model = PanelModel(script)
        script.models.append(model)
        return model


    def build_shell():
        @tool
        async def offline_shell(value: str):
            """Stream offline work without a subprocess or network access."""
            script.executions.append(value)
            yield {"progress": "working", "value": value}
            await asyncio.sleep(0)  # Exercise native foreground callback scheduling.
            if script.tool_failure:
                raise ValueError("offline tool failed")
            yield {"status": "success", "content": [{"text": f"done: {value}"}]}

        script.shell_builds.append(offline_shell)
        return offline_shell

    monkeypatch.setattr(panel_agent, "build_model", build_model)
    # Real create_panel_agent (core tools, tool_catalog, think for perplexity...)
    # plus the injected offline tool the scripted model calls. No subprocesses.
    native_create = chat.create_panel_agent

    def create_with_offline_tool(**kwargs):
        kwargs["extra_tools"] = [*kwargs.get("extra_tools", []), build_shell()]
        return native_create(**kwargs)

    monkeypatch.setattr(chat, "create_panel_agent", create_with_offline_tool)

    @asynccontextmanager
    async def connect():
        # Re-entering the actual lifespan constructs a NEW manager and restores
        # the same native storage, exercising reload without patching any factory.
        async with main.app.router.lifespan_context(main.app):
            manager = main.app.state.panel_runtime
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                         base_url="http://offline") as client:
                yield client, manager
        assert manager._closed

    return script, connect


def request(session="e2e", provider="openai", **kwargs):
    return {"session_id": session, "user_id": "alice", "provider": provider, "model": "offline-panel",
            "message": "do offline work", "options": {"context": "sliding"}, **kwargs}


def sse(response, *, status="completed"):
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    events = []
    for frame in response.text.strip().split("\n\n"):
        identifier, data = frame.splitlines()
        event = json.loads(data.removeprefix("data: "))
        assert identifier == f"id: {event['sequence']}"
        assert event["version"] == 1
        assert isinstance(event["session_id"], str) and isinstance(event["run_id"], str)
        assert isinstance(event["node_path"], list)
        # UI gets protocol envelopes, never raw live SDK invocation objects.
        assert not {"agent", "model", "invocation_state", "request_state", "callback_handler"} & event.keys()
        events.append(event)
    assert events[0]["type"] == "run_started"
    assert events[-1]["type"] == "run_finished"
    assert events[-1]["status"] == status, events
    assert sum(e["type"] == "run_finished" for e in events) == 1
    assert len({e["run_id"] for e in events}) == 1
    assert [e["sequence"] for e in events] == list(range(events[0]["sequence"], events[-1]["sequence"] + 1))
    return events


async def snapshot(client, session="e2e"):
    response = await client.get(f"/sessions/{session}", params={"user_id": "alice"})
    assert response.status_code == 200, response.text
    return response.json()


def of_type(events, kind):
    return [event for event in events if event["type"] == kind]


@pytest.mark.parametrize("background", [False, True])
def test_message_foreground_progress_results_and_reload(offline, background):
    script, connect = offline

    async def scenario():
        async with connect() as (client, manager):
            body = request(options={"context": "sliding", "background": background},
                           browser_context={"url": "https://offline.invalid/first"})
            events = sse(await client.post("/chat", json=body))
            session = await manager.get("alice", "e2e")
            agent = session.agent
            assert agent.memory_manager is not None
            assert isinstance(agent.conversation_manager, SlidingWindowConversationManager)
            assert agent._session_manager is session.session_manager  # SDK 1.56 has no public accessor.
            assert len(script.models) == 1  # No long-lived children; think/formations build per call.
            assert len(script.shell_builds) == 1
            assert script.executions == ["payload"]
            names = {spec["name"] for spec in agent.model.calls[0]["tools"]}
            assert {"offline_shell", "ask_user", "add_memory", "search_memory", "tool_catalog",
                    "mcp_client", "editor", "shell", "environment", "http_request", "perplexity_search"} <= names
            assert "think" not in names and "review" not in names  # think is Perplexity-only
            assert "https://offline.invalid/first" in json.dumps(agent.model.calls[0]["messages"])
            inputs = of_type(events, "tool_input")
            assert inputs[-1]["input"] == {"value": "payload"}
            progress = of_type(events, "tool_progress")
            # The decorator can also stream its final yield as progress; the work
            # update itself must appear exactly once, never as background activity.
            work = [e for e in progress if e["data"].get("progress") == "working"]
            assert len(work) == 1
            result, = of_type(events, "tool_result")
            assert result["content"] == [{"text": "done: payload"}]
            assert result["status"] == "success"
            assert result["id"] == work[0]["id"] == inputs[-1]["id"] == "use-1"
            assert result["name"] == work[0]["name"] == "offline_shell"
            assert result["node_path"] == work[0]["node_path"] == []
            assert work[0]["sequence"] < result["sequence"] < events[-1]["sequence"]
            assert not of_type(events, "background_event")
            assert not of_type(events, "error")
            assert events[-1]["result"]["metrics"]["accumulated_usage"]["totalTokens"] == 10
            assert events[-1]["result"]["structured_output"] is None
            assert "state" not in events[-1]["result"]
            before = await snapshot(client)
            assert before["status"] == "completed" and not before["active"]
            assert before["replay_after"] == before["sequence"] == events[-1]["sequence"]
            assert before["result"] == events[-1]["result"]
            assert before["input"] is None and not before["recovery_required"]
            assert (await client.get("/sessions/e2e?user_id=bob")).status_code == 404

        async with connect() as (client, restored_manager):
            after = await snapshot(client)
            assert after == before
            restored = await restored_manager.get("alice", "e2e")
            assert restored.agent is not agent
            assert restored.agent.messages == agent.messages
            assert len(script.models) == 2 and not script.models[1].calls  # reload built a fresh root only
            assert sse(await client.get("/sessions/e2e/events?user_id=alice&after=0")) == events
            second = sse(await client.post("/chat", json=request(message="follow up", options=body["options"])))
            assert second[0]["sequence"] == events[-1]["sequence"] + 1
            assert second[0]["run_id"] != events[0]["run_id"]
            assert script.executions == ["payload"]
            assert len(script.models) == 2 and len(script.shell_builds) == 2
            replay = await client.get("/sessions/e2e/events?user_id=alice",
                                      headers={"Last-Event-ID": str(events[-1]["sequence"])})
            assert sse(replay) == second

    asyncio.run(scenario())


def test_checkpoint_resume_survives_manager_reload_without_repeating_tool(offline):
    script, connect = offline

    async def scenario():
        body = request(options={"context": "sliding", "checkpointing": True})
        async with connect() as (client, _):
            first = sse(await client.post("/chat", json=body), status="checkpointed")
            paused = await snapshot(client)
            checkpoint, = of_type(first, "checkpoint")
            assert checkpoint["checkpoint"] == paused["checkpoint"] == first[-1]["result"]["checkpoint"]
            assert script.executions == []
            assert (await client.post("/chat", json=body)).status_code == 409

        async with connect() as (client, _):
            assert await snapshot(client) == paused
            assert all(not model.calls for model in script.models[3:])
            resume = {**body, "message": "", "action": "checkpoint_resume"}
            second = sse(await client.post("/chat", json=resume), status="checkpointed")
            assert script.executions == ["payload"]
            assert len(of_type(second, "tool_result")) == 1
            paused_after_tool = await snapshot(client)

        async with connect() as (client, _):
            assert await snapshot(client) == paused_after_tool
            third = sse(await client.post("/chat", json=resume))
            assert script.executions == ["payload"]
            assert not of_type(third, "tool_result")
            assert (await snapshot(client))["checkpoint"] is None
            assert second[0]["sequence"] == first[-1]["sequence"] + 1
            assert third[0]["sequence"] == second[-1]["sequence"] + 1

    asyncio.run(scenario())


def test_actual_ask_user_interrupt_round_trip_and_reload(offline):
    script, connect = offline
    script.uses = [("ask_user", {"question": "Which option?"})]

    async def scenario():
        async with connect() as (client, _):
            events = sse(await client.post("/chat", json=request()), status="interrupted")
            paused = await snapshot(client)
            interrupt_event, = of_type(events, "interrupt")
            assert interrupt_event["interrupts"] == paused["interrupts"] == events[-1]["result"]["interrupts"]
            interrupt, = paused["interrupts"]
            assert interrupt["name"] == "ask_user" and interrupt["reason"] == {"question": "Which option?"}
            assert isinstance(interrupt["id"], str)
            assert not of_type(events, "tool_result")

        async with connect() as (client, manager):
            assert await snapshot(client) == paused
            resume = request(message="", action="interrupt_response", interrupt_responses=[
                {"interruptId": interrupt["id"], "response": {"choice": "A"}}])
            bad = {**resume, "interrupt_responses": [{"interruptId": "wrong", "response": "A"}]}
            assert (await client.post("/chat", json=bad)).status_code == 422
            assert await snapshot(client) == paused
            resumed = sse(await client.post("/chat", json=resume))
            result, = of_type(resumed, "tool_result")
            assert result["name"] == "ask_user" and result["status"] == "success"
            assert "A" in json.dumps(result["content"])
            session = await manager.get("alice", "e2e")
            assert len(session.agent.model.calls) == 1  # Restored tool use, no repeat model request.
            done = await snapshot(client)
            assert done["interrupts"] == [] and done["checkpoint"] is None
            assert not of_type(resumed, "interrupt") and not script.executions

    asyncio.run(scenario())


def test_simultaneous_http_requests_reserve_one_real_agent(offline):
    script, connect = offline

    async def scenario():
        script.entered, script.release = asyncio.Event(), asyncio.Event()
        async with connect() as (client, manager):
            sends = [asyncio.create_task(client.post("/chat", json=request(message=f"request {i}"))) for i in range(6)]
            try:
                await asyncio.wait_for(script.entered.wait(), 5)
                # Five losers finish while the admitted model remains blocked.
                completed = set()
                while len(completed) < 5:
                    done, _ = await asyncio.wait(set(sends) - completed, timeout=5,
                                                 return_when=asyncio.FIRST_COMPLETED)
                    assert done, "Conflicting request waited for the running model"
                    completed.update(done)
                assert all(task.result().status_code == 409 for task in completed)
                live = await snapshot(client)
                assert live["active"] and live["status"] == "running"
                assert live["messages"] == [] and live["input"].startswith("request ")
                assert live["replay_after"] == 0
                assert len(script.models) == 1 and len(script.shell_builds) == 1
            finally:
                script.release.set()
                responses = await asyncio.wait_for(asyncio.gather(*sends), 5)
            winner, = [response for response in responses if response.status_code == 200]
            events = sse(winner)
            assert script.executions == ["payload"]
            session = await manager.get("alice", "e2e")
            assert session.task.done()
            assert (await snapshot(client))["sequence"] == events[-1]["sequence"]
            # Immediate next request must not conflict with a finishing task.
            sse(await client.post("/chat", json=request(message="next turn")))
            assert len(script.shell_builds) == 1

    asyncio.run(scenario())


def test_root_retry_scope_retains_previous_cycle_and_child_output(offline):
    """Perplexity config: `think` runs a child agent (fresh model, parent's tools);
    its streamed events arrive under node_path=[<think toolUseId>] with no root
    retry/cycle scoping, while the root retry is scoped to the root only."""
    script, connect = offline
    script.throttle = True
    script.uses.append(("think", {"thought": "reason offline"}))

    async def scenario():
        async with connect() as (client, manager):
            events = sse(await client.post("/chat", json=request(provider="perplexity")))
            retry, = of_type(events, "retry")  # Native hook + compatibility throttle deduplicated.
            assert retry["node_path"] == [] and retry["model_attempt"] == 1 and retry["attempt"] == 2
            assert "id" not in retry
            root = [e for e in of_type(events, "text_delta") if not e["node_path"]]
            first, discarded, replacement = root
            assert [e["data"] for e in root] == ["retained first cycle", "discard draft", "root answer"]
            assert first["cycle"] != discarded["cycle"]
            assert discarded["cycle"] == replacement["cycle"] == retry["cycle"]
            assert discarded["model_attempt"] == 1 and replacement["model_attempt"] == 2
            child = [e for e in of_type(events, "text_delta") if e["node_path"]]
            assert child and all(e["node_path"] == ["use-2"] for e in child)
            assert all("model_attempt" not in e and "cycle" not in e for e in child)
            reasoning = [e for e in of_type(events, "reasoning_delta") if not e["node_path"]]
            assert reasoning and reasoning[0]["cycle"] == retry["cycle"]
            assert reasoning[0]["model_attempt"] == 2
            assert script.executions == ["payload"]
            assert not of_type(events, "background_event")
            session = await manager.get("alice", "e2e")
            assert len(session.agent.model.calls) == 3
            assert "discard draft" not in json.dumps((await snapshot(client))["messages"])

    asyncio.run(scenario())


@pytest.mark.parametrize("formation,children", [
    ("research_review", 2), ("reasoning_swarm", 1), ("nested_research_review", 3),
])
def test_live_native_formation_results_serialize_through_http(offline, formation, children):
    script, connect = offline
    script.uses = [(formation, {"prompt": "analyze offline"})]

    async def scenario():
        async with connect() as (client, _):
            events = sse(await client.post("/chat", json=request()))
            result, = [e for e in of_type(events, "tool_result") if not e["node_path"]]
            assert result["name"] == formation and result["status"] == "success", result
            payload = result["content"][0]["json"]
            assert payload["error"] is None
            assert payload["result"]["type"] == "multiagent_result"
            assert of_type(events, "node_event")
            child_text = [e for e in of_type(events, "text_delta") if e["node_path"]]
            assert len(child_text) == children
            assert all(e["node_path"][:2] == ["use-1", formation] for e in child_text)
            assert all(e["data"] == "child answer" for e in child_text)
            assert not of_type(events, "error") and not of_type(events, "background_event")
            assert sum(len(model.calls) for model in script.models) == 2 + children
            saved = await snapshot(client)
            assert saved["result"] == events[-1]["result"]
            assert "multiagent_result" in json.dumps(saved["messages"])

        async with connect() as (client, _):
            assert await snapshot(client) == saved
            assert sse(await client.get("/sessions/e2e/events?user_id=alice&after=0")) == events

    asyncio.run(scenario())


@pytest.mark.parametrize("tool_error", [False, True])
def test_native_failures_are_json_events_and_terminal_snapshots(offline, tool_error):
    script, connect = offline
    script.tool_failure = tool_error
    script.failure = None if tool_error else "offline model failed"

    async def scenario():
        async with connect() as (client, manager):
            events = sse(await client.post("/chat", json=request()), status="completed" if tool_error else "error")
            before = await snapshot(client)
            session = await manager.get("alice", "e2e")
            assert session.task.done() and session.task.exception() is None
            assert not before["active"]
            if tool_error:
                result, = of_type(events, "tool_result")
                assert result["status"] == "error" and "offline tool failed" in json.dumps(result["content"])
                assert not of_type(events, "error") and not before["recovery_required"]
            else:
                error, = of_type(events, "error")
                assert error["error"] == {"type": "RuntimeError", "message": "offline model failed"}
                assert error["sequence"] + 1 == events[-1]["sequence"]
                assert events[-1]["stop_reason"] == "error"
                assert before["status"] == "error" and not before["recovery_required"]
                assert before["error"] == error["error"]

        async with connect() as (client, _):
            assert await snapshot(client) == before
            assert all(not model.calls for model in script.models[3:])
            if not tool_error:
                script.failure = None
                sse(await client.post("/chat", json=request()), status="completed")
                assert (await snapshot(client))["error"] is None

    asyncio.run(scenario())
