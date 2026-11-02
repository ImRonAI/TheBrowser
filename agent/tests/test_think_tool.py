"""The vendored strands_tools ``think`` (research/think.py), loaded unchanged, plus the native
``BeforeToolCallEvent`` guard that keeps parent-only tools out of its child agents.

Real SDK agents, hooks and tool execution; only models (and the HTTP client) are scripted.
"""

from __future__ import annotations

import asyncio
import copy
import json
import threading
from types import SimpleNamespace

import httpx
import openai
from strands import Agent, tool
from strands.models.model import Model

from agent.api.core.panel_agent import PROJECT_TOOLS_DIR
from agent.api.core.panel_tools import ThinkToolsGuard, load_vendored_think

CHILD_PROMPT = "You are the think child."


class ParentAndChildModel(Model):
    """One instance, as think.py reuses ``parent.model``: the parent calls ``think`` once; the
    child (recognised by its system prompt) records its tools and concludes."""

    def __init__(self, think_input):
        self.think_input = think_input
        self.child_tools: list[list[str]] = []

    def get_config(self):
        return {"model_id": "offline", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        yield {"messageStart": {"role": "assistant"}}
        if system_prompt == CHILD_PROMPT:
            self.child_tools.append(sorted(spec["name"] for spec in tool_specs or []))
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "child conclusion"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}
            return
        if not any("toolResult" in block for message in messages for block in message["content"]):
            yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": "t1", "name": "think"}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(self.think_input)}}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "tool_use"}}
            return
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "parent answer"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


def _named(name):
    @tool(name=name)
    async def probe(value: str = "") -> str:
        """A named offline probe tool."""
        return value
    return probe


PARENT_TOOLS = ["shell", "recall", "search_memories", "ask_user", "tool_catalog",
                "user_browser_playwright_click", "strands_manage_background_task",
                "http_request", "perplexity_search"]
ALLOWED = ["http_request", "perplexity_search", "recall", "search_memories", "shell"]


def _run(think_input, prompt="think hard"):
    model = ParentAndChildModel(think_input)
    agent = Agent(model=model, tools=[load_vendored_think(PROJECT_TOOLS_DIR), *map(_named, PARENT_TOOLS)],
                  plugins=[ThinkToolsGuard()], callback_handler=None)
    result = asyncio.run(agent.invoke_async(prompt))
    results = [b["toolResult"] for m in agent.messages for b in m["content"] if "toolResult" in b]
    return model, result, results


def test_vendored_think_loads_unchanged_with_its_native_schema():
    think = load_vendored_think(PROJECT_TOOLS_DIR)
    schema = think.tool_spec["inputSchema"]["json"]
    assert think.tool_name == "think"
    assert schema["required"] == ["thought", "cycle_count", "system_prompt"]
    assert "agent" not in schema["properties"]  # injected natively by the SDK


def test_guard_gives_the_think_child_only_non_parent_only_tools_when_omitted():
    model, result, results = _run({"thought": "weigh it", "cycle_count": 1, "system_prompt": CHILD_PROMPT})
    assert result.stop_reason == "end_turn"
    assert model.child_tools == [ALLOWED]
    assert results[0]["status"] == "success" and "child conclusion" in json.dumps(results[0])


def test_guard_withholds_research_tools_when_the_user_said_browser_only():
    """2026-10-15: a 'browser only' flight search was answered by the think child over fetch/search."""
    prompt = "Find the cheapest flight from Palm Springs to Buffalo. Use the browser only."
    model, _, _ = _run({"thought": "plan", "cycle_count": 1, "system_prompt": CHILD_PROMPT}, prompt=prompt)
    assert model.child_tools == [["recall", "search_memories", "shell"]]
    model, _, _ = _run({"thought": "plan", "cycle_count": 1, "system_prompt": CHILD_PROMPT,
                        "tools": ["http_request", "shell"]}, prompt="Browser-only please: book it.")
    assert model.child_tools == [["shell"]]


def test_browser_only_detection_reads_the_current_request_only():
    from agent.api.core.panel_tools import browser_only_requested

    def user(text):
        return {"role": "user", "content": [{"text": text}]}
    tool_turn = {"role": "user", "content": [{"toolResult": {"toolUseId": "t", "status": "success", "content": []}}]}
    assert browser_only_requested([user("Look this up. Use the browser only."), tool_turn])
    assert browser_only_requested([user("only use the browser for this")])
    assert browser_only_requested([user("browser-only")])
    assert not browser_only_requested([user("open the browser and also search the web")])
    # A later request without the restriction lifts it.
    assert not browser_only_requested([user("Use the browser only."), tool_turn, user("Now summarize from memory.")])
    assert not browser_only_requested([])


def test_guard_filters_an_explicit_tool_list():
    model, _, _ = _run({"thought": "weigh it", "cycle_count": 1, "system_prompt": CHILD_PROMPT,
                        "tools": ["shell", "ask_user", "think", "user_browser_playwright_click"]})
    assert model.child_tools == [["shell"]]


def test_think_runs_the_perplexity_model_on_its_own_event_loop(monkeypatch):
    """Gate (plan Phase 4): think.py reuses ``parent.model`` inside its worker thread and event
    loop. PerplexityResponsesModel opens a fresh AsyncOpenAI/httpx client per request, so nothing
    is bound to the parent's loop."""
    from agent.api.core.perplexity_model import PerplexityResponsesModel

    clients = []

    class Responses:
        async def create(self, **kwargs):
            async def stream():
                yield SimpleNamespace(type="response.created", response=SimpleNamespace(id="r"))
                yield SimpleNamespace(type="response.output_text.delta", delta="child conclusion")
                yield SimpleNamespace(type="response.completed", response=SimpleNamespace(usage=None))
            return stream()

    class Client:
        def __init__(self, **kwargs):
            clients.append((asyncio.get_running_loop(), threading.get_ident(), kwargs["http_client"]))
            self.responses = Responses()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

    monkeypatch.setattr(openai, "AsyncOpenAI", Client)
    model = PerplexityResponsesModel(client_args={"api_key": "k", "base_url": "u", "timeout": httpx.Timeout(5)},
                                     model_id="offline/perplexity", stateful=False)
    parent = Agent(model=model, tools=[load_vendored_think(PROJECT_TOOLS_DIR)], plugins=[ThinkToolsGuard()],
                   callback_handler=None)
    loops = []

    async def parent_call():
        loops.append((asyncio.get_running_loop(), threading.get_ident()))
        return await model.stream([{"role": "user", "content": [{"text": "hi"}]}]).__anext__()

    asyncio.run(parent_call())
    outcome = parent.tool.think(thought="weigh it", cycle_count=1, system_prompt=CHILD_PROMPT)
    assert outcome["status"] == "success", outcome
    assert "child conclusion" in json.dumps(copy.deepcopy(outcome["content"]))
    assert len(clients) == 2
    (first_loop, _, first_http), (child_loop, child_thread, child_http) = clients
    assert first_loop is loops[0][0] and child_loop is not first_loop
    assert child_http is not first_http  # per-request httpx client: nothing shared across loops
    assert child_thread != loops[0][1]
