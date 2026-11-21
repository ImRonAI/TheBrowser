"""Who a request acts for: the tenant every per-user namespace is keyed by.

Routes that keep per-user state (panel sessions, threads, context items, the brain, tool repairs, teaching,
Build workspaces, Deep Research runs) take the caller's ``user_id`` and pass it to ``tenant_id``, which
returns the namespace to use. ``RON_TENANCY`` decides what proves it:

- ``trust`` (the default) keeps the caller's ``user_id`` as the tenant, unchecked, which is how every client
  calls these routes today ("a trusted-local namespace, not authenticated multi-tenant isolation").
- ``verify`` takes the tenant from the same credentials the Projects routes take (``core/projects.py``).
  ``Authorization: Bearer <Supabase access token>`` makes the verified account the tenant;
  ``X-Ron-Workspace: <capability>`` makes that account-free workspace the tenant. A ``user_id`` naming a
  different id is refused (403), and ``default`` (no name) means the credential's tenant. Without a credential
  an account id (a UUID, which ``threads.owner_uuid`` reads as signed in and the service-role routes act for)
  is refused (401), and a local ``user_id`` (``default``, an install id) is taken only from a loopback client:
  the desktop's own backend.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from starlette.requests import HTTPConnection
from pydantic import Field

from agent.api.core.projects import guest_identity, verify_bearer

#: The panel's identifiers: what a ``user_id`` may look like on every route.
Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")]

TenantKind = Literal["account", "guest", "local"]
Mode = Literal["trust", "verify"]
LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})
UNNAMED = "default"


@dataclass(frozen=True)
class Tenant:
    """``id`` is the namespace (what ``user_id`` keys today); ``verified`` says a credential proved it."""

    id: str
    kind: TenantKind
    verified: bool


def mode() -> Mode:
    value = os.getenv("RON_TENANCY", "trust").strip().lower() or "trust"
    if value == "trust" or value == "verify":
        return value
    raise RuntimeError(f"RON_TENANCY must be trust or verify, not {value!r}")


def is_account(user_id: str) -> bool:
    try:
        _ = UUID(user_id)
    except ValueError:
        return False
    return True


def _proven(claimed: str, proven: str, kind: TenantKind) -> Tenant:
    if claimed not in (UNNAMED, proven):
        raise HTTPException(403, "user_id names a different account than the request's credential")
    return Tenant(proven, kind, True)


async def resolve_tenant(request: HTTPConnection, claimed: str = UNNAMED) -> Tenant:
    local: TenantKind = "account" if is_account(claimed) else "local"
    if mode() == "trust":
        return Tenant(claimed, local, False)
    authorization = request.headers.get("authorization", "")
    if authorization:
        return _proven(claimed, (await verify_bearer(authorization)).user_id, "account")
    guest = guest_identity(request.headers.get("x-ron-workspace", ""))
    if guest is not None:
        return _proven(claimed, guest.user_id, "guest")
    if local == "account":
        raise HTTPException(401, "Sign in: an account's data needs its access token")
    host = request.client.host if request.client else ""
    if host not in LOOPBACK:
        raise HTTPException(401, "A credential is required")
    return Tenant(claimed, local, False)


async def tenant_id(request: HTTPConnection, claimed: str = UNNAMED) -> str:
    """The namespace for a route's per-user state; see the module docstring."""
    return (await resolve_tenant(request, claimed)).id


async def query_tenant(request: Request, user_id: Identifier = UNNAMED) -> str:
    """``tenant_id`` for a route that takes ``user_id`` as a query parameter."""
    return await tenant_id(request, user_id)


#: A route parameter that is the tenant: the ``user_id`` query parameter, resolved.
TenantId = Annotated[str, Depends(query_tenant)]
