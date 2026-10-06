"""Specialist agents: the harness portable config, stored via the supabase client, served over native A2A."""

from __future__ import annotations

import asyncio
import json
import socket
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest

from agent.api.core.harness_agents import HarnessA2AHost, SignInRequired, create_harness_tools, harness_table, owner_uuid

OWNER = str(uuid.uuid4())

ECHO_MODEL = '''
from strands.models import Model


class EchoModel(Model):
    def get_config(self):
        return {"model_id": "echo", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        text = "".join(block.get("text", "") for block in messages[-1]["content"])
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": f"specialist saw: {text}"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


model = EchoModel()
'''


class FakePostgrest:
    """The PostgREST requests the supabase client sends for harness_agents (trigger-maintained updated_at)."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        params = dict(request.url.params)
        if request.method == "POST":
            assert params["on_conflict"] == "owner_id,name"
            body = json.loads(request.content)
            body = body[0] if isinstance(body, list) else body
            existing = next((row for row in self.rows.values()
                             if row["owner_id"] == body["owner_id"] and row["name"] == body["name"]), None)
            row = {**(existing or {"id": str(uuid.uuid4())}), **body, "updated_at": datetime.now(timezone.utc).isoformat()}
            self.rows[row["id"]] = row
            return httpx.Response(201, json=[row])
        rows = list(self.rows.values())
        for field in ("owner_id", "id"):
            if field in params:
                rows = [row for row in rows if row[field] == params[field].removeprefix("eq.")]
        return httpx.Response(200, json=rows)


@pytest.fixture
def postgrest(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test")
    return FakePostgrest()


@pytest.fixture
def table(postgrest):
    return asyncio.run(harness_table(httpx.AsyncClient(transport=httpx.MockTransport(postgrest))))


@pytest.fixture
def echo_config(tmp_path: Path) -> dict[str, Any]:
    (tmp_path / "echo_model.py").write_text(ECHO_MODEL)
    return {"name": "Echo", "description": "Echoes tasks.", "instructions": "Echo the task.",
            "modelModule": {"module": str(tmp_path / "echo_model.py"), "export": "model"}, "builtinTools": []}


def test_guests_must_sign_in_and_the_service_key_is_required(monkeypatch):
    with pytest.raises(SignInRequired):
        owner_uuid("default")
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_SERVICE_ROLE_KEY"):
        asyncio.run(harness_table())


@pytest.mark.asyncio
async def test_create_harness_stores_the_portable_config_and_upserts_by_name(table, postgrest, echo_config):
    create, listing = create_harness_tools(OWNER, table=table, host=HarnessA2AHost(table))
    config = {**echo_config, "tools": [{"module": "./research/perplexity_search_api.py", "export": "perplexity_search_api"}],
              "mcpServers": {"user_browser": {"command": "electron-playwright-mcp"}}}
    first = await create(config=config)
    assert {"perplexity_search_api", "a2a_send_message"} <= set(first["registered_tools"])
    stored = postgrest.rows[first["id"]]["config"]
    assert stored["tools"] == [{"kind": "tool", "module": "./research/perplexity_search_api.py", "export": "perplexity_search_api"}]
    assert stored["mcpServers"] == {"user_browser": {"command": "electron-playwright-mcp"}}
    assert stored["session"] is True, "the stored config is the author's; session/memory are run-time options"
    assert first["a2a_url"].endswith(f"/a2a/agents/{first['id']}")
    second = await create(config={**echo_config, "description": "Echoes tasks loudly."})
    assert second["id"] == first["id"] and len(postgrest.rows) == 1
    assert [item["description"] for item in await listing()] == ["Echoes tasks loudly."]
    with pytest.raises(ModuleNotFoundError):  # the harness's own loader error reaches the model unchanged
        await create(config={**echo_config, "tools": [{"module": "./research/no_such_tool.py", "export": "x"}]})
    assert len(postgrest.rows) == 1, "a definition the harness cannot construct is never saved"
    with pytest.raises(SignInRequired):
        await create_harness_tools("default", table=table)[0](config=echo_config)


@pytest.mark.asyncio
async def test_ron_providers_are_built_by_build_model_and_passed_as_the_model_instance(table, echo_config, monkeypatch, tmp_path):
    from strands.models import Model

    from agent.api.core import panel_agent
    from agent.api.core.harness_agents import build_specialist

    built = []

    class RonModel(Model):
        def get_config(self):
            return {"model_id": "ron", "stateful": False}

        def update_config(self, **kwargs):
            pass

        async def structured_output(self, *args, **kwargs):
            raise NotImplementedError
            yield

        async def stream(self, *args, **kwargs):
            raise NotImplementedError
            yield

    def build_model(provider, model_id, *args, **kwargs):
        built.append((provider, model_id))
        return RonModel()

    monkeypatch.setattr(panel_agent, "build_model", build_model)
    monkeypatch.setattr(panel_agent, "default_selection", lambda: ("perplexity", "openai/gpt-6.1-sol"))
    config = {key: value for key, value in echo_config.items() if key != "modelModule"}
    agent = build_specialist({**config, "model": "perplexity/openai/gpt-6.1-sol"}, OWNER, connect_mcp=False)
    assert isinstance(agent.model, RonModel) and built == [("perplexity", "openai/gpt-6.1-sol")]
    agent.cleanup()
    stored = await create_harness_tools(OWNER, table=table, host=HarnessA2AHost(table))[0](config=config)
    assert stored["config"]["model"] == "perplexity/openai/gpt-6.1-sol", "an omitted model is Ron's default provider"


def test_stored_specialist_answers_over_native_a2a(table, echo_config, monkeypatch):
    import uvicorn
    from fastapi import FastAPI

    from agent.api.core.a2a_tools import a2a_tools

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    monkeypatch.setenv("PANEL_A2A_URL", f"http://127.0.0.1:{port}/a2a")
    host = HarnessA2AHost(table)
    created = asyncio.run(create_harness_tools(OWNER, table=table, host=host)[0](config=echo_config))
    app = FastAPI()
    app.mount("/a2a/agents", host)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 15
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started
    try:
        card = httpx.get(f"{created['a2a_url']}/.well-known/agent-card.json", timeout=10).json()
        assert card["name"] == "Echo" and card["url"].rstrip("/") == created["a2a_url"]
        assert httpx.get(f"http://127.0.0.1:{port}/a2a/agents/{uuid.uuid4()}/.well-known/agent-card.json").status_code == 404
        send = next(tool for tool in a2a_tools() if tool.tool_name == "a2a_send_message")

        async def call() -> Any:
            result = None
            async for event in send.stream({"toolUseId": "t", "name": "a2a_send_message",
                                            "input": {"message_text": "save three videos", "target_agent_url": created["a2a_url"]}}, {}):
                result = event
            return result["tool_result"] if isinstance(result, dict) and "tool_result" in result else result

        reply = asyncio.run(call())
        assert reply["status"] == "success" and "specialist saw: save three videos" in json.dumps(reply["content"])
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        asyncio.run(host.aclose())
