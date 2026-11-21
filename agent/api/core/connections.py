"""The user's own developer accounts for every agent: Vercel, Netlify, GitHub, GitLab, Supabase and Bitbucket.

Each is the provider's official hosted MCP server, reached with the user's own sign-in:

* Vercel, https://mcp.vercel.com (vercel.com/docs/agent-resources/vercel-mcp): OAuth only. Ren identifies itself with a
  Client ID Metadata Document, ``/connections/client.json`` (vercel.com/changelog/vercel-mcp-now-supports-client-id-metadata-documents).
* Netlify, https://mcp.netlify.com/mcp (netlify.com/auth.md): OAuth 2.1 with dynamic client registration, or a personal
  access token as the bearer.
* GitHub, https://api.githubcopilot.com/mcp/ (github/github-mcp-server, docs/remote-server.md): a personal access token
  as the bearer. Its OAuth needs a GitHub App or OAuth App of the host's own, since it has no dynamic client
  registration (docs/host-integration.md), so GitHub signs in with a token.
* GitLab, https://gitlab.com/api/v4/mcp (docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/): OAuth
  with dynamic client registration (the ``mcp`` scope), or a fine-grained personal access token with the MCP permission.
* Supabase, https://mcp.supabase.com/mcp (supabase.com/docs/guides/getting-started/mcp): OAuth with dynamic client
  registration, or a personal access token as the bearer.
* Bitbucket: Atlassian has no Bitbucket server of its own; Bitbucket Cloud's tools are on the Atlassian Rovo MCP server,
  https://mcp.atlassian.com/v2/mcp (support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/), for a
  workspace linked to an Atlassian organization: OAuth 2.1, or a service account's API key as the bearer.

OAuth is the MCP Python SDK's own client (``OAuthClientProvider``): it reads the server's metadata, uses the Client ID
Metadata Document where the server supports one and dynamic client registration otherwise, and refreshes the tokens.
The browser part happens on the phone: ``POST /connections/{provider}/start`` answers the provider's sign-in page, the
app opens it, and the provider returns to ``/connections/callback``. A token typed in the app is kept the same way.
Tokens stay in ``RON_CONNECTIONS_DIR`` on this server, one file per user and provider; no agent ever sees one.

``server`` is the user's connected accounts as one MCP server (``/connections/mcp``, the user in ``X-Ren-User``), each
provider's tools under its name (``vercel_``, ``github_``, ...), so ren's agents (``connection_tools``), ren mobile's
Strands agents and OpenCode reach them the same way. A tool its server doesn't mark read-only (``readOnlyHint``) first
asks the user on the phone (``request_approval`` through Ren's hub, its name and arguments shown); without the phone it
doesn't run.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlparse

import mcp.types as mt
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from fastmcp import Client, FastMCP
from fastmcp.client.transports import FastMCPTransport, StreamableHttpTransport
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_headers
from fastmcp.server.middleware import CallNext, Middleware, MiddlewareContext
from fastmcp.server.providers.proxy import ProxyProvider
from fastmcp.tools.base import ToolResult
from mcp.client.auth import OAuthClientProvider, TokenStorage
from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata, OAuthToken
from pydantic import AnyHttpUrl, AnyUrl, BaseModel
from strands.tools.mcp import MCPClient
from strands.types.tools import AgentTool

from agent.api.core import config as app_config
from agent.api.core import ren_mcp

logger = logging.getLogger(__name__)

Approval = Literal["deploy", "cloud_coding"]


@dataclass(frozen=True)
class Provider:
    name: str
    label: str
    url: str
    #: Whether the provider's server signs in with OAuth for a client like Ren (else a token only).
    oauth: bool
    #: The phone's approval kind (``request_approval``'s ``action_type``) for a tool that changes something.
    approval: Approval
    #: What to make for a token, shown in the app.
    token_hint: str


PROVIDERS: dict[str, Provider] = {
    provider.name: provider
    for provider in (
        Provider("vercel", "Vercel", "https://mcp.vercel.com", True, "deploy", ""),
        Provider("netlify", "Netlify", "https://mcp.netlify.com/mcp", True, "deploy",
                 "A personal access token (Netlify › User settings › Applications)."),
        Provider("github", "GitHub", "https://api.githubcopilot.com/mcp/", False, "cloud_coding",
                 "A personal access token (GitHub › Settings › Developer settings)."),
        Provider("gitlab", "GitLab", "https://gitlab.com/api/v4/mcp", True, "cloud_coding",
                 "A fine-grained personal access token with the MCP tool resource's Execute permission."),
        Provider("supabase", "Supabase", "https://mcp.supabase.com/mcp", True, "cloud_coding",
                 "A personal access token (Supabase › Account › Access tokens)."),
        Provider("bitbucket", "Bitbucket", "https://mcp.atlassian.com/v2/mcp", True, "cloud_coding",
                 "An Atlassian service account's API key (a workspace linked to an Atlassian organization)."),
    )
}


def provider(name: str) -> Provider:
    found = PROVIDERS.get(name)
    if found is None:
        raise HTTPException(404, f"Unknown provider {name!r}")
    return found


# --- tokens ---------------------------------------------------------------------------------------


class Stored(BaseModel):
    tokens: OAuthToken | None = None
    client_info: OAuthClientInformationFull | None = None


class FileStorage(TokenStorage):
    """One user's tokens and registered client for one provider, in a file only this server's user can read."""

    def __init__(self, user_id: str, name: str) -> None:
        folder = app_config.CONNECTIONS_DIR / "".join(c for c in user_id if c.isalnum() or c in "-_")
        self.path = folder / f"{name}.json"

    def read(self) -> Stored:
        return Stored.model_validate_json(self.path.read_text()) if self.path.exists() else Stored()

    def write(self, stored: Stored) -> None:
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path.touch(mode=0o600)
        self.path.write_text(stored.model_dump_json(exclude_none=True))

    async def get_tokens(self) -> OAuthToken | None:
        return self.read().tokens

    async def set_tokens(self, tokens: OAuthToken) -> None:
        self.write(self.read().model_copy(update={"tokens": tokens}))

    async def get_client_info(self) -> OAuthClientInformationFull | None:
        return self.read().client_info

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        self.write(self.read().model_copy(update={"client_info": client_info}))


def callback_url() -> str:
    return f"{app_config.PUBLIC_URL}/connections/callback"


def client_metadata_url() -> str:
    return f"{app_config.PUBLIC_URL}/connections/client.json"


def client_metadata() -> OAuthClientMetadata:
    return OAuthClientMetadata(
        client_name="Ren",
        client_uri=AnyHttpUrl("https://oubliai.com"),
        redirect_uris=[AnyUrl(callback_url())],
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        token_endpoint_auth_method="none",
    )


def signs_in(account: Provider) -> bool:
    """Whether [account] signs in with OAuth here: the server needs a public https address to return to."""
    return account.oauth and app_config.PUBLIC_URL.startswith("https://")


def oauth(
    user_id: str,
    name: str,
    redirect: Callable[[str], Awaitable[None]] | None = None,
    callback: Callable[[], Awaitable[tuple[str, str | None]]] | None = None,
) -> OAuthClientProvider:
    """The SDK's OAuth for the user's account at [name]; [redirect] and [callback] only while signing in."""
    return OAuthClientProvider(
        PROVIDERS[name].url,
        client_metadata(),
        FileStorage(user_id, name),
        redirect_handler=redirect,
        callback_handler=callback,
        client_metadata_url=client_metadata_url() if signs_in(PROVIDERS[name]) else None,
    )


# --- the MCP server -----------------------------------------------------------------------------

server: FastMCP[None] = FastMCP(
    "ren-connections",
    instructions=(
        "The user's own Vercel, Netlify, GitHub, GitLab, Supabase and Bitbucket accounts, each provider's tools under "
        "its name (vercel_, netlify_, github_, gitlab_, supabase_, bitbucket_), only the ones the user connected in "
        "Ren. Use them to push code, open pull requests, run database changes and deploy. A tool that changes "
        "something asks the user on their phone first."
    ),
)
#: What a provider the user hasn't connected serves: nothing.
NOTHING: FastMCP[None] = FastMCP("not connected")


def _user() -> str:
    return get_http_headers().get("x-ren-user") or "default"


def _client(name: str) -> Client[StreamableHttpTransport] | Client[FastMCPTransport]:
    user = _user()
    if FileStorage(user, name).read().tokens is None:
        return Client(NOTHING)
    return Client(StreamableHttpTransport(PROVIDERS[name].url, auth=oauth(user, name)))


for _name in PROVIDERS:
    server.add_provider(ProxyProvider(lambda name=_name: _client(name), cache_ttl=0), namespace=_name)


class AskFirst(Middleware):
    """A tool not marked read-only runs once the user approves it on the phone, its name and arguments shown."""

    async def on_call_tool(
        self, context: MiddlewareContext[mt.CallToolRequestParams], call_next: CallNext[mt.CallToolRequestParams, ToolResult]
    ) -> ToolResult:
        name = context.message.name
        tool = await server.get_tool(name)
        if tool is None or (tool.annotations is not None and tool.annotations.readOnlyHint):
            return await call_next(context)
        account = PROVIDERS[name.split("_", 1)[0]]
        details = f"{account.label}: {name.split('_', 1)[1]}\n{json.dumps(context.message.arguments or {}, indent=2)}"
        if not await approved(account.approval, details):
            raise ToolError(f"The user didn't approve {name}.")
        return await call_next(context)


server.add_middleware(AskFirst())


async def approved(action: Approval, details: str) -> bool:
    """The user's answer on the phone (``request_approval`` through Ren's hub); no when the phone can't be asked."""
    url = ren_mcp.hub_url()
    if url is None:
        raise ToolError("Ren can't ask the user: this server isn't joined to Ren's hub, so changes don't run.")
    transport = StreamableHttpTransport(ren_mcp.hub_http_url(url), auth=ren_mcp.hub_token())
    async with Client(transport, timeout=None) as client:
        result = await client.call_tool("request_approval", {"action_type": action, "details": details}, raise_on_error=False)
    text = next((block.text for block in result.content if isinstance(block, mt.TextContent)), "")
    if result.is_error:
        raise ToolError(f"Ren couldn't ask the user on the phone: {text or "the phone isn't connected"}")
    return bool(json.loads(text).get("approved"))


# --- for ren's own agents -----------------------------------------------------------------------

_lock = threading.Lock()
_clients: dict[str, MCPClient] = {}


def connection_tools(user_id: str) -> list[AgentTool]:
    """The tools of the accounts [user_id] connected, from this server's ``/connections/mcp``; none when there are none."""
    with _lock:
        client = _clients.get(user_id)
        if client is not None and not client._is_session_active():
            client.stop(None, None, None)
            client = None
        try:
            if client is None:
                client = MCPClient(
                    url=f"http://127.0.0.1:{app_config.API_PORT}/connections/mcp/", headers={"X-Ren-User": user_id}
                )
                client.start()
                _clients[user_id] = client
            return list(client.list_tools_sync())
        except Exception:
            logger.exception("The user's connected accounts didn't load; their tools are left out")
            if client is not None:
                client.stop(None, None, None)
            _clients.pop(user_id, None)
            return []


# --- signing in from the phone ------------------------------------------------------------------

router = APIRouter(prefix="/connections")
#: Sign-ins waiting for the provider's return, by OAuth state.
_waiting: dict[str, asyncio.Future[tuple[str, str | None]]] = {}
_sign_ins: set[asyncio.Task[None]] = set()


class Connection(BaseModel):
    name: str
    label: str
    connected: bool
    oauth: bool
    token_hint: str


class TokenBody(BaseModel):
    token: str


@router.get("")
async def list_connections(user_id: str) -> list[Connection]:
    return [
        Connection(name=p.name, label=p.label, connected=FileStorage(user_id, p.name).read().tokens is not None,
                   oauth=signs_in(p), token_hint=p.token_hint)
        for p in PROVIDERS.values()
    ]


@router.post("/{name}/start")
async def start(name: str, user_id: str) -> dict[str, str]:
    """Starts signing the user in to [name]: the provider's sign-in page for the app to open."""
    if not signs_in(provider(name)):
        raise HTTPException(400, f"{PROVIDERS[name].label} signs in with a token.")
    page: asyncio.Future[str] = asyncio.get_running_loop().create_future()
    code: asyncio.Future[tuple[str, str | None]] = asyncio.get_running_loop().create_future()

    async def redirect(url: str) -> None:
        _waiting[parse_qs(urlparse(url).query)["state"][0]] = code
        page.set_result(url)

    async def callback() -> tuple[str, str | None]:
        return await code

    async def sign_in() -> None:
        async with Client(StreamableHttpTransport(PROVIDERS[name].url, auth=oauth(user_id, name, redirect, callback))) as client:
            await client.ping()

    def ended(task: asyncio.Task[None]) -> None:
        _sign_ins.discard(task)
        if not page.done():
            page.set_result("")

    task = asyncio.create_task(sign_in())
    _sign_ins.add(task)
    task.add_done_callback(ended)
    url = await page
    if not url and (error := task.exception()):
        raise HTTPException(502, f"{PROVIDERS[name].label} sign-in didn't start: {error}")
    # An empty address: the user was signed in already.
    return {"url": url}


@router.get("/callback")
async def callback(state: str, code: str | None = None, error: str | None = None) -> HTMLResponse:
    """Where the provider returns the user's browser after sign-in."""
    waiting = _waiting.pop(state, None)
    if waiting is None or waiting.done():
        return HTMLResponse("<p>This sign-in has expired. Start it again in Ren.</p>", status_code=400)
    if code is None:
        waiting.set_exception(RuntimeError(error or "The provider didn't sign you in."))
        return HTMLResponse(f"<p>Not signed in: {error or 'no code'}. You can go back to Ren.</p>", status_code=400)
    waiting.set_result((code, state))
    return HTMLResponse("<p>Signed in. You can go back to Ren.</p>")


@router.get("/client.json")
async def client_document() -> dict[str, object]:
    """Ren's Client ID Metadata Document, for servers that identify clients by URL (Vercel)."""
    return {"client_id": client_metadata_url(), **client_metadata().model_dump(mode="json", exclude_none=True)}


@router.post("/{name}/token")
async def save_token(name: str, user_id: str, body: TokenBody) -> Connection:
    """Keeps a token the user made at [name] as their sign-in there."""
    provider(name)
    if not body.token.strip():
        raise HTTPException(400, "The token is empty.")
    await FileStorage(user_id, name).set_tokens(OAuthToken(access_token=body.token.strip(), token_type="Bearer"))
    return next(c for c in await list_connections(user_id) if c.name == name)


@router.delete("/{name}")
async def disconnect(name: str, user_id: str) -> None:
    """Forgets the user's sign-in at [name] on this server."""
    FileStorage(user_id, provider(name).name).path.unlink(missing_ok=True)
