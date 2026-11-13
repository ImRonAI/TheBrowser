"""Ren's Build Agent (core/build_agent.py): its create_harness composition and its NIM -> Mistral fail-over.

The fail-over test drives the real ``openai`` client, the native ``ModelRouter`` and the harness agent against a local
HTTP server that speaks the OpenAI chat-completions stream: one model holds the request open without sending a byte
(what NVIDIA's hosted endpoint did), the other answers.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
from strands.agent.conversation_manager import SummarizingConversationManager
from strands.models.routing import ModelRouter
from strands.storage import InMemoryStorage
from strands.vended_plugins.context_offloader import ContextOffloader

from agent.api.core import build_agent
from agent.api.core import config as app_config
from agent.api.core import panel_agent, panel_storage

GLM_NIM, GLM_MISTRAL, GLM_FULL = "z-ai/glm-5.3-flash", "zai-glm-5-3-flash", "zai-glm-5-3"


@pytest.fixture
def providers(monkeypatch):
    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nim-test-key")
    monkeypatch.setattr(app_config, "MISTRAL_API_KEY", "mistral-test-key")
    monkeypatch.setenv("RON_CHAT_PROVIDERS", "nim,mistral")
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    monkeypatch.setattr(build_agent, "_strategy", None)


def test_glm_runs_at_max_and_falls_back_to_glm_on_the_other_provider_then_glm_5_3(providers):
    assert build_agent.build_candidates("nim", GLM_NIM, None) == [
        ("nim", GLM_NIM, "max"), ("mistral", GLM_MISTRAL, "max"), ("mistral", GLM_FULL, "max")]
    assert build_agent.build_candidates("mistral", GLM_MISTRAL, None) == [
        ("mistral", GLM_MISTRAL, "max"), ("nim", GLM_NIM, "max"), ("mistral", GLM_FULL, "max")]
    assert build_agent.build_candidates("mistral", GLM_FULL, None) == [
        ("mistral", GLM_FULL, "max"), ("nim", GLM_NIM, "max"), ("mistral", GLM_MISTRAL, "max")]
    # A picked level carries over to a fallback that offers it.
    assert build_agent.build_candidates("nim", GLM_NIM, "low") == [
        ("nim", GLM_NIM, "low"), ("mistral", GLM_MISTRAL, "low"), ("mistral", GLM_FULL, "low")]
    # A model without reasoning levels gets none; the GLM fallbacks still run at max.
    assert build_agent.build_candidates("mistral", "codestral-latest", None) == [
        ("mistral", "codestral-latest", None), ("nim", GLM_NIM, "max"), ("mistral", GLM_MISTRAL, "max"),
        ("mistral", GLM_FULL, "max")]


def test_glm_5_3_is_offered_only_with_mistral(providers, monkeypatch):
    monkeypatch.setenv("RON_CHAT_PROVIDERS", "nim")
    assert build_agent.build_candidates("nim", GLM_NIM, None) == [("nim", GLM_NIM, "max")]


def test_router_bounds_silent_nim_and_mistral_calls(providers, monkeypatch):
    from agent.api.core.mistral_model import RonMistralModel
    from strands.models.openai import OpenAIModel

    monkeypatch.setattr(app_config, "RON_BUILD_NIM_READ_TIMEOUT", 20.0)
    monkeypatch.setattr(app_config, "RON_BUILD_MISTRAL_READ_TIMEOUT", 60.0)
    router = build_agent.build_model_router("nim", GLM_NIM, None)
    assert isinstance(router, ModelRouter) and router._strategy is build_agent.routing_strategy()
    assert [candidate.name for candidate in router.candidates] == [
        f"nim:{GLM_NIM}", f"mistral:{GLM_MISTRAL}", f"mistral:{GLM_FULL}"]
    nim, *mistral = (candidate.model for candidate in router.candidates)
    assert isinstance(nim, OpenAIModel) and nim.config["params"] == {"reasoning_effort": "max"}
    assert nim.client_args["timeout"] == httpx.Timeout(20.0, connect=10.0)
    assert nim.client_args["max_retries"] == 0
    for model in mistral:
        assert isinstance(model, RonMistralModel) and model.reasoning_effort == "max"
        assert model.client_args["timeout_ms"] == 60_000


def _context(router, *attempts):
    from strands.models.routing.strategy import RoutingAttempt, RoutingContext

    by_name = {candidate.name: candidate for candidate in router.candidates}
    return RoutingContext(messages=[], system_prompt=None, tool_specs=[], candidates=router.candidates,
                          invocation_state={}, attempts=tuple(
                              RoutingAttempt(by_name[name], error) for name, error in attempts))


def test_a_turn_opens_on_the_first_candidate_that_has_not_failed_recently(providers):
    strategy = build_agent.RecentFailureStrategy(cooldown=0.3)
    router = build_agent.build_model_router("nim", GLM_NIM, None)
    nim, flash, full = (f"nim:{GLM_NIM}", f"mistral:{GLM_MISTRAL}", f"mistral:{GLM_FULL}")
    pick = lambda *attempts: asyncio.run(strategy.select(_context(router, *attempts))).name  # noqa: E731

    assert pick() == nim
    # After a failure it is FallbackStrategy: the next candidate in the same call.
    assert pick((nim, TimeoutError())) == flash
    assert pick((nim, TimeoutError()), (flash, RuntimeError("429"))) == full
    # The next turn opens past the two that just failed, and on the oldest failure once every candidate failed.
    assert pick() == full
    asyncio.run(strategy.select(_context(router, (full, TimeoutError()))))
    assert pick() == nim
    # A candidate that answers again is cleared; the cooldown expires the rest.
    asyncio.run(strategy.select(_context(router, (flash, None), (full, TimeoutError()))))
    assert pick() == flash
    time.sleep(0.35)
    assert pick() == nim


def test_build_destination_is_a_harness_agent_in_its_workspace(providers):
    from strands_harness.plugins import EnvironmentContext

    from agent.api.core.build_workspace import BuildWorkspaceGuard, workspace_root
    from agent.api.endpoints import chat

    agent = asyncio.run(chat._create_runtime_agent(
        user_id="default", session_id="build-session", options={}, runtime_options={},
        selection={"provider": "nim", "model_id": GLM_NIM, "destination": "build"}))
    root = workspace_root("default", "build-session")
    # Agent(model=ModelRouter) keeps the router and serves its first candidate as agent.model.
    router = agent._model_router
    assert isinstance(router, ModelRouter) and agent.model is router.candidates[0].model
    assert [candidate.name for candidate in router.candidates] == [
        f"nim:{GLM_NIM}", f"mistral:{GLM_MISTRAL}", f"mistral:{GLM_FULL}"]
    tools = set(agent.tool_registry.registry)
    assert {"shell", "editor", "http_request", "todo_write"} <= tools
    assert not tools & {"tool_catalog", "mcp_client", "read", "write", "edit"}
    plugins = list(agent._plugin_registry._plugins.values())
    assert not any(isinstance(plugin, EnvironmentContext) for plugin in plugins)
    guards = [plugin for plugin in plugins if isinstance(plugin, BuildWorkspaceGuard)]
    assert len(guards) == 1 and guards[0].root == str(root)
    assert root.is_dir() and (root.stat().st_mode & 0o777) == 0o700
    assert "You are Ren's Build Agent." in agent.system_prompt and str(root) in agent.system_prompt
    # The panel composition's context modes, so Build threads saved by it restore (see the restore test).
    manager = agent.conversation_manager
    assert type(manager) is SummarizingConversationManager and manager.preserve_recent_messages == 4
    assert isinstance(manager.summarization_agent._model_router, ModelRouter)
    assert any(isinstance(plugin, ContextOffloader) for plugin in plugins)


@pytest.mark.parametrize("context", ["sliding", "agentic"])
def test_build_agent_context_modes_match_the_panel(providers, context):
    from strands.agent.conversation_manager import SlidingWindowConversationManager
    from strands.experimental.context_manager import ContextManager

    from agent.api.endpoints import chat

    agent = asyncio.run(chat._create_runtime_agent(
        user_id="default", session_id=f"build-{context}", options={"context": context}, runtime_options={},
        selection={"provider": "nim", "model_id": GLM_NIM, "destination": "build"}))
    plugins = list(agent._plugin_registry._plugins.values())
    if context == "sliding":
        assert type(agent.conversation_manager) is SlidingWindowConversationManager
        assert any(isinstance(plugin, ContextOffloader) for plugin in plugins)
    else:
        assert any(isinstance(plugin, ContextManager) for plugin in plugins)


class _ChatCompletions(BaseHTTPRequestHandler):
    """``POST /v1/chat/completions``: ``hang`` models never answer, every other model streams one reply."""

    requests: list[dict] = []
    hang: set[str] = set()
    release = threading.Event()

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).requests.append({"path": self.path, "model": body["model"], "at": time.monotonic(),
                                    "reasoning_effort": body.get("reasoning_effort"),
                                    "roles": [message["role"] for message in body["messages"]]})
        if body["model"] in self.hang:
            self.release.wait(30)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        chunk = {"id": "c1", "object": "chat.completion.chunk", "created": 0, "model": body["model"]}
        for event in (
            {**chunk, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hello from GLM."},
                                   "finish_reason": None}]},
            {**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
            {**chunk, "choices": [], "usage": {"prompt_tokens": 9, "completion_tokens": 4, "total_tokens": 13}},
        ):
            self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, *_args) -> None:
        pass


@pytest.fixture
def nim_server(monkeypatch):
    """NVIDIA's chat-completions served locally: ``openai/gpt-oss-20b`` never answers, GLM 5.3 Flash does."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _ChatCompletions)
    server.daemon_threads = True
    _ChatCompletions.requests, _ChatCompletions.hang = [], {"openai/gpt-oss-20b"}
    _ChatCompletions.release.clear()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(panel_agent, "NVIDIA_NIM_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setenv("RON_CHAT_PROVIDERS", "nim")
    monkeypatch.setattr(app_config, "RON_BUILD_NIM_READ_TIMEOUT", 0.5)
    try:
        yield _ChatCompletions
    finally:
        _ChatCompletions.release.set()
        server.shutdown()
        server.server_close()


def _side_models(provider, model_id, effort):
    return lambda name: (build_agent.build_model_router(provider, model_id, effort) if name == "summarizer"
                         else build_agent.build_side_model(provider, model_id, effort))


def test_a_silent_nim_model_fails_over_to_glm_within_the_read_timeout(providers, nim_server):
    agent = build_agent.create_build_agent(
        user_id="default", session_id="failover", browser="user",
        model=build_agent.build_model_router("nim", "openai/gpt-oss-20b", None),
        side_model_factory=_side_models("nim", "openai/gpt-oss-20b", None))
    started = time.monotonic()
    result = asyncio.run(agent.invoke_async("Say hello."))
    elapsed = time.monotonic() - started

    assert str(result).strip() == "Hello from GLM."
    assert [(r["path"], r["model"], r["reasoning_effort"]) for r in nim_server.requests] == [
        ("/v1/chat/completions", "openai/gpt-oss-20b", None),
        ("/v1/chat/completions", GLM_NIM, "max"),
    ]
    switch = nim_server.requests[1]["at"] - nim_server.requests[0]["at"]
    assert 0.4 < switch < 5, switch
    assert elapsed < 10, elapsed

    # The next turn, and a fresh router (a runtime respawn), open on GLM without waiting on the silent model again.
    assert str(asyncio.run(agent.invoke_async("Again."))).strip() == "Hello from GLM."
    respawned = build_agent.create_build_agent(
        user_id="default", session_id="failover-2", browser="user",
        model=build_agent.build_model_router("nim", "openai/gpt-oss-20b", None),
        side_model_factory=_side_models("nim", "openai/gpt-oss-20b", None))
    assert str(asyncio.run(respawned.invoke_async("Once more."))).strip() == "Hello from GLM."
    assert [r["model"] for r in nim_server.requests[2:]] == [GLM_NIM, GLM_NIM]


def test_a_build_thread_saved_by_the_panel_composition_restores_into_the_build_agent(providers, nim_server):
    """Build threads were saved by ``create_panel_agent`` (``SummarizingConversationManager``) before this module."""
    from strands import Agent

    from agent.api.core.panel_storage import ThreadSessionManager, get_user_session_storage, thread_agent_id

    def thread():
        return {"agent_id": thread_agent_id("default"),
                "session_manager": ThreadSessionManager("old-build", storage=get_user_session_storage("default"))}

    saved = Agent(model=panel_agent.build_model("nim", GLM_NIM, "max"), callback_handler=None,
                  conversation_manager=SummarizingConversationManager(
                      summarization_agent=Agent(model=panel_agent.build_model("nim", GLM_NIM, None),
                                                callback_handler=None),
                      preserve_recent_messages=4),
                  **thread())
    asyncio.run(saved.invoke_async("The dev server port is 4100."))

    agent = build_agent.create_build_agent(
        user_id="default", session_id="old-build", browser="user", callback_handler=None,
        model=build_agent.build_model_router("nim", GLM_NIM, None),
        side_model_factory=_side_models("nim", GLM_NIM, None), **thread())
    assert [message["role"] for message in agent.messages] == ["user", "assistant"]
    assert str(asyncio.run(agent.invoke_async("Which port?"))).strip() == "Hello from GLM."
    assert nim_server.requests[-1]["roles"] == ["system", "user", "assistant", "user"]
