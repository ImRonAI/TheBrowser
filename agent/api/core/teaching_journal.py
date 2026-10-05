"""Teach Ron's own copy of the daily journal tool, bound to one lesson workspace.

This is a copy of ``agent/tools/strands_tools/devops/journal.py`` with the same four
actions (``write``/``read``/``list``/``add_task``), the same Markdown layout
(``## HH:MM:SS`` entries, ``## HH:MM:SS - Task`` + ``- [ ] task``) and the same
result shapes. It differs only where the original cannot run inside a native
``BidiAgent`` lesson:

- the journal directory is a factory argument (the lesson workspace), not
  ``cwd()``/``RON_AGENT_SANDBOX_ROOT`` — no global environment or ``chdir``;
- ``date`` is validated as ``YYYY-MM-DD`` so it can never escape the directory;
- the tool is ``async`` with file IO in ``asyncio.to_thread`` (the Bidi tool
  executor awaits tool streams) and prints no rich console panels;
- every ``write``/``add_task`` is also forwarded to ``on_entry`` so the
  ``TeachingService`` journal remains the single evidence source for the review
  digest and approval; the Markdown file is the agent-facing mirror.

Also provides ``LessonWorkspacePolicy``, a native ``BeforeToolCallEvent`` hook that
confines mutating parent-scope tools to the lesson workspace, and
``copy_into_lesson``, which copies an existing file into the workspace without ever
modifying the source.
"""

from __future__ import annotations

import asyncio
import re
import shutil
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from strands import tool
from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry

OnEntry = Callable[[str, str], Awaitable[Any]]
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_COPY_BYTES = 5 * 1024 * 1024
#: Editor commands that write; ``view``/``find_line`` only read.
EDITOR_MUTATING = frozenset({"create", "str_replace", "pattern_replace", "insert", "undo_edit"})
#: Parent-scope tools that execute on the host without a sandbox and therefore cannot be
#: confined to the workspace by argument inspection.
UNCONFINABLE_TOOLS = frozenset({"shell", "environment", "mcp_client"})


def lesson_workspace(root: Path, scope: str, session_id: str) -> Path:
    """The lesson's private directory under the teaching storage root."""
    return root / scope / "workspaces" / session_id


def _validated_date(date_str: str | None) -> str:
    if date_str is None:
        return datetime.now().strftime("%Y-%m-%d")
    if not _DATE.fullmatch(date_str):
        raise ValueError("date must be YYYY-MM-DD")
    datetime.strptime(date_str, "%Y-%m-%d")
    return date_str


def _inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def create_lesson_journal(journal_root: Path, on_entry: OnEntry | None = None) -> Any:
    """Build the lesson-bound ``journal`` tool.

    Args:
        journal_root: Directory that receives ``journal/<date>.md`` files.
        on_entry: Awaited with ``(kind, text)`` after each ``write`` (``observation``) and
            ``add_task`` (``task``) so the durable service journal records the same evidence.
    """
    journal_root = Path(journal_root)

    def ensure_journal_dir() -> Path:
        journal_dir = journal_root / "journal"
        journal_dir.mkdir(parents=True, exist_ok=True)
        return journal_dir

    def get_journal_path(date_str: str | None = None) -> Path:
        return ensure_journal_dir() / f"{_validated_date(date_str)}.md"

    def append(path: Path, text: str) -> None:
        with open(path, "a") as handle:
            handle.write(text)

    @tool
    async def journal(action: str, content: str | None = None, date: str | None = None,
                      task: str | None = None) -> dict[str, Any]:
        """Create and manage this lesson's daily journal entries with tasks and notes.

        Record every observable interaction here as it happens: what the user said, what
        you said, what you saw on the shared screen, and open questions. Entries are
        stored as Markdown in the lesson workspace, organized by date, and mirrored into
        the durable lesson evidence that the user later reviews and approves.

        Args:
            action: Action to perform (write/read/list/add_task)
            content: Content to write (required for write action)
            date: Date in YYYY-MM-DD format (defaults to today)
            task: Task to add (required for add_task action)

        Returns:
            Dictionary containing status and response content:
            Success case: Returns confirmation of the action performed
            Error case: Returns information about what went wrong
        """
        try:
            if action == "write":
                if not content:
                    return {"status": "error", "content": [{"text": "Content is required for write action"}]}
                journal_path = get_journal_path(date)
                timestamp = datetime.now().strftime("%H:%M:%S")
                await asyncio.to_thread(append, journal_path, f"\n## {timestamp}\n{content}\n")
                if on_entry is not None:
                    await on_entry("observation", content)
                return {"status": "success", "content": [{"text": f"Added entry to journal: {journal_path}"}]}

            elif action == "read":
                journal_path = get_journal_path(date)
                if not journal_path.exists():
                    return {"status": "error", "content": [{"text": f"No journal found for date: {journal_path.stem}"}]}
                text = await asyncio.to_thread(journal_path.read_text)
                return {"status": "success", "content": [{"text": text}]}

            elif action == "list":
                journal_dir = ensure_journal_dir()
                journals = sorted(journal_dir.glob("*.md"))
                if not journals:
                    return {"status": "success", "content": [{"text": "No journal entries found"}]}
                entries = []
                for journal_file in journals:
                    text = await asyncio.to_thread(journal_file.read_text)
                    entries.append({
                        "date": journal_file.stem,
                        "entry_count": len([line for line in text.split("\n") if line.startswith("## ")]),
                        "task_count": text.count("- [ ]"),
                    })
                return {"status": "success", "content": [{"text": f"Listed {len(entries)} journal entries"},
                                                          {"json": {"entries": entries}}]}

            elif action == "add_task":
                if not task:
                    return {"status": "error", "content": [{"text": "Task is required for add_task action"}]}
                journal_path = get_journal_path(date)
                timestamp = datetime.now().strftime("%H:%M:%S")
                await asyncio.to_thread(append, journal_path, f"\n## {timestamp} - Task\n- [ ] {task}\n")
                if on_entry is not None:
                    await on_entry("task", task)
                return {"status": "success", "content": [{"text": f"Added task to journal: {journal_path}"}]}

            return {"status": "error", "content": [{"text": f"Unknown action: {action}"}]}
        except Exception as error:
            return {"status": "error", "content": [{"text": f"Error: {str(error)}"}]}

    return journal


