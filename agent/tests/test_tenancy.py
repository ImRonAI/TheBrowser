"""Tenancy (``core/tenancy.py``): which tenant a request acts for, and the routes that ask it."""

from __future__ import annotations

import hashlib
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.websockets import WebSocketDisconnect

from agent.api.core import context_agent, tenancy
from agent.api.core.projects import ProjectIdentity
from agent.api.main import app

ALICE = "11111111-1111-4111-8111-111111111111"
BOB = "22222222-2222-4222-8222-222222222222"
CAPABILITY = "ab" * 32
GUEST = str(uuid.uuid5(uuid.NAMESPACE_URL, f"ron-guest:{hashlib.sha256(CAPABILITY.encode()).hexdigest()}"))


def request(headers: dict[str, str] | None = None, host: str = "127.0.0.1") -> Request:
    raw = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
    return Request({"type": "http", "headers": raw, "client": (host, 50000)})


@pytest.fixture
def accounts(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Supabase Auth as a table of tokens: ``token-alice`` proves Alice, ``token-bob`` Bob, anything else is 401."""
    calls: list[str] = []

    async def verify(authorization: str) -> ProjectIdentity:
        calls.append(authorization)
        users = {"Bearer token-alice": ALICE, "Bearer token-bob": BOB}
        if authorization not in users:
            raise HTTPException(401, "Session expired; sign in again")
        return ProjectIdentity(users[authorization], authorization[7:], "https://supabase.test", "anon")

    monkeypatch.setattr(tenancy, "verify_bearer", verify)
    return calls


@pytest.fixture
def verify_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RON_TENANCY", "verify")


@pytest.mark.asyncio
async def test_trust_keeps_the_callers_user_id_without_checking_credentials(monkeypatch: pytest.MonkeyPatch, accounts: list[str]) -> None:
    monkeypatch.delenv("RON_TENANCY", raising=False)
    tenant = await tenancy.resolve_tenant(request({"Authorization": "Bearer token-bob"}, host="203.0.113.5"), ALICE)
    assert tenant == tenancy.Tenant(ALICE, "account", False)
    assert await tenancy.tenant_id(request(), "install-7") == "install-7"
    assert accounts == []


@pytest.mark.asyncio
async def test_verify_takes_the_account_a_bearer_proves(verify_mode: None, accounts: list[str]) -> None:
    assert await tenancy.resolve_tenant(request({"Authorization": "Bearer token-alice"}), ALICE) == tenancy.Tenant(ALICE, "account", True)
    assert await tenancy.tenant_id(request({"Authorization": "Bearer token-alice"}, host="203.0.113.5")) == ALICE


@pytest.mark.asyncio
async def test_verify_refuses_a_user_id_that_is_not_the_credentials(verify_mode: None, accounts: list[str]) -> None:
    with pytest.raises(HTTPException) as refused:
        _ = await tenancy.tenant_id(request({"Authorization": "Bearer token-alice"}), BOB)
    assert refused.value.status_code == 403
    with pytest.raises(HTTPException) as refused:
        _ = await tenancy.tenant_id(request({"X-Ron-Workspace": CAPABILITY}), ALICE)
    assert refused.value.status_code == 403


@pytest.mark.asyncio
async def test_verify_passes_on_a_bearer_supabase_refuses(verify_mode: None, accounts: list[str]) -> None:
    with pytest.raises(HTTPException) as refused:
        _ = await tenancy.tenant_id(request({"Authorization": "Bearer stolen"}), ALICE)
    assert refused.value.status_code == 401


@pytest.mark.asyncio
async def test_verify_takes_a_guest_workspace_from_its_capability(verify_mode: None, accounts: list[str]) -> None:
    assert await tenancy.resolve_tenant(request({"X-Ron-Workspace": CAPABILITY}, host="203.0.113.5")) == tenancy.Tenant(GUEST, "guest", True)
    assert accounts == []


@pytest.mark.asyncio
async def test_verify_refuses_an_account_id_without_its_token_even_on_loopback(verify_mode: None) -> None:
    with pytest.raises(HTTPException) as refused:
        _ = await tenancy.tenant_id(request(), ALICE)
    assert refused.value.status_code == 401


@pytest.mark.asyncio
async def test_verify_takes_a_local_user_id_only_from_loopback(verify_mode: None) -> None:
    assert await tenancy.resolve_tenant(request(host="::1"), "install-7") == tenancy.Tenant("install-7", "local", False)
    with pytest.raises(HTTPException) as refused:
        _ = await tenancy.tenant_id(request(host="203.0.113.5"), "install-7")
    assert refused.value.status_code == 401


def test_an_unknown_mode_is_a_configuration_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RON_TENANCY", "open")
    with pytest.raises(RuntimeError):
        _ = tenancy.mode()


def test_routes_refuse_another_accounts_data(verify_mode: None, accounts: list[str]) -> None:
    client = TestClient(app)
    alice = {"Authorization": "Bearer token-alice"}
    assert client.get("/context/items", params={"user_id": BOB}, headers=alice).status_code == 403
    assert client.get("/context/profile", params={"user_id": BOB}).status_code == 401
    assert client.get("/sessions/s1", params={"user_id": BOB}, headers=alice).status_code == 403
    assert client.post("/sessions/s1/cancel", json={"user_id": BOB}, headers=alice).status_code == 403
    assert client.get("/deep-research/runs", params={"user_id": BOB}).status_code == 401
    assert client.get("/teaching/skills", params={"user_id": BOB, "agent_id": "panel"}, headers=alice).status_code == 403
    assert client.get("/tools/repairs", params={"user_id": BOB}, headers=alice).status_code == 403


def test_a_route_reads_the_proven_tenants_data(verify_mode: None, accounts: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    async def list_items(user_id: str, *, limit: int) -> list[dict[str, str]]:
        seen.append(user_id)
        return []

    monkeypatch.setattr(context_agent, "list_items", list_items)
    client = TestClient(app)
    assert client.get("/context/items", headers={"Authorization": "Bearer token-alice"}).json() == {"items": []}
    assert client.get("/context/items", params={"user_id": "install-7"}).status_code == 200
    remote = TestClient(app, client=("203.0.113.5", 50000))
    assert remote.get("/context/items", params={"user_id": "install-7"}).status_code == 401
    assert seen == [ALICE, "install-7"]


def test_the_live_socket_closes_for_an_unproven_account(verify_mode: None) -> None:
    client = TestClient(app, headers={"Origin": "http://localhost:5173"})
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(f"/bidi?user_id={ALICE}") as socket:
            _ = socket.receive_text()
    assert closed.value.code == 1008
