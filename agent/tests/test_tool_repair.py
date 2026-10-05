"""Per-user tool repair (CAT-50/51): trigger, redaction, context examples, storage layout, fixer run
with scripted models + fake shell/sandbox, activate (sha check / 409), reload at the NEXT invocation,
rollback, restart recovery, and tenant isolation. Fully offline."""

from __future__ import annotations

import asyncio
import json
import textwrap
from pathlib import Path

import pytest
from strands import Agent, tool
from strands.models.model import Model
from strands.storage import InMemoryStorage
from strands.types.tools import AgentTool

from strands.sandbox import ExecutionResult
from strands.sandbox.not_a_sandbox_local_environment import NotASandboxLocalEnvironment

from agent.api.core import panel_agent, panel_storage, panel_tools, tool_repair
from agent.api.core.tool_observation import TOOL_FAILURES_STATE_KEY, ToolObservation, trace_attributes
from agent.api.core.tool_repair import (
    REPAIR_REQUEST_STATE_KEY, RepairConfig, RepairService, ToolRepairTrigger, pending_proposal,
    select_context_examples,
)

FLAKY_SOURCE = textwrap.dedent('''
    """Deliberately broken library tool for repair tests."""
    from strands import tool


    @tool
    def flaky(record: dict) -> str:
        """Return the record's label.

        Args:
            record: A mapping that should contain ``label``.
        """
        return str(record["label"])
''')

FIXED_SOURCE = FLAKY_SOURCE.replace('return str(record["label"])', 'return str(record.get("label", "<unlabelled>"))')


