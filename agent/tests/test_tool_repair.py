"""Per-user tool repair (CAT-50/51): the native tool-failure hook starts a bounded investigation; the
real create_harness fixer is served by Ron's A2AServer and driven by the official a2a-sdk client
(input_required interrupt -> approve/decline -> applied); sandbox required (blocked without Docker);
activation bound to owner/base sha/artifact digest/approval token; reload at the NEXT invocation;
rollback; restart recovery; tenant isolation. Fully offline: scripted models, fake sandbox, ASGI transport."""

from __future__ import annotations

import asyncio
import json
import textwrap
from pathlib import Path
from types import SimpleNamespace
from typing import Any

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


def test_target_kind_classifies_mcp_core_library_and_other(library):
    from unittest.mock import Mock

    from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

    assert tool_repair.target_kind(panel_tools.load_library_tool(library, library / "demo" / "flaky.py", "flaky")) == "library"
    mcp_tool = Mock(spec=MCPAgentTool)
    mcp_tool.wrapped = None
    assert tool_repair.target_kind(mcp_tool) == "mcp"
    assert tool_repair.target_kind(tool_repair._AdaptedTool(mcp_tool, SimpleNamespace(), "r")) == "mcp"  # adapted MCP tools stay mcp
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




# --- Trigger: evidence capture, guidance, no live retry for side effects, no recursion ----------

def test_trigger_records_guidance_and_starts_one_investigation_with_full_evidence(library):
    """Two identical failures: the first (idempotent, visible params) is a guided retry, the second
    starts an investigation with the evidence the fixer needs; the request is redacted, the
    evidence keeps the exact failing input and the user's current request."""
    started: list = []
    trigger = ToolRepairTrigger(RepairConfig(threshold=2, models=("m",)), start=started.append, browser="user")
    path = library / "demo" / "flaky.py"
    flaky_tool = panel_tools.load_library_tool(library, path, "flaky")
    agent = Agent(model=ScriptedModel([("flaky", {"record": {"secret": "SENSITIVE"}}), ("flaky", {"record": {"label": "ok"}}), ("flaky", {"record": {}})]),
                  tools=[flaky_tool], hooks=[ToolObservation(), trigger], callback_handler=None,
                  trace_attributes=trace_attributes(session_id="s1", user_id="alice"))
    asyncio.run(agent.invoke_async("please label my records"))
    assert agent.state.get(TOOL_FAILURES_STATE_KEY)["count"] == 2
    proposal = pending_proposal(agent)
    assert proposal is not None and proposal["status"] == "investigating"
    assert proposal["tool_name"] == "flaky" and proposal["exception_class"] == "KeyError" and proposal["count"] == 2
    # Redacted request: argument keys/types only, never values; provenance included.
    assert proposal["outcome"]["arg_types"] == {"record": "dict"}
    assert proposal["outcome"]["source"]["path"] == "demo/flaky.py"
    assert "SENSITIVE" not in json.dumps(proposal["outcome"]) and "KeyError" in proposal["outcome"]["exception"]
    recorded = agent.state.get(tool_repair.REPAIR_CONTEXT_STATE_KEY)["flaky"]
    assert sorted(entry["status"] for entry in recorded) == ["error", "error", "success"]
    # One investigation, with the owner, the exact call, the spec, the request and the browser.
    assert len(started) == 1
    evidence = started[0]
    assert evidence.user_id == "alice" and evidence.session_id == "s1" and evidence.kind == "library"
    assert evidence.tool_use["input"] in ({"record": {"secret": "SENSITIVE"}}, {"record": {}})
    assert evidence.tool_spec["name"] == "flaky" and "inputSchema" in evidence.tool_spec
    assert evidence.current_request == "please label my records" and evidence.browser == "user"
    assert "KeyError" in evidence.error and len(evidence.messages) >= 2 and evidence.side_effecting is False
    guide = agent.state.get("panel.tool_failure")
    assert guide["phase"] == "investigating" and guide["tool_name"] == "flaky" and guide["count"] == 2
    from agent.api.core.tool_failure import failure_guidance
    from strands.vended_plugins.context_injector import InjectionContext
    text = failure_guidance(InjectionContext(messages=agent.messages, state=agent.state, agent=agent))
    assert text is not None and "investigating" in text and "Do not call this tool again" in text
    # A later failure of the same tool while investigating does not start a second one.
    agent.model = ScriptedModel([("flaky", {"record": {}})])
    asyncio.run(agent.invoke_async("again"))
    assert len(started) == 1


def test_trigger_guides_one_retry_for_idempotent_tools_and_none_for_side_effects(library):
    """First idempotent failure -> `retry` guidance (no investigation). A side-effecting tool (browser,
    shell, non-GET http) is never repeated on the live environment: it investigates at once."""
    started: list = []
    once = _agent(library, [("flaky", {"record": {}})], extra_hooks=())
    asyncio.run(once.invoke_async("go"))
    assert pending_proposal(once) is None
    assert once.state.get("panel.tool_failure")["phase"] == "retry"

    @tool(name="user_browser_browser_click")
    async def click(selector: str) -> str:
        """Click."""
        raise RuntimeError("no element")

    live = Agent(model=ScriptedModel([("user_browser_browser_click", {"selector": "#a"})]), tools=[click],
                 hooks=[ToolObservation(), ToolRepairTrigger(RepairConfig(threshold=2, models=("m",)), start=started.append, browser="user")],
                 callback_handler=None, trace_attributes=trace_attributes(session_id="s1", user_id="alice"))
    asyncio.run(live.invoke_async("click it"))
    assert len(started) == 1 and started[0].side_effecting is True and started[0].count == 1
    assert live.state.get("panel.tool_failure")["phase"] == "investigating"
    assert "side effects" in failure_guidance_text(live)


def failure_guidance_text(agent) -> str:
    from agent.api.core.tool_failure import failure_guidance
    from strands.vended_plugins.context_injector import InjectionContext
    return failure_guidance(InjectionContext(messages=agent.messages, state=agent.state, agent=agent)) or ""


