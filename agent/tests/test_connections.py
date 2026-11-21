"""The user's connected accounts (core/connections.py), offline: a phone-driven OAuth sign-in against a local OAuth MCP
server with dynamic client registration, the proxy with approval before a change, a typed token and disconnecting."""

from __future__ import annotations

import dataclasses
import json
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from fastmcp import Client, FastMCP
from fastmcp.client.transports import StreamableHttpTransport
from fastmcp.server.auth.providers.in_memory import InMemoryOAuthProvider
from mcp.server.auth.settings import ClientRegistrationOptions
from starlette.types import ASGIApp

from agent.api.core import config, connections


def _port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _serve(app: ASGIApp, port: int) -> None:
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[tuple[str, list[tuple[str, str]]]]:
    provider_port, hub_port, api_port = _port(), _port(), _port()
    provider = FastMCP(
        "provider",
        auth=InMemoryOAuthProvider(
            base_url=f"http://127.0.0.1:{provider_port}", client_registration_options=ClientRegistrationOptions(enabled=True)
        ),
    )

    @provider.tool(annotations={"readOnlyHint": True})
    def list_sites() -> list[str]:
        return ["site-a"]

    @provider.tool
    def deploy(site: str) -> str:
        return f"deployed {site}"

    asked: list[tuple[str, str]] = []
    hub = FastMCP("hub")

    @hub.tool
    def request_approval(action_type: str, details: str) -> str:
        asked.append((action_type, details))
        return json.dumps({"approved": "refuse" not in details, "remember_decision": False})

    monkeypatch.setattr(config, "CONNECTIONS_DIR", tmp_path)
    monkeypatch.setattr(config, "PUBLIC_URL", "https://ren.example")
    monkeypatch.setattr(config, "API_PORT", api_port)
    monkeypatch.setenv("REN_HUB_URL", f"ws://127.0.0.1:{hub_port}")
    monkeypatch.setenv("REN_HUB_TOKEN", "hub-token")
    monkeypatch.setitem(
        connections.PROVIDERS, "netlify",
        dataclasses.replace(connections.PROVIDERS["netlify"], url=f"http://127.0.0.1:{provider_port}/mcp"),
    )
    mcp_app = connections.server.http_app(path="/")
    api = FastAPI(lifespan=mcp_app.lifespan)
    api.mount("/connections/mcp", mcp_app)
    api.include_router(connections.router)
    _serve(provider.http_app(path="/mcp"), provider_port)
    _serve(hub.http_app(path="/mcp"), hub_port)
    _serve(api, api_port)
    yield f"http://127.0.0.1:{api_port}", asked


def test_sign_in_proxy_and_approval(world: tuple[str, list[tuple[str, str]]]) -> None:
    base, asked = world
    with httpx.Client(timeout=30) as http:
        listed = {row["name"]: row for row in http.get(f"{base}/connections", params={"user_id": "u1"}).json()}
        assert listed["netlify"]["oauth"] and not listed["netlify"]["connected"]
        assert not listed["github"]["oauth"]
        assert connections.connection_tools("u1") == []

        page = http.post(f"{base}/connections/netlify/start", params={"user_id": "u1"}).json()["url"]
        assert parse_qs(urlparse(page).query)["redirect_uri"] == ["https://ren.example/connections/callback"]
        # The phone's browser: the provider signs the user in and sends it to Ren's callback.
        returned = parse_qs(urlparse(http.get(page).headers["location"]).query)
        done = http.get(f"{base}/connections/callback", params={"code": returned["code"][0], "state": returned["state"][0]})
        assert done.status_code == 200
        deadline = time.monotonic() + 10
        while not (connections.FileStorage("u1", "netlify").read().tokens or time.monotonic() > deadline):
            time.sleep(0.1)

        assert sorted(tool.tool_name for tool in connections.connection_tools("u1")) == ["netlify_deploy", "netlify_list_sites"]
        assert connections.connection_tools("u2") == []
        assert http.get(f"{base}/connections/client.json").json()["client_id"] == "https://ren.example/connections/client.json"

    async def calls() -> None:
        transport = StreamableHttpTransport(f"{base}/connections/mcp/", headers={"X-Ren-User": "u1"})
        async with Client(transport) as client:
            assert (await client.call_tool("netlify_list_sites", {})).data == ["site-a"]
            assert asked == []
            assert (await client.call_tool("netlify_deploy", {"site": "site-a"})).data == "deployed site-a"
            assert asked == [("deploy", 'Netlify: deploy\n{\n  "site": "site-a"\n}')]
            refused = await client.call_tool("netlify_deploy", {"site": "refuse"}, raise_on_error=False)
            assert refused.is_error

    import asyncio

    asyncio.run(calls())

    with httpx.Client(timeout=30) as http:
        assert http.post(f"{base}/connections/github/token", params={"user_id": "u1"}, json={"token": "pat"}).json()["connected"]
        assert http.post(f"{base}/connections/github/start", params={"user_id": "u1"}).status_code == 400
        http.delete(f"{base}/connections/netlify", params={"user_id": "u1"})
        connected = [row["name"] for row in http.get(f"{base}/connections", params={"user_id": "u1"}).json() if row["connected"]]
        assert connected == ["github"]
        assert connections.FileStorage("u1", "github").path.stat().st_mode & 0o777 == 0o600
