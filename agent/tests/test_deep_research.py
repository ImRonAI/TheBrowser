"""Offline tests for Deep Research: the formation as Strands builds it, the kept events and the runs.

The agents run on ``ScriptedModel``, a Strands ``Model`` that calls ``subagent`` and
``handoff_to_agent`` where a real model would, so nothing leaves the machine.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, AsyncIterator, Iterator
import json
from pathlib import Path
import re
from typing import Any

from fastapi import FastAPI
import httpx
import pytest
from strands.models.model import Model
from strands.multiagent import Status, Swarm
from strands.multiagent.base import MultiAgentResult, NodeResult
from strands.multiagent.graph import Graph
from strands.storage import InMemoryStorage
from strands.types.streaming import StreamEvent

from agent.api.core import config as app_config
from agent.api.core import deep_research, panel_storage
from agent.api.endpoints import deep_research as deep_research_endpoints

_ROLE_RE = re.compile(r"^## Your role: (.+)$", re.MULTILINE)

#: Who each Swarm agent hands off to; a Swarm agent that hands off to nobody ends its Swarm.
#: The agent a Swarm agent's "## Handing off" section sends it to once its work is done.
_DONE_HANDOFF_RE = re.compile(r"^## Handing off\n.*?When .*?hand off to (\w+)\.", re.MULTILINE)


def _tool_use(tool_use_id: str, name: str, tool_input: dict[str, Any]) -> Iterator[StreamEvent]:
    yield {"messageStart": {"role": "assistant"}}
    yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": tool_use_id, "name": name}}}}
    yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(tool_input)}}}}
    yield {"contentBlockStop": {"contentBlockIndex": 0}}
    yield {"messageStop": {"stopReason": "tool_use"}}


def _text(text: str) -> Iterator[StreamEvent]:
    yield {"messageStart": {"role": "assistant"}}
    yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"reasoningContent": {"text": "Thinking."}}}}
    yield {"contentBlockStop": {"contentBlockIndex": 0}}
    yield {"contentBlockDelta": {"contentBlockIndex": 1, "delta": {"text": text}}}
    yield {"contentBlockStop": {"contentBlockIndex": 1}}
    yield {"messageStop": {"stopReason": "end_turn"}}


def _tool_results(messages: list[Any]) -> int:
    return sum(
        1
        for message in messages
        if message.get("role") == "user"
        for block in message.get("content") or ()
        if "toolResult" in block
    )


class ScriptedModel(Model):
    """Each Swarm agent hands off as its instructions say once its work is done; the researcher first runs one
    ``subagent``."""

    def __init__(self, gate: asyncio.Event | None = None) -> None:
        self.gate = gate
        self.roles: list[str] = []

    def update_config(self, **model_config: Any) -> None:
        del model_config

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "scripted"}

    async def structured_output(
        self, output_model: Any, prompt: Any, system_prompt: Any = None, **kwargs: Any
    ) -> AsyncGenerator[dict[str, Any], None]:
        raise NotImplementedError
        yield {}

    async def stream(
        self,
        messages: Any,
        tool_specs: list[Any] | None = None,
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[StreamEvent]:
        if self.gate is not None:
            await self.gate.wait()
        role = _ROLE_RE.search(system_prompt or "")
        label = role.group(1) if role else ""
        done = _tool_results(list(messages))
        steps: list[tuple[str, dict[str, Any]]] = []
        if label == "Researcher" and "subagent" in {spec["name"] for spec in tool_specs or ()}:
            steps.append(("subagent", {"task": "Find the surface code threshold."}))
        handoff = _DONE_HANDOFF_RE.search(system_prompt or "")
        if handoff:
            steps.append(("handoff_to_agent", {"agent_name": handoff.group(1), "message": f"{label} is done."}))
        if role and done == 0:
            self.roles.append(label)
        events = _tool_use(f"{label or 'sub'}-{done}", *steps[done]) if done < len(steps) else _text(f"{label} done.")
        for event in events:
            yield event


@pytest.fixture
def isolated(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    monkeypatch.setattr(app_config, "RON_DEEP_RESEARCH_ARTIFACTS_DIR", tmp_path / "artifacts")
    monkeypatch.setattr(app_config, "RON_DEEP_RESEARCH_ENABLED", True)
    monkeypatch.setattr(deep_research, "_RUNS", {})


def _agents() -> list[deep_research.AgentSpec]:
    return [agent for formation in deep_research.FORMATION_TOPOLOGY["nodes"] for agent in formation["children"]]


def test_every_agent_has_its_skill_and_swarms_have_no_edges() -> None:
    skills = {skill.name for skill in deep_research.Skill.from_directory(deep_research.DEEP_RESEARCH_SKILLS_DIR)}
    agents = _agents()
    assert len(agents) == 19
    assert len({agent["id"] for agent in agents}) == len(agents)
    assert {agent["skill"] for agent in agents} <= skills
    for formation in deep_research.FORMATION_TOPOLOGY["nodes"]:
        if formation["kind"] == "swarm":
            assert formation["edges"] == []


def test_each_agent_gets_only_the_listed_sections_of_its_skill() -> None:
    skills = {skill.name: skill for skill in deep_research.Skill.from_directory(deep_research.DEEP_RESEARCH_SKILLS_DIR)}
    agents = {agent["id"]: agent for agent in _agents()}
    assert set(deep_research.SKILL_SECTIONS) <= set(agents)
    for agent_id, headings in deep_research.SKILL_SECTIONS.items():
        skill = skills[agents[agent_id]["skill"]]
        text = deep_research.skill_sections(skill.instructions, headings)
        assert len(text) < len(skill.instructions)
        for heading in headings:
            assert re.search(rf"^#+ {re.escape(heading)}$", text, re.MULTILINE)


def test_skill_sections_end_at_the_next_heading_of_their_level_and_skip_code_fences() -> None:
    body = "# Skill\n## Keep\ntext\n```sh\n# not a heading\n```\n### Inner\nmore\n## Drop\ngone\n"
    assert deep_research.skill_sections(body, ("Keep",)) == "## Keep\ntext\n```sh\n# not a heading\n```\n### Inner\nmore"
    with pytest.raises(ValueError):
        deep_research.skill_sections(body, ("Missing",))


def test_every_swarm_agent_is_told_when_to_hand_off_and_only_the_last_check_ends_it() -> None:
    for formation in deep_research.FORMATION_TOPOLOGY["nodes"]:
        ids = [agent["id"] for agent in formation["children"]]
        if formation["kind"] == "graph":
            assert not set(ids) & set(deep_research.SWARM_HANDOFFS)
            continue
        for agent_id in ids:
            text = deep_research.SWARM_HANDOFFS[agent_id]
            assert set(re.findall(r"hand off to (\w+)", text)) - {"the", "its"} <= set(ids)
            assert ("without handing off" in text) == (agent_id == ids[-1])


def test_the_formation_is_a_graph_of_swarms_and_graphs(isolated: None) -> None:
    graph = deep_research.build_deep_research_graph(
        session_id="dr-build", user_id="u1", model=ScriptedModel(), depth="deep"
    )
    assert isinstance(graph, Graph)
    kinds = {node_id: type(node.executor) for node_id, node in graph.nodes.items()}
    assert kinds == {
        "research_swarm": Swarm,
        "data_analysis_graph": Graph,
        "writing_swarm": Swarm,
        "production_graph": Graph,
    }
    research = graph.nodes["research_swarm"].executor
    assert isinstance(research, Swarm)
    assert list(research.nodes) == ["researcher", "fact_checker", "citation_manager", "research_qa"]
    production = graph.nodes["production_graph"].executor
    assert isinstance(production, Graph)
    assert {node.node_id for node in production.entry_points} == {"pdf_publisher", "deck_producer"}
    for node in graph.nodes.values():
        assert getattr(node.executor, "_session_manager", None) is None


def test_filter_event_keeps_documented_fields_through_nested_streams() -> None:
    agent_text = {"data": "Hello", "delta": {"text": "Hello"}, "agent": object()}
    nested = {
        "type": "multiagent_node_stream",
        "node_id": "research_swarm",
        "event": {"type": "multiagent_node_stream", "node_id": "researcher", "event": agent_text},
    }
    assert deep_research.filter_event(nested) == {
        "type": "multiagent_node_stream",
        "node_id": "research_swarm",
        "event": {"type": "multiagent_node_stream", "node_id": "researcher", "event": {"data": "Hello"}},
    }
    sub = {
        "tool_stream_event": {
            "tool_use": {"toolUseId": "t1", "name": "subagent", "input": {"task": "x"}, "extra": 1},
            "data": {"reasoningText": "Hmm", "reasoning": True},
        }
    }
    assert deep_research.filter_event(sub) == {
        "tool_stream_event": {
            "tool_use": {"toolUseId": "t1", "name": "subagent", "input": {"task": "x"}},
            "data": {"reasoningText": "Hmm"},
        }
    }
    stop = {"type": "multiagent_node_stop", "node_id": "n", "node_result": NodeResult(result=Exception("boom"))}
    kept = deep_research.filter_event(stop)
    assert kept is not None and kept["node_result"] == NodeResult(result=Exception("boom")).to_dict()
    result = {"type": "multiagent_result", "result": MultiAgentResult(status=Status.COMPLETED)}
    assert deep_research.filter_event(result) == {
        "type": "multiagent_result",
        "result": MultiAgentResult(status=Status.COMPLETED).to_dict(),
    }
    assert deep_research.filter_event({"init_event_loop": True}) is None
    assert deep_research.filter_event({"event": {"messageStart": {"role": "assistant"}}}) is None


def _inner_events(events: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    for event in events:
        current: Any = event
        while isinstance(current, dict):
            yield current
            current = current.get("event")


async def _wait_until_done(user_id: str, session_id: str) -> dict[str, object]:
    for _ in range(600):
        run = await deep_research.get_run(user_id=user_id, session_id=session_id)
        assert run is not None
        if not run["active"]:
            return run
        await asyncio.sleep(0.05)
    raise AssertionError("the run did not finish")


@pytest.mark.asyncio
async def test_a_run_streams_the_sdk_events_and_reopens_from_storage(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = ScriptedModel()
    monkeypatch.setattr(deep_research, "build_model", lambda *args, **kwargs: model)
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("gemini", "scripted"))

    meta = await deep_research.start_run(user_id="u1", query="Surface codes vs qLDPC", depth="standard")
    session_id = meta["session_id"]
    run = await _wait_until_done("u1", session_id)
    assert run["status"] == "completed", run["error"]

    assert model.roles[:15] == [
        "Researcher",
        "Fact Checker",
        "Citation Manager",
        "Research QA",
        "Visual Planner",
        "Data Analyst",
        "Visual Citation",
        "Visual QA",
        "Report Designer",
        "Deck Designer",
        "Layout QA",
        "Report Writer",
        "Report QA",
        "Deck Writer",
        "Deck QA",
    ]
    assert set(model.roles[15:]) == {"PDF Publisher", "Slidev Producer", "PDF QA", "Slidev QA"}

    events = run["events"]
    assert isinstance(events, list)
    flat = list(_inner_events(events))
    assert {"type": "multiagent_handoff", "from_node_ids": ["researcher"], "to_node_ids": ["fact_checker"],
            "message": "Researcher is done."} in flat
    assert any(event.get("type") == "multiagent_node_start" and event.get("node_id") == "writing_swarm" for event in flat)
    assert any("reasoningText" in event for event in flat)
    sub_events = [event["tool_stream_event"] for event in flat if "tool_stream_event" in event]
    assert sub_events and sub_events[0]["tool_use"]["name"] == "subagent"
    assert events[-1]["type"] == "multiagent_result"

    frames = [frame async for frame in deep_research.stream_events(user_id="u1", session_id=session_id, after=0)]
    assert len(frames) == len(events) + 1
    assert frames[0].startswith("id: 1\ndata: ")
    assert frames[-1].startswith("event: run\n")

    monkeypatch.setattr(deep_research, "_RUNS", {})
    reopened = await deep_research.get_run(user_id="u1", session_id=session_id)
    assert reopened is not None and reopened["events"] == json.loads(json.dumps(events, default=str))
    assert [listed["session_id"] for listed in await deep_research.list_runs(user_id="u1")] == [session_id]
    assert await deep_research.get_run(user_id="u2", session_id=session_id) is None

    assert await deep_research.delete_run(user_id="u1", session_id=session_id)
    assert await deep_research.get_run(user_id="u1", session_id=session_id) is None


@pytest.mark.asyncio
async def test_cancel_stops_the_run_and_a_saved_active_run_reads_as_failed(
    isolated: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    gate = asyncio.Event()
    monkeypatch.setattr(deep_research, "build_model", lambda *args, **kwargs: ScriptedModel(gate))
    monkeypatch.setattr(deep_research, "resolve_selection", lambda *args: ("gemini", "scripted"))

    meta = await deep_research.start_run(user_id="u1", query="Battery chemistry")
    session_id = meta["session_id"]
    await asyncio.sleep(0.2)
    cancelled = await deep_research.cancel_run(user_id="u1", session_id=session_id)
    assert cancelled is not None and cancelled["status"] == "cancelled" and not cancelled["active"]

    storage = panel_storage.get_user_session_storage("u1")
    saved = {**cancelled, "status": "running", "active": True}
    await storage.write(f"deep_research/runs/{session_id}/run.json", json.dumps(saved).encode())
    monkeypatch.setattr(deep_research, "_RUNS", {})
    reread = await deep_research.get_run(user_id="u1", session_id=session_id)
    assert reread is not None
    assert (reread["status"], reread["active"], reread["error"]) == (
        "failed",
        False,
        "The server stopped during this run.",
    )


@pytest.mark.asyncio
async def test_endpoints_are_loopback_only_and_serve_the_workspace(isolated: None) -> None:
    app = FastAPI()
    app.include_router(deep_research_endpoints.router)
    remote = httpx.ASGITransport(app=app, client=("203.0.113.42", 52100))
    async with httpx.AsyncClient(transport=remote, base_url="http://test") as client:
        assert (await client.get("/deep-research/status")).status_code == 403

    workspace = deep_research.artifacts_dir("dr-files")
    (workspace / "slides").mkdir(parents=True)
    (workspace / "report.md").write_text("# Report\n", encoding="utf-8")
    (workspace / "slides" / "index.html").write_text("<html></html>", encoding="utf-8")
    (workspace.parent / "secret.txt").write_text("no", encoding="utf-8")

    local = httpx.ASGITransport(app=app, client=("127.0.0.1", 52100))
    async with httpx.AsyncClient(transport=local, base_url="http://test") as client:
        status = (await client.get("/deep-research/status")).json()
        assert status["topology"]["nodes"][0]["id"] == "research_swarm"
        report = await client.get("/deep-research/runs/dr-files/artifacts/report.md")
        assert report.status_code == 200 and report.text == "# Report\n"
        assert (await client.get("/deep-research/runs/dr-files/artifacts/slides/")).text == "<html></html>"
        assert (await client.get("/deep-research/runs/dr-files/artifacts/%2E%2E/secret.txt")).status_code == 404
        download = await client.get("/deep-research/runs/dr-files/artifacts/report.md?download=true")
        assert download.headers["content-disposition"] == 'attachment; filename="report.md"'
        assert (await client.get("/deep-research/runs/dr-missing")).status_code == 404
        assert (await client.post("/deep-research/runs", json={"query": "  "})).status_code == 422