def test_trigger_ignores_cancelled_calls_fixer_tools_and_every_kind_counts(library):
    """Cancelled tool calls (BeforeToolCall cancel) and the fixer's own / Ron's control tools never
    start an investigation; every repairable kind does (core here)."""
    started: list = []

    @tool
    async def local_bad(value: str) -> str:
        """Raises."""
        raise ValueError(value)

    @tool
    async def submit_repair(status: str) -> str:
        """Fixer tool (recursion guard)."""
        raise ValueError("boom")

    class CancelAll:
        def register_hooks(self, registry, **_):
            from strands.hooks.events import BeforeToolCallEvent
            registry.add_callback(BeforeToolCallEvent, self.cancel)

        def cancel(self, event):
            if event.tool_use["name"] == "local_bad" and event.tool_use["input"].get("value") == "cancel":
                event.cancel_tool = "cancelled by policy"

    agent = Agent(model=ScriptedModel([("local_bad", {"value": "cancel"}), ("submit_repair", {"status": "x"}),
                                       ("local_bad", {"value": "a"}), ("local_bad", {"value": "b"})]),
                  tools=[local_bad, submit_repair],
                  hooks=[ToolObservation(), CancelAll(), ToolRepairTrigger(RepairConfig(threshold=2), start=started.append)],
                  callback_handler=None, trace_attributes=trace_attributes(session_id="s1", user_id="alice"))
    asyncio.run(agent.invoke_async("go"))
    assert [e.tool_name for e in started] == ["local_bad"]
    assert started[0].kind == "core" and tool_repair.target_kind(local_bad) == "core"
    counts = agent.state.get(tool_repair.REPAIR_COUNTS_STATE_KEY)
    assert counts == {"local_bad|ValueError": 2}


def test_fixer_hitl_gates_only_apply_repair():
    """The fixer's native HumanInTheLoop: every tool runs, apply_repair parks the run on an interrupt."""
    @tool
    async def apply_repair(revision: str) -> str:
        """Apply."""
        return "applied"

    @tool
    async def shell(command: str) -> str:
        """Shell."""
        return "ok"

    free = asyncio.run(Agent(model=ScriptedModel([("shell", {"command": "ls"})]), tools=[shell, apply_repair],
                             interventions=[tool_repair.fixer_hitl()], callback_handler=None).invoke_async("go"))
    assert free.stop_reason == "end_turn"
    paused = asyncio.run(Agent(model=ScriptedModel([("apply_repair", {"revision": "r1"})]), tools=[shell, apply_repair],
                               interventions=[tool_repair.fixer_hitl()], callback_handler=None).invoke_async("go"))
    assert paused.stop_reason == "interrupt"
    assert paused.interrupts[0].name == tool_repair.HITL_INTERRUPT_NAME
    assert paused.interrupts[0].reason.startswith('Approve "apply_repair"')


# --- The real harness over native A2A, driven by the official client -------------------------

class FixerModel(ScriptedModel):
    """Drives the fixer SOP: write the repaired file + test, run the sandbox, record five demos,
    submit, then (verified) ask to apply. Each invocation issues the remaining tool uses the previous
    turn did not get to (the interrupt splits the run in two invocations)."""

    def __init__(self, uses):
        super().__init__(uses)
        self.cursor = 0

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        yield {"messageStart": {"role": "assistant"}}
        last = messages[-1]["content"]
        done_ids = {b["toolResult"]["toolUseId"] for m in messages for b in m["content"] if "toolResult" in b}
        issued = {b["toolUse"]["toolUseId"] for m in messages for b in m["content"] if "toolUse" in b}
        # Only after the model has seen a result for every tool use it issued does it emit more.
        if issued - done_ids:
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "waiting"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}
            return
        remaining = self.uses[self.cursor:]
        if remaining and not any(b.get("toolResult", {}).get("status") == "error" and "CONFIRMATION_FAILED" in json.dumps(b) for b in last):
            # Issue the next batch: everything up to and including the first apply_repair.
            batch = []
            for name, inputs in remaining:
                batch.append((name, inputs))
                if name == tool_repair.APPLY_TOOL_NAME:
                    break
            self.cursor += len(batch)
            for index, (name, inputs) in enumerate(batch):
                yield {"contentBlockStart": {"contentBlockIndex": index, "start": {"toolUse": {"toolUseId": f"u{self.cursor}-{index}", "name": name}}}}
                yield {"contentBlockDelta": {"contentBlockIndex": index, "delta": {"toolUse": {"input": json.dumps(inputs)}}}}
                yield {"contentBlockStop": {"contentBlockIndex": index}}
            yield {"messageStop": {"stopReason": "tool_use"}}
            return
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "done"}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


def _fixer_builder(uses):
    model = FixerModel(uses)

    def build(provider, model_id, effort=None, *, hosted_tools=True):
        return model
    return build


