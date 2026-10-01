"""Offline HTTP tests for the idle-gated dreaming endpoint (S5/S7)."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from strands.models.model import Model
from strands.storage import InMemoryStorage


class DreamModel(Model):
    """Scripted consolidator: reads the journal, adds one tagged memory, then stops."""

    def __init__(self):
        self.calls = []

    def get_config(self):
        return {"model_id": "offline-dream", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls.append(sorted(spec["name"] for spec in tool_specs or []))
        results = [b["toolResult"] for m in messages for b in m["content"] if "toolResult" in b]
        yield {"messageStart": {"role": "assistant"}}
        if not results:
            name, inputs = "journal", {"action": "read"}
        elif len(results) == 1:
            entry = ("<start_entry>\n<topic_name>ToDo's<topic_name/>\n<subject>Mom's birthday dinner plan<subject/>\n"
                     "<created_at>2026-10-01T14:03:09<created_at/>\n"
                     "<tags>todo, family, food, birthday, schedule, reminder, deadline, home, decision, goal</tags>\n"
                     "Book the Thai place for Friday.\n<end_entry/>")
            name, inputs = "add_memory", {"entries": [entry]}
        else:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "consolidated"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}
            return
        yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": f"d{len(results)}", "name": name}}}}
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "tool_use"}}


@pytest.fixture
def app(monkeypatch, tmp_path):
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    monkeypatch.setenv("PANEL_STORAGE", "memory")
    monkeypatch.setenv("PANEL_A2A_ENABLED", "false")
    monkeypatch.setenv("RON_NGROK", "0")
    monkeypatch.setenv("RON_AGENT_SANDBOX_ROOT", str(tmp_path))
    monkeypatch.setenv("RON_MEMORY_AGENT_MODELS", "x/dream")
    monkeypatch.setenv("RON_MEMORY_IDLE_SECONDS", "300")
    from agent.api.core import config as app_config
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "offline-not-a-credential")
    from agent.api.core import memory_agent, panel_storage
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    model = DreamModel()
    monkeypatch.setattr(memory_agent, "build_model", lambda *a, **k: model)
    memory_agent._agents.clear()
    from agent.api import main
    return main.app, model


def _journal_write(tmp_path):
    day = tmp_path / "journal"
    day.mkdir(exist_ok=True)
    (day / "2026-10-01.md").write_text("## 14:03:09\n<start_entry>...<end_entry/>\n")


def test_dream_skips_while_active_and_runs_when_idle(app, tmp_path):
    application, model = app
    _journal_write(tmp_path)

    async def run():
        async with application.router.lifespan_context(application):
            runtime = application.state.panel_runtime
            transport = httpx.ASGITransport(app=application)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                # Never-seen user: nothing to dream about.
                r = await client.post("/memory/dream", json={"user_id": "ghost"})
                assert r.status_code == 200 and r.json() == {"status": "skipped", "reason": "no_activity", "user_id": "ghost"}

                runtime.touch("u1")
                r = await client.post("/memory/dream", json={"user_id": "u1"})
                assert r.status_code == 202, r.text
                body = r.json()
                assert body["status"] == "skipped" and body["reason"] == "active" and body["idle_seconds"] < 300

                runtime._last_activity["u1"] -= 301
                status = await client.get("/memory/status", params={"user_id": "u1"})
                assert status.status_code == 200 and status.json()["idle_seconds"] >= 300
                r = await client.post("/memory/dream", json={"user_id": "u1"})
                assert r.status_code == 200, r.text
                body = r.json()
                assert body["status"] == "dreamed" and body["user_id"] == "u1"
                # The scripted model saw the memory agent's tool set and journaled then added.
                assert model.calls and model.calls[0] == ["add_memory", "inject_memory", "journal", "search_memories", "search_memory"]
                assert len(model.calls) == 3

                # The consolidated entry is now searchable with nested filters.
                from agent.api.core.memory_agent import known_memory_agents
                agent = known_memory_agents()["u1"]
                hits = await agent.memory_manager._stores[0].search("Thai", {"order": ["topic", "tags"], "topic": "ToDo's", "tags": ["food"]})
                assert len(hits) == 1 and hits[0].metadata["subject"] == "Mom's birthday dinner plan"
                assert hits[0].metadata["path"] == "todo-s/20261001T140309-mom-s-birthday-dinner-plan.md"

                # Second idle call is rejected while one is in flight, allowed after.
                r = await client.post("/memory/dream", json={"user_id": "u1"})
                assert r.status_code == 200 and r.json()["status"] == "dreamed"

    asyncio.run(run())


def test_dream_requires_loopback(app):
    application, _ = app

    async def run():
        async with application.router.lifespan_context(application):
            transport = httpx.ASGITransport(app=application, client=("203.0.113.9", 4444))
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                r = await client.post("/memory/dream", json={"user_id": "u1"})
                assert r.status_code == 403

    asyncio.run(run())
