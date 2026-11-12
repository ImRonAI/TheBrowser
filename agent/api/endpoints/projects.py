"""Projects API: verified Supabase identity and one shared mutation path."""
import json
from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from agent.api.core.projects import ProjectIdentity, ProjectService, project_identity

router = APIRouter(prefix="/projects")
Identity = Annotated[ProjectIdentity, Depends(project_identity)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProjectCreate(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    key: str = Field(pattern=r"^[A-Z][A-Z0-9]{1,11}$")
    type: str = "software-development"
    summary: str = ""


class ProjectUpdate(StrictModel):
    version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = None
    lifecycle: Literal["active", "paused", "completed", "archived"] | None = None
    settings: dict[str, Any] | None = None


class IssueCreate(StrictModel):
    project_id: UUID
    parent_id: UUID | None = None
    type: str
    title: str = Field(min_length=1, max_length=500)
    description: str = ""
    status: Literal["backlog", "in-progress", "review", "blocked", "done"] = "backlog"
    priority: Literal["critical", "high", "medium", "low"] = "medium"
    assignees: list[UUID] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    estimate: float | None = Field(default=None, ge=0)
    start_date: str | None = None
    end_date: str | None = None
    due_date: str | None = None
    custom_fields: dict[str, Any] = Field(default_factory=dict)


class IssueUpdate(StrictModel):
    version: int = Field(ge=1)
    # Explicit whitelist; immutable identity/ownership columns cannot be patched.
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    type: str | None = None
    parent_id: UUID | None = None
    status: Literal["backlog", "in-progress", "review", "blocked", "done"] | None = None
    priority: Literal["critical", "high", "medium", "low"] | None = None
    assignees: list[UUID] | None = None
    labels: list[str] | None = None
    estimate: float | None = Field(default=None, ge=0)
    start_date: str | None = None
    end_date: str | None = None
    due_date: str | None = None
    rank: float | None = None
    custom_fields: dict[str, Any] | None = None
    work_products: list[dict[str, Any]] | None = None
    context: list[dict[str, Any]] | None = None


class LinkCreate(StrictModel):
    source_id: UUID
    target_id: UUID
    type: Literal["blocks", "enables", "implements", "fixes", "duplicates", "discovers", "relates"]


class EventCreate(StrictModel):
    title: str = Field(min_length=1, max_length=300)
    starts_at: str
    ends_at: str
    timezone: str = "UTC"
    meeting_url: str | None = None
    agenda: str = ""
    participants: list[str] = Field(default_factory=list)


#: List rows omit `content`; a page body is read with GET /projects/documents/{id}.
DOCUMENT_SUMMARY = "id,project_id,parent_id,title,version,created_by,created_at,updated_at"


class DocumentCreate(StrictModel):
    #: None is a personal page (only its author sees it). A child page is always in its parent's project.
    project_id: UUID | None = None
    parent_id: UUID | None = None
    title: str = Field(default="Untitled", min_length=1, max_length=300)
    content: str = Field(default="", max_length=2_000_000)


class DocumentMove(StrictModel):
    project_id: UUID


class CommentCreate(StrictModel):
    #: Checked after trimming by ProjectService.add_comment (blank or longer than COMMENT_MAX is a 422).
    body: str


class CommentUpdate(StrictModel):
    version: int = Field(ge=1)
    body: str


class MemberInvite(StrictModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DocumentLinkCreate(StrictModel):
    document_id: UUID
    issue_id: UUID


class DocumentConversationCreate(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    goal: bool = False


class DocumentConversationUpdate(StrictModel):
    title: str = Field(min_length=1, max_length=200)


class DocumentUpdate(StrictModel):
    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=300)
    content: str | None = Field(default=None, max_length=2_000_000)
    parent_id: UUID | None = None


class DocumentSkillPublish(StrictModel):
    """Whose skill the page becomes: the teaching scope (``user_id`` + ``agent_id``, ``panel`` = Ron)."""
    user_id: str = Field(min_length=1, max_length=256)
    agent_id: str = Field(default="panel", min_length=1, max_length=256)


@router.get("")
async def list_projects(identity: Identity, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    return await ProjectService(identity).rows("projects", order="id.asc", offset=offset, limit=limit)


@router.get("/links")
async def list_links(identity: Identity, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    return await ProjectService(identity).rows("issue_links", order="id.asc", offset=offset, limit=limit)


@router.get("/activity")
async def list_activity(identity: Identity, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    return await ProjectService(identity).rows("activity_log", order="timestamp.desc,id.asc", offset=offset, limit=limit)


@router.post("")
async def create_project(body: ProjectCreate, identity: Identity):
    rows = await ProjectService(identity).request("POST", "projects", body={**body.model_dump(),
        "project_key": body.key, "user_id": identity.user_id, "owner_id": identity.user_id})
    return rows[0]


@router.patch("/{project_id}")
async def update_project(project_id: UUID, body: ProjectUpdate, identity: Identity):
    from fastapi import HTTPException
    rows = await ProjectService(identity).request("PATCH", "projects",
        params={"id": f"eq.{project_id}", "version": f"eq.{body.version}"},
        body=body.model_dump(exclude={"version"}, exclude_unset=True))
    if not rows: raise HTTPException(409, "Project changed or access was removed; reload before saving")
    return rows[0]


@router.get("/{project_id}/issues")
async def list_issues(project_id: UUID, identity: Identity, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    return await ProjectService(identity).rows("issues", project_id=f"eq.{project_id}", order="rank.asc,id.asc", offset=offset, limit=limit)


@router.get("/{project_id}/members")
async def list_members(project_id: UUID, identity: Identity):
    """The owner, then the people they invited. A guest workspace has only its owner."""
    return await ProjectService(identity).members(str(project_id))


@router.post("/{project_id}/members")
async def invite_member(project_id: UUID, body: MemberInvite, identity: Identity):
    """Invite an existing Ren account by email (owner only; guests sign in first)."""
    return await ProjectService(identity).invite_member(str(project_id), body.email)


@router.delete("/{project_id}/members/{user_id}")
async def remove_member(project_id: UUID, user_id: UUID, identity: Identity):
    """The owner removes a member, or a member leaves (their own user_id)."""
    return await ProjectService(identity).remove_member(str(project_id), str(user_id))


#: Rows per activity_log request (Supabase's default PostgREST max-rows) and the most read for one history.
HISTORY_PAGE = 1000
HISTORY_MAX_ROWS = 10_000


def _epoch_ms(value: Any) -> int | None:
    try:
        moment = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000)


def issue_transitions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compact the audit trail (oldest first) into per-issue status/estimate/type changes.

    Each `new_value` is the issue row as JSON text (audit_canonical_issue, guest `audit`). An issue's
    first readable row is its first transition; later rows are kept only when one of the three changed.
    """
    last: dict[str, tuple[Any, Any, Any]] = {}
    transitions = []
    for row in rows:
        issue_id = row.get("issue_id")
        at = _epoch_ms(row.get("timestamp"))
        if not issue_id or at is None or not row.get("new_value"):
            continue
        try:
            value = json.loads(row["new_value"])
        except (TypeError, ValueError):
            continue
        if not isinstance(value, dict) or not isinstance(value.get("status"), str):
            continue
        estimate = value.get("estimate")
        estimate = float(estimate) if isinstance(estimate, (int, float)) and not isinstance(estimate, bool) else None
        state = (value["status"], estimate, value.get("type"))
        if last.get(issue_id) == state:
            continue
        last[issue_id] = state
        transitions.append({"issue_id": issue_id, "at": at, "status": state[0], "estimate": estimate, "type": state[2]})
    return transitions


@router.get("/{project_id}/history")
async def project_history(project_id: UUID, identity: Identity):
    """Status/estimate/type transitions of every issue in one project, oldest first, for the dashboard.

    Reads the newest audit rows first so that, when HISTORY_MAX_ROWS binds, the recent window is complete
    and only the oldest history is dropped (`truncated`, `since` = the oldest row read).
    """
    service = ProjectService(identity)
    if not await service.rows("projects", select="id", id=f"eq.{project_id}"):
        raise HTTPException(404, "Project not found or not accessible")
    rows: list[dict[str, Any]] = []
    truncated = False
    while True:
        if len(rows) >= HISTORY_MAX_ROWS:
            truncated = bool(await service.rows("activity_log", select="id", project_id=f"eq.{project_id}",
                                                order="timestamp.desc,id.desc", offset=len(rows), limit=1))
            break
        # Stop on an empty page, not a short one: the server may cap a page below HISTORY_PAGE.
        page = await service.rows("activity_log", select="issue_id,timestamp,new_value", project_id=f"eq.{project_id}",
                                  order="timestamp.desc,id.desc", offset=len(rows),
                                  limit=min(HISTORY_PAGE, HISTORY_MAX_ROWS - len(rows)))
        if not page:
            break
        rows.extend(page)
    rows.reverse()
    return {"project_id": str(project_id), "transitions": issue_transitions(rows), "rows_read": len(rows),
            "truncated": truncated, "since": _epoch_ms(rows[0]["timestamp"]) if rows else None}


@router.post("/issues")
async def create_issue(body: IssueCreate, identity: Identity):
    return await ProjectService(identity).create_issue(body.model_dump(mode="json"))


@router.get("/issues/{issue_id}/context")
async def issue_context(issue_id: UUID, identity: Identity):
    return await ProjectService(identity).context(str(issue_id))


@router.patch("/issues/{issue_id}")
async def update_issue(issue_id: UUID, body: IssueUpdate, identity: Identity):
    return await ProjectService(identity).update_issue(str(issue_id), body.version,
        body.model_dump(mode="json", exclude={"version"}, exclude_unset=True))


@router.post("/links")
async def create_link(body: LinkCreate, identity: Identity):
    return await ProjectService(identity).link_issues(body.model_dump(mode="json"))


@router.delete("/links/{link_id}")
async def delete_link(link_id: UUID, identity: Identity):
    return await ProjectService(identity).unlink_issues(str(link_id))


@router.post("/issues/{issue_id}/events")
async def create_event(issue_id: UUID, body: EventCreate, identity: Identity):
    rows = await ProjectService(identity).request("POST", "issue_events", body={**body.model_dump(), "issue_id": str(issue_id)})
    return rows[0]


@router.get("/issues/{issue_id}/comments")
async def list_comments(issue_id: UUID, identity: Identity, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    """The issue's comments, oldest first (404 when the issue is not visible)."""
    return await ProjectService(identity).comments(str(issue_id), offset=offset, limit=limit)


@router.post("/issues/{issue_id}/comments")
async def add_comment(issue_id: UUID, body: CommentCreate, identity: Identity):
    """A person's comment; agents comment through their tools (ProjectService.add_comment with agent_name)."""
    return await ProjectService(identity).add_comment(str(issue_id), body.body)


@router.patch("/comments/{comment_id}")
async def edit_comment(comment_id: UUID, body: CommentUpdate, identity: Identity):
    return await ProjectService(identity).edit_comment(str(comment_id), body.version, body.body)


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: UUID, identity: Identity):
    return await ProjectService(identity).delete_comment(str(comment_id))


@router.get("/{project_id}/documents")
async def list_documents(project_id: UUID, identity: Identity, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    return await ProjectService(identity).rows("project_documents", select=DOCUMENT_SUMMARY, project_id=f"eq.{project_id}",
                                               order="created_at.asc,id.asc", offset=offset, limit=limit)


@router.get("/documents")
async def list_all_documents(identity: Identity, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    """Every page the caller can access: across projects, plus their personal pages (`project_id` null)."""
    return await ProjectService(identity).rows("project_documents", select=DOCUMENT_SUMMARY,
                                               order="updated_at.desc,id.asc", offset=offset, limit=limit)


@router.get("/document-links")
async def list_document_links(identity: Identity, document_id: UUID | None = None, issue_id: UUID | None = None,
                              offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    """Links of one page (document_id) or of one issue (issue_id)."""
    if (document_id is None) == (issue_id is None):
        raise HTTPException(422, "Pass exactly one of document_id or issue_id")
    where = {"document_id": f"eq.{document_id}"} if document_id else {"issue_id": f"eq.{issue_id}"}
    return await ProjectService(identity).rows("document_issue_links", order="created_at.asc,id.asc",
                                               offset=offset, limit=limit, **where)


@router.post("/document-links")
async def create_document_link(body: DocumentLinkCreate, identity: Identity):
    rows = await ProjectService(identity).request("POST", "document_issue_links", body=body.model_dump(mode="json"))
    return rows[0]


@router.delete("/document-links/{link_id}")
async def delete_document_link(link_id: UUID, identity: Identity):
    rows = await ProjectService(identity).request("DELETE", "document_issue_links", params={"id": f"eq.{link_id}"})
    if not rows:
        raise HTTPException(404, "Link not found or not accessible")
    return {"deleted": True}


@router.get("/documents/{document_id}/conversations")
async def list_document_conversations(document_id: UUID, identity: Identity, offset: int = Query(0, ge=0),
                                      limit: int = Query(100, ge=1, le=500)):
    """The caller's saved Ask Ron conversations on one page, most recently used first."""
    return await ProjectService(identity).rows("document_conversations", document_id=f"eq.{document_id}",
                                               order="updated_at.desc,id.asc", offset=offset, limit=limit)


@router.post("/documents/{document_id}/conversations")
async def create_document_conversation(document_id: UUID, body: DocumentConversationCreate, identity: Identity):
    """A new conversation on this page; the database assigns its session id (`doc-<id>`)."""
    rows = await ProjectService(identity).request("POST", "document_conversations",
        body={"document_id": str(document_id), **body.model_dump(mode="json")})
    return rows[0]


@router.patch("/document-conversations/{conversation_id}")
async def touch_document_conversation(conversation_id: UUID, body: DocumentConversationUpdate, identity: Identity):
    """Marks the conversation as used now (the trigger sets updated_at) and keeps or renames its title."""
    rows = await ProjectService(identity).request("PATCH", "document_conversations",
        params={"id": f"eq.{conversation_id}"}, body=body.model_dump(mode="json"))
    if not rows:
        raise HTTPException(404, "Conversation not found or not accessible")
    return rows[0]


@router.get("/documents/{document_id}")
async def get_document(document_id: UUID, identity: Identity):
    rows = await ProjectService(identity).rows("project_documents", id=f"eq.{document_id}")
    if not rows:
        raise HTTPException(404, "Document not found or not accessible")
    return rows[0]


@router.post("/documents")
async def create_document(body: DocumentCreate, identity: Identity):
    return await ProjectService(identity).create_document(body.model_dump(mode="json"))


@router.post("/documents/{document_id}/move")
async def move_document(document_id: UUID, body: DocumentMove, identity: Identity):
    """Add a page (with every page under it) to a project, or move it to another one; it leaves its parent."""
    return await ProjectService(identity).move_document(str(document_id), str(body.project_id))


@router.patch("/documents/{document_id}")
async def update_document(document_id: UUID, body: DocumentUpdate, identity: Identity):
    rows = await ProjectService(identity).request("PATCH", "project_documents",
        params={"id": f"eq.{document_id}", "version": f"eq.{body.version}"},
        body=body.model_dump(mode="json", exclude={"version"}, exclude_unset=True))
    if not rows:
        raise HTTPException(409, "This page changed elsewhere or access was removed. Reload before saving again.")
    return rows[0]


@router.delete("/documents/{document_id}")
async def delete_document(document_id: UUID, identity: Identity):
    rows = await ProjectService(identity).request("DELETE", "project_documents", params={"id": f"eq.{document_id}"})
    if not rows:
        raise HTTPException(404, "Document not found or not accessible")
    return {"deleted": True}


@router.get("/documents/{document_id}/skill")
async def get_document_skill(document_id: UUID, identity: Identity, user_id: str = Query(min_length=1, max_length=256),
                             agent_id: str = Query("panel", min_length=1, max_length=256)):
    """The agent skill this page was published as (``core/document_skills.py``), or ``{"skill": null}``."""
    from agent.api.core.document_skills import bind_owner, document_skill
    from agent.api.core.teaching import get_teaching_service

    bind_owner(identity, user_id)
    try:
        return {"skill": await document_skill(get_teaching_service(), identity, user_id=user_id, agent_id=agent_id,
                                              document_id=str(document_id))}
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.post("/documents/{document_id}/skill")
async def publish_document_skill(document_id: UUID, body: DocumentSkillPublish, identity: Identity):
    """Publish (or republish) the page as a native Agent Skill of ``agent_id``, read with the caller's own access.

    Stored with the agent's taught skills, so ``GET /teaching/skills`` and ``use_skill`` find it. 422 lists every
    unknown reference or missing section; 403 when the credential is another user's.
    """
    from agent.api.core.document_skills import bind_owner, publish_document_skill as publish
    from agent.api.core.teaching import get_teaching_service

    bind_owner(identity, body.user_id)
    try:
        return await publish(get_teaching_service(), identity, user_id=body.user_id, agent_id=body.agent_id,
                             document_id=str(document_id))
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


class IssueAgentMessage(StrictModel):
    message: str = Field(min_length=1, max_length=20000)


def issue_runtime(request: Request):
    runtime = getattr(request.app.state, "issue_agents", None)
    if runtime is None:
        raise HTTPException(503, "Task agent runtime has not started")
    return runtime


@router.get("/issues/{issue_id}/agent")
async def issue_agent_history(issue_id: UUID, identity: Identity, request: Request, offset: int = Query(0, ge=0)):
    history = await issue_runtime(request).history(ProjectService(identity), str(issue_id), offset)
    return {**history, "owner_id": identity.user_id}


@router.post("/issues/{issue_id}/agent/messages", status_code=202)
async def issue_agent_message(issue_id: UUID, body: IssueAgentMessage, identity: Identity, request: Request):
    if not body.message.strip():
        raise HTTPException(422, "Message cannot be blank")
    result = await issue_runtime(request).start(ProjectService(identity), str(issue_id), body.message.strip())
    return {**result, "owner_id": identity.user_id}


@router.post("/issues/{issue_id}/agent/cancel")
async def cancel_issue_agent(issue_id: UUID, identity: Identity, request: Request):
    return await issue_runtime(request).cancel(ProjectService(identity), str(issue_id))