def _fixer_script(status="verified", fix_type="OTHERS", demos=5, apply=True):
    demonstrations = [("record_demonstration", {"kind": "failing", "input": {"record": {}}, "expected": "<unlabelled>",
                                                "actual": "<unlabelled>", "status": "passed", "dry_run": False, "source": "session"})]
    for i in range(demos - 1):
        demonstrations.append(("record_demonstration", {"kind": "context", "input": {"record": {"label": i}}, "expected": str(i),
                                                        "actual": str(i), "status": "passed", "dry_run": False,
                                                        "source": "session" if i == 0 else "synthetic"}))
    script = [
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
    if apply and status == "verified":
        script.append((tool_repair.APPLY_TOOL_NAME, {"revision": "<rev>", "summary": "Guard the missing label key."}))
    return script


class Harness:
    """A FastAPI app with Ron's fixer A2AServer mounted at /a2a/fixer, served in-process over
    httpx.ASGITransport (real a2a-sdk server + real a2a-sdk client, no sockets)."""

    def __init__(self, service: RepairService, http: Any) -> None:
        from fastapi import FastAPI

        from agent.api.core.panel_a2a import create_panel_a2a_server, mount_panel_a2a

        self.app = FastAPI()
        self.integration = create_panel_a2a_server(agent_factory=service.agent_for, http_url="http://test/a2a/fixer")
        assert mount_panel_a2a(self.app, self.integration, enabled=True, path="/a2a/fixer")
        self.http = http

    @classmethod
    async def start(cls, service: RepairService) -> "Harness":
        import httpx

        holder: dict = {}

        def http_factory():
            return holder["http"]

        harness = cls.__new__(cls)
        from fastapi import FastAPI

        from agent.api.core.panel_a2a import create_panel_a2a_server, mount_panel_a2a

        harness.app = FastAPI()
        harness.integration = create_panel_a2a_server(agent_factory=service.agent_for, http_url="http://test/a2a/fixer")
        assert mount_panel_a2a(harness.app, harness.integration, enabled=True, path="/a2a/fixer")
        holder["http"] = httpx.AsyncClient(transport=httpx.ASGITransport(app=harness.app), base_url="http://test")
        harness.http = holder["http"]
        service._client_factory = lambda url: tool_repair.FixerClient(url, http=http_factory())
        return harness

    async def close(self) -> None:
        await self.http.aclose()
        await self.integration.aclose()


def _service(script, *, timeout_s=60, sandbox=None, activate_fn_reload=None) -> RepairService:
    service = RepairService(RepairConfig(threshold=2, models=("m1",), timeout_s=timeout_s, max_concurrent=2),
                            fixer_url="http://test/a2a/fixer", reload_live_sessions=activate_fn_reload)
    service.build_model = _fixer_builder(script)
    service.sandbox_factory = sandbox or _fake_sandbox
    service.sop_prompt = "SOP: repair carefully."
    return service


def _fail_twice(library, *, user_id="alice", session_id="s1", service: RepairService | None = None):
    """A live agent whose `flaky` fails twice -> the service's trigger starts the investigation."""
    path = library / "demo" / "flaky.py"
    flaky_tool = panel_tools.load_library_tool(library, path, "flaky")
    hooks = [ToolObservation(), service.trigger(browser="user") if service else ToolRepairTrigger(RepairConfig(threshold=2))]
    return Agent(model=ScriptedModel([("flaky", {"record": {}}), ("flaky", {"record": {}})]), tools=[flaky_tool], hooks=hooks,
                 callback_handler=None, trace_attributes=trace_attributes(session_id=session_id, user_id=user_id))


def _patch_rev(service: RepairService, script):
    """The scripted model does not know the revision id until the run exists: fill it in."""
    for index, (name, inputs) in enumerate(script):
        if name == tool_repair.APPLY_TOOL_NAME and inputs.get("revision") == "<rev>":
            inv = next(iter(service._by_key.values()))
            script[index] = (name, {**inputs, "revision": inv.run.revision})


async def _until(predicate, timeout=20.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.02)


def test_native_a2a_round_trip_investigate_approve_apply(library):
    """Gate 1: a tool failure starts the investigation (hook -> service, no HTTP, no click); the real
    create_harness fixer is served by Ron's A2AServer and driven by the official a2a-sdk client; its
    `apply_repair` call parks the task in input_required with the native interrupt DataPart; the
    panel's approval (bound to the approval token) resumes it with the interruptResponse DataPart;
    the revision is activated for the owner and the originating agent's guidance says `confirm`."""
    events: list = []
    script = _fixer_script()
    reloaded: list = []

    async def reload(user_id, tool_name, revision_file, repair_kind):
        reloaded.append((user_id, tool_name, repair_kind))
        return ["s1"]

    service = _service(script, activate_fn_reload=reload)

    async def emit(user_id, session_id, payload):
        events.append((user_id, session_id, payload))

    service.bind_emitter(emit)

    async def scenario():
        harness = await Harness.start(service)
        try:
            agent = _fail_twice(library, service=service)
            await agent.invoke_async("label my records")
            inv = service._by_key[("alice", "flaky")]
            assert inv.state == "investigating" and inv.task is not None
            assert agent.state.get(REPAIR_REQUEST_STATE_KEY)["status"] == "investigating"
            _patch_rev(service, script)
            await _until(lambda: inv.state == "approval")
            # The parked native interrupt: name + id arrive through the A2A input_required DataPart.
            assert inv.interrupt["name"] == tool_repair.HITL_INTERRUPT_NAME and inv.interrupt["interruptId"]
            assert inv.task_id and inv.run.manifest["status"] == "verified"
            approval = next(p for _, _, p in events if "approval" in p)["approval"]
            assert approval["status"] == "verified" and approval["approval_token"] and approval["interrupt"]["interruptId"] == inv.interrupt["interruptId"]
            assert agent.state.get("panel.tool_failure")["phase"] == "approval"
            assert "waits for the user's approval" in failure_guidance_text(agent)
            # A wrong token is refused (403-style); the right one resumes the task.
            with pytest.raises(PermissionError):
                service.approve("alice", "flaky", inv.run.revision, "0" * 64)
            with pytest.raises(LookupError):
                service.approve("bob", "flaky", inv.run.revision, approval["approval_token"])
            service.approve("alice", "flaky", inv.run.revision, approval["approval_token"])
            result = await service.wait("alice", "flaky")
            assert inv.state == "applied" and result["applied"]["revision"] == inv.run.revision
            assert result["applied"]["live_sessions_reloaded"] == ["s1"] and reloaded == [("alice", "flaky", "file")]
            assert (await tool_repair.read_active("alice", "flaky"))["revision"] == inv.run.revision
            manifest = (await tool_repair.list_repairs("alice"))[0]
            assert manifest["status"] == "active" and manifest["active"] is True and manifest["owner_id"] == "alice"
            assert manifest["artifact_digest"] and manifest["approval_token"] == approval["approval_token"]
            assert "files/demo/flaky.py" in manifest["files"] and manifest["reflection"]["7"] == "answer"
            # The originating agent: confirm phase, then a success closes the loop.
            assert agent.state.get("panel.tool_failure")["phase"] == "confirm"
            assert "Call flaky again now" in failure_guidance_text(agent)
            ready = [p for _, _, p in events if "ready" in p]
            assert ready and ready[-1]["ready"]["status"] == "active" and ready[-1]["ready"]["applied"]
            kinds = [next(k for k in p if k not in ("revision", "tool_name")) for _, _, p in events]
            assert kinds[0] == "investigating" and "a2a" in kinds and kinds[-1] == "ready"
            assert all(u == "alice" and s == "s1" for u, s, _ in events)
            # Other tenant: nothing.
            assert await tool_repair.list_repairs("bob") == []
        finally:
            await harness.close()

    asyncio.run(scenario())


def test_native_a2a_round_trip_decline_leaves_nothing_applied(library):
    script = _fixer_script()
    service = _service(script)

    async def scenario():
        harness = await Harness.start(service)
        try:
            agent = _fail_twice(library, service=service)
            await agent.invoke_async("go")
            inv = service._by_key[("alice", "flaky")]
            _patch_rev(service, script)
            await _until(lambda: inv.state == "approval")
            service.decline("alice", "flaky", inv.run.revision)
            result = await service.wait("alice", "flaky")
            assert inv.state == "declined" and result["status"] == "declined" and result["declined"] is True
            assert await tool_repair.read_active("alice", "flaky") is None
            assert agent.state.get("panel.tool_failure")["phase"] == "declined"
            assert "declined the repair" in failure_guidance_text(agent)
            # Nothing is waiting any more.
            with pytest.raises(LookupError):
                service.decline("alice", "flaky", inv.run.revision)
        finally:
            await harness.close()

    asyncio.run(scenario())


def test_native_a2a_cancel_while_waiting_and_while_running(library):
    script = _fixer_script()
    service = _service(script)

    async def scenario():
        harness = await Harness.start(service)
        try:
            agent = _fail_twice(library, service=service)
            await agent.invoke_async("go")
            inv = service._by_key[("alice", "flaky")]
            _patch_rev(service, script)
            await _until(lambda: inv.state == "approval")
            await service.cancel("alice", "flaky")
            result = await service.wait("alice", "flaky")
            assert inv.state == "cancelled" and result["status"] == "cancelled"
            assert await tool_repair.read_active("alice", "flaky") is None
            assert agent.state.get("panel.tool_failure")["phase"] in ("failed", "blocked")
            with pytest.raises(LookupError):
                await service.cancel("alice", "flaky")
        finally:
            await harness.close()

    asyncio.run(scenario())

    # Cancel mid-run: the fixer is inside the sandbox (its shell blocks on a gate) when the user
    # cancels; the driver stops, the A2A task is cancelled, nothing is stored as verified.
    gate = asyncio.Event()
    entered = asyncio.Event()

    class SlowSandbox(WorkspaceSandbox):
        async def execute_streaming(self, command, **kwargs):
            entered.set()
            await gate.wait()
            yield ExecutionResult(stdout="ok\n", stderr="", exit_code=0)

    slow = _service(_fixer_script(), sandbox=lambda run: (SlowSandbox(run.workspace), "docker"))

    async def running():
        harness = await Harness.start(slow)
        try:
            agent = _fail_twice(library, service=slow)
            await agent.invoke_async("go")
            inv = slow._by_key[("alice", "flaky")]
            await asyncio.wait_for(entered.wait(), 20)
            assert inv.state == "investigating"
            await slow.cancel("alice", "flaky")
            gate.set()
            result = await slow.wait("alice", "flaky")
            assert result["status"] in ("cancelled", "failed") and inv.state in ("cancelled", "failed")
            assert await tool_repair.read_active("alice", "flaky") is None
            assert (await tool_repair.list_repairs("alice"))[0]["status"] in ("cancelled", "failed")
        finally:
            await harness.close()

    asyncio.run(running())


def test_investigation_is_blocked_without_a_sandbox_and_failed_without_submit(library, monkeypatch):
    """No host fallback: Docker missing -> `blocked`, nothing stored as verified, nothing activatable.
    A fixer that ends without submit_repair -> `failed`."""
    monkeypatch.setattr(tool_repair.shutil, "which", lambda name: None)
    blocked = _service(_fixer_script(), sandbox=None)
    blocked.sandbox_factory = None  # production create_sandbox

    async def scenario(service, expect):
        harness = await Harness.start(service)
        try:
            agent = _fail_twice(library, service=service)
            await agent.invoke_async("go")
            result = await service.wait("alice", "flaky")
            assert result["status"] == expect, result
            assert agent.state.get("panel.tool_failure")["phase"] == expect
            with pytest.raises((ValueError, FileNotFoundError)):
                await tool_repair.activate("alice", "flaky", result["revision"], approval_token_="0" * 64)
        finally:
            await harness.close()

    asyncio.run(scenario(blocked, "blocked"))
    with pytest.raises(tool_repair.SandboxUnavailable):
        tool_repair.create_sandbox(tool_repair.RepairRun(user_id="a", session_id="s", tool_name="t", revision="r", workspace=library, manifest={}))
    monkeypatch.undo()
    no_submit = _service([("shell", {"command": "echo hi"})])
    asyncio.run(scenario(no_submit, "failed"))


def test_verified_requires_five_passed_demonstrations_and_needs_maintainer_routes(library):
    service = _service(_fixer_script(demos=2))

    async def scenario(service, expect_status, expect_phase):
        harness = await Harness.start(service)
        try:
            agent = _fail_twice(library, service=service)
            await agent.invoke_async("go")
            result = await service.wait("alice", "flaky")
            assert result["status"] == expect_status, result
            assert agent.state.get("panel.tool_failure")["phase"] == expect_phase
        finally:
            await harness.close()

    # submit_repair raised (2 demos) -> the model then tried apply_repair on an unverified run -> error
    # tool result -> turn ends; no approval was requested, nothing stored as verified.
    asyncio.run(scenario(service, "failed", "failed"))
    asyncio.run(scenario(_service(_fixer_script(fix_type="SYSTEM_PROMPT_FIX", apply=False)), "needs_maintainer", "failed"))


def test_sandbox_run_args_are_bounded_and_off_the_host_network(library):
    run = tool_repair.RepairRun(user_id="a", session_id="s", tool_name="t", revision="r1", workspace=library, manifest={})
    args = tool_repair.sandbox_run_args(run, "ron-repair-r1")
    joined = " ".join(args)
    assert "--memory" in args and "--cpus" in args and "--pids-limit" in args and "--network" in args
    assert "--network host" not in joined and "docker.sock" not in joined and "--privileged" not in joined
    assert "no-new-privileges" in joined and f"{library.resolve()}:/workspace" in joined
    assert joined.endswith(f"{tool_repair.SANDBOX_IMAGE} sleep infinity")


def test_activate_binds_owner_base_sha_digest_and_token(library):
    """Gate 4: wrong owner, stale base file, tampered artifact and a wrong/missing token all fail
    server-side; the right token activates; rollback restores the vendored file."""
    script = _fixer_script(apply=False)
    service = _service(script)

    async def scenario():
        harness = await Harness.start(service)
        try:
            agent = _fail_twice(library, service=service)
            await agent.invoke_async("go")
            result = await service.wait("alice", "flaky")
            assert result["status"] == "verified" and result["approval_token"]
            rev, token = result["revision"], result["approval_token"]
            path = library / "demo" / "flaky.py"
            with pytest.raises(ValueError):
                await tool_repair.activate("alice", "flaky", rev)
            with pytest.raises(PermissionError):
                await tool_repair.activate("alice", "flaky", rev, approval_token_="f" * 64)
            with pytest.raises((PermissionError, FileNotFoundError)):
                await tool_repair.activate("bob", "flaky", rev, approval_token_=token)
            original = path.read_text(encoding="utf-8")
            path.write_text(original + "\n# drift\n", encoding="utf-8")
            with pytest.raises(tool_repair.RevisionConflict):
                await tool_repair.activate("alice", "flaky", rev, approval_token_=token)
            path.write_text(original, encoding="utf-8")
            storage = tool_repair.repair_storage("alice")
            stored = await storage.read(f"flaky/{rev}/files/demo/flaky.py")
            await storage.write(f"flaky/{rev}/files/demo/flaky.py", stored + b"\n# tampered\n")
            with pytest.raises(tool_repair.RevisionConflict):
                await tool_repair.activate("alice", "flaky", rev, approval_token_=token)
            await storage.write(f"flaky/{rev}/files/demo/flaky.py", stored)
            active = await tool_repair.activate("alice", "flaky", rev, approval_token_=token)
            assert active["revision"] == rev and Path(active["revision_file"]).is_file()
            assert tool_repair.active_revision_file("alice", "flaky", path) == Path(active["revision_file"])
            assert tool_repair.active_revision_file("bob", "flaky", path) is None
            rolled = await tool_repair.rollback("alice", "flaky")
            assert rolled["previous"]["revision"] == rev and await tool_repair.read_active("alice", "flaky") is None
            assert (await tool_repair.list_repairs("alice"))[0]["status"] == "rolled_back"
        finally:
            await harness.close()

    asyncio.run(scenario())


def _verified(library, script=None) -> tuple[Any, dict]:
    script = script or _fixer_script(apply=False)
    service = _service(script)

    async def scenario():
        harness = await Harness.start(service)
        try:
            agent = _fail_twice(library, service=service)
            await agent.invoke_async("go")
            return agent, await service.wait("alice", "flaky")
        finally:
            await harness.close()

    return asyncio.run(scenario())


def test_reload_takes_effect_at_next_invocation_and_rollback_restores(library):
    _, result = _verified(library)
    rev, token = result["revision"], result["approval_token"]
    path = library / "demo" / "flaky.py"
    active = asyncio.run(tool_repair.activate("alice", "flaky", rev, approval_token_=token))
    swapped: dict = {}

    class SwapDuringCall(AgentTool):
        def __init__(self, wrapped):
            super().__init__()
            self.wrapped = wrapped

        tool_name = property(lambda self: self.wrapped.tool_name)
        tool_spec = property(lambda self: self.wrapped.tool_spec)
        tool_type = property(lambda self: self.wrapped.tool_type)

        async def stream(self, tool_use, invocation_state, **kwargs):
            if not swapped:
                swapped["done"] = await catalog.reload_tool("flaky", agent=live, root=library, path=path,
                                                            revision_file=Path(active["revision_file"]))
            async for event in self.wrapped.stream(tool_use, invocation_state, **kwargs):
                yield event

    old_tool = SwapDuringCall(panel_tools.load_library_tool(library, path, "flaky"))
    catalog = panel_tools.PanelToolCatalog(tools=[old_tool])
    live = Agent(model=ScriptedModel([("flaky", {"record": {}})]), tools=[catalog], callback_handler=None)
    catalog.bind(live)
    asyncio.run(live.invoke_async("go"))
    assert swapped["done"] is True
    first_results = [b["toolResult"] for m in live.messages for b in m["content"] if "toolResult" in b]
    assert first_results[0]["status"] == "error"  # in-flight call finished on the old code
    live.model = ScriptedModel([("flaky", {"record": {}})])
    asyncio.run(live.invoke_async("again"))
    results = [b["toolResult"] for m in live.messages for b in m["content"] if "toolResult" in b]
    assert results[-1]["status"] == "success" and "<unlabelled>" in json.dumps(results[-1]["content"])
    from strands.vended_plugins.context_injector import InjectionContext
    render = tool_repair.revision_notice_render("alice")
    context = InjectionContext(messages=live.messages, state=live.state, agent=live)
    note = render(context)
    assert note is not None and "flaky" in note and rev in note and render(context) is None
    asyncio.run(tool_repair.rollback("alice", "flaky"))
    asyncio.run(catalog.reload_tool("flaky", agent=live, root=library, path=path, revision_file=None))
    live.model = ScriptedModel([("flaky", {"record": {}})])
    asyncio.run(live.invoke_async("third"))
    results = [b["toolResult"] for m in live.messages for b in m["content"] if "toolResult" in b]
    assert results[-1]["status"] == "error"


def test_new_session_load_path_uses_active_revision_for_this_user_only(library):
    _, result = _verified(library)
    asyncio.run(tool_repair.activate("alice", "flaky", result["revision"], approval_token_=result["approval_token"]))
    path = library / "demo" / "flaky.py"

    def build(user_id):
        catalog = panel_tools.PanelToolCatalog()
        catalog.set_revision_resolver(tool_repair.revision_resolver(user_id))
        agent = Agent(model=ScriptedModel([("flaky", {"record": {}})]), tools=[catalog], callback_handler=None)
        catalog.bind(agent)
        asyncio.run(catalog.stage_tool(path, "flaky", agent=agent, root=library))
        asyncio.run(agent.invoke_async("go"))
        return [b["toolResult"] for m in agent.messages for b in m["content"] if "toolResult" in b][-1]

    assert build("alice")["status"] == "success"
    assert build("bob")["status"] == "error"


def test_restart_recovery_rematerializes_active_revisions_and_rejects_stale_approvals(library):
    _, result = _verified(library)
    active = asyncio.run(tool_repair.activate("alice", "flaky", result["revision"], approval_token_=result["approval_token"]))
    import shutil
    shutil.rmtree(tool_repair._active_dir("alice"))
    assert tool_repair.active_revision_file("alice", "flaky", library / "demo" / "flaky.py") is None
    assert asyncio.run(tool_repair.restore_active_markers("alice")) == 1
    assert tool_repair.active_revision_file("alice", "flaky", library / "demo" / "flaky.py") == Path(active["revision_file"])
    # After a restart there is no running investigation: an approval for the old context is stale.
    fresh = RepairService(RepairConfig(threshold=2, models=("m1",)), fixer_url="http://test/a2a/fixer")
    with pytest.raises(LookupError):
        fresh.approve("alice", "flaky", result["revision"], result["approval_token"])
    assert fresh.status("alice", "flaky") == {"state": "idle", "last": None}


def test_fixer_repairs_a_core_tool_with_a_user_scoped_adapter(library):
    """A non-library failure is repaired too: the fixer writes an adapter module that wraps the
    registered tool for THIS user; activation applies it via ToolRegistry.replace (next invocation)
    and to new sessions via the catalog adapter."""
    @tool
    async def host_tool(record: dict) -> str:
        """Needs record.label."""
        return str(record["label"])

    script = _adapter_script("host_tool")
    service = _service(script)

    async def scenario():
        harness = await Harness.start(service)
        try:
            agent = Agent(model=ScriptedModel([("host_tool", {"value": "a"}), ("host_tool", {"value": "b"})]), tools=[host_tool],
                          hooks=[ToolObservation(), service.trigger(browser="user")], callback_handler=None,
                          trace_attributes=trace_attributes(session_id="s1", user_id="alice"))
            await agent.invoke_async("go")
            assert service._by_key[("alice", "host_tool")].evidence.kind == "core"
            return await service.wait("alice", "host_tool")
        finally:
            await harness.close()

    result = asyncio.run(scenario())
    assert result["status"] == "verified" and result["route"] == "repair"
    manifest = asyncio.run(tool_repair.read_manifest("alice", "host_tool", result["revision"]))
    assert manifest["target_kind"] == "core" and manifest["repair_kind"] == "adapter"
    assert "adapter/host_tool.py" in manifest["files"] and manifest["base_sha256"] is not None
    active = asyncio.run(tool_repair.activate("alice", "host_tool", result["revision"], approval_token_=result["approval_token"]))
    assert active["repair_kind"] == "adapter"
    assert tool_repair.active_adapter_file("alice", "host_tool")[1] == result["revision"]
    assert tool_repair.active_adapter_file("bob", "host_tool") is None

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
    catalog = panel_tools.PanelToolCatalog(tools=[host_tool])
    live = Agent(model=ScriptedModel([("host_tool", {"value": "x"})]), tools=[catalog], callback_handler=None)
    catalog.bind(live)
    adapter = tool_repair.load_adapter(tool_repair.active_adapter_file("alice", "host_tool")[0])
    assert asyncio.run(catalog.replace_tool("host_tool", agent=live, build=lambda base: tool_repair._AdaptedTool(base, adapter, "r")))
    asyncio.run(live.invoke_async("go"))
    assert [b["toolResult"]["status"] for m in live.messages for b in m["content"] if "toolResult" in b] == ["success"]
    assert asyncio.run(catalog.replace_tool("host_tool", agent=live, build=lambda base: base))
    asyncio.run(tool_repair.rollback("alice", "host_tool"))
    assert tool_repair.active_adapter_file("alice", "host_tool") is None


def test_fixer_repairs_an_mcp_browser_tool_with_an_adapter_and_server_revision(library, monkeypatch):
    """MCP/browser tools: a side-effecting failure investigates at the FIRST failure (never repeated on
    the live browser); (a) an adapter wraps the MCP tool for this user, (b) a `server` revision is a
    repaired copy of electron_playwright_mcp run by this user's browser server via PYTHONPATH."""
    from unittest.mock import Mock

    from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

    from agent.api.core.panel_browser import browser_client_factory

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

    adapter_source = "def transform_input(input):\n    return {'selector': input.get('selector') or input.get('element')}\n"
    base = [item for item in _fixer_script(apply=False) if item[0] != "write"]
    script = [("write", {"path": "/workspace/adapter/user_browser_browser_click.py", "content": adapter_source}),
              *base[:-1], ("submit_repair", base[-1][1] | {"repair_kind": "adapter", "diff": "+ element -> selector"})]
    service = _service(script)

    async def scenario():
        harness = await Harness.start(service)
        try:
            mcp_tool = FakeMCPTool()
            assert tool_repair.target_kind(mcp_tool) == "mcp"
            agent = Agent(model=ScriptedModel([("user_browser_browser_click", {"element": "#go"})]), tools=[mcp_tool],
                          hooks=[ToolObservation(), service.trigger(browser="user")], callback_handler=None,
                          trace_attributes=trace_attributes(session_id="s1", user_id="alice"))
            await agent.invoke_async("go")
            inv = service._by_key[("alice", "user_browser_browser_click")]
            assert inv.evidence.kind == "mcp" and inv.evidence.side_effecting and inv.evidence.count == 1
            assert "ToolError: selector is required" in inv.evidence.error
            return await service.wait("alice", "user_browser_browser_click")
        finally:
            await harness.close()

    result = asyncio.run(scenario())
    assert result["status"] == "verified" and result["route"] == "repair"
    manifest = asyncio.run(tool_repair.read_manifest("alice", "user_browser_browser_click", result["revision"]))
    assert manifest["target_kind"] == "mcp" and manifest["repair_kind"] == "adapter"
    asyncio.run(tool_repair.activate("alice", "user_browser_browser_click", result["revision"], approval_token_=result["approval_token"]))

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

    # (b) server revision for THIS user's browser server PYTHONPATH.
    rev = "20261004t000000-srv001"
    files = {f"server/{tool_repair.MCP_SERVER_PACKAGE}/server.py": b"# repaired server\n", f"server/{tool_repair.MCP_SERVER_PACKAGE}/__init__.py": b""}
    for name, data in files.items():
        asyncio.run(tool_repair.repair_storage("alice").write(f"user_browser_browser_click/{rev}/{name}", data))
    digest = tool_repair.artifact_digest(files)
    token = tool_repair.approval_token("alice", "user_browser_browser_click", rev, None, digest)
    asyncio.run(tool_repair.write_manifest("alice", {"tool_name": "user_browser_browser_click", "revision": rev, "target_kind": "mcp",
        "repair_kind": "server", "source_path": None, "base_sha256": None, "status": "verified", "created_at": "2026-10-04T00:00:00",
        "demonstrations": [], "files": sorted(files), "artifact_digest": digest, "approval_token": token, "owner_id": "alice"}))
    active = asyncio.run(tool_repair.activate("alice", "user_browser_browser_click", rev, approval_token_=token))
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


def test_fixer_defaults_to_gpt_6_1_sol_at_max_effort_with_harness_builtins(monkeypatch):
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
        assert seen == [("perplexity", "openai/gpt-6.1-sol", "max", False)]
        names = set(fixer.tool_registry.registry)
        assert {"shell", "read", "write", "edit", "todo_write", "record_demonstration", "submit_repair", "apply_repair"} <= names
        assert not names & {"editor", "environment", "mcp_client", "http_request", "subagent", "web_fetch"}
        # The panel A2A server is not a fixer peer (isolation): no a2a tools unless RON_TOOL_REPAIR_A2A_AGENTS lists one.
        assert not names & {"a2a_send_message", "a2a_discover_agent"}
        assert fixer.name == "Ron Tool Fixer" and fixer._interrupt_state is not None
    finally:
        fixer.cleanup()


# --- HTTP surface: investigation on the stream, approve over HTTP, activate/rollback -------------

def test_http_repair_loop_end_to_end(library, monkeypatch):
    """POST /chat (two KeyErrors) starts the investigation from the hook; the session's SSE replay
    carries tool_repair_investigating, the Repair chain progress, tool_repair_approval (token +
    interrupt) and tool_repair_ready; POST /tools/repairs/{tool}/approve resumes the fixer, the
    revision is applied and the live session runs the repaired code at its next invocation; rollback
    restores the vendored file; activate without the token is refused."""
    import httpx
    from agent.api.endpoints import chat
    from agent.api.main import app
    from agent.api.core.panel_runtime import PanelRuntimeManager

    path = library / "demo" / "flaky.py"
    uses = [("flaky", {"record": {}}), ("flaky", {"record": {}})]
    agents: list[Agent] = []
    script = _fixer_script()

    def construct(**kwargs):
        runtime_options = dict(kwargs["runtime_options"])
        # chat._create_runtime_agent put the service's trigger among the runtime hooks.
        assert any(isinstance(hook, ToolRepairTrigger) and hook.start is not None for hook in runtime_options["hooks"])
        catalog = panel_tools.PanelToolCatalog(tools=[panel_tools.load_library_tool(library, path, "flaky")])
        catalog.set_revision_resolver(tool_repair.revision_resolver(kwargs["user_id"]))
        agent = Agent(model=ScriptedModel(list(uses)), tools=[catalog],
                      trace_attributes=trace_attributes(session_id=kwargs["session_id"], user_id=kwargs["user_id"]),
                      **{**runtime_options, "hooks": [ToolObservation(), *runtime_options["hooks"]]})
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
    monkeypatch.setenv("PANEL_A2A_URL", "http://test/a2a")
    monkeypatch.setattr(tool_repair, "native_sop_prompt", lambda *a, **k: "SOP")
    # The lifespan builds the RepairService; swap its model/sandbox seams for the scripted fixer and
    # point its client at the in-process ASGI app (the real mounted /a2a/fixer).
    built: dict = {}
    original_init = RepairService.__init__

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.config = RepairConfig(threshold=2, models=("m1",), timeout_s=60)
        self.build_model = _fixer_builder(script)
        self.sandbox_factory = _fake_sandbox
        self.sop_prompt = "SOP"
        built["service"] = self

    monkeypatch.setattr(RepairService, "__init__", patched_init)

    def frames(response):
        assert response.status_code == 200, response.text
        return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]

    async def scenario():
        async with app.router.lifespan_context(app):
            service: RepairService = built["service"]
            assert app.state.tool_repairs is service and app.state.fixer_a2a is not None
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                service._client_factory = lambda url: tool_repair.FixerClient(url, http=client)
                body = {"session_id": "repair-chat", "user_id": "alice", "message": "go", "provider": "openai", "model": "offline"}
                stream = frames(await client.post("/chat", json=body))
                assert stream[-1]["type"] == "run_finished"
                guide = agents[0].state.get("panel.tool_failure")
                assert guide["phase"] == "investigating" and guide["tool_name"] == "flaky"
                inv = service._by_key[("alice", "flaky")]
                _patch_rev(service, script)
                await _until(lambda: inv.state == "approval")
                after = stream[-1]["sequence"]
                tail = frames(await client.get(f"/sessions/repair-chat/events?user_id=alice&after={after}"))
                types = [e["type"] for e in [*stream, *tail]]
                # The investigation starts inside the failing run (hook -> service), so its first
                # event is part of that run's stream; the approval arrives after the run finished.
                assert "tool_repair_investigating" in types and "tool_repair_approval" in [e["type"] for e in tail]
                investigating = next(e for e in stream if e["type"] == "tool_repair_investigating")
                assert investigating["tool"] == "flaky" and investigating["count"] == 2 and investigating["kind"] == "library"
                everything = [*stream, *tail]
                assert any(e["type"] == "tool_input" and e["name"] == "repair" and e["id"] == f"repair:{inv.run.revision}" for e in everything)
                assert any(e["type"] == "tool_progress" and e["name"] == "repair" for e in tail)
                approval = next(e for e in tail if e["type"] == "tool_repair_approval")
                assert approval["rev"] == inv.run.revision and approval["status"] == "verified" and approval["approval_token"]
                assert approval["interrupt"]["name"] == tool_repair.HITL_INTERRUPT_NAME and approval["diff"]
                active = (await client.get("/tools/repairs/active?user_id=alice")).json()["investigations"]
                assert active and active[0]["state"] == "approval"
                # Wrong token -> 403; wrong owner -> 404; right token -> approved.
                assert (await client.post("/tools/repairs/flaky/approve", json={"user_id": "alice", "rev": inv.run.revision, "approval_token": "0" * 64})).status_code == 403
                assert (await client.post("/tools/repairs/flaky/approve", json={"user_id": "bob", "rev": inv.run.revision, "approval_token": approval["approval_token"]})).status_code == 404
                approved = await client.post("/tools/repairs/flaky/approve", json={"user_id": "alice", "rev": inv.run.revision, "approval_token": approval["approval_token"]})
                assert approved.status_code == 200, approved.text
                result = await service.wait("alice", "flaky")
                assert result["status"] == "active" and result["applied"]["live_sessions_reloaded"] == ["repair-chat"]
                tail = frames(await client.get(f"/sessions/repair-chat/events?user_id=alice&after={approval['sequence']}"))
                ready = [e for e in tail if e["type"] == "tool_repair_ready"]
                assert ready and ready[0]["rev"] == inv.run.revision and ready[0]["status"] == "active" and len(ready[0]["demonstrations"]) == 5
                listed = (await client.get("/tools/repairs?user_id=alice")).json()["revisions"]
                assert listed[0]["revision"] == inv.run.revision and listed[0]["active"] is True
                assert (await client.get("/tools/repairs?user_id=bob")).json()["revisions"] == []
                # Next invocation of the same live session runs the repaired revision.
                agents[0].model = ScriptedModel([("flaky", {"record": {}})])
                second = frames(await client.post("/chat", json={**body, "message": "again"}))
                results = [e for e in second if e["type"] == "tool_result" and e["name"] == "flaky"]
                assert results and results[-1]["status"] == "success"
                assert agents[0].state.get("panel.tool_failure")["phase"] == "done"
                # Rollback -> vendored file again.
                rolled = await client.post("/tools/repairs/flaky/rollback", json={"user_id": "alice"})
                assert rolled.status_code == 200 and rolled.json()["live_sessions_reloaded"] == ["repair-chat"]
                agents[0].model = ScriptedModel([("flaky", {"record": {}})])
                third = frames(await client.post("/chat", json={**body, "message": "third"}))
                results = [e for e in third if e["type"] == "tool_result" and e["name"] == "flaky"]
                assert results and results[-1]["status"] == "error"
                # Re-activate by HTTP requires the token; library drift -> 409.
                token = approval["approval_token"]
                assert (await client.post("/tools/repairs/flaky/activate", json={"user_id": "alice", "rev": inv.run.revision, "approval_token": "0" * 64})).status_code == 403
                original = path.read_text(encoding="utf-8")
                path.write_text(original + "\n# drift\n", encoding="utf-8")
                assert (await client.post("/tools/repairs/flaky/activate", json={"user_id": "alice", "rev": inv.run.revision, "approval_token": token})).status_code == 409
                path.write_text(original, encoding="utf-8")
                assert (await client.post("/tools/repairs/flaky/activate", json={"user_id": "alice", "rev": inv.run.revision, "approval_token": token})).status_code == 200
                # Validation: unknown tool, bad revision id, nothing to decline.
                assert (await client.post("/tools/repairs", json={"user_id": "alice", "session_id": "repair-chat", "tool_name": "nope"})).status_code == 422
                assert (await client.post("/tools/repairs/flaky/activate", json={"user_id": "alice", "rev": "missing-rev", "approval_token": token})).status_code == 404
                assert (await client.post("/tools/repairs/flaky/decline", json={"user_id": "alice"})).status_code == 404

    asyncio.run(scenario())


