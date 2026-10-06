"""Learning SOP phases beyond observation: capability discovery, specialist authoring, demonstration."""

from __future__ import annotations

import json

import pytest

from agent.api.core import teaching
from agent.api.core.process_document import ProcessDocument, render_process_document


def _names(tools) -> set[str]:
    return {item.tool_name for item in tools}


def test_review_discovers_every_capability_category_but_cannot_create(tmp_path):
    service = teaching.TeachingService(tmp_path)
    review = _names(service.discovery_tools("u", "panel"))
    assert review == {"list_learned_skills", "list_harness_agents", "a2a_list_discovered_agents", "a2a_discover_agent"}
    assert review <= teaching.DISCOVERY_TOOLS
    publish = _names(service.discovery_tools("u", "panel", authoring=True))
    assert publish == review | {"create_harness"} and publish <= teaching.AUTHORING_TOOLS
    assert "a2a_send_message" not in teaching.AUTHORING_TOOLS, "learning must not execute the workflow"
    assert _names(service.discovery_tools("u", "issue:1", authoring=True)) == {
        "list_learned_skills", "a2a_list_discovered_agents", "a2a_discover_agent"}


def test_process_document_carries_the_implementation_choice_and_questions():
    document = ProcessDocument(title="Watch later", overview="o", prerequisites=[], inputs=[],
        steps=[{"title": "Save", "instructions": "Save it", "expected_outcome": "Saved", "evidence_sequences": [1]}],
        completion_criteria=["Saved"], exceptions=[], implementation="Create a <specialist> with create_harness.",
        questions=["Which YouTube account?"])
    html = render_process_document(document, 1, "now")
    assert "Recommended implementation" in html and "&lt;specialist&gt;" in html
    assert "Which YouTube account?" in html
    legacy = ProcessDocument.model_validate({key: value for key, value in document.model_dump().items()
                                             if key not in {"implementation", "questions"}})
    assert legacy.implementation == "" and legacy.questions == []


async def _published(tmp_path, agent_id="panel"):
    service = teaching.TeachingService(tmp_path)
    session = await service.create_session("u", agent_id, "Watch later", "Save a video")
    session.update(status="ready", skill_id=session["id"])
    key = service._key("u", agent_id, session["id"])
    await service._write(key, session)
    return service, session, key


@pytest.mark.asyncio
async def test_demonstration_runs_the_published_sop_once_and_records_evidence(tmp_path, monkeypatch):
    service, session, key = await _published(tmp_path)
    calls = []

    async def read_file(user_id, agent_id, skill_id, path):
        return {"content": json.dumps({"mcp_servers": [], "tools": {}})}

    async def use_skill(skill_name, request):
        calls.append((skill_name, json.loads(request)))
        return {"status": "completed", "results": [{"complete": True, "evidence": "toast seen", "result": "saved"}]}

    monkeypatch.setattr(service, "read_file", read_file)
    monkeypatch.setattr("agent.api.core.panel_tools.build_core_tools", lambda root: [])
    monkeypatch.setattr(teaching, "create_learned_skill_tools", lambda *args, **kwargs: [None, use_skill])
    await service._demonstrate(session, key)
    saved = await service._read(key)
    assert calls == [(session["id"], {"phase": "demonstrate", "objective": "Save a video", "context": ""})]
    assert saved["demonstration"]["status"] == "completed"
    assert saved["demonstration"]["evidence"] == "toast seen" and saved["demonstration"]["finished_at"]


@pytest.mark.asyncio
async def test_failed_or_interrupted_demonstrations_are_reported_not_hidden(tmp_path, monkeypatch):
    service, session, key = await _published(tmp_path)

    async def read_file(*args):
        raise FileNotFoundError("capabilities.json missing")

    monkeypatch.setattr(service, "read_file", read_file)
    await service._demonstrate(session, key)
    assert (await service._read(key))["demonstration"]["status"] == "failed"

    session["demonstration"] = {"status": "running", "started_at": "then"}
    await service._write(key, session)
    reloaded = await service.get_session("u", "panel", session["id"])
    assert reloaded["demonstration"]["status"] == "failed" and "interrupted" in reloaded["demonstration"]["result"]

    issue_service, issue_session, issue_key = await _published(tmp_path / "issue", "issue:1")
    await issue_service._demonstrate(issue_session, issue_key)
    assert (await issue_service._read(issue_key))["demonstration"]["status"] == "skipped"
