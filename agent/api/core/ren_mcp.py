"""Ren desktop as an MCP server and an MCP client, joined to the phone through Ren's hub.

**Server** (``ren-desktop``, FastMCP). What ren desktop serves to the phone and to the agents outside it:

- the browser, under ``browser_``: the same ``electron-playwright-mcp`` server Ren's own agents drive, on the user's
  window, with the same no-approval policy the panel agent runs it under (``accept_browser_elicitation``);
- Ren's agent: ``ask_ren`` runs one turn of an Agent Panel thread and returns Ren's answer, ``ren_threads`` and
  ``ren_thread`` read saved threads, ``ren_cancel`` stops a run. These call the API's own routes in process, so a turn
  started over MCP is the run the panel itself would start.

It is mounted at ``/mcp`` (loopback, like the rest of the API). A desktop can't be called from outside, so when
``REN_HUB_URL`` is set the backend dials Ren's hub and serves this same server on that WebSocket (``attach_to_hub``).

**Client.** The hub is also where Ren reaches the phone. ``hub_server_config`` and ``hub_client_factory`` put one MCP
server named ``phone`` in the panel agent's tool catalog: the phone's tools (texts, calls, calendar, its browser), which
the agent stages with ``tool_catalog(action="load", name="phone")`` the way it stages the browser.

Environment: ``REN_HUB_URL`` (the hub's WebSocket base, e.g. ``wss://rivet.ron-ai.dev/hub``), ``REN_HUB_TOKEN`` (its
bearer token), ``REN_MCP_USER_ID`` (whose threads ``ask_ren`` works in; ``default`` is the guest).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any, Final

import anyio
import httpx
import mcp.types as types
from fastmcp import Client, FastMCP
from fastmcp.client.elicitation import ElicitResult
from fastmcp.exceptions import ToolError
from fastmcp.server.providers.proxy import ProxyProvider
from mcp.shared.message import SessionMessage
from pydantic import ValidationError
from starlette.types import ASGIApp
from websockets.asyncio.client import connect as ws_connect
from websockets.typing import Subprotocol

from agent.api.core.panel_browser import browser_server_config, default_browser

logger = logging.getLogger(__name__)

#: The catalog name of the phone's tools, and their prefix in the panel agent.
PHONE_SERVER: Final[str] = "phone"
#: The hub's WebSocket path a desktop attaches on, and its MCP path.
ATTACH_PATH: Final[str] = "/attach/desktop"
MCP_PATH: Final[str] = "/mcp"
#: The hub lists the desktop's own tools under this prefix; the panel agent has those already.
_OWN_TOOLS: Final[re.Pattern[str]] = re.compile(r"^desktop_")
_FIRST_RETRY_SECONDS: Final[float] = 2.0
_LAST_RETRY_SECONDS: Final[float] = 60.0


def hub_url() -> str | None:
    """The hub's WebSocket base, or None when this desktop isn't joined to one."""
    return (os.getenv("REN_HUB_URL") or "").strip().rstrip("/") or None


def _hub_token() -> str:
    return os.getenv("REN_HUB_TOKEN", "")


def _mcp_user() -> str:
    return os.getenv("REN_MCP_USER_ID", "default")


# --- server --------------------------------------------------------------------------------------


async def _accept(message: str, response_type: Any, params: Any, context: Any) -> ElicitResult[Any]:
    """The browser server asks before every mutating tool; ren desktop's agents answer yes, and so does this server."""
    return ElicitResult(action="accept")


def _browser_server() -> FastMCP:
    """The electron-playwright-mcp server on the user's window, configured the way the panel agent's is."""
    from electron_playwright_mcp.server import create_mcp

    env = {str(key): str(value) for key, value in next(iter(browser_server_config(default_browser()).values()))["env"].items()}  # type: ignore[union-attr]
    previous = {key: os.environ.get(key) for key in env}
    os.environ.update(env)
    try:
        # create_mcp reads its three surface URLs from the environment while it builds.
        return create_mcp()
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _answer(messages: list[dict[str, Any]]) -> str:
    """Ren's last answer in a thread: the text of its final assistant message."""
    for message in reversed(messages):
        if message.get("role") == "assistant":
            text = "\n".join(block["text"] for block in message.get("content", []) if isinstance(block.get("text"), str))
            if text.strip():
                return text.strip()
    return ""


def create_ren_mcp(app: ASGIApp, *, browser: FastMCP | None = None) -> FastMCP:
    """Ren desktop's MCP server over [app], the API it is mounted in. ``browser`` replaces the browser server in tests."""
    server = FastMCP(
        "ren-desktop",
        instructions=(
            "Ren desktop. `browser_*` tools drive the desktop browser's tabs (list tabs, navigate, snapshot, click, type, "
            "screenshot). `ask_ren` hands a task to Ren, the agent inside ren desktop, and returns its answer; pass the "
            "`thread` it returned to continue the same conversation."
        ),
    )
    backend = browser if browser is not None else _browser_server()
    server.add_provider(ProxyProvider(lambda: Client(backend, elicitation_handler=_accept), cache_ttl=0), namespace="browser")

    @asynccontextmanager
    async def api() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ren-desktop", timeout=None) as client:
            yield client

    def checked(response: httpx.Response) -> Any:
        if response.is_error:
            try:
                detail = response.json().get("detail")
            except ValueError:
                detail = None
            raise ToolError(str(detail or response.text[:300] or f"ren desktop answered {response.status_code}"))
        return response.json()

    @server.tool
    async def ask_ren(prompt: str, thread: str | None = None) -> dict[str, str]:
        """Ask Ren, the agent in ren desktop, to do or answer something, and wait for its answer.

        Ren works with ren desktop's tools: the desktop browser, web search, files and shell on the computer, the
        user's projects and documents. Give ``thread`` (from an earlier answer) to continue that conversation;
        leave it out to start a new one. Returns the thread and Ren's answer.
        """
        session_id = thread or f"mcp-{uuid.uuid4().hex[:16]}"
        body = {"session_id": session_id, "user_id": _mcp_user(), "message": prompt}
        async with api() as client:
            async with client.stream("POST", "/chat", json=body) as response:
                if response.is_error:
                    await response.aread()
                    checked(response)
                # The response is the run's event stream; it ends when the run does.
                async for _ in response.aiter_bytes():
                    pass
            snapshot = checked(await client.get(f"/sessions/{session_id}", params={"user_id": _mcp_user()}))
        if snapshot.get("status") != "completed":
            error = snapshot.get("error") or {}
            raise ToolError(str(error.get("message") or f"Ren's run ended as {snapshot.get('status')}"))
        return {"thread": session_id, "answer": _answer(snapshot.get("messages") or [])}

    @server.tool(annotations={"readOnlyHint": True})
    async def ren_threads(limit: int = 20) -> dict[str, Any]:
        """Ren's saved threads in ren desktop, newest first. Guests have none (``sign_in_required``)."""
        async with api() as client:
            return dict(checked(await client.get("/sessions", params={"user_id": _mcp_user(), "limit": max(1, min(limit, 100))})))

    @server.tool(annotations={"readOnlyHint": True})
    async def ren_thread(thread: str) -> dict[str, Any]:
        """One of Ren's threads in order: what was asked, what Ren did, and what it answered."""
        async with api() as client:
            snapshot = checked(await client.get(f"/sessions/{thread}", params={"user_id": _mcp_user()}))
        return {"thread": thread, "status": snapshot.get("status"), "messages": snapshot.get("messages") or []}

    @server.tool
    async def ren_cancel(thread: str) -> dict[str, Any]:
        """Stop the run Ren is on in a thread."""
        async with api() as client:
            return dict(checked(await client.post(f"/sessions/{thread}/cancel", json={"user_id": _mcp_user()})))

    return server


# --- attachment to the hub -----------------------------------------------------------------------