def test_fixer_card_is_served_without_a_model_and_unknown_contexts_are_refused(monkeypatch):
    """The A2A card path never starts a model or container; a request for a context the service
    did not register is refused (identity is server-owned, never client-supplied)."""
    monkeypatch.setattr("agent.api.core.panel_agent.default_selection", lambda: None)
    service = RepairService(RepairConfig(threshold=2, models=("m1",)), fixer_url="http://test/a2a/fixer")
    card = service.agent_for("__agent_card__")
    assert card.name == "Ron Tool Fixer" and card.description
    card.cleanup()
    with pytest.raises(LookupError):
        service.agent_for("repair-unknown")


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
    files = {f"server/{tool_repair.MCP_SERVER_PACKAGE}/__init__.py": b"", f"server/{tool_repair.MCP_SERVER_PACKAGE}/server.py": b"# repaired\n"}
    for name, data in files.items():
        asyncio.run(tool_repair.repair_storage("alice").write(f"user_browser_browser_click/{rev}/{name}", data))
    digest = tool_repair.artifact_digest(files)
    token = tool_repair.approval_token("alice", "user_browser_browser_click", rev, None, digest)
    asyncio.run(tool_repair.write_manifest("alice", {"tool_name": "user_browser_browser_click", "revision": rev, "target_kind": "mcp",
        "repair_kind": "server", "source_path": None, "base_sha256": None, "status": "verified", "created_at": "2026-10-05T00:00:00",
        "demonstrations": [], "files": sorted(files), "artifact_digest": digest, "approval_token": token}))
    asyncio.run(tool_repair.activate("alice", "user_browser_browser_click", rev, approval_token_=token))
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
