"""Loopback API for durable skill teaching and compilation."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from agent.api.core.teaching import get_teaching_service
from agent.api.core.tenancy import tenant_id

router = APIRouter(prefix="/teaching", tags=["teaching"])


class Scope(BaseModel):
    user_id: str = Field(min_length=1, max_length=256)
    agent_id: str = Field(min_length=1, max_length=256)


class CreateSession(Scope):
    title: str = Field(min_length=1, max_length=200)
    objective: str = Field(min_length=1, max_length=10000)
    context: str = Field(default="", max_length=10000)


class ApproveReview(Scope):
    revision: int = Field(ge=1)


class ReviseReview(ApproveReview):
    feedback: str = Field(min_length=1, max_length=10000)


@router.post("/sessions", status_code=201)
async def create_session(http_request: Request, request: CreateSession):
    request.user_id = await tenant_id(http_request, request.user_id)
    try:
        return await get_teaching_service().create_session(**request.model_dump())
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/sessions")
async def list_sessions(request: Request, user_id: str, agent_id: str):
    user_id = await tenant_id(request, user_id)
    try:
        return {"sessions": await get_teaching_service().list_sessions(user_id, agent_id)}
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/sessions/{session_id}")
async def get_session(request: Request, session_id: str, user_id: str, agent_id: str):
    user_id = await tenant_id(request, user_id)
    try:
        return await get_teaching_service().get_session(user_id, agent_id, session_id)
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.post("/sessions/{session_id}/finish", status_code=202)
async def finish_session(http_request: Request, session_id: str, request: Scope):
    request.user_id = await tenant_id(http_request, request.user_id)
    try:
        return await get_teaching_service().finish(request.user_id, request.agent_id, session_id)
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/sessions/{session_id}/review", status_code=202)
async def revise_review(http_request: Request, session_id: str, request: ReviseReview):
    request.user_id = await tenant_id(http_request, request.user_id)
    try:
        return await get_teaching_service().revise(session_id=session_id, **request.model_dump())
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/sessions/{session_id}/approve", status_code=202)
async def approve_review(http_request: Request, session_id: str, request: ApproveReview):
    request.user_id = await tenant_id(http_request, request.user_id)
    try:
        return await get_teaching_service().approve(session_id=session_id, **request.model_dump())
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/sessions/{session_id}/document", response_class=HTMLResponse)
async def process_document(request: Request, session_id: str, user_id: str, agent_id: str):
    user_id = await tenant_id(request, user_id)
    try:
        document = await get_teaching_service().get_document(user_id, agent_id, session_id)
        return HTMLResponse(document, headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
        })
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/skills")
async def list_skills(request: Request, user_id: str, agent_id: str):
    user_id = await tenant_id(request, user_id)
    try:
        return {"skills": await get_teaching_service().list_skills(user_id, agent_id)}
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/references")
async def list_references(request: Request, user_id: str, agent_id: str = "panel"):
    """What a skill page can reference with ``@``: tools, MCP servers, this agent's skills and Ron's A2A agent.

    Pages and the user's specialists/project agents come from their own APIs (renderer).
    """
    user_id = await tenant_id(request, user_id)
    from agent.api.core.document_skills import reference_catalog

    try:
        return await reference_catalog(get_teaching_service(), user_id, agent_id)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/skills/{skill_id}/files")
async def read_file(request: Request, skill_id: str, path: str, user_id: str, agent_id: str):
    user_id = await tenant_id(request, user_id)
    try:
        return await get_teaching_service().read_file(user_id, agent_id, skill_id, path)
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
