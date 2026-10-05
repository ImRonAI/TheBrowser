"""Retrieve learned workflows from the upstream Strands Agent SOP MCP server."""

from pathlib import Path
import sys

from mcp import StdioServerParameters
from mcp.client.stdio import stdio_client
from strands.tools.mcp import MCPClient
from strands.vended_plugins.context_injector import ContextInjector


def native_sop_prompt(directory: Path, user_input: str = "", *, name: str = "workflow") -> str:
    """Load the current approved workflow through the unmodified upstream server.

    A new short-lived server reads the directory on each call, so published SOP
    changes are visible without retaining stale prompt content or user credentials.
    """
    directory = directory.resolve(strict=True)
    if not name or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for character in name):
        raise ValueError("Invalid native SOP name")
    if not (directory / f"{name}.sop.md").is_file():
        raise ValueError(f"The requested {name}.sop.md is missing")
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "strands_agents_sops", "mcp", "--sop-paths", str(directory)],
    )
    with MCPClient(lambda: stdio_client(parameters), startup_timeout=15) as client:
        result = client.get_prompt_sync(name, {"user_input": user_input})
        text = "\n".join(message.content.text for message in result.messages
                         if message.content.type == "text")
        if not text:
            raise ValueError("The native Agent SOP server returned an empty prompt")
        return text


def learning_sop_injector() -> ContextInjector:
    """Load via native MCP first, then use the existing user-turn injector unchanged."""
    prompt = native_sop_prompt(Path(__file__).parents[2] / "sops", name="learning-a-new-skill")
    return ContextInjector(lambda _context: prompt, trigger="userTurn", name="ron:learning-a-new-skill")
