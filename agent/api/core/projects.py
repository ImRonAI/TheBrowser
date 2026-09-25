"""Account RLS persistence and isolated, durable account-free workspaces."""
from __future__ import annotations

import os
import hashlib
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID, NAMESPACE_URL, uuid5

import httpx
from fastapi import HTTPException, Request


@dataclass(frozen=True)
class ProjectIdentity:
    user_id: str
    token: str
    url: str
    key: str
    guest: bool = False


async def project_identity(request: Request) -> ProjectIdentity:
    authorization = request.headers.get("authorization", "")
    if not authorization:
        capability = request.headers.get("x-ron-workspace", "")
        if re.fullmatch(r"[a-f0-9]{64}", capability):
            digest = hashlib.sha256(capability.encode()).hexdigest()
            return ProjectIdentity(str(uuid5(NAMESPACE_URL, f"ron-guest:{digest}")), digest, "", "", guest=True)
    if not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(401, "Workspace credential is missing or invalid")
    url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")).rstrip("/")
    key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY", "")
    if not url or not key:
        raise HTTPException(503, "Supabase is not configured")
    token = authorization[7:]
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(f"{url}/auth/v1/user", headers={"apikey": key, "Authorization": authorization})
        if response.status_code in (401, 403):
            raise HTTPException(401, "Session expired; sign in again")
        response.raise_for_status()
        user_id = str(UUID(response.json()["id"]))
    except (httpx.HTTPError, KeyError, ValueError) as error:
        raise HTTPException(503, "Unable to verify project access") from error
    return ProjectIdentity(user_id, token, url, key)


class ProjectService:
    def __init__(self, identity: ProjectIdentity):
        self.identity = identity

    async def request(self, method: str, resource: str, *, params=None, body=None) -> Any:
        if self.identity.guest:
            import asyncio
            from agent.api.core.guest_projects import request
            return await asyncio.to_thread(request, self.identity, method, resource, params or {}, body)
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.request(method, f"{self.identity.url}/rest/v1/{resource}",
                    headers={"apikey": self.identity.key, "Authorization": f"Bearer {self.identity.token}",
                             "Prefer": "return=representation"}, params=params, json=body)
        except httpx.HTTPError as error:
            raise HTTPException(503, "Project database is unavailable; no save was confirmed") from error
        if response.is_error:
            try:
                detail = response.json()
            except ValueError:
                detail = {}
            code = detail.get("code")
            status = 409 if code in {"23505", "40001"} else 422
            if response.status_code in {401, 403}: status = response.status_code
            if response.status_code >= 500: status = 503
            raise HTTPException(status, detail.get("message", "Project operation failed"))
        return response.json() if response.content else None

    async def rows(self, table: str, **filters):
        return await self.request("GET", table, params={"select": "*", **filters})

    async def issue(self, issue_id: str):
        rows = await self.rows("issues", id=f"eq.{UUID(issue_id)}")
        if not rows:
            raise HTTPException(404, "Issue not found or not accessible")
        return rows[0]

    async def context(self, issue_id: str):
        issue = await self.issue(issue_id)
        # Every query carries the user's JWT. RLS filters both relationship endpoints.
        import asyncio
        children, links, activity, events = await asyncio.gather(
            self.rows("issues", parent_id=f"eq.{issue_id}", order="rank.asc"),
            self.rows("issue_links", **{"or": f"(source_id.eq.{issue_id},target_id.eq.{issue_id})"}),
            self.rows("activity_log", issue_id=f"eq.{issue_id}", order="timestamp.desc", limit="100"),
            self.rows("issue_events", issue_id=f"eq.{issue_id}", order="starts_at.asc"),
        )
        related_ids = {link[key] for link in links for key in ("source_id", "target_id")} - {issue_id}
        if issue.get("parent_id"): related_ids.add(issue["parent_id"])
        related = await self.rows("issues", id=f"in.({','.join(sorted(related_ids))})") if related_ids else []
        return {"issue": issue, "children": children, "related": related, "links": links,
                "activity": activity, "events": events}

    async def create_issue(self, values: dict):
        rows = await self.request("POST", "issues", body={**values, "created_by": self.identity.user_id})
        return rows[0]

    async def update_issue(self, issue_id: str, version: int, values: dict):
        rows = await self.request("PATCH", "issues", params={"id": f"eq.{UUID(issue_id)}", "version": f"eq.{version}"}, body=values)
        if not rows:
            raise HTTPException(409, "Issue changed or access was removed. Reload before saving again.")
        return rows[0]


@dataclass(frozen=True)
class IssueScope:
    """Trusted application binding; never populated from model tool arguments."""
    issue_id: str
    project_id: str


class ScopedIssueService:
    EDITABLE = frozenset({"title", "description", "status", "priority", "estimate", "labels",
                          "start_date", "end_date", "due_date", "custom_fields", "work_products"})

    def __init__(self, service: ProjectService, scope: IssueScope):
        self.service, self.scope = service, scope

    async def update(self, version: int, values: dict):
        if values.keys() - self.EDITABLE:
            raise HTTPException(403, "Issue agents cannot change identity, hierarchy, assignees or relationships")
        current = await self.service.issue(self.scope.issue_id)
        if current["project_id"] != self.scope.project_id:
            raise HTTPException(403, "Issue scope no longer matches")
        return await self.service.update_issue(self.scope.issue_id, version, values)

    async def create_child(self, values: dict):
        if values.keys() - (self.EDITABLE - {"status"} | {"type"}):
            raise HTTPException(403, "Child scope and initial status are server-owned")
        current = await self.service.issue(self.scope.issue_id)
        if current["project_id"] != self.scope.project_id:
            raise HTTPException(403, "Issue scope no longer matches")
        return await self.service.create_issue({**values, "project_id": self.scope.project_id,
            "parent_id": self.scope.issue_id, "status": "backlog", "priority": values.get("priority", "medium")})