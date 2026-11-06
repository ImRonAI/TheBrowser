"""Projects API: verified Supabase identity and one shared mutation path."""
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
    project_id: UUID
    parent_id: UUID | None = None
    title: str = Field(default="Untitled", min_length=1, max_length=300)
    content: str = Field(default="", max_length=2_000_000)


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
    rows = await ProjectService(identity).request("POST", "issue_links", body={**body.model_dump(mode="json"), "created_by": identity.user_id})
    return rows[0]


@router.delete("/links/{link_id}")
async def delete_link(link_id: UUID, identity: Identity):
    from fastapi import HTTPException
    rows = await ProjectService(identity).request("DELETE", "issue_links", params={"id": f"eq.{link_id}"})
    if not rows:
        raise HTTPException(409, "Relationship changed or access was removed; reload before saving")
    return {"deleted": True}


@router.post("/issues/{issue_id}/events")
async def create_event(issue_id: UUID, body: EventCreate, identity: Identity):
    rows = await ProjectService(identity).request("POST", "issue_events", body={**body.model_dump(), "issue_id": str(issue_id)})
    return rows[0]


@router.get("/{project_id}/documents")
async def list_documents(project_id: UUID, identity: Identity, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    return await ProjectService(identity).rows("project_documents", select=DOCUMENT_SUMMARY, project_id=f"eq.{project_id}",
                                               order="created_at.asc,id.asc", offset=offset, limit=limit)


@router.get("/documents")
async def list_all_documents(identity: Identity, offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
    """Every page the caller can access, across projects (for linking a page to an issue)."""
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
    rows = await ProjectService(identity).request("POST", "project_documents", body=body.model_dump(mode="json"))
    return rows[0]


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