async def serve_on_socket(server: FastMCP, url: str, token: str, *, attached: Callable[[], None] | None = None) -> None:
    """Dial ``url`` and serve ``server`` on that WebSocket until it closes: the dialed end is the MCP server.

    The MCP SDK's own WebSocket client transport can't send the bearer token, so this is that transport with the
    header: JSON-RPC messages as text frames under the ``mcp`` subprotocol.
    """
    async with ws_connect(url, subprotocols=[Subprotocol("mcp")], additional_headers={"Authorization": f"Bearer {token}"}) as socket:
        to_server, server_reads = anyio.create_memory_object_stream[SessionMessage | Exception](0)
        server_writes, from_server = anyio.create_memory_object_stream[SessionMessage](0)

        async def reader() -> None:
            async with to_server:
                async for raw in socket:
                    try:
                        message = types.JSONRPCMessage.model_validate_json(raw)
                    except ValidationError as error:
                        await to_server.send(error)
                    else:
                        await to_server.send(SessionMessage(message))

        async def writer() -> None:
            async with from_server:
                async for outgoing in from_server:
                    await socket.send(json.dumps(outgoing.message.model_dump(by_alias=True, mode="json", exclude_none=True)))

        async with anyio.create_task_group() as tasks:
            tasks.start_soon(reader)
            tasks.start_soon(writer)
            if attached is not None:
                attached()
            # The low-level server over a pair of streams, as FastMCP's own stdio runner starts it.
            low_level = server._mcp_server
            await low_level.run(server_reads, server_writes, low_level.create_initialization_options())
            tasks.cancel_scope.cancel()


async def attach_to_hub(server: FastMCP, url: str, token: str) -> None:
    """Keep ``server`` attached to the hub at ``url``: dial again after every drop, waiting longer after each failure."""
    wait = _FIRST_RETRY_SECONDS

    def attached() -> None:
        nonlocal wait
        wait = _FIRST_RETRY_SECONDS
        logger.info("ren desktop is attached to the hub at %s", url)

    while True:
        try:
            await serve_on_socket(server, url + ATTACH_PATH, token, attached=attached)
            logger.info("the hub closed the link; dialing again")
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 - every failure to reach the hub is retried
            logger.warning("ren desktop could not attach to the hub (%s: %s); retrying in %.0fs", type(error).__name__, error, wait)
        await asyncio.sleep(wait)
        wait = min(wait * 2, _LAST_RETRY_SECONDS)


# --- the phone, for Ren's own agents -------------------------------------------------------------


def _hub_http_url(url: str) -> str:
    """The hub's MCP endpoint for its WebSocket base (``wss://host/hub`` -> ``https://host/hub/mcp``)."""
    return re.sub(r"^ws", "http", url, count=1) + MCP_PATH


def hub_server_config() -> dict[str, dict[str, object]]:
    """The tool catalog's entry for the phone, or nothing when this desktop isn't joined to a hub."""
    url = hub_url()
    if url is None:
        return {}
    return {PHONE_SERVER: {"url": _hub_http_url(url), "headers": {"Authorization": f"Bearer {_hub_token()}"}}}


def hub_client_factory() -> Callable[[], Any]:
    """Factory for an unstarted ``MCPClient`` on the hub: the phone's tools under ``phone_``, the desktop's own left out."""
    from mcp.client.streamable_http import streamablehttp_client
    from strands.tools.mcp import MCPClient

    def factory() -> MCPClient:
        config = hub_server_config()[PHONE_SERVER]
        return MCPClient(
            lambda: streamablehttp_client(str(config["url"]), headers=dict(config["headers"])),  # type: ignore[call-overload]
            prefix=PHONE_SERVER, tool_filters={"rejected": [_OWN_TOOLS]},
        )

    return factory


def phone_prompt_section() -> str:
    """``## Phone`` for the panel agent's instructions when the desktop is joined to the hub; empty otherwise."""
    if hub_url() is None:
        return ""
    return f"""

## Phone
The user's phone runs ren mobile and is reachable as one MCP server. Load it when a task needs the phone:

tool_catalog(action="load", name="{PHONE_SERVER}")

After load, `{PHONE_SERVER}_hub_peers` says whether the phone is attached. Its tools are prefixed `{PHONE_SERVER}_`:
texts (`{PHONE_SERVER}_sms_list`, `{PHONE_SERVER}_sms_send`), calls, contacts, calendar, reminders, notifications,
apps, and the phone's own browser (`{PHONE_SERVER}_browser_tabs`, `{PHONE_SERVER}_browser_open`,
`{PHONE_SERVER}_browser_read`, ...). Before an action on the phone that sends, calls, buys or deletes, call
`{PHONE_SERVER}_request_approval`; the user answers it on the phone."""
