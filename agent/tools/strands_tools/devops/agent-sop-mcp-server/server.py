from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _add_sops_package(repo_root: Path) -> None:
    sops_pkg = repo_root / "agent" / "tools" / "agent-sop" / "python"
    sys.path.insert(0, str(sops_pkg))


def _default_sop_paths(repo_root: Path) -> str:
    custom = repo_root / "agent" / "sops"
    builtins = repo_root / "agent" / "tools" / "agent-sop" / "agent-sops"
    return f"{custom}:{builtins}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Agent SOP MCP server")
    parser.add_argument("--sop-paths", default=None, help="Colon-separated SOP directories")
    args = parser.parse_args()

    repo_root = _repo_root()
    _add_sops_package(repo_root)

    from strands_agents_sops.mcp import run_mcp_server

    sop_paths = args.sop_paths or _default_sop_paths(repo_root)
    run_mcp_server(sop_paths=sop_paths)


if __name__ == "__main__":
    main()