def create_copy_tool(workspace: Path, on_entry: OnEntry | None = None) -> Any:
    """``copy_into_lesson``: copy an existing file into the lesson workspace, never the reverse."""
    workspace = Path(workspace)

    def copy(source: Path, destination: Path) -> int:
        workspace.mkdir(parents=True, exist_ok=True)
        if not source.is_file():
            raise FileNotFoundError(f"{source} is not a file")
        if source.stat().st_size > MAX_COPY_BYTES:
            raise ValueError(f"{source} exceeds {MAX_COPY_BYTES} bytes")
        if destination.exists():
            raise FileExistsError(f"{destination} already exists in the lesson workspace")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        return destination.stat().st_size

    @tool
    async def copy_into_lesson(source_path: str, destination: str) -> dict[str, Any]:
        """Copy an existing tool or skill file into this lesson's workspace to build on it.

        Existing tools and skills are never modified; make a copy here and edit the copy.
        The destination is relative to the lesson workspace and must not already exist.

        Args:
            source_path: Absolute path of the existing file to copy.
            destination: Relative path inside the lesson workspace for the copy.
        """
        source = Path(source_path).expanduser()
        target = workspace / destination
        if not _inside(workspace, target) or Path(destination).is_absolute():
            raise ValueError("destination must stay inside the lesson workspace")
        if _inside(workspace, source):
            raise ValueError("source must be an existing file outside the lesson workspace")
        size = await asyncio.to_thread(copy, source, target)
        if on_entry is not None:
            await on_entry("copy", f"Copied {source} to lesson workspace as {destination} ({size} bytes)")
        return {"status": "success", "content": [{"text": f"Copied {size} bytes to {target}"}]}

    return copy_into_lesson


class LessonWorkspacePolicy(HookProvider):
    """Confine mutating parent-scope tools to the lesson workspace.

    Reads (``editor view``/``find_line``, ``http_request``, browser tools, lesson tools)
    pass. Editor writes must target a path inside the workspace. Tools that run on the
    host without a sandbox (``shell``, ``environment``, ``mcp_client``) cannot be confined by
    argument inspection, so they are denied outright. Denials use the native
    ``cancel_tool`` so the model receives an explanatory result instead of a crash.
    """

    def __init__(self, workspace: Path, *, lesson_tools: set[str]) -> None:
        self.workspace = Path(workspace)
        self.lesson_tools = set(lesson_tools)
        self.denied: list[tuple[str, str]] = []

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before_tool_call)

    def decision(self, name: str, tool_input: dict[str, Any]) -> str | None:
        """Return a denial reason, or ``None`` when the call may proceed."""
        if name in self.lesson_tools:
            return None
        if name in UNCONFINABLE_TOOLS:
            return (f"{name} is not available while teaching: it runs on the host without a sandbox. "
                    "Copy files into the lesson workspace with copy_into_lesson and edit the copies.")
        if name == "editor":
            command = tool_input.get("command")
            if command in EDITOR_MUTATING:
                path = tool_input.get("path")
                if not isinstance(path, str) or not _inside(self.workspace, Path(path)):
                    return (f"editor {command} is limited to the lesson workspace {self.workspace}; "
                            "existing tools and skills must not be modified. Use copy_into_lesson first.")
        return None

    def before_tool_call(self, event: BeforeToolCallEvent) -> None:
        reason = self.decision(event.tool_use["name"], dict(event.tool_use.get("input") or {}))
        if reason is not None:
            self.denied.append((event.tool_use["name"], reason))
            event.cancel_tool = reason
