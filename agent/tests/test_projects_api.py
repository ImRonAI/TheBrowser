"""Offline contract tests. Database RLS/concurrency require separate live acceptance tests."""
import asyncio
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
from fastapi import FastAPI

from agent.api.core.projects import RON_ASSIGNEE_ID, ProjectIdentity, ProjectService, project_identity
from agent.api.endpoints.projects import router


def test_projects_require_bearer_identity():
    async def scenario():
        app = FastAPI()
        app.include_router(router)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get('/projects')
            assert response.status_code == 401
    asyncio.run(scenario())


def test_relationship_delete_requires_confirmed_row(monkeypatch):
    async def scenario():
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[project_identity] = lambda: ProjectIdentity(str(uuid4()), 'token', 'https://offline.invalid', 'public')
        request = AsyncMock(return_value=[])
        monkeypatch.setattr(ProjectService, 'request', request)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            link_id = str(uuid4())
            assert (await client.delete(f'/projects/links/{link_id}')).status_code == 409
            request.return_value = [{'id': link_id}]
            assert (await client.delete(f'/projects/links/{link_id}')).json() == {'deleted': True}
    asyncio.run(scenario())


def test_database_transport_forwards_user_jwt_without_retry(monkeypatch):
    async def scenario():
        calls = []
        identity = ProjectIdentity(str(uuid4()), 'user-jwt', 'https://offline.invalid', 'public-key')

        def respond(request):
            calls.append(request)
            assert request.headers['authorization'] == 'Bearer user-jwt'
            assert request.headers['apikey'] == 'public-key'
            return httpx.Response(503, json={'message': 'Unavailable'})

        original_client = httpx.AsyncClient
        monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original_client(
            transport=httpx.MockTransport(respond), **kwargs))
        from fastapi import HTTPException
        try:
            await ProjectService(identity).request('POST', 'projects', body={'name': 'Test'})
        except HTTPException as error:
            assert error.status_code == 503
        else:
            raise AssertionError('Failed write must not report success')
        assert len(calls) == 1
    asyncio.run(scenario())


def test_project_contracts_and_version_conflicts(monkeypatch):
    async def scenario():
        identity = ProjectIdentity(str(uuid4()), 'user-token', 'https://offline.invalid', 'public-key')
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[project_identity] = lambda: identity
        request = AsyncMock(return_value=[{'id': str(uuid4()), 'version': 1}])
        monkeypatch.setattr(ProjectService, 'request', request)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post('/projects', json={'name': 'Test', 'key': 'TEST'})
            assert response.status_code == 200
            body = request.call_args.kwargs['body']
            assert body['key'] == body['project_key'] == 'TEST'
            assert body['user_id'] == body['owner_id'] == identity.user_id
            request.reset_mock()
            response = await client.post('/projects', json={'name': 'Test', 'key': 'TEST', 'user_id': str(uuid4())})
            assert response.status_code == 422
            request.assert_not_awaited()

            issue_id = str(uuid4())
            response = await client.patch(f'/projects/issues/{issue_id}', json={'version': 4, 'due_date': None})
            assert response.status_code == 200
            assert request.call_args.kwargs['params'] == {'id': f'eq.{issue_id}', 'version': 'eq.4'}
            assert request.call_args.kwargs['body'] == {'due_date': None}
            for field in ['number', 'project_id', 'created_by', 'id']:
                response = await client.patch(f'/projects/issues/{issue_id}', json={'version': 4, field: str(uuid4())})
                assert response.status_code == 422
            request.return_value = []
            response = await client.patch(f'/projects/issues/{issue_id}', json={'version': 4, 'title': 'Stale'})
            assert response.status_code == 409
            response = await client.patch(f'/projects/{uuid4()}', json={'version': 4, 'name': 'Stale'})
            assert response.status_code == 409
    asyncio.run(scenario())


def test_collection_reads_are_paginated_without_owner_filter(monkeypatch):
    async def scenario():
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[project_identity] = lambda: ProjectIdentity(str(uuid4()), 'token', 'https://offline.invalid', 'public')
        request = AsyncMock(return_value=[])
        monkeypatch.setattr(ProjectService, 'request', request)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            for path, table in [('', 'projects'), ('/links', 'issue_links'), ('/activity', 'activity_log')]:
                response = await client.get(f'/projects{path}?offset=200&limit=200')
                assert response.status_code == 200
                assert request.call_args.args == ('GET', table)
                params = request.call_args.kwargs['params']
                assert params['offset'] == 200 and params['limit'] == 200
                assert 'user_id' not in params
            assert (await client.get('/projects?limit=501')).status_code == 422
            assert (await client.get('/projects?offset=-1')).status_code == 422
    asyncio.run(scenario())


def test_assignees_limited_to_signed_in_user_and_ron(monkeypatch):
    async def scenario():
        identity = ProjectIdentity(str(uuid4()), 'user-token', 'https://offline.invalid', 'public-key')
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[project_identity] = lambda: identity
        request = AsyncMock(return_value=[{'id': str(uuid4()), 'version': 1}])
        monkeypatch.setattr(ProjectService, 'request', request)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            project_id, issue_id = str(uuid4()), str(uuid4())
            allowed = [identity.user_id, RON_ASSIGNEE_ID]
            create = {'project_id': project_id, 'type': 'task', 'title': 'T'}
            assert (await client.post('/projects/issues', json={**create, 'assignees': allowed})).status_code == 200
            assert (await client.patch(f'/projects/issues/{issue_id}', json={'version': 1, 'assignees': allowed})).status_code == 200
            assert (await client.patch(f'/projects/issues/{issue_id}', json={'version': 1, 'assignees': []})).status_code == 200
            request.reset_mock()
            stranger = [str(uuid4())]
            assert (await client.post('/projects/issues', json={**create, 'assignees': stranger})).status_code == 422
            assert (await client.patch(f'/projects/issues/{issue_id}', json={'version': 1, 'assignees': stranger})).status_code == 422
            request.assert_not_awaited()
    asyncio.run(scenario())

