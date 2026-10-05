"""Lesson-bound journal copy: same semantics as devops/journal.py, Bidi-compatible, workspace-confined."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

import pytest

from agent.api.core.teaching_journal import (
    LessonWorkspacePolicy,
    create_copy_tool,
    create_lesson_journal,
    lesson_workspace,
)


class Recorder:
    def __init__(self) -> None:
        self.entries: list[tuple[str, str]] = []

    async def __call__(self, kind: str, text: str) -> None:
        self.entries.append((kind, text))


@pytest.mark.asyncio
async def test_journal_actions_match_original_markdown_and_mirror_entries(tmp_path):
    recorder = Recorder()
    journal = create_lesson_journal(tmp_path, recorder)
    func = journal._tool_func
    assert asyncio.iscoroutinefunction(func), "Bidi tool executor awaits async tools"

    assert await func(action="write") == {"status": "error", "content": [{"text": "Content is required for write action"}]}
    assert await func(action="add_task") == {"status": "error", "content": [{"text": "Task is required for add_task action"}]}
    assert (await func(action="read", date="2026-01-01"))["status"] == "error"
    assert (await func(action="list"))["content"][0]["text"] == "No journal entries found"

    written = await func(action="write", content="Opened the settings page", date="2026-01-01")
    assert written["status"] == "success" and written["content"][0]["text"].startswith("Added entry to journal: ")
    tasked = await func(action="add_task", task="Verify the saved profile", date="2026-01-01")
    assert tasked["status"] == "success"

    path = tmp_path / "journal" / "2026-01-01.md"
    text = path.read_text()
    assert re.fullmatch(r"\n## \d\d:\d\d:\d\d\nOpened the settings page\n\n## \d\d:\d\d:\d\d - Task\n- \[ \] Verify the saved profile\n", text)
    assert (await func(action="read", date="2026-01-01"))["content"] == [{"text": text}]
    listed = await func(action="list")
    assert listed["content"][0]["text"] == "Listed 1 journal entries"
    assert listed["content"][1]["json"]["entries"] == [{"date": "2026-01-01", "entry_count": 2, "task_count": 1}]
    assert recorder.entries == [("observation", "Opened the settings page"), ("task", "Verify the saved profile")]
    assert (await func(action="nope"))["content"][0]["text"] == "Unknown action: nope"


@pytest.mark.asyncio
async def test_journal_date_is_validated_and_cannot_escape_the_workspace(tmp_path):
    journal = create_lesson_journal(tmp_path)
    for bad in ("../../etc/x", "2026-13-40", "20260101", "today"):
        result = await journal._tool_func(action="write", content="x", date=bad)
        assert result["status"] == "error", bad
    assert list(tmp_path.rglob("*")) in ([], [tmp_path / "journal"])
    assert (await journal._tool_func(action="write", content="ok"))["status"] == "success"
    files = list((tmp_path / "journal").glob("*.md"))
    assert len(files) == 1 and re.fullmatch(r"\d{4}-\d{2}-\d{2}\.md", files[0].name)


@pytest.mark.asyncio
async def test_copy_into_lesson_only_writes_inside_workspace_and_never_touches_source(tmp_path):
    source = tmp_path / "existing" / "skill.md"
    source.parent.mkdir()
    source.write_text("original")
    workspace = tmp_path / "lesson"
    recorder = Recorder()
    copy = create_copy_tool(workspace, recorder)._tool_func

    result = await copy(source_path=str(source), destination="skills/skill.md")
    assert result["status"] == "success"
    assert (workspace / "skills" / "skill.md").read_text() == "original"
    assert source.read_text() == "original"
    assert recorder.entries[0][0] == "copy"
    with pytest.raises(FileExistsError):
        await copy(source_path=str(source), destination="skills/skill.md")
    for destination in ("../outside.md", "/abs/outside.md", "skills/../../outside.md"):
        with pytest.raises(ValueError):
            await copy(source_path=str(source), destination=destination)
    assert not (tmp_path / "outside.md").exists()
    with pytest.raises(FileNotFoundError):
        await copy(source_path=str(tmp_path / "missing"), destination="m.md")
    with pytest.raises(ValueError):
        await copy(source_path=str(workspace / "skills" / "skill.md"), destination="copy2.md")


def test_workspace_policy_confines_editor_writes_and_denies_unconfinable_tools(tmp_path):
    workspace = tmp_path / "lesson"
    policy = LessonWorkspacePolicy(workspace, lesson_tools={"journal", "copy_into_lesson", "finish_observation"})
    assert policy.decision("journal", {"action": "write"}) is None
    assert policy.decision("http_request", {"url": "https://example.com"}) is None
    assert policy.decision("user_browser_click", {"selector": "a"}) is None
    assert policy.decision("editor", {"command": "view", "path": "/etc/hosts"}) is None
    assert policy.decision("editor", {"command": "create", "path": str(workspace / "tool.py")}) is None
    for command in ("create", "str_replace", "pattern_replace", "insert", "undo_edit"):
        assert policy.decision("editor", {"command": command, "path": str(tmp_path / "existing.py")}), command
        assert policy.decision("editor", {"command": command, "path": str(workspace / ".." / "x.py")}), command
    assert policy.decision("editor", {"command": "create"}), "missing path is denied"
    for name in ("shell", "environment", "mcp_client"):
        assert "without a sandbox" in policy.decision(name, {"command": "ls"})


def test_workspace_policy_cancels_through_native_before_tool_call_event(tmp_path):
    from strands.hooks import BeforeToolCallEvent, HookRegistry

    workspace = tmp_path / "lesson"
    policy = LessonWorkspacePolicy(workspace, lesson_tools={"journal"})
    registry = HookRegistry()
    registry.add_hook(policy)
    agent = object()
    denied = BeforeToolCallEvent(agent=agent, selected_tool=None, invocation_state={},
                                 tool_use={"toolUseId": "1", "name": "shell", "input": {"command": "rm -rf /"}})
    registry.invoke_callbacks(denied)
    assert isinstance(denied.cancel_tool, str) and "shell" in denied.cancel_tool
    allowed = BeforeToolCallEvent(agent=agent, selected_tool=None, invocation_state={},
                                  tool_use={"toolUseId": "2", "name": "journal", "input": {"action": "list"}})
    registry.invoke_callbacks(allowed)
    assert allowed.cancel_tool is False
    assert policy.denied == [("shell", denied.cancel_tool)]


def test_lesson_workspace_is_under_teaching_root():
    path = lesson_workspace(Path("/root"), "scope", "sess")
    assert path == Path("/root/scope/workspaces/sess")
