"""Account RLS persistence and isolated, durable account-free workspaces."""
from __future__ import annotations

import os
import hashlib
import inspect
import json
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID, NAMESPACE_URL, uuid5

import httpx
from fastapi import HTTPException, Request


# Ron, the built-in agent, as an assignee. Mirrors RON_ASSIGNEE in src/types/projects.ts.
RON_ASSIGNEE_ID = "004d28ef-3a52-540d-96ea-ff0627040b8e"
#: Longest comment body, after trimming (021_issue_comments.sql checks the same bound; renderer COMMENT_MAX).
COMMENT_MAX = 20_000


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
    COMMENT_MAX = COMMENT_MAX

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
            if not isinstance(detail, dict):
                detail = {}
            code = str(detail.get("code") or "")
            status = 409 if code in {"23505", "40001"} else 422
            if response.status_code in {401, 403}: status = response.status_code
            # SQL that raised with an HTTP status (PostgREST custom SQLSTATE PTxyz, e.g. PT404 from a trigger or RPC).
            if re.fullmatch(r"PT4\d\d", code): status = int(code[2:])
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

    def check_assignees(self, values: dict):
        """For now only the signed-in user and Ron can be assigned."""
        allowed = {self.identity.user_id, RON_ASSIGNEE_ID}
        if set(map(str, values.get("assignees") or [])) - allowed:
            raise HTTPException(422, "Issues can only be assigned to you or Ren")

    async def create_issue(self, values: dict):
        self.check_assignees(values)
        rows = await self.request("POST", "issues", body={**values, "created_by": self.identity.user_id})
        return rows[0]

    async def update_issue(self, issue_id: str, version: int, values: dict):
        self.check_assignees(values)
        rows = await self.request("PATCH", "issues", params={"id": f"eq.{UUID(issue_id)}", "version": f"eq.{version}"}, body=values)
        if not rows:
            raise HTTPException(409, "Issue changed or access was removed. Reload before saving again.")
        row = rows[0]
        if values.get("status") == "done":
            # A finished blocker no longer blocks: each issue it was holding returns to its earlier status.
            links = await self.rows("issue_links", source_id=f"eq.{row['id']}", type="eq.blocks")
            released = [issue for link in links if (issue := await self.release_blocked(link["target_id"]))]
            if released:
                row = {**row, "unblocked_issues": released}
        return row

    # ── Blocking relationships ──────────────────────────────────────────────
    # `A blocks B` moves B to Blocked while A is unfinished. When B's last unfinished blocker goes
    # (the relationship is removed, or the blocker is done), B returns to the status it had before
    # Blocked, read from its own audit trail (activity_log old/new rows).

    async def link_issues(self, values: dict) -> dict:
        """Create a relationship; a `blocks` edge from an unfinished issue moves its target to Blocked."""
        rows = await self.request("POST", "issue_links", body={**values, "created_by": self.identity.user_id})
        link = rows[0]
        if link["type"] == "blocks" and (await self.issue(str(link["source_id"])))["status"] != "done":
            blocked = await self._transition(str(link["target_id"]),
                lambda issue: BLOCKED if issue["status"] not in ("done", BLOCKED) else None)
            if blocked:
                link = {**link, "blocked_issue": blocked}
        return link

    async def unlink_issues(self, link_id: str) -> dict:
        rows = await self.request("DELETE", "issue_links", params={"id": f"eq.{UUID(link_id)}"})
        if not rows:
            raise HTTPException(409, "Relationship changed or access was removed; reload before saving")
        result: dict[str, Any] = {"deleted": True}
        if rows[0].get("type") == "blocks" and (released := await self.release_blocked(str(rows[0]["target_id"]))):
            result["unblocked_issues"] = [released]
        return result

    async def open_blockers(self, issue_id: str) -> list[dict]:
        """The unfinished issues with a `blocks` relationship to this one."""
        links = await self.rows("issue_links", target_id=f"eq.{issue_id}", type="eq.blocks")
        if not links:
            return []
        blockers = await self.rows("issues", id=f"in.({','.join(sorted({str(link['source_id']) for link in links}))})")
        return [issue for issue in blockers if issue["status"] != "done"]

    async def status_before_blocked(self, issue_id: str) -> str | None:
        """The status the issue had when it last moved into Blocked."""
        entries = await self.rows("activity_log", issue_id=f"eq.{issue_id}", order="timestamp.desc", limit="200")
        for entry in entries:
            new, old = _row_json(entry.get("new_value")), _row_json(entry.get("old_value"))
            if new.get("status") == BLOCKED and old.get("status") not in (None, BLOCKED):
                return old["status"]
        return None

    async def release_blocked(self, issue_id: str) -> dict | None:
        """Return a Blocked issue with no unfinished blockers left to its earlier status."""
        async def decide(issue: dict) -> str | None:
            if issue["status"] != BLOCKED or await self.open_blockers(issue_id):
                return None
            return await self.status_before_blocked(issue_id)
        return await self._transition(issue_id, decide)

    async def _transition(self, issue_id: str, decide) -> dict | None:
        """Apply `decide(issue)`'s status with the issue's current version; reread once if it changed meanwhile."""
        for attempt in range(2):
            try:
                issue = await self.issue(issue_id)
            except HTTPException:
                return None
            status = decide(issue)
            if inspect.isawaitable(status):
                status = await status
            if not status or status == issue["status"]:
                return None
            try:
                return await self.update_issue(issue_id, issue["version"], {"status": status})
            except HTTPException as error:
                if error.status_code != 409 or attempt:
                    raise
        return None

    # ── Comments (021_issue_comments.sql) ───────────────────────────────────
    # Anyone with access to the project comments. The database stamps the author, their display name and the
    # issue's project; an agent's comment is its user's row with `author_kind` 'agent' and the agent's name.

    async def comments(self, issue_id: str, *, offset: int = 0, limit: int = 200) -> list[dict]:
        """The issue's comments, oldest first; 404 when the issue is not visible."""
        await self.issue(issue_id)
        return await self.rows("issue_comments", issue_id=f"eq.{UUID(issue_id)}", order="created_at.asc,id.asc",
                               offset=offset, limit=limit)

    async def add_comment(self, issue_id: str, body: str, *, agent_name: str | None = None) -> dict:
        """A person's comment, or an agent's when `agent_name` is given; 404 when the issue is not visible."""
        text = _comment_body(body)
        agent = (agent_name or "").strip() or None
        if agent and len(agent) > 120:
            raise HTTPException(422, "An agent name is at most 120 characters")
        rows = await self.request("POST", "issue_comments", body={"issue_id": str(UUID(issue_id)), "body": text,
            "author_kind": "agent" if agent else "user", "agent_name": agent})
        return rows[0]

    async def edit_comment(self, comment_id: str, version: int, body: str) -> dict:
        """Replace your own comment's body at `version`. Agent comments are never edited (403)."""
        rows = await self.request("PATCH", "issue_comments", params={"id": f"eq.{UUID(comment_id)}", "version": f"eq.{version}"},
                                  body={"body": _comment_body(body)})
        if not rows:
            raise HTTPException(409, "Comment changed or you can't edit it. Reload the comments before saving again.")
        return rows[0]

    async def delete_comment(self, comment_id: str) -> dict:
        """Your own comment, or any comment on a project you own."""
        rows = await self.request("DELETE", "issue_comments", params={"id": f"eq.{UUID(comment_id)}"})
        if not rows:
            raise HTTPException(404, "Comment not found or you can't delete it")
        return {"deleted": True}

    # ── Pages (015_project_documents.sql, 022_personal_documents.sql) ──────

    async def create_document(self, values: dict) -> dict:
        """A page in a project, or a personal page (`project_id` None). A child page is in its parent's project."""
        if values.get("parent_id"):
            parents = await self.rows("project_documents", select="id,project_id", id=f"eq.{UUID(str(values['parent_id']))}")
            if not parents:
                raise HTTPException(404, "Parent page not found or not accessible")
            project_id = parents[0]["project_id"]
            if values.get("project_id") not in (None, project_id):
                raise HTTPException(422, "A child page belongs to its parent page's project")
            values = {**values, "project_id": project_id}
        rows = await self.request("POST", "project_documents", body=values)
        return rows[0]

    async def move_document(self, document_id: str, project_id: str) -> dict:
        """Move a page and every page under it into a project (rpc/move_document); the page leaves its parent.

        404 when the page is not visible, 403 when the project is not accessible, 422 when it is already there.
        """
        moved = await self.request("POST", "rpc/move_document", body={"p_document": str(UUID(document_id)),
                                                                      "p_project": str(UUID(project_id))})
        return moved[0] if isinstance(moved, list) else moved

    # ── People (023_project_members.sql) ────────────────────────────────────

    async def members(self, project_id: str) -> list[dict]:
        """The owner, then the invited members: `{user_id, name, email, role, joined_at}`."""
        people = await self.request("POST", "rpc/project_people", body={"p_project": str(UUID(project_id))})
        if not people:
            raise HTTPException(404, "Project not found or not accessible")
        return people

    async def invite_member(self, project_id: str, email: str) -> dict:
        """Add an existing Ren account (by email) to a project you own; inviting a member again is a no-op."""
        people = await self.request("POST", "rpc/invite_project_member", body={"p_project": str(UUID(project_id)),
                                                                               "p_email": email.strip()})
        if not people:
            raise HTTPException(404, "Project not found or not accessible")
        return people[0]

    async def remove_member(self, project_id: str, user_id: str) -> dict:
        """The owner removes a member; a member removes themselves (leaves)."""
        rows = await self.request("DELETE", "project_members", params={"project_id": f"eq.{UUID(project_id)}",
                                                                       "user_id": f"eq.{UUID(user_id)}"})
        if not rows:
            raise HTTPException(404, "Member not found or you can't remove them")
        return {"deleted": True}


BLOCKED = "blocked"


def _comment_body(body: str) -> str:
    text = (body or "").strip()
    if not text:
        raise HTTPException(422, "Write something before posting the comment")
    if len(text) > COMMENT_MAX:
        raise HTTPException(422, f"A comment is at most {COMMENT_MAX:,} characters")
    return text


def _row_json(value) -> dict:
    """activity_log stores rows as JSON text (Supabase `to_jsonb(row)::text`, guest `json.dumps`)."""
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value) if value else {}
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


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