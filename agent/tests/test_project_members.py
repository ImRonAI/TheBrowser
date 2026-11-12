"""Project people (023_project_members.sql) through the real Projects router and the real guest SQLite workspace
(X-Ron-Workspace). A guest workspace is one person, the owner of all its projects; inviting needs Ren accounts, so a
guest is asked to sign in. No Supabase account or connection."""
import asyncio
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from starlette.requests import Request

from agent.api.core.guest_projects import SIGN_IN_TO_INVITE
from agent.api.core.projects import ProjectService, project_identity
from agent.api.endpoints.projects import router

WORKSPACE = 'f' * 64


def client(workspace: str = WORKSPACE) -> httpx.AsyncClient:
    app = FastAPI()
    app.include_router(router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                             headers={'X-Ron-Workspace': workspace})


async def service(workspace: str = WORKSPACE) -> ProjectService:
    return ProjectService(await project_identity(Request({'type': 'http', 'headers': [(b'x-ron-workspace', workspace.encode())]})))


def test_a_guest_workspace_lists_its_owner_and_asks_to_sign_in_before_inviting(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        projects = await service()
        async with client() as http:
            project = (await http.post('/projects', json={'name': 'Team', 'key': 'TEAM'})).json()
            people = await http.get(f"/projects/{project['id']}/members")
            assert people.status_code == 200, people.text
            assert people.json() == [{'user_id': projects.identity.user_id, 'name': 'You', 'email': '', 'role': 'owner',
                                      'joined_at': project['created_at']}]
            missing = await http.get(f"/projects/{uuid4()}/members")
            assert (missing.status_code, missing.json()['detail']) == (404, 'Project not found or not accessible')
            assert (await http.get('/projects/not-a-project/members')).status_code == 422

            # Inviting needs a Ren account on both sides; the address is checked first.
            for email in ('friend@example.com', '  Friend@Example.com  '):
                refused = await http.post(f"/projects/{project['id']}/members", json={'email': email})
                assert (refused.status_code, refused.json()['detail']) == (403, SIGN_IN_TO_INVITE)
            for body in ({'email': 'not-an-email'}, {'email': 'friend@example'}, {'email': ''}, {},
                         {'email': f"{'x' * 310}@example.com"}, {'email': 'friend@example.com', 'role': 'owner'}):
                assert (await http.post(f"/projects/{project['id']}/members", json=body)).status_code == 422
            removed = await http.delete(f"/projects/{project['id']}/members/{uuid4()}")
            assert (removed.status_code, removed.json()['detail']) == (403, SIGN_IN_TO_INVITE)
            left = await http.delete(f"/projects/{project['id']}/members/{projects.identity.user_id}")
            assert (left.status_code, left.json()['detail']) == (403, SIGN_IN_TO_INVITE)
            assert (await http.get(f"/projects/{project['id']}/members")).json()[0]['role'] == 'owner'

        # Another workspace does not see the project or its people.
        async with client('0' * 64) as stranger:
            assert (await stranger.get(f"/projects/{project['id']}/members")).status_code == 404

        # The same rules reach the agents through ProjectService.
        assert [person['role'] for person in await projects.members(project['id'])] == ['owner']
        for call, status in ((lambda: projects.invite_member(project['id'], 'friend@example.com'), 403),
                             (lambda: projects.remove_member(project['id'], str(uuid4())), 403),
                             (lambda: projects.members(str(uuid4())), 404)):
            with pytest.raises(HTTPException) as error:
                await call()
            assert error.value.status_code == status

    asyncio.run(scenario())
