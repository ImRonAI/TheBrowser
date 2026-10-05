"""Tool observation (CAT-49): native AfterToolCallEvent -> span event + agent.state failure flag."""

from __future__ import annotations

import asyncio
import json

import pytest
from strands import Agent, tool
from strands.models.model import Model

from agent.api.core import tool_observation
from agent.api.core.tool_observation import TOOL_FAILURES_STATE_KEY, ToolObservation, trace_attributes


class ScriptedModel(Model):
    def __init__(self, uses):
        self.uses = uses

    def get_config(self):
        return {"model_id": "offline", "stateful": False}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        yield {"messageStart": {"role": "assistant"}}
        if not any("toolResult" in b for m in messages for b in m["content"]):
            for index, (name, inputs) in enumerate(self.uses):
                yield {"contentBlockStart": {"contentBlockIndex": index, "start": {"toolUse": {"toolUseId": f"u{index}", "name": name}}}}
                yield {"contentBlockDelta": {"contentBlockIndex": index, "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
                yield {"contentBlockStop": {"contentBlockIndex": index}}
            yield {"messageStop": {"stopReason": "tool_use"}}
            return
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "done"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


@tool
async def ok_tool(value: str) -> str:
    """Succeeds."""
    return value


@tool
async def bad_tool(value: str) -> str:
    """Raises."""
    raise ValueError(f"boom {value}")


def test_failures_are_flagged_in_agent_state_and_successes_are_not():
    agent = Agent(model=ScriptedModel([("ok_tool", {"value": "a"}), ("bad_tool", {"value": "b"}), ("missing", {})]),
                  tools=[ok_tool, bad_tool], hooks=[ToolObservation()], callback_handler=None,
                  trace_attributes=trace_attributes(session_id="s1", user_id="u1"))
    result = asyncio.run(agent.invoke_async("go"))
    assert result.stop_reason == "end_turn"
    flagged = agent.state.get(TOOL_FAILURES_STATE_KEY)
    assert flagged["count"] == 2
    assert flagged["last"]["tool_name"] in {"bad_tool", "missing"}
    assert flagged["last"]["status"] == "error" and flagged["last"]["retry"] is False
    assert isinstance(flagged["last"]["duration"], float)
    assert agent.trace_attributes == {"session.id": "s1", "user.id": "u1"}


def test_no_failures_leaves_state_untouched():
    agent = Agent(model=ScriptedModel([("ok_tool", {"value": "a"})]), tools=[ok_tool],
                  hooks=[ToolObservation()], callback_handler=None)
    asyncio.run(agent.invoke_async("go"))
    assert agent.state.get(TOOL_FAILURES_STATE_KEY) is None


def test_tool_outcome_shape():
    from strands.hooks import AfterToolCallEvent

    event = AfterToolCallEvent(agent=None, selected_tool=None, tool_use={"toolUseId": "t", "name": "x", "input": {}},
                               invocation_state={}, result={"toolUseId": "t", "status": "error", "content": []},
                               exception=RuntimeError("why"), duration=0.5)
    outcome = tool_observation.tool_outcome(event)
    assert outcome == {"tool_name": "x", "toolUseId": "t", "status": "error", "exception": "RuntimeError: why",
                       "duration": 0.5, "retry": False, "cancelled": False,
                       "implementation": None, "wrapped": [], "source": None}


def test_provenance_reports_wrapper_chain_and_vendored_source(tmp_path):
    """A catalog-loaded library tool reports its file (relative to the library) + sha; a renamed
    facade reports both the wrapper chain and the innermost source."""
    from strands.hooks import AfterToolCallEvent

    from agent.api.core import panel_tools
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR

    path = PROJECT_TOOLS_DIR / "research" / "perplexity_search_api.py"
    loaded = panel_tools.load_library_tool(PROJECT_TOOLS_DIR, path, "perplexity_search_api")
    renamed = panel_tools._RenamedTool(loaded, "perplexity_search")
    event = AfterToolCallEvent(agent=None, selected_tool=renamed, tool_use={"toolUseId": "t", "name": "perplexity_search", "input": {"query": "SECRETVALUE", "n": 2}},
                               invocation_state={}, result={"toolUseId": "t", "status": "success", "content": []}, exception=None, duration=0.1)
    outcome = tool_observation.tool_outcome(event)
    assert outcome["implementation"] == "_RenamedTool"
    assert outcome["wrapped"] == ["_AsyncNativeTool", "DecoratedFunctionTool"]
    assert outcome["source"]["path"] == "research/perplexity_search_api.py"
    assert outcome["source"]["sha256"] == tool_observation.file_sha256(path)
    assert tool_observation.is_library_tool(renamed)
    # A tool outside the library (here: a test-local @tool) is not repairable.
    assert not tool_observation.is_library_tool(ok_tool)

    redacted = tool_observation.redact_outcome(outcome, event.tool_use)
    assert redacted["arg_types"] == {"query": "str", "n": "int"}
    assert "SECRETVALUE" not in json.dumps(redacted)  # argument values never leave the session
    assert redacted["source"] == outcome["source"] and redacted["wrapped"] == outcome["wrapped"]
    assert redacted["exception_class"] is None

    failing = tool_observation.redact_outcome({**outcome, "exception": "KeyError: 'missing'"}, event.tool_use)
    assert failing["exception_class"] == "KeyError"


def test_revision_import_binds_vendored_module_name(tmp_path):
    """A repaired copy anywhere on disk executes under the vendored module name, so relative
    imports resolve, and the stamp points at the copy; re-importing the library file restores it."""
    from agent.api.core import panel_tools
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR

    path = PROJECT_TOOLS_DIR / "research" / "perplexity_search_api.py"
    copy = tmp_path / "perplexity_search_api.py"
    copy.write_text(path.read_text(encoding="utf-8").replace("import asyncio\n", "import asyncio\nREVISED = True\n", 1), encoding="utf-8")
    module = panel_tools.import_vendored_revision(PROJECT_TOOLS_DIR, path, copy)
    assert module.__name__ == "ron_vendored_tools.research.perplexity_search_api" and module.REVISED is True
    revised = panel_tools.load_library_tool(PROJECT_TOOLS_DIR, path, "perplexity_search_api", revision_file=copy)
    assert tool_observation.tool_source(revised)["path"] == str(copy.resolve())
    restored = panel_tools.import_vendored_module(PROJECT_TOOLS_DIR, path)
    assert not hasattr(restored, "REVISED") and restored.__file__ == str(path)


def test_evals_exporter_is_opt_in(monkeypatch):
    monkeypatch.setattr(tool_observation, "_exporter", None)
    monkeypatch.delenv("RON_TOOL_OBSERVATION", raising=False)
    assert tool_observation.setup_evals_exporter() is None
    monkeypatch.setenv("RON_TOOL_OBSERVATION", "1")
    pytest.importorskip("strands_evals")
    exporter = tool_observation.setup_evals_exporter()
    assert exporter is not None
    assert tool_observation.setup_evals_exporter() is exporter  # once per process
