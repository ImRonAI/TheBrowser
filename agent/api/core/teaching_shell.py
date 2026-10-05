"""Per-lesson Strands Shell MCP server (``strands-shell --config <toml> --mcp``).

Teach Ron's only process-execution capability is the official Strands Shell
(https://github.com/strands-agents/shell): an in-process Rust VFS shell exposed over
MCP as ``shell``, ``read_file``, ``write_file`` and ``list_dir``. Nothing here spawns a
host shell. Per lesson one server process is started through the native
``strands.tools.mcp.MCPClient`` ``ToolProvider`` with a generated TOML:

- ``mode = "copy"`` binds for the vendored tool library and configured skill roots at
  ``/sources/tools`` and ``/sources/skills/<name>`` — the agent edits snapshots, never
  the host originals;
- one ``mode = "direct"`` bind for the lesson workspace at ``/workspace`` so artifacts
  the agent builds persist on the host where the compiler can pick them up.

No other host path exists inside the shell, no credentials are declared, and the
server inherits an empty environment, so ``.env``/``.git`` and user secrets are not
reachable. ``curl`` keeps the shell's own SSRF defaults.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from typing import Any

SHELL_SERVER_NAME = "lesson_shell"
#: Official tool names exposed by ``strands-shell --mcp`` (0.3.x).
SHELL_TOOL_NAMES = frozenset({"shell", "read_file", "write_file", "list_dir"})
WORKSPACE_MOUNT = "/workspace"
TOOLS_MOUNT = "/sources/tools"
SKILLS_MOUNT = "/sources/skills"


def shell_executable() -> str:
    """Path of the installed ``strands-shell`` CLI (same venv as the API)."""
    candidate = Path(sys.executable).with_name("strands-shell")
    if candidate.is_file():
        return str(candidate)
    found = shutil.which("strands-shell")
    if not found:
        raise RuntimeError("strands-shell is not installed in the API environment")
    return found


def _toml_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def shell_config_toml(workspace: Path, *, tools_source: Path | None, skill_roots: dict[str, Path]) -> str:
    """Render the per-lesson Strands Shell TOML.

    Args:
        workspace: Host lesson workspace, direct-bound at ``/workspace``.
        tools_source: Vendored tool library root, copy-bound read-only at ``/sources/tools``.
        skill_roots: Configured skill roots, copy-bound read-only at ``/sources/skills/<name>``.
    """
    sections: list[str] = []

    def bind(mode: str, source: Path, destination: str, *, readonly: bool) -> None:
        lines = ["[[bind]]", f"mode = {_toml_string(mode)}", f"source = {_toml_string(str(source))}",
                 f"destination = {_toml_string(destination)}"]
        if readonly:
            lines.append("readonly = true")
        sections.append("\n".join(lines))

    if tools_source is not None:
        bind("copy", tools_source, TOOLS_MOUNT, readonly=True)
    for name, root in sorted(skill_roots.items()):
        bind("copy", root, f"{SKILLS_MOUNT}/{name}", readonly=True)
    bind("direct", workspace, WORKSPACE_MOUNT, readonly=False)
    return "\n\n".join(sections) + "\n"


def configured_skill_roots() -> dict[str, Path]:
    """Skill directories from ``PANEL_SKILLS_DIRS``/``PANEL_SKILLS_DIR`` keyed by mount name."""
    raw = os.environ.get("PANEL_SKILLS_DIRS") or os.environ.get("PANEL_SKILLS_DIR", "")
    roots: dict[str, Path] = {}
    for entry in raw.split(os.pathsep):
        if not entry.strip():
            continue
        path = Path(entry.strip()).expanduser().resolve()
        if not path.is_dir():
            continue
        name = path.name or "skills"
        suffix = 1
        while name in roots:
            suffix += 1
            name = f"{path.name}-{suffix}"
        roots[name] = path
    return roots


def write_shell_config(workspace: Path, *, tools_source: Path | None, skill_roots: dict[str, Path]) -> Path:
    """Write the lesson's TOML beside (not inside) the workspace so the agent cannot edit it."""
    config_path = workspace.parent / f"{workspace.name}.shell.toml"
    config_path.write_text(shell_config_toml(workspace, tools_source=tools_source, skill_roots=skill_roots))
    return config_path


def create_shell_client(config_path: Path) -> Any:
    """An UNSTARTED native ``MCPClient`` for ``strands-shell --config <toml> --mcp``.

    The server is started by the native tool registry when the agent is constructed
    (``add_consumer`` + ``load_tools``) and stopped at ``tool_registry.cleanup()``.
    Tools keep their official names; the prefix is not applied so the model sees the
    documented ``shell``/``read_file``/``write_file``/``list_dir``.
    """
    from mcp import StdioServerParameters, stdio_client
    from strands.tools.mcp import MCPClient

    params = StdioServerParameters(command=shell_executable(), args=["--config", str(config_path), "--mcp"], env={})
    return MCPClient(lambda: stdio_client(params))


def is_shell_tool(tool: Any, client: Any) -> bool:
    """Trusted identity check: the tool object must be the lesson shell client's own MCP tool,
    not merely a tool named ``shell``."""
    return getattr(tool, "mcp_client", None) is client and tool.tool_name in SHELL_TOOL_NAMES