class ScriptedModel(Model):
    """Issues the given tool uses on the first call, then ends the turn."""

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
        # Per invocation: issue the tool uses unless the LAST user message is a tool-result turn.
        if not any("toolResult" in b for b in messages[-1]["content"]):
            for index, (name, inputs) in enumerate(self.uses):
                yield {"contentBlockStart": {"contentBlockIndex": index, "start": {"toolUse": {"toolUseId": f"u{index}", "name": name}}}}
                yield {"contentBlockDelta": {"contentBlockIndex": index, "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
                yield {"contentBlockStop": {"contentBlockIndex": index}}
            yield {"messageStop": {"stopReason": "tool_use"}}
            return
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "done"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


@pytest.fixture
def library(tmp_path, monkeypatch):
    """A tiny vendored library root with ``demo/flaky.py``; storage in memory; session dir in tmp."""
    root = tmp_path / "strands_tools"
    (root / "demo").mkdir(parents=True)
    (root / "demo" / "flaky.py").write_text(FLAKY_SOURCE, encoding="utf-8")
    monkeypatch.setattr(panel_agent, "PROJECT_TOOLS_DIR", root)
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    monkeypatch.setattr(tool_repair.config, "SESSION_STORAGE_DIR", tmp_path / "sessions")
    monkeypatch.delenv("RON_TOOL_OBSERVATION", raising=False)
    # Force a fresh module so a previous test's revision is not left in sys.modules.
    import sys
    sys.modules.pop("ron_vendored_tools.demo.flaky", None)
    return root


def _agent(root: Path, uses, *, user_id="alice", session_id="s1", revision=None, extra_hooks=()):
    path = root / "demo" / "flaky.py"
    flaky_tool = panel_tools.load_library_tool(root, path, "flaky", revision_file=revision)
    return Agent(model=ScriptedModel(uses), tools=[flaky_tool],
                 hooks=[ToolObservation(), ToolRepairTrigger(RepairConfig(threshold=2, models=("m",))), *extra_hooks],
                 callback_handler=None, trace_attributes=trace_attributes(session_id=session_id, user_id=user_id))


# --- Trigger -------------------------------------------------------------------------------

def test_trigger_proposes_after_threshold_identical_failures_of_a_library_tool(library):
    agent = _agent(library, [("flaky", {"record": {"secret": "SENSITIVE"}}), ("flaky", {"record": {"label": "ok"}}), ("flaky", {"record": {}})])
    asyncio.run(agent.invoke_async("go"))
    assert agent.state.get(TOOL_FAILURES_STATE_KEY)["count"] == 2
    proposal = pending_proposal(agent)
    assert proposal is not None
    assert proposal["tool_name"] == "flaky" and proposal["exception_class"] == "KeyError" and proposal["count"] == 2
    # Redacted: argument keys/types only, never values; provenance included.
    assert proposal["outcome"]["arg_types"] == {"record": "dict"}
    assert proposal["outcome"]["source"]["path"] == "demo/flaky.py"
    assert "SENSITIVE" not in json.dumps(proposal["outcome"]) and "KeyError" in proposal["outcome"]["exception"]
    # Context examples recorded (concurrent executor: completion order is not fixed).
    recorded = agent.state.get(tool_repair.REPAIR_CONTEXT_STATE_KEY)["flaky"]
    assert sorted(entry["status"] for entry in recorded) == ["error", "error", "success"]


def test_trigger_proposes_for_every_tool_kind_but_not_for_single_failures(library):
    """ALL tool failures propose a fix. The kind tells the fixer what it can deliver: a user-scoped
    revision (library) or a diagnosed proposal for the maintainer (core/mcp/other)."""
    @tool
    async def local_bad(value: str) -> str:
        """Raises."""
        raise ValueError(value)

    agent = Agent(model=ScriptedModel([("local_bad", {"value": "a"}), ("local_bad", {"value": "b"})]), tools=[local_bad],
                  hooks=[ToolObservation(), ToolRepairTrigger(RepairConfig(threshold=2))], callback_handler=None)
    asyncio.run(agent.invoke_async("go"))
    proposal = pending_proposal(agent)
    assert proposal is not None and proposal["tool_name"] == "local_bad" and proposal["kind"] == "core"
    assert tool_repair.target_kind(local_bad) == "core"
    once = _agent(library, [("flaky", {"record": {}})])
    asyncio.run(once.invoke_async("go"))
    assert pending_proposal(once) is None


def test_target_kind_classifies_mcp_core_library_and_other(library):
    from unittest.mock import Mock

    from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

    assert tool_repair.target_kind(panel_tools.load_library_tool(library, library / "demo" / "flaky.py", "flaky")) == "library"
    mcp_tool = Mock(spec=MCPAgentTool)
    mcp_tool.wrapped = None
    assert tool_repair.target_kind(mcp_tool) == "mcp"
    assert tool_repair.target_kind(panel_tools._AsyncNativeTool(mcp_tool)) == "mcp"  # browser tools are wrapped MCP tools
    assert tool_repair.target_kind(None) == "other"
    # Every kind is repairable per user (file / adapter / server); only a system prompt is not.
    assert tool_repair.route_fix("OTHERS", source_path="x.py", kind="mcp") == "repair"
    assert tool_repair.route_fix("OTHERS", source_path="x.py", kind="core") == "repair"
    assert tool_repair.route_fix("OTHERS", source_path="demo/flaky.py", kind="library") == "repair"
    assert tool_repair.route_fix("SYSTEM_PROMPT_FIX", source_path=None, kind="mcp") == "needs_maintainer"


def test_select_context_examples_most_recent_first_excluding_failing_and_marking_dry_runs():
    messages = [
        {"role": "assistant", "content": [{"toolUse": {"toolUseId": "a", "name": "flaky", "input": {"record": {"label": 1}}}}]},
        {"role": "assistant", "content": [{"toolUse": {"toolUseId": "b", "name": "other", "input": {}}}]},
        {"role": "assistant", "content": [{"toolUse": {"toolUseId": "c", "name": "flaky", "input": {"record": {"label": 2}}}}]},
        {"role": "assistant", "content": [{"toolUse": {"toolUseId": "fail", "name": "flaky", "input": {"record": {}}}}]},
    ]
    examples = select_context_examples(messages, "flaky", exclude_tool_use_id="fail")
    assert [e["toolUseId"] for e in examples] == ["c", "a"]
    assert all(e["kind"] == "context" and e["source"] == "session" and e["dry_run"] is False for e in examples)
    assert select_context_examples(messages, "flaky", n=1)[0]["toolUseId"] == "fail"
    assert tool_repair.is_side_effecting("shell", {}) and tool_repair.is_side_effecting("http_request", {"method": "POST"})
    assert not tool_repair.is_side_effecting("http_request", {"method": "GET"})
    assert tool_repair.is_side_effecting("user_browser_browser_click", {})


def test_route_fix_table():
    assert tool_repair.route_fix("OTHERS", source_path="demo/flaky.py") == "repair"
    assert tool_repair.route_fix("TOOL_DESCRIPTION_FIX", source_path="demo/flaky.py") == "repair"
    assert tool_repair.route_fix("WRAPPER_FIX", source_path="demo/flaky.py") == "repair"
    assert tool_repair.route_fix("WRAPPER_FIX", source_path="core/panel_tools.py") == "needs_maintainer"
    assert tool_repair.route_fix("SYSTEM_PROMPT_FIX", source_path="demo/flaky.py") == "needs_maintainer"
    with pytest.raises(ValueError):
        tool_repair.route_fix("NOPE", source_path=None)


# --- Fixer run (scripted model, fake shell MCP, fake sandbox) -------------------------------

class WorkspaceSandbox(NotASandboxLocalEnvironment):
    """Test double for the SDK DockerSandbox: the harness's write/read/edit/shell run on the host,
    with the container path /workspace mapped onto the run's workspace directory."""

    def __init__(self, workspace: Path) -> None:
        super().__init__()
        self.workspace = workspace

    def _map(self, path: str) -> str:
        return str(self.workspace / path[len("/workspace/"):]) if path.startswith("/workspace/") else path

    async def write_file(self, path, content, **kwargs):
        return await super().write_file(self._map(path), content, **kwargs)

    async def read_file(self, path, **kwargs):
        return await super().read_file(self._map(path), **kwargs)

    async def execute_streaming(self, command, **kwargs):
        # pytest/demonstrations are "run" by the fake: report success without touching the host.
        yield ExecutionResult(stdout="5 passed\n", stderr="", exit_code=0)


def _fake_sandbox(run):
    return WorkspaceSandbox(run.workspace), "docker"


class FixerModel(ScriptedModel):
    """Drives the fixer: write the repaired file + test, run the sandbox, record five demos, submit."""


def _fixer_builder(uses):
    def build(provider, model_id, effort=None, *, hosted_tools=True):
        return FixerModel(uses)
    return build


def _fixer_script(status="verified", fix_type="OTHERS", demos=5):
    demonstrations = [("record_demonstration", {"kind": "failing", "input": {"record": {}}, "expected": "<unlabelled>",
                                                "actual": "<unlabelled>", "status": "passed", "dry_run": False, "source": "session"})]
    for i in range(demos - 1):
        demonstrations.append(("record_demonstration", {"kind": "context", "input": {"record": {"label": i}}, "expected": str(i),
                                                        "actual": str(i), "status": "passed", "dry_run": False,
                                                        "source": "session" if i == 0 else "synthetic"}))
    return [
        ("write", {"path": "/workspace/files/demo/flaky.py", "content": FIXED_SOURCE}),
        ("write", {"path": "/workspace/tests/test_flaky.py", "content": "def test_ok():\n    assert True\n"}),
        ("shell", {"command": "pytest -q /workspace/tests"}),
        *demonstrations,
        ("submit_repair", {"status": status, "fix_type": fix_type, "summary": "Guard the missing label key.",
                           "reflection": {str(i): "answer" for i in range(1, 8)},
                           "wrapper_audit": {"direct_call": "KeyError", "wrapped_call": "KeyError", "conclusion": "tool defect"},
                           "diff": "-return str(record[\"label\"])\n+return str(record.get(\"label\", \"<unlabelled>\"))",
                           "test_file": "tests/test_flaky.py"}),
    ]


def _run_fixer(library, *, script, user_id="alice", session_id="s1", agent=None, events=None):
    service = RepairService(RepairConfig(threshold=2, models=("m1", "m2"), timeout_s=60))
    if agent is None:
        agent = _agent(library, [("flaky", {"record": {}}), ("flaky", {"record": {}})], user_id=user_id, session_id=session_id)
        asyncio.run(agent.invoke_async("go"))
    assert pending_proposal(agent) is not None

    async def go():
        started = await service.start(
            user_id=user_id, session_id=session_id, tool_name="flaky", session_messages=list(agent.messages), agent=agent,
            on_event=(events.append if events is not None else None), build_model=_fixer_builder(script),
            sandbox_factory=_fake_sandbox, sop_prompt="SOP: repair carefully.",
        )
        assert started["state"] == "running"
        return await service.wait(user_id, "flaky")

    return agent, asyncio.run(go())


def test_fixer_run_writes_verified_manifest_and_files(library):
    events: list = []
    agent, result = _run_fixer(library, script=_fixer_script(), events=events)
    assert result["status"] == "verified" and result["sandbox"] == "docker" and result["route"] == "repair"
    assert len(result["demonstrations"]) == 5 and {d["kind"] for d in result["demonstrations"]} == {"failing", "context"}
    assert any("event" in e for e in events) and events[-1]["ready"]["status"] == "verified"
    revisions = asyncio.run(tool_repair.list_repairs("alice"))
    assert len(revisions) == 1
    manifest = revisions[0]
    assert manifest["tool_name"] == "flaky" and manifest["status"] == "verified" and manifest["active"] is False
    assert manifest["repair_kind"] == "file" and manifest["target_kind"] == "library"
    assert manifest["source_path"] == "demo/flaky.py" and manifest["base_sha256"] == tool_repair.file_sha256(library / "demo" / "flaky.py")
    assert manifest["reflection"]["7"] == "answer" and manifest["wrapper_audit"]["conclusion"] == "tool defect"
    assert "files/demo/flaky.py" in manifest["files"] and "tests/test_flaky.py" in manifest["files"]
    stored = asyncio.run(tool_repair.repair_storage("alice").read(f"flaky/{manifest['revision']}/files/demo/flaky.py"))
    assert stored is not None and b'record.get("label"' in stored
    assert agent.state.get(REPAIR_REQUEST_STATE_KEY)["status"] == "ready"
    # Another user sees nothing.
    assert asyncio.run(tool_repair.list_repairs("bob")) == []


def test_fixer_verified_requires_five_passed_demonstrations(library):
    _, result = _run_fixer(library, script=_fixer_script(demos=2))
    # submit_repair raised -> the model's turn ended without a successful submit -> failed manifest.
    assert result["status"] == "failed"


def test_fixer_local_sandbox_downgrades_to_unverified(library):
    def local_sandbox(run):
        sandbox, _ = _fake_sandbox(run)
        return sandbox, "local"

    service = RepairService(RepairConfig(threshold=2, models=("m1",), timeout_s=60))
    agent = _agent(library, [("flaky", {"record": {}}), ("flaky", {"record": {}})])
    asyncio.run(agent.invoke_async("go"))

    async def go():
        await service.start(user_id="alice", session_id="s1", tool_name="flaky", session_messages=list(agent.messages), agent=agent,
                            build_model=_fixer_builder(_fixer_script()), sandbox_factory=local_sandbox,
                            sop_prompt="SOP")
        return await service.wait("alice", "flaky")

    result = asyncio.run(go())
    assert result["status"] == "unverified" and result["sandbox"] == "local"
    with pytest.raises(ValueError):
        asyncio.run(tool_repair.activate("alice", "flaky", result["revision"]))


def test_fixer_system_prompt_fix_routes_to_needs_maintainer(library):
    _, result = _run_fixer(library, script=_fixer_script(fix_type="SYSTEM_PROMPT_FIX"))
    assert result["status"] == "needs_maintainer" and result["route"] == "needs_maintainer"


def test_fixer_rejects_unregistered_tool_and_concurrent_runs(library):
    service = RepairService(RepairConfig(threshold=2, models=("m1",)))
    agent = _agent(library, [("flaky", {"record": {}}), ("flaky", {"record": {}})])
    asyncio.run(agent.invoke_async("go"))

    async def go():
        with pytest.raises(ValueError):
            await service.start(user_id="alice", session_id="s1", tool_name="missing", session_messages=[], agent=agent)
        gate = asyncio.Event()

        class SlowSandbox(WorkspaceSandbox):
            async def execute_streaming(self, command, **kwargs):
                await gate.wait()
                yield ExecutionResult(stdout="ok\n", stderr="", exit_code=0)

        def slow_sandbox(run):
            return SlowSandbox(run.workspace), "docker"

        await service.start(user_id="alice", session_id="s1", tool_name="flaky", session_messages=list(agent.messages), agent=agent,
                            build_model=_fixer_builder(_fixer_script()), sandbox_factory=slow_sandbox,
                            sop_prompt="SOP")
        await asyncio.sleep(0.05)
        with pytest.raises(RuntimeError):
            await service.start(user_id="alice", session_id="s1", tool_name="flaky", session_messages=list(agent.messages), agent=agent,
                                build_model=_fixer_builder(_fixer_script()), sandbox_factory=slow_sandbox,
                                sop_prompt="SOP")
        gate.set()
        await service.wait("alice", "flaky")

    asyncio.run(go())


ADAPTER_SOURCE = """
def transform_input(input):
    # The model keeps sending `value`; the tool requires a dict `record` with a label.
    value = input.get("value", "")
    return {"record": {"label": value or "<unlabelled>"}}


def transform_result(result, input):
    return result
"""


def _adapter_script(tool_name: str, status="verified"):
    base = [item for item in _fixer_script(status=status) if item[0] != "write"]
    submit = base[-1][1] | {"repair_kind": "adapter", "diff": "+ adapter transform_input: value -> record.label"}
    return [("write", {"path": f"/workspace/adapter/{tool_name}.py", "content": ADAPTER_SOURCE}),
            ("write", {"path": f"/workspace/tests/test_{tool_name}.py", "content": "def test_ok():\n    assert True\n"}),
            *base[1:-1], ("submit_repair", submit)]


def test_fixer_repairs_a_core_tool_with_a_user_scoped_adapter(library):
    """A non-library failure is repaired too: the fixer writes an adapter module (transform_input /
    transform_result) that wraps the registered tool for THIS user; activation applies it to the live
    session via ToolRegistry.replace (next invocation) and to new sessions via the catalog adapter."""
    @tool
    async def host_tool(record: dict) -> str:
        """Needs record.label."""
        return str(record["label"])

    # The model mis-calls it with `value`; the SDK validates input -> error twice -> proposal (kind=core).
    agent = Agent(model=ScriptedModel([("host_tool", {"value": "a"}), ("host_tool", {"value": "b"})]), tools=[host_tool],
                  hooks=[ToolObservation(), ToolRepairTrigger(RepairConfig(threshold=2, models=("m",)))], callback_handler=None)
    asyncio.run(agent.invoke_async("go"))
    assert pending_proposal(agent)["kind"] == "core"
    service = RepairService(RepairConfig(threshold=2, models=("m1",), timeout_s=60))

    async def go():
        started = await service.start(user_id="alice", session_id="s1", tool_name="host_tool", session_messages=list(agent.messages),
                                      agent=agent, build_model=_fixer_builder(_adapter_script("host_tool")), sandbox_factory=_fake_sandbox,
                                      sop_prompt="SOP")
        return started, await service.wait("alice", "host_tool")

    started, result = asyncio.run(go())
    assert result["status"] == "verified" and result["route"] == "repair"
    manifest = asyncio.run(tool_repair.read_manifest("alice", "host_tool", started["revision"]))
    assert manifest["target_kind"] == "core" and manifest["repair_kind"] == "adapter"
    assert "adapter/host_tool.py" in manifest["files"] and manifest["base_sha256"] is not None
    active = asyncio.run(tool_repair.activate("alice", "host_tool", started["revision"]))
    assert active["repair_kind"] == "adapter"
    assert tool_repair.active_adapter_file("alice", "host_tool")[1] == started["revision"]
    assert tool_repair.active_adapter_file("bob", "host_tool") is None

    # New session for alice: the catalog wraps the tool; the mis-call now succeeds. Bob: unchanged.
    def run_as(user_id):
        catalog = panel_tools.PanelToolCatalog(tools=[host_tool])
        catalog.set_tool_adapter(lambda value: tool_repair.adapt_tool(user_id, value))
        live = Agent(model=ScriptedModel([("host_tool", {"value": "hello"})]), tools=[catalog], callback_handler=None)
        catalog.bind(live)
        asyncio.run(live.invoke_async("go"))
        return [b["toolResult"] for m in live.messages for b in m["content"] if "toolResult" in b][-1]

    alice = run_as("alice")
    assert alice["status"] == "success" and "hello" in json.dumps(alice["content"])
    assert run_as("bob")["status"] == "error"

    # Live session: replace_tool applies the adapter (next invocation); rollback unwraps.
    catalog = panel_tools.PanelToolCatalog(tools=[host_tool])
    live = Agent(model=ScriptedModel([("host_tool", {"value": "x"})]), tools=[catalog], callback_handler=None)
    catalog.bind(live)
    adapter = tool_repair.load_adapter(tool_repair.active_adapter_file("alice", "host_tool")[0])
    assert asyncio.run(catalog.replace_tool("host_tool", agent=live, build=lambda base: tool_repair._AdaptedTool(base, adapter, "r")))
    asyncio.run(live.invoke_async("go"))
    assert [b["toolResult"]["status"] for m in live.messages for b in m["content"] if "toolResult" in b] == ["success"]
    assert asyncio.run(catalog.replace_tool("host_tool", agent=live, build=lambda base: base))
    assert type(live.tool_registry.registry["host_tool"]).__name__ != "_AdaptedTool"
    asyncio.run(tool_repair.rollback("alice", "host_tool"))
    assert tool_repair.active_adapter_file("alice", "host_tool") is None


def test_fixer_repairs_an_mcp_browser_tool_with_an_adapter_and_server_revision(library, monkeypatch):
    """MCP/browser tools are repaired per user too: (a) an adapter wraps the MCP tool in the user's
    registry (incl. when it arrives from the MCP provider list), (b) a `server` revision is a repaired
    copy of electron_playwright_mcp that this user's browser server process runs via PYTHONPATH."""
    from unittest.mock import Mock

    from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

    from agent.api.core.panel_browser import browser_client_factory

    # A fake MCP tool: fails unless `selector` is present (the model sends `element`).
    class FakeMCPTool(MCPAgentTool):  # type: ignore[misc]
        def __init__(self):
            AgentTool.__init__(self)
            self.mcp_client = object()
            self.mcp_tool = Mock(name="user_browser_browser_click")

        @property
        def tool_name(self):
            return "user_browser_browser_click"

        @property
        def tool_spec(self):
            return {"name": self.tool_name, "description": "click", "inputSchema": {"json": {"type": "object", "properties": {"selector": {"type": "string"}}}}}

        @property
        def tool_type(self):
            return "python"

        async def stream(self, tool_use, invocation_state, **kwargs):
            inputs = tool_use.get("input") or {}
            if "selector" not in inputs:
                yield {"toolUseId": tool_use["toolUseId"], "status": "error", "content": [{"text": "ToolError: selector is required"}]}
                return
            yield {"toolUseId": tool_use["toolUseId"], "status": "success", "content": [{"text": f"clicked {inputs['selector']}"}]}

    mcp_tool = FakeMCPTool()
    assert tool_repair.target_kind(mcp_tool) == "mcp"
    agent = Agent(model=ScriptedModel([("user_browser_browser_click", {"element": "#go"}), ("user_browser_browser_click", {"element": "#go"})]),
                  tools=[mcp_tool], hooks=[ToolObservation(), ToolRepairTrigger(RepairConfig(threshold=2, models=("m",)))], callback_handler=None)
    asyncio.run(agent.invoke_async("go"))
    assert pending_proposal(agent)["kind"] == "mcp"

    adapter_source = "def transform_input(input):\n    return {'selector': input.get('selector') or input.get('element')}\n"
    base = [item for item in _fixer_script() if item[0] != "write"]
    script = [("write", {"path": "/workspace/adapter/user_browser_browser_click.py", "content": adapter_source}),
              *base[:-1], ("submit_repair", base[-1][1] | {"repair_kind": "adapter", "diff": "+ element -> selector"})]
    service = RepairService(RepairConfig(threshold=2, models=("m1",), timeout_s=60))

    async def go():
        started = await service.start(user_id="alice", session_id="s1", tool_name="user_browser_browser_click",
                                      session_messages=list(agent.messages), agent=agent, build_model=_fixer_builder(script),
                                      sandbox_factory=_fake_sandbox, sop_prompt="SOP")
        return started, await service.wait("alice", "user_browser_browser_click")

    started, result = asyncio.run(go())
    assert result["status"] == "verified" and result["route"] == "repair"
    manifest = asyncio.run(tool_repair.read_manifest("alice", "user_browser_browser_click", started["revision"]))
    assert manifest["target_kind"] == "mcp" and manifest["repair_kind"] == "adapter"
    asyncio.run(tool_repair.activate("alice", "user_browser_browser_click", started["revision"]))

    # The MCP tool coming from the provider list is wrapped by the catalog for alice only.
    class Provider:
        def __init__(self, tool_):
            self._tool = tool_
        def add_consumer(self, *a, **k): pass
        def remove_consumer(self, *a, **k): pass
        async def load_tools(self, **k): return [self._tool]

    def run_as(user_id):
        catalog = panel_tools.PanelToolCatalog(tools=[FakeMCPTool()])
        catalog.set_tool_adapter(lambda value: tool_repair.adapt_tool(user_id, value))
        live = Agent(model=ScriptedModel([("user_browser_browser_click", {"element": "#buy"})]), tools=[catalog], callback_handler=None)
        catalog.bind(live)
        asyncio.run(live.invoke_async("go"))
        return [b["toolResult"] for m in live.messages for b in m["content"] if "toolResult" in b][-1]

    alice = run_as("alice")
    assert alice["status"] == "success" and "clicked #buy" in json.dumps(alice["content"])
    assert run_as("bob")["status"] == "error"

    # (b) server revision: a repaired copy of the MCP server package is put first on THIS user's
    # browser server PYTHONPATH; nothing changes for bob or for the shared install.
    rev = "20261004t000000-srv001"
    pkg = f"user_browser_browser_click/{rev}/server/{tool_repair.MCP_SERVER_PACKAGE}/server.py"
    asyncio.run(tool_repair.repair_storage("alice").write(pkg, b"# repaired server\n"))
    asyncio.run(tool_repair.repair_storage("alice").write(f"user_browser_browser_click/{rev}/server/{tool_repair.MCP_SERVER_PACKAGE}/__init__.py", b""))
    asyncio.run(tool_repair.write_manifest("alice", {"tool_name": "user_browser_browser_click", "revision": rev, "target_kind": "mcp",
        "repair_kind": "server", "source_path": None, "base_sha256": None, "status": "verified", "created_at": "2026-10-04T00:00:00",
        "demonstrations": [], "files": [f"server/{tool_repair.MCP_SERVER_PACKAGE}/server.py"]}))
    active = asyncio.run(tool_repair.activate("alice", "user_browser_browser_click", rev))
    assert active["repair_kind"] == "server"
    dirs = tool_repair.active_server_dirs("alice")
    assert len(dirs) == 1 and (dirs[0] / tool_repair.MCP_SERVER_PACKAGE / "server.py").is_file()
    env = tool_repair.browser_server_env("alice")
    assert env["PYTHONPATH"] == str(dirs[0]) and tool_repair.browser_server_env("bob") == {}
    captured = {}

    class FakeParams:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("mcp.StdioServerParameters", FakeParams)
    monkeypatch.setattr("strands.tools.mcp.MCPClient", lambda *a, **k: Mock(name="client"))
    browser_client_factory("user", extra_env=env)()
    assert captured["env"]["PYTHONPATH"] == str(dirs[0]) and "ELECTRON_PLAYWRIGHT_MCP_ELECTRON_URL" in captured["env"]
    asyncio.run(tool_repair.rollback("alice", "user_browser_browser_click"))
    assert tool_repair.browser_server_env("alice") == {}


# --- Activate / reload / rollback / restart / isolation -------------------------------------

def test_activate_checks_sha_then_reload_takes_effect_at_next_invocation_and_rollback_restores(library):
    agent, result = _run_fixer(library, script=_fixer_script())
    rev = result["revision"]
    path = library / "demo" / "flaky.py"

    # Library drift -> 409-style conflict; restoring the file makes activation succeed.
    original = path.read_text(encoding="utf-8")
    path.write_text(original + "\n# touched\n", encoding="utf-8")
    with pytest.raises(tool_repair.RevisionConflict):
        asyncio.run(tool_repair.activate("alice", "flaky", rev))
    path.write_text(original, encoding="utf-8")
    active = asyncio.run(tool_repair.activate("alice", "flaky", rev))
    assert active["revision"] == rev and Path(active["revision_file"]).is_file()
    assert asyncio.run(tool_repair.read_active("alice", "flaky"))["revision"] == rev
    assert asyncio.run(tool_repair.list_repairs("alice"))[0]["active"] is True
    # Sync resolver used by the catalog loader for new sessions of THIS user only.
    assert tool_repair.active_revision_file("alice", "flaky", path) == Path(active["revision_file"])
    assert tool_repair.active_revision_file("bob", "flaky", path) is None

    # A live session: the swap lands while a `flaky` call is IN FLIGHT (its stream has started),
    # so that call completes on the old code; the repaired revision is what the registry resolves
    # from the next invocation on (native ToolRegistry.replace semantics).
    swapped: dict = {}

    class SwapDuringCall(panel_tools._AsyncNativeTool):
        async def stream(self, tool_use, invocation_state, **kwargs):
            if not swapped:
                swapped["done"] = await catalog.reload_tool("flaky", agent=live, root=library, path=path,
                                                            revision_file=Path(active["revision_file"]))
            async for event in super().stream(tool_use, invocation_state, **kwargs):
                yield event

    old_tool = SwapDuringCall(panel_tools.load_library_tool(library, path, "flaky"))
    catalog = panel_tools.PanelToolCatalog(tools=[old_tool])
    live = Agent(model=ScriptedModel([("flaky", {"record": {}})]), tools=[catalog], callback_handler=None)
    catalog.bind(live)
    assert panel_tools.PanelToolCatalog.for_agent(live) is catalog
    first = asyncio.run(live.invoke_async("go"))
    assert swapped["done"] is True
    first_results = [b["toolResult"] for m in live.messages for b in m["content"] if "toolResult" in b]
    assert first_results[0]["status"] == "error"  # old code: KeyError
    live.model = ScriptedModel([("flaky", {"record": {}})])
    asyncio.run(live.invoke_async("again"))
    results = [b["toolResult"] for m in live.messages for b in m["content"] if "toolResult" in b]
    assert results[-1]["status"] == "success" and "<unlabelled>" in json.dumps(results[-1]["content"])
    assert first.stop_reason == "end_turn"

    # The userTurn notice announces the activation once per session.
    from strands.vended_plugins.context_injector import InjectionContext
    render = tool_repair.revision_notice_render("alice")
    context = InjectionContext(messages=live.messages, state=live.state, agent=live)
    note = render(context)
    assert note is not None and "flaky" in note and rev in note
    assert live.state.get(tool_repair.REPAIR_NOTICES_STATE_KEY) == [f"flaky@{rev}"]
    assert render(context) is None  # once per session
    assert tool_repair.revision_notice("alice").name == "ron:tool-repair-notice"

    # Rollback: active.json removed, reload back to the vendored file -> KeyError again next invocation.
    rolled = asyncio.run(tool_repair.rollback("alice", "flaky"))
    assert rolled["previous"]["revision"] == rev
    assert asyncio.run(tool_repair.read_active("alice", "flaky")) is None
    assert tool_repair.active_revision_file("alice", "flaky", path) is None
    assert asyncio.run(tool_repair.list_repairs("alice"))[0]["status"] == "rolled_back"
    asyncio.run(catalog.reload_tool("flaky", agent=live, root=library, path=path, revision_file=None))
    live.model = ScriptedModel([("flaky", {"record": {}})])
    asyncio.run(live.invoke_async("third"))
    results = [b["toolResult"] for m in live.messages for b in m["content"] if "toolResult" in b]
    assert results[-1]["status"] == "error"


def test_new_session_load_path_uses_active_revision_for_this_user_only(library):
    _, result = _run_fixer(library, script=_fixer_script())
    asyncio.run(tool_repair.activate("alice", "flaky", result["revision"]))
    path = library / "demo" / "flaky.py"

    def build(user_id):
        catalog = panel_tools.PanelToolCatalog()
        catalog.set_revision_resolver(tool_repair.revision_resolver(user_id))
        agent = Agent(model=ScriptedModel([("flaky", {"record": {}})]), tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        asyncio.run(catalog.stage_tool(path, "flaky", agent=agent, root=library))
        asyncio.run(agent.invoke_async("go"))
        return [b["toolResult"] for m in agent.messages for b in m["content"] if "toolResult" in b][-1]

    assert build("alice")["status"] == "success"   # repaired revision
    assert build("bob")["status"] == "error"       # vendored file, untouched


def test_restart_recovery_rematerializes_active_revisions(library, tmp_path):
    _, result = _run_fixer(library, script=_fixer_script())
    active = asyncio.run(tool_repair.activate("alice", "flaky", result["revision"]))
    # Simulate a restart: the local materialized copy is gone, storage (active.json) survives.
    import shutil
    shutil.rmtree(tool_repair._active_dir("alice"))
    assert tool_repair.active_revision_file("alice", "flaky", library / "demo" / "flaky.py") is None
    assert asyncio.run(tool_repair.restore_active_markers("alice")) == 1
    assert tool_repair.active_revision_file("alice", "flaky", library / "demo" / "flaky.py") == Path(active["revision_file"])


def test_sop_is_served_by_the_native_sop_server_with_parameters_as_user_input(library):
    """The fixer's input is the native Agent SOP prompt: the pinned strands_agents_sops MCP server
    renders `Run this SOP: <agent-sop name=...><content>SOP</content><user-input>params</user-input>`."""
    from agent.api.core.native_sop import native_sop_prompt

    text = native_sop_prompt(tool_repair.SOPS_DIR, "tool_name: flaky", name=tool_repair.SOP_NAME)
    assert text.startswith("Run this SOP:") and f'<agent-sop name="{tool_repair.SOP_NAME}">' in text
    assert "## Parameters" in text and "## Steps" in text and "### 2. Wrapper audit" in text and "submit_repair" in text
    assert "<user-input>\ntool_name: flaky\n</user-input>" in text
    run = tool_repair.RepairRun(user_id="alice", session_id="s1", tool_name="flaky", revision="r1", workspace=library / "ws",
                                manifest={"target_kind": "library", "source_path": "demo/flaky.py", "base_sha256": "abc",
                                          "tool_spec": {"name": "flaky", "inputSchema": {}}}, sandbox="docker")
    params = tool_repair.sop_parameters(run, {"outcome": {"exception": "KeyError: 'label'"}, "count": 2},
                                        {"toolUseId": "u0", "input": {"record": {}}}, [], None)
    assert params.startswith("tool_name: flaky\ntarget_kind: library") and "failing_request:" in params and "KeyError" in params
    rendered = tool_repair.sop_task(run, {"outcome": {}, "count": 2}, None, [], None, sop_prompt="BODY")
    assert "<content>\nBODY\n</content>" in rendered and "sandbox: docker" in rendered


def test_fixer_defaults_to_gpt_6_1_sol_at_max_effort(monkeypatch):
    monkeypatch.delenv("RON_TOOL_REPAIR_MODELS", raising=False)
    monkeypatch.delenv("RON_TOOL_REPAIR_EFFORT", raising=False)
    cfg = RepairConfig.from_env()
    assert cfg.models == ("openai/gpt-6.1-sol",) and cfg.effort == "max"
    seen = []

    def build(provider, model_id, effort=None, *, hosted_tools=True):
        seen.append((provider, model_id, effort, hosted_tools))
        return ScriptedModel([])

    run = tool_repair.RepairRun(user_id="alice", session_id="s1", tool_name="flaky", revision="r1",
                                workspace=tool_repair.config.SESSION_STORAGE_DIR / "repairs" / "x" / "r1",
                                manifest={"target_kind": "library"})
    fixer = tool_repair.build_fixer(run, models=cfg.models, effort=cfg.effort, build_model=build, sandbox_factory=_fake_sandbox)
    try:
        assert seen == [("perplexity", "openai/gpt-6.1-sol", "max", False)]  # hosted tools are set explicitly on params
        names = set(fixer.tool_registry.registry)
        assert {"shell", "read", "write", "edit", "todo_write", "record_demonstration", "submit_repair"} <= names
        assert not names & {"editor", "environment", "mcp_client", "http_request", "subagent", "web_fetch"}
    finally:
        fixer.cleanup()


# --- HTTP surface: proposal on the stream, fixer run, ready event, activate/rollback -----------

def test_http_repair_loop_end_to_end(library, monkeypatch):
    """POST /chat (two KeyErrors) -> tool_repair_proposed; POST /tools/repairs -> fixer runs while the
    session is idle and `tool_repair_ready` lands on GET /sessions/{id}/events; activate swaps the
    tool in the live session (409 on library drift); rollback restores the vendored file."""
    import httpx
    from agent.api.endpoints import chat
    from agent.api.main import app
    from agent.api.core.panel_runtime import PanelRuntimeManager

    path = library / "demo" / "flaky.py"
    uses = [("flaky", {"record": {}}), ("flaky", {"record": {}})]
    agents: list[Agent] = []

    def construct(**kwargs):
        runtime_options = kwargs["runtime_options"]
        catalog = panel_tools.PanelToolCatalog(tools=[panel_tools.load_library_tool(library, path, "flaky")])
        catalog.set_revision_resolver(tool_repair.revision_resolver(kwargs["user_id"]))
        agent = Agent(model=ScriptedModel(list(uses)), tools=[catalog],
                      **{**runtime_options, "hooks": [*runtime_options["hooks"], ToolObservation(),
                                                      ToolRepairTrigger(RepairConfig(threshold=2, models=("m",)))]})
        catalog.bind(agent)
        agents.append(agent)
        return agent

    users: dict = {}
    manager = PanelRuntimeManager(factory=chat._create_runtime_agent,
                                  storage_factory=lambda user: users.setdefault(user, InMemoryStorage()), shutdown_timeout=0.05)
    monkeypatch.setattr(chat, "create_panel_agent", construct)
    monkeypatch.setattr(chat, "provider_api_key", lambda _: "offline-key-guard")
    monkeypatch.setattr(chat, "configured_providers", lambda: ["openai"])
    monkeypatch.setattr(chat, "create_runtime_manager", lambda: manager)
    monkeypatch.delenv("PANEL_A2A_ENABLED", raising=False)
    # The service's fixer is scripted + fake shell/sandbox: patch the module-level factories it uses.
    monkeypatch.setattr(panel_agent, "build_model", _fixer_builder(_fixer_script()))
    monkeypatch.setattr(tool_repair, "create_sandbox", _fake_sandbox)
    monkeypatch.setattr(tool_repair, "native_sop_prompt", lambda *a, **k: "SOP")

    def frames(response):
        assert response.status_code == 200, response.text
        return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]

    async def scenario():
        async with app.router.lifespan_context(app):
            app.state.tool_repairs = RepairService(RepairConfig(threshold=2, models=("m1",), timeout_s=60))
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                body = {"session_id": "repair-chat", "user_id": "alice", "message": "go", "provider": "openai", "model": "offline"}
                stream = frames(await client.post("/chat", json=body))
                proposed = [e for e in stream if e["type"] == "tool_repair_proposed"]
                assert len(proposed) == 1 and proposed[0]["tool"] == "flaky" and proposed[0]["count"] == 2
                assert proposed[0]["outcome"]["arg_types"] == {"record": "dict"}
                assert stream[-1]["type"] == "run_finished"
                # Nothing ran yet; the user clicks Repair.
                assert (await client.get("/tools/repairs?user_id=alice")).json()["revisions"] == []
                started = await client.post("/tools/repairs", json={"user_id": "alice", "session_id": "repair-chat", "tool_name": "flaky"})
                assert started.status_code == 200, started.text
                rev = started.json()["revision"]
                result = await app.state.tool_repairs.wait("alice", "flaky")
                assert result["status"] == "verified"
                after = stream[-1]["sequence"]
                tail = frames(await client.get(f"/sessions/repair-chat/events?user_id=alice&after={after}"))
                ready = [e for e in tail if e["type"] == "tool_repair_ready"]
                assert ready and ready[0]["rev"] == rev and ready[0]["status"] == "verified" and len(ready[0]["demonstrations"]) == 5
                # The fixer's child events rendered as the `repair` chain tool.
                assert any(e["type"] == "tool_input" and e["name"] == "repair" and e["id"] == f"repair:{rev}" for e in tail)
                assert any(e["node_path"] == [f"repair:{rev}"] for e in tail)
                listed = (await client.get("/tools/repairs?user_id=alice")).json()["revisions"]
                assert listed[0]["revision"] == rev and listed[0]["active"] is False
                # Other tenant: nothing.
                assert (await client.get("/tools/repairs?user_id=bob")).json()["revisions"] == []

                # Library drift -> 409.
                original = path.read_text(encoding="utf-8")
                path.write_text(original + "\n# drift\n", encoding="utf-8")
                conflict = await client.post("/tools/repairs/flaky/activate", json={"user_id": "alice", "rev": rev})
                assert conflict.status_code == 409
                path.write_text(original, encoding="utf-8")
                activated = await client.post("/tools/repairs/flaky/activate", json={"user_id": "alice", "rev": rev})
                assert activated.status_code == 200, activated.text
                assert activated.json()["live_sessions_reloaded"] == ["repair-chat"]
                # Next invocation of the same live session runs the repaired revision.
                agents[0].model = ScriptedModel([("flaky", {"record": {}})])
                second = frames(await client.post("/chat", json={**body, "message": "again"}))
                results = [e for e in second if e["type"] == "tool_result" and e["name"] == "flaky"]
                assert results and results[-1]["status"] == "success"
                assert not any(e["type"] == "tool_repair_proposed" for e in second)
                # Rollback -> vendored file again.
                rolled = await client.post("/tools/repairs/flaky/rollback", json={"user_id": "alice"})
                assert rolled.status_code == 200 and rolled.json()["live_sessions_reloaded"] == ["repair-chat"]
                agents[0].model = ScriptedModel([("flaky", {"record": {}})])
                third = frames(await client.post("/chat", json={**body, "message": "third"}))
                results = [e for e in third if e["type"] == "tool_result" and e["name"] == "flaky"]
                assert results and results[-1]["status"] == "error"
                # Validation: loopback-only, unknown tool, bad revision id.
                bad = await client.post("/tools/repairs", json={"user_id": "alice", "session_id": "repair-chat", "tool_name": "nope"})
                assert bad.status_code == 422
                assert (await client.post("/tools/repairs/flaky/activate", json={"user_id": "alice", "rev": "missing-rev"})).status_code == 404

    asyncio.run(scenario())


def test_server_revision_restarts_the_users_browser_mcp_server_in_a_live_session(library):
    """Activating a `server` revision stops the staged browser MCP server process and spawns a new one
    whose factory reads this user's current PYTHONPATH; the new tool list is published at the next
    boundary. Rollback restarts it again without the repaired package."""
    from unittest.mock import Mock

    from strands.tools.mcp import MCPClient

    spawned: list[dict] = []
    stopped: list[int] = []

    def make_tool(label: str):
        @tool(name="user_browser_browser_click")
        async def click(selector: str) -> str:
            """Click.

            Args:
                selector: CSS selector.
            """
            return f"{label}:{selector}"
        return click

    def factory(env_reader):
        def build():
            env = env_reader()
            client = MCPClient(lambda: None)
            tool_ = make_tool("repaired" if env.get("PYTHONPATH") else "stock")
            tool_.mcp_client = client  # identity used by the catalog to find the server's tools
            async def load_tools(**_kwargs):
                client._tool_provider_started = True  # what the real start() records; stop() runs at zero consumers
                return [tool_]

            client.load_tools = load_tools
            client.stop = Mock(side_effect=lambda *a: stopped.append(id(client)))
            spawned.append({"client": client, "env": env})
            return client
        return build

    env_reader = lambda: tool_repair.browser_server_env("alice")  # noqa: E731
    catalog = panel_tools.PanelToolCatalog(mcp_servers={"user_browser": {"command": "/bin/true"}},
                                           mcp_client_factories={"user_browser": factory(env_reader)})
    live = Agent(model=ScriptedModel([("user_browser_browser_click", {"selector": "#a"})]), tools=[catalog], callback_handler=None)
    catalog.bind(live)
    asyncio.run(catalog.stage_mcp_server("user_browser", agent=live))
    asyncio.run(live.invoke_async("go"))
    results = lambda: [b["toolResult"]["content"][0]["text"] for m in live.messages for b in m["content"] if "toolResult" in b]  # noqa: E731
    assert results()[-1] == "stock:#a" and spawned[0]["env"] == {}

    # Activate a server revision for alice -> restart -> new process sees PYTHONPATH -> next invocation uses it.
    rev = "20261005t000000-srv002"
    for name, data in ((f"{tool_repair.MCP_SERVER_PACKAGE}/__init__.py", b""), (f"{tool_repair.MCP_SERVER_PACKAGE}/server.py", b"# repaired\n")):
        asyncio.run(tool_repair.repair_storage("alice").write(f"user_browser_browser_click/{rev}/server/{name}", data))
    asyncio.run(tool_repair.write_manifest("alice", {"tool_name": "user_browser_browser_click", "revision": rev, "target_kind": "mcp",
        "repair_kind": "server", "source_path": None, "base_sha256": None, "status": "verified", "created_at": "2026-10-05T00:00:00",
        "demonstrations": [], "files": []}))
    asyncio.run(tool_repair.activate("alice", "user_browser_browser_click", rev))
    new_tools = asyncio.run(catalog.restart_mcp_server("user_browser", agent=live))
    assert new_tools == ["user_browser_browser_click"]
    assert len(spawned) == 2 and spawned[1]["env"]["PYTHONPATH"] and stopped == [id(spawned[0]["client"])]
    live.model = ScriptedModel([("user_browser_browser_click", {"selector": "#b"})])
    asyncio.run(live.invoke_async("again"))
    assert results()[-1] == "repaired:#b"

    # Rollback -> restart again -> stock server, old repaired process stopped.
    asyncio.run(tool_repair.rollback("alice", "user_browser_browser_click"))
    assert asyncio.run(catalog.restart_mcp_server("user_browser", agent=live)) == ["user_browser_browser_click"]
    assert len(spawned) == 3 and spawned[2]["env"] == {} and stopped[-1] == id(spawned[1]["client"])
    live.model = ScriptedModel([("user_browser_browser_click", {"selector": "#c"})])
    asyncio.run(live.invoke_async("third"))
    assert results()[-1] == "stock:#c"
    # A server that was never staged is a no-op.
    assert asyncio.run(catalog.restart_mcp_server("cloud_browser", agent=live)) == []
    live.cleanup()


def test_fixer_model_carries_perplexity_server_side_tools_and_a2a_provider(monkeypatch, tmp_path):
    """The fixer's Perplexity request carries the hosted tools (built-ins, GitHub connector, Context7 MCP)
    on the MODEL params — never in Agent.tools — and the installed strands_tools A2AClientToolProvider
    gives it a2a_discover_agent / a2a_list_discovered_agents / a2a_send_message over Ron's agents."""
    from agent.api.core import panel_agent

    monkeypatch.setenv("PERPLEXITY_API_KEY", "offline-key")
    monkeypatch.setenv("CONTEXT7_API_KEY", "ctx7-secret")
    monkeypatch.setattr(tool_repair.config, "CONTEXT7_API_KEY", "ctx7-secret")
    hosted = tool_repair.fixer_hosted_tools(["web_search", "fetch_url", "image_search", "sandbox", "connector_github", "context7"])
    assert [t["type"] for t in hosted] == ["web_search", "fetch_url", "image_search", "sandbox", "connector", "mcp"]
    assert hosted[4] == {"type": "connector", "id": "connector_github", "server_label": "github",
                         "server_description": hosted[4]["server_description"]}
    assert hosted[5]["server_url"] == "https://mcp.context7.com/mcp" and hosted[5]["authorization"] == "ctx7-secret"
    with pytest.raises(ValueError):
        tool_repair.fixer_hosted_tools(["nope"])

    run = tool_repair.RepairRun(user_id="alice", session_id="s1", tool_name="flaky", revision="r1",
                                workspace=tmp_path / "ws", manifest={"target_kind": "library"})
    fixer = tool_repair.build_fixer(run, models=("openai/gpt-6.1-sol",), effort="max", build_model=panel_agent.build_model,
                                    sandbox_factory=_fake_sandbox,
                                    hosted_tools=["web_search", "fetch_url", "image_search", "sandbox", "connector_github", "context7"],
                                    a2a_agents=["http://localhost:9999/a2a"])
    try:
        model = fixer.model.candidates[0] if hasattr(fixer.model, "candidates") else fixer.model
        params = model.config["params"]
        assert params["reasoning"] == {"effort": "max"} and model.config["model_id"] == "openai/gpt-6.1-sol"
        assert [t["type"] for t in params["tools"]] == ["web_search", "fetch_url", "image_search", "sandbox", "connector", "mcp"]
        names = set(fixer.tool_registry.registry)
        assert {"a2a_discover_agent", "a2a_list_discovered_agents", "a2a_send_message"} <= names
        assert not any(name in names for name in ("web_search", "fetch_url", "image_search", "sandbox", "connector_github", "context7"))
    finally:
        fixer.cleanup()


def test_fixer_talks_to_rons_native_a2a_server_over_a2a(tmp_path):
    """Native Strands A2A end-to-end: Ron's own A2AServer (panel_a2a) serves a Strands agent; the fixer's
    a2a_send_message tool (strands_tools A2AClientToolProvider) reaches it and gets the answer back."""
    import socket
    import threading
    import time

    import uvicorn
    from fastapi import FastAPI

    from agent.api.core.panel_a2a import create_panel_a2a_server, mount_panel_a2a

    class EchoModel(ScriptedModel):
        async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
            text = "".join(b.get("text", "") for b in messages[-1]["content"])
            yield {"messageStart": {"role": "assistant"}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": f"peer saw: {text}"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{port}/a2a"
    integration = create_panel_a2a_server(
        agent_factory=lambda context_id: Agent(model=EchoModel([]), name="Ron Peer", description="echo peer", callback_handler=None),
        http_url=url)
    app = FastAPI()
    assert mount_panel_a2a(app, integration, enabled=True, path="/a2a")
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 15
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started
    try:
        provider = tool_repair.fixer_a2a_provider([url])
        assert provider is not None
        by_name = {t.tool_name: t for t in provider.tools}

        async def call(name, inputs):
            result = None
            async for event in by_name[name].stream({"toolUseId": name, "name": name, "input": inputs}, {}):
                result = event
            return result["tool_result"] if isinstance(result, dict) and "tool_result" in result else result

        agents = asyncio.run(call("a2a_list_discovered_agents", {}))
        assert "Ron Peer" in json.dumps(agents["content"])
        reply = asyncio.run(call("a2a_send_message", {"message_text": "hello from the fixer", "target_agent_url": url}))
        assert reply["status"] == "success" and "peer saw: hello from the fixer" in json.dumps(reply["content"])
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        asyncio.run(integration.aclose())


def test_every_ron_agent_carries_native_a2a_tools(monkeypatch, tmp_path):
    """a2a_tools() is the single source: panel server URL (default this API's /a2a) + RON_A2A_AGENTS;
    PANEL_A2A_ENABLED=0 removes the tools everywhere; children never inherit them (parent-only)."""
    from agent.api.core import a2a_tools as a
    from agent.api.core.panel_tools import is_parent_only_tool

    monkeypatch.delenv("PANEL_A2A_ENABLED", raising=False)
    monkeypatch.delenv("PANEL_A2A_URL", raising=False)
    monkeypatch.setenv("RON_A2A_AGENTS", "http://peer.local/a2a, not-a-url ,http://peer.local/a2a")
    urls = a.a2a_agent_urls()
    assert urls[0].endswith("/a2a") and urls[1:] == ["http://peer.local/a2a"]
    tools = a.a2a_tools()
    assert sorted(t.tool_name for t in tools) == sorted(a.A2A_TOOL_NAMES)
    assert all(is_parent_only_tool(name) for name in a.A2A_TOOL_NAMES)
    monkeypatch.setenv("PANEL_A2A_ENABLED", "0")
    assert a.a2a_tools() == [] and tool_repair.fixer_a2a_provider() is None
