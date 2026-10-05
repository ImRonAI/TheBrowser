"""Approval remains bound to actual observed evidence across Live changes."""

import asyncio
import copy
from unittest.mock import AsyncMock

import pytest

from agent.api.core.teaching import TeachingService, _group_steps, _journal_digest


async def reviewed_lesson(service):
    session = await service.create_session("owner", "panel", "Example", "Read an example page")
    await service.begin_observation("owner", "panel", session["id"])
    await service.append_journal("owner", "panel", session["id"], "Opened example page")
    await service.set_status("owner", "panel", session["id"], "recorded")
    session = await service.get_session("owner", "panel", session["id"])
    session.update(status="awaiting_approval", review={
        "revision": 1, "journal_digest": _journal_digest(session), "html": "<p>Review</p>",
    })
    await service._write(service._key("owner", "panel", session["id"]), session)
    return session


@pytest.mark.asyncio
async def test_approval_rejects_stale_revision_or_changed_journal(tmp_path):
    service = TeachingService(tmp_path)
    session = await reviewed_lesson(service)
    service._compile = AsyncMock()
    with pytest.raises(ValueError, match="stale"):
        await service.approve("owner", "panel", session["id"], 2)
    session["journal"][0]["text"] = "Changed after review"
    await service._write(service._key("owner", "panel", session["id"]), session)
    with pytest.raises(ValueError, match="stale"):
        await service.approve("owner", "panel", session["id"], 1)
    service._compile.assert_not_called()
    assert not service._tasks


@pytest.mark.asyncio
async def test_matching_approval_records_digest_before_compilation(tmp_path):
    service = TeachingService(tmp_path)
    session = await reviewed_lesson(service)
    captured = []

    async def compile_lesson(approved, key):
        captured.append(await service._read(key))
        assert approved["approval"]["journal_digest"] == _journal_digest(approved)

    service._compile = compile_lesson
    approved = await service.approve("owner", "panel", session["id"], 1)
    await asyncio.gather(*service._tasks.values())
    assert approved["status"] == "compiling"
    assert captured[0]["approval"]["revision"] == 1
    assert captured[0]["approval"]["journal_digest"] == session["review"]["journal_digest"]
    await service.shutdown()


@pytest.mark.asyncio
async def test_resume_invalidates_review_and_scopes_remain_isolated(tmp_path):
    service = TeachingService(tmp_path)
    session = await reviewed_lesson(service)
    resumed = await service.begin_observation("owner", "panel", session["id"])
    assert resumed["review"] is None and resumed["approval"] is None
    assert resumed["journal"] == session["journal"]
    with pytest.raises(FileNotFoundError):
        await service.get_session("other-owner", "panel", session["id"])
    with pytest.raises(FileNotFoundError):
        await service.get_session("owner", "issue:another", session["id"])
    await service.set_status("owner", "panel", session["id"], "recorded")
    with pytest.raises(ValueError, match="finished"):
        await service.append_journal("owner", "panel", session["id"], "Late async observation")


def test_saved_tool_group_must_match_approved_revision_and_step_order():
    manifest = {
        "approval_revision": 1,
        "steps": [{"title": "Read", "instructions": "Read issue", "expected_outcome": "Issue read",
                   "evidence_sequences": [1]}],
        "tool_group": {"id": "group", "name": "Example", "approval_revision": 1,
                       "members": [{"id": "reader", "kind": "tool", "target": "read_issue"}],
                       "steps": [{"step": 1, "member_ids": ["reader"]}]},
    }
    assert _group_steps(manifest)[0].tools == ["read_issue"]
    for mutation in ("revision", "order", "member"):
        changed = copy.deepcopy(manifest)
        if mutation == "revision":
            changed["tool_group"]["approval_revision"] = 2
        elif mutation == "order":
            changed["tool_group"]["steps"][0]["step"] = 2
        else:
            changed["tool_group"]["steps"][0]["member_ids"] = ["unapproved"]
        with pytest.raises(ValueError):
            _group_steps(changed)


@pytest.mark.asyncio
async def test_mcp_cannot_borrow_registered_issue_credentials(tmp_path, monkeypatch):
    from agent.api.core import teaching

    service = TeachingService(tmp_path)
    monkeypatch.setattr(teaching, "_service", service)
    service._assigned_tools[teaching._scope("owner", "issue:example")] = {"read_issue": object()}
    with pytest.raises(ValueError, match="authenticated issue agent"):
        await teaching.use_skill("owner", "issue:example", "example", "run it")
