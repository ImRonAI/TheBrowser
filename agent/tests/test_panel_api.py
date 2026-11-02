"""Offline HTTP integration using real native agents, storage and runtime tasks."""

import asyncio
import copy
import json
import threading
from contextlib import asynccontextmanager
from unittest.mock import Mock

import httpx
import pytest
from strands import Agent, tool
from strands.hooks.events import BeforeToolCallEvent
from strands.models.model import Model
from strands.storage import InMemoryStorage

from agent.api.endpoints import chat
from agent.api.main import app
from agent.api.core.panel_runtime import PanelRuntimeManager


class OfflineModel(Model):
    def __init__(self, *, tool_name=None, entered=None, release=None, fail=False):
        self.tool_name = tool_name
        self.entered, self.release, self.fail = entered, release, fail
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
        if self.fail:
            raise RuntimeError("offline model failed")
        use_tool = self.tool_name and not any("toolResult" in b for m in messages for b in m["content"])
        yield {"messageStart": {"role": "assistant"}}
        if use_tool:
            yield {"contentBlockStart": {"contentBlockIndex": 0,
                   "start": {"toolUse": {"toolUseId": "work-id", "name": self.tool_name}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": "{}"}}}}
        else:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "offline answer"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "tool_use" if use_tool else "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 2, "totalTokens": 3},
                            "metrics": {"latencyMs": 1}}}


def events(response):
    assert response.status_code == 200, response.text
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


@pytest.mark.parametrize('destination', ['panel', 'search', 'build'])
@pytest.mark.parametrize('explicit_selection', [True, False])
def test_article_reaches_native_model_and_restored_history(monkeypatch, destination, explicit_selection):
    from agent.api.core.articles import ARTICLE_PREFIX

    async def scenario():
        model = OfflineModel()
        article = {'id': 'article-1', 'title': 'Reference', 'url': 'https://example.com/story',
                   'source': 'example.com', 'text': 'Important content beyond the headline.', 'status': 'extracted'}
        async with offline_api(monkeypatch, model=model) as (client, manager, builds, agents, shell, threads):
            monkeypatch.setattr(chat, 'infer_provider', lambda _: 'openai')
            monkeypatch.setattr(chat, 'provider_default_model', lambda _: 'offline')
            response = await client.post('/chat', json={'session_id': f'article-{destination}',
                **({'provider': 'openai', 'model': 'offline'} if explicit_selection else {}),
                'message': 'Compare this evidence.', 'destination': destination, 'attachments': [article]})
            events(response)
            await manager.get('default', f'article-{destination}')
            blocks = model.calls[0][0]['content']
            assert blocks[0]['text'] == 'Compare this evidence.'
            assert json.loads(blocks[1]['text'][len(ARTICLE_PREFIX):]) == article
            snapshot = (await client.get(f'/sessions/article-{destination}')).json()
            assert snapshot['selection']['provider'] == 'openai'
            assert snapshot['selection']['model_id'] == 'offline'
            assert snapshot['messages'][0]['content'] == blocks
            if destination != 'panel':
                assert f'You are {destination.title()} Agent.' in builds[0]['system_prompt']
            wrong = await client.post('/chat', json={'session_id': f'article-{destination}', 'provider': 'openai',
                'message': 'Wrong destination', 'destination': 'build' if destination != 'build' else 'search'})
            assert wrong.status_code == 409
    asyncio.run(scenario())


@asynccontextmanager
async def offline_api(monkeypatch, *, model=None, tools=(), hooks=(), history_limit=2048):
    model = model or OfflineModel()
    builds, agents, threads = [], [], []
    shell = Mock(return_value=object())

    def construct(**kwargs):
        builds.append(kwargs)
        threads.append(threading.get_ident())
        runtime_options = kwargs["runtime_options"]
        agent = Agent(
            model=model, tools=list(tools), checkpointing=kwargs["options"]["checkpointing"],
            **{**runtime_options, "hooks": [*runtime_options["hooks"], *hooks]},
        )
        agents.append(agent)
        return agent

    users = {}
    manager = PanelRuntimeManager(factory=chat._create_runtime_agent,
                                  storage_factory=lambda user: users.setdefault(user, InMemoryStorage()),
                                  history_limit=history_limit, shutdown_timeout=0.05)
    monkeypatch.setattr(chat, "create_panel_agent", construct)
    monkeypatch.setattr(chat, "provider_api_key", lambda _: "offline-key-guard")
    monkeypatch.setattr(chat, "configured_providers", lambda: ["openai"])
    monkeypatch.setattr(chat, "create_runtime_manager", lambda: manager)
    monkeypatch.delenv("PANEL_A2A_ENABLED", raising=False)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            yield client, manager, builds, agents, shell, threads


def test_native_chat_snapshot_replay_context_and_configuration(monkeypatch):
    async def scenario():
        model = OfflineModel()
        async with offline_api(monkeypatch, model=model) as (client, manager, builds, agents, shell, threads):
            body = {"session_id": "chat", "user_id": "alice", "message": "first", "provider": "openai",
                    "model": "offline", "reasoning_effort": None, "browser_context": {"url": "https://first.test"}}
            first = events(await client.post("/chat", json=body))
            assert first[0]["type"] == "run_started"
            assert first[-1]["type"] == "run_finished"
            assert first[-1]["status"] == "completed", first
            assert first[-1]["result"]["metrics"]["accumulated_usage"]["totalTokens"] == 3
            snap = (await client.get("/sessions/chat?user_id=alice")).json()
            assert snap["status"] == "completed"
            assert snap["replay_after"] == snap["sequence"]
            assert snap["input"] is None
            assert snap["selection"] == {"provider": "openai", "model_id": "offline", "reasoning_effort": None, "browser": "user"}
            # Browser context reaches the MODEL (ephemeral input middleware) but never
            # message history: the persisted/hydrated user turn is just the user's text.
            assert "https://first.test" in json.dumps(model.calls[0])
            assert [b["text"] for m in snap["messages"] if m["role"] == "user" for b in m["content"] if "text" in b] == ["first"]
            assert "Browser context" not in json.dumps(snap["messages"])
            assert "Browser context" not in json.dumps(agents[0].messages)
            assert snap["steering"] == []
            second = events(await client.post("/chat", json={**body, "message": "second",
                                                           "browser_context": {"url": "https://second.test"}}))
            assert second[0]["sequence"] == first[-1]["sequence"] + 1
            assert first[0]["run_id"] != second[0]["run_id"]
            assert "https://second.test" in json.dumps(model.calls[-1])
            assert "https://first.test" not in json.dumps(model.calls[-1])  # not carried across runs
            assert "Browser context" not in json.dumps(agents[0].messages)
            assert len(builds) == len(agents) == 1
            assert builds[0]["options"] == {"context": "auto", "tool_execution": "concurrent",
                                            "checkpointing": False, "background": False, "goal": ""}
            assert builds[0]["runtime_options"]["session_manager"] is (await manager.get("alice", "chat")).session_manager
            assert threads == [threads[0]] and threads[0] != threading.get_ident()
            replay = events(await client.get("/sessions/chat/events?user_id=alice&after=0"))
            assert replay[-1]["run_id"] == second[-1]["run_id"]  # Do not stop at first run's terminal event.
            assert len(replay) == len(first) + len(second)
            replay_last = events(await client.get("/sessions/chat/events?user_id=alice",
                                                 headers={"Last-Event-ID": str(first[-1]["sequence"])}))
            assert replay_last == second
            for change in ({"model": "other"}, {"reasoning_effort": "high"}, {"options": {"context": "sliding"}}):
                rejected = await client.post("/chat", json={**body, **change})
                assert rejected.status_code == 409
                assert "new chat" in rejected.json()["detail"]
            assert len(builds) == 1
            assert (await client.get("/sessions/chat?user_id=bob")).status_code == 404
            assert (await client.post("/sessions/chat/cancel", json={"user_id": "bob"})).status_code == 404
            third = events(await client.post("/chat", json={"session_id": "chat", "user_id": "alice", "message": "third"}))
            assert third[-1]["status"] == "completed"
        assert manager._closed
    asyncio.run(scenario())


def test_live_handoff_reaches_native_input_without_becoming_history_or_tools(monkeypatch):
    async def scenario():
        model = OfflineModel()
        turns = [{"role": "user", "text": "Remember the cobalt reference."},
                 {"role": "assistant", "text": "The lookup completed; no further tool call is needed."}]
        async with offline_api(monkeypatch, model=model) as (client, manager, builds, agents, shell, threads):
            request = {"session_id": "live-handoff", "user_id": "alice", "provider": "openai",
                       "model": "offline", "message": "Continue from Live",
                       "browser_context": {"live_conversation": turns}}
            response = events(await client.post("/chat", json=request))
            assert response[-1]["status"] == "completed"
            # Native ContextInjector folds the handoff into the user message for this call only.
            injected = model.calls[0][-1]
            assert injected["role"] == "user"
            assert injected["content"][0]["text"] == "Continue from Live"
            assert "live_conversation" in injected["content"][-1]["text"]
            assert "cobalt reference" in injected["content"][-1]["text"]
            assert not any("toolUse" in block for message in model.calls[0] for block in message["content"])
            snapshot = (await client.get("/sessions/live-handoff?user_id=alice")).json()
            assert "cobalt reference" not in json.dumps(snapshot["messages"])
            assert "cobalt reference" not in json.dumps(agents[0].messages)
            request.pop("browser_context")
            await client.post("/chat", json={**request, "message": "Next request"})
            assert "cobalt reference" not in json.dumps(model.calls[-1])
    asyncio.run(scenario())


def test_checkpoint_and_interrupt_frontend_actions(monkeypatch):
    async def scenario():
        calls = []

        @tool
        async def work() -> str:
            """Perform offline work."""
            calls.append("work")
            return "done"

        async with offline_api(monkeypatch, model=OfflineModel(tool_name="work"), tools=[work]) as (client, *_):
            body = {"session_id": "checkpoint", "message": "go", "provider": "openai", "model": "offline",
                    "options": {"checkpointing": True}}
            assert events(await client.post("/chat", json=body))[-1]["status"] == "checkpointed"
            assert calls == []
            assert (await client.post("/chat", json={**body, "message": "wrong"})).status_code == 409
            response = await client.post("/chat", json={**body, "message": "", "action": "checkpoint_resume",
                                                      "browser_context": {"url": "fresh-reference"}})
            assert events(response)[-1]["status"] == "checkpointed"
            assert calls == ["work"]
            response = await client.post("/chat", json={**body, "message": "", "action": "checkpoint_resume"})
            assert events(response)[-1]["status"] == "completed"
            assert calls == ["work"]

        calls.clear()
        def approval(event: BeforeToolCallEvent):
            assert event.interrupt("approval", reason="Proceed?") == "yes"

        async with offline_api(monkeypatch, model=OfflineModel(tool_name="work"), tools=[work], hooks=[approval]) as (client, *_):
            body = {"session_id": "interrupt", "message": "go", "provider": "openai", "model": "offline"}
            assert events(await client.post("/chat", json=body))[-1]["status"] == "interrupted"
            assert calls == []
            snap = (await client.get("/sessions/interrupt")).json()
            resumed = {**body, "message": "", "action": "interrupt_response",
                       "interrupt_responses": [{"interruptId": snap["interrupts"][0]["id"], "response": "yes"}]}
            wrong = await client.post("/chat", json={**resumed, "interrupt_responses": [{"interruptId": "bad", "response": "yes"}]})
            assert wrong.status_code == 422
            assert events(await client.post("/chat", json=resumed))[-1]["status"] == "completed"
            assert calls == ["work"]
    asyncio.run(scenario())


def test_live_snapshot_busy_steer_and_cancel(monkeypatch):
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        async with offline_api(monkeypatch, model=OfflineModel(entered=entered, release=release)) as (client, manager, *_):
            body = {"session_id": "live", "message": "go", "provider": "openai", "model": "offline"}
            sending = asyncio.create_task(client.post("/chat", json=body))
            await asyncio.wait_for(entered.wait(), 3)
            snapshot = (await client.get("/sessions/live")).json()
            assert snapshot["active"] and snapshot["status"] == "running"
            assert snapshot["messages"] == [] and snapshot["input"] == "go"
            assert snapshot["replay_after"] == 0
            assert (await client.post("/chat", json=body)).status_code == 409
            steering = {"message": "be brief", "steering_id": "same"}
            one = await client.post("/sessions/live/steer", json=steering)
            two = await client.post("/sessions/live/steer", json=steering)
            assert one.json() == two.json()
            assert one.json()["status"] == "queued"
            cancel = await client.post("/sessions/live/cancel", json={})
            assert cancel.json()["cancel_requested"]
            release.set()
            assert events(await sending)[-1]["status"] == "cancelled"
            assert (await manager.snapshot("default", "live"))["status"] == "cancelled"
    asyncio.run(scenario())


def test_overflow_before_headers_and_native_failure_status(monkeypatch):
    async def scenario():
        async with offline_api(monkeypatch, history_limit=2) as (client, *_):
            response = await client.post("/chat", json={"session_id": "overflow", "message": "go", "provider": "openai"})
            # A very fast producer can overflow even the initial subscriber.
            assert response.status_code in (200, 409)
            response = await client.get("/sessions/overflow/events?after=0")
            assert response.status_code == 409
            assert response.headers["content-type"].startswith("application/json")
            assert response.json()["detail"]["code"] == "replay_overflow"
            snap = (await client.get("/sessions/overflow")).json()
            assert snap["replay_after"] == snap["sequence"]
            assert (await client.get("/sessions/overflow/events?after=99999")).status_code == 422
        async with offline_api(monkeypatch, model=OfflineModel(fail=True)) as (client, *_):
            result = events(await client.post("/chat", json={"session_id": "failed", "message": "go", "provider": "openai"}))
            assert result[-1]["status"] == "error"
            snap = (await client.get("/sessions/failed")).json()
            assert snap["status"] == "error"
            assert not snap["recovery_required"]
            assert "offline model failed" in snap["error"]["message"]
    asyncio.run(scenario())


@pytest.mark.parametrize("change", [
    {"session_id": "../escape"}, {"session_id": "."}, {"session_id": "x" * 129},
    {"session_id": "bad\\path"}, {"session_id": "bad\n"}, {"user_id": "../escape"},
    {"options": {"context": "unknown"}}, {"options": {"tool_execution": "threads"}},
    {"options": {"unknown": True}}, {"action": "interrupt_response"},
    {"action": "checkpoint_resume", "message": "not allowed"}, {"message": "   "},
])
def test_request_validation_before_any_construction(monkeypatch, change):
    async def scenario():
        async with offline_api(monkeypatch) as (client, _, builds, _, shell, _):
            response = await client.post("/chat", json={"session_id": "valid", "message": "go", **change})
            assert response.status_code == 422
            assert not builds
    asyncio.run(scenario())


def test_startup_without_provider_and_lifespan_shutdown(monkeypatch):
    async def scenario():
        from agent.api.core import panel_agent
        monkeypatch.setattr(panel_agent, "configured_providers", lambda: [])
        monkeypatch.setenv("PANEL_A2A_ENABLED", "true")
        async with app.router.lifespan_context(app):
            manager = app.state.panel_runtime
            assert app.state.panel_a2a is None
        assert manager._closed
        assert app.state.panel_runtime is None
    asyncio.run(scenario())


def test_disconnected_http_subscriber_does_not_cancel_server_task(monkeypatch):
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        async with offline_api(monkeypatch, model=OfflineModel(entered=entered, release=release)) as (client, manager, *_):
            sending = asyncio.create_task(client.post("/chat", json={
                "session_id": "detached", "message": "go", "provider": "openai", "model": "offline",
            }))
            await asyncio.wait_for(entered.wait(), 3)
            sending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await sending
            session = await manager.get("default", "detached")
            assert session.active
            release.set()
            await session.wait()
            replay = events(await client.get("/sessions/detached/events?after=0"))
            assert replay[-1]["status"] == "completed"
    asyncio.run(scenario())


def test_opt_in_a2a_native_factory_mount_and_cleanup(monkeypatch):
    async def scenario():
        from agent.api.core import panel_agent
        from agent.api.core import panel_a2a
        monkeypatch.setattr(panel_agent, "default_selection", lambda: ("openai", "offline"))
        models, tools, integrations = [], [], []

        def model_factory(*args):
            model = OfflineModel()
            models.append(model)
            return model

        def shell_factory():
            @tool
            async def offline_shell() -> str:
                """Offline shell stand-in; never starts a subprocess."""
                return "done"
            tools.append(offline_shell)
            return offline_shell

        native_create = panel_a2a.create_panel_a2a_server
        def capture(**kwargs):
            integration = native_create(**kwargs)
            integrations.append(integration)
            return integration

        monkeypatch.setattr(panel_agent, "build_model", model_factory)
        # A2A contexts get the real core tool set; substitute the offline stand-in
        # so the test never spawns MCP/shell processes.
        from agent.api import main as main_module
        from agent.api.core import panel_tools
        monkeypatch.setattr(panel_tools, "build_core_tools", lambda _dir: [shell_factory()])
        monkeypatch.setattr(main_module, "build_core_tools", lambda _dir: [shell_factory()], raising=False)
        monkeypatch.setattr(panel_a2a, "create_panel_a2a_server", capture)
        monkeypatch.setenv("PANEL_A2A_ENABLED", "true")
        monkeypatch.setenv("PANEL_A2A_URL", "http://test/a2a")
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                card = await client.get("/a2a/.well-known/agent-card.json")
                assert card.status_code == 200
                assert card.json()["name"] == "Ron"
                assert (await client.get("/config")).json()["features"]["a2a"] is True
                # Metadata construction never spawns shell. Two models: the panel card and the
                # fixer card (`tool_failure.fixer_agent_for`, mounted at /a2a/fixer).
                assert len(models) == 2 and tools == []
                for context_id in ("first-context", "second-context"):
                    response = await client.post("/a2a/", json={
                        "jsonrpc": "2.0", "id": context_id, "method": "message/send",
                        "params": {"message": {"messageId": context_id, "contextId": context_id,
                                               "role": "user", "parts": [{"kind": "text", "text": "hello"}]}},
                    })
                    assert response.status_code == 200
                    assert "error" not in response.json(), response.text
                assert len(models) == 4 and len(tools) == 2
                assert models[2] is not models[3] and tools[0] is not tools[1]
        assert integrations[0]._closed
        assert not any(getattr(route, "path", None) == "/a2a" for route in app.routes)
    asyncio.run(scenario())


# --- browser target selection (todo 14) ---------------------------------------------------

def test_browser_defaults_to_user_and_is_pinned_per_session(monkeypatch):
    monkeypatch.delenv("RON_BROWSER_DEFAULT", raising=False)

    async def scenario():
        async with offline_api(monkeypatch) as (client, manager, builds, agents, shell, threads):
            body = {"session_id": "b-default", "message": "hi", "provider": "openai", "model": "offline"}
            events(await client.post("/chat", json=body))
            assert builds[0]["browser"] == "user"
            assert 'tool_catalog(action="load", name="user_browser")' in builds[0]["system_prompt"]
            assert "cloud_browser_" not in builds[0]["system_prompt"]
            snap = (await client.get("/sessions/b-default")).json()
            assert snap["selection"]["browser"] == "user"
            # Same browser again (explicit) is fine; a different one is a 409 selection change.
            events(await client.post("/chat", json={**body, "message": "again", "browser": "user"}))
            rejected = await client.post("/chat", json={**body, "message": "switch", "browser": "cloud"})
            assert rejected.status_code == 409
            assert "Session selection cannot change" in rejected.text
            assert len(builds) == 1

    asyncio.run(scenario())


def test_browser_cloud_selection_reaches_factory_and_prompt(monkeypatch):
    async def scenario():
        async with offline_api(monkeypatch) as (client, manager, builds, agents, shell, threads):
            body = {"session_id": "b-cloud", "message": "hi", "provider": "openai", "model": "offline",
                    "browser": "cloud"}
            events(await client.post("/chat", json=body))
            assert builds[0]["browser"] == "cloud"
            assert 'tool_catalog(action="load", name="cloud_browser")' in builds[0]["system_prompt"]
            assert "user_browser_" not in builds[0]["system_prompt"]
            snap = (await client.get("/sessions/b-cloud")).json()
            assert snap["selection"] == {"provider": "openai", "model_id": "offline",
                                         "reasoning_effort": None, "browser": "cloud"}
            # Omitting browser on a later turn keeps the pinned selection (no 409).
            events(await client.post("/chat", json={k: v for k, v in body.items() if k != "browser"} | {"message": "more"}))
            assert (await client.get("/sessions/b-cloud")).json()["selection"]["browser"] == "cloud"

    asyncio.run(scenario())


def test_browser_invalid_value_is_422(monkeypatch):
    async def scenario():
        async with offline_api(monkeypatch) as (client, manager, builds, agents, shell, threads):
            response = await client.post("/chat", json={"session_id": "b-bad", "message": "hi", "provider": "openai",
                                                        "model": "offline", "browser": "laptop"})
            assert response.status_code == 422
            assert builds == []

    asyncio.run(scenario())
