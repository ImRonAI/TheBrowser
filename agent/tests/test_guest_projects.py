"""Real SQLite and HTTP boundary; no Supabase account, token or connection."""
import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from agent.api.core import issue_agents
from agent.api.core.issue_agents import IssueAgentRuntime
from agent.api.core.issue_agents import issue_tools
from agent.api.endpoints.projects import router
from agent.tests.test_panel_tools import OfflineModel
from agent.tests.test_panel_tools import call_tool


def application():
    app = FastAPI()
    app.include_router(router)
    return app


def test_guest_projects_persist_and_isolate_with_conflicts_and_validation(tmp_path, monkeypatch):
    path = tmp_path / 'projects.db'
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(path))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url='http://test',
                                    headers={'X-Ron-Workspace': 'a' * 64}) as client:
            response = await client.post('/projects', json={'name': 'No account', 'key': 'NA'})
            assert response.status_code == 200, response.text
            project = response.json()
            response = await client.post('/projects/issues', json={'project_id': project['id'], 'type': 'task', 'title': 'Persistent task'})
            assert response.status_code == 200, response.text
            issue = response.json()
            assert issue['number'] == 1
            assert (await client.patch(f"/projects/issues/{issue['id']}", json={'version': 1, 'title': 'Saved'})).json()['version'] == 2
            assert (await client.patch(f"/projects/issues/{issue['id']}", json={'version': 1, 'title': 'Stale'})).status_code == 409
            assert (await client.post('/projects/issues', json={'project_id': project['id'], 'type': 'subtask', 'title': 'Orphan'})).status_code == 422
            assert (await client.post('/projects/issues', json={'project_id': project['id'], 'type': 'subtask', 'parent_id': issue['id'], 'title': 'Child'})).json()['number'] == 2
            assert len((await client.get('/projects/activity')).json()) == 3
            other = {'X-Ron-Workspace': 'b' * 64}
            assert (await client.get('/projects', headers=other)).json() == []
            assert (await client.get(f"/projects/issues/{issue['id']}/context", headers=other)).status_code == 404
            assert (await client.patch(f"/projects/issues/{issue['id']}", headers=other, json={'version': 2, 'title': 'Stolen'})).status_code == 409
            assert (await client.get('/projects', headers={'X-Ron-Workspace': 'invalid'})).status_code == 401
            # The renderer sends ISO timestamps, not date-only values.
            dated = await client.post('/projects/issues', json={'project_id': project['id'], 'type': 'task',
                'title': 'Scheduled', 'due_date': '2026-10-01T16:16:00.000Z',
                'start_date': '2026-10-01T10:00:00+02:00', 'end_date': '2026-10-01T09:00:00Z'})
            assert dated.status_code == 200, dated.text
            assert dated.json()['number'] == 3
            assert (await client.post('/projects/issues', json={'project_id': project['id'], 'type': 'task',
                'title': 'Wrong workspace'}, headers=other)).status_code == 404
        # A new app/connection reads disk, not an in-memory cache.
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url='http://test',
                                    headers={'X-Ron-Workspace': 'a' * 64}) as client:
            assert (await client.get('/projects')).json()[0]['id'] == project['id']
            assert (await client.get(f"/projects/issues/{issue['id']}/context")).json()['issue']['title'] == 'Saved'
        assert 'a' * 64 not in path.read_bytes().decode(errors='ignore')
        assert path.stat().st_mode & 0o777 == 0o600
    asyncio.run(scenario())


def test_guest_native_a2a_restart_snapshots_and_conversation_isolation(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))
    monkeypatch.setattr(issue_agents, 'default_selection', lambda: ('openai', 'offline'))
    models = []

    def factory(*args, **kwargs):
        model = OfflineModel('Guest reply')
        models.append(model)
        return model

    async def scenario():
        app = application()
        app.state.issue_agents = IssueAgentRuntime(factory)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                                    headers={'X-Ron-Workspace': 'c' * 64}) as client:
            project = (await client.post('/projects', json={'name': 'Guest', 'key': 'GT'})).json()
            issue = (await client.post('/projects/issues', json={'project_id': project['id'], 'type': 'task', 'title': 'Test'})).json()
            path = f"/projects/issues/{issue['id']}/agent"
            response = await client.post(path + '/messages', json={'message': 'Remember my guest message'})
            assert response.status_code == 202, response.text
            agent_id = response.json()['agent']['id']
            await asyncio.gather(*(r.task for r in app.state.issue_agents.active.values()))
            history = (await client.get(path)).json()
            assert history['runs'][0]['status'] == 'completed', history
            assert history['runs'][0]['output'] == 'Guest reply'
            await app.state.issue_agents.shutdown()
            app.state.issue_agents = IssueAgentRuntime(factory)
            response = await client.post(path + '/messages', json={'message': 'Second turn after restart'})
            assert response.status_code == 202, response.text
            assert response.json()['agent']['id'] == agent_id
            await asyncio.gather(*(r.task for r in app.state.issue_agents.active.values()))
            assert 'Remember my guest message' in json.dumps(models[1].calls[0]['messages'])
            assert len((await client.get(path)).json()['runs']) == 2
            assert (await client.get(path, headers={'X-Ron-Workspace': 'd' * 64})).status_code == 404
            await app.state.issue_agents.shutdown()
    asyncio.run(scenario())


def test_guest_native_cancel_and_orphan_recovery(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))
    monkeypatch.setattr(issue_agents, 'default_selection', lambda: ('openai', 'offline'))

    async def scenario():
        from starlette.requests import Request
        from agent.api.core.projects import ProjectService, project_identity

        identity = await project_identity(Request({'type': 'http', 'headers': [(b'x-ron-workspace', b'e' * 64)]}))
        service = ProjectService(identity)
        project = (await service.request('POST', 'projects', body={'name': 'Cancel', 'key': 'CA'}))[0]
        issue = await service.create_issue({'project_id': project['id'], 'type': 'task', 'title': 'Cancel'})
        entered, release = asyncio.Event(), asyncio.Event()
        runtime = IssueAgentRuntime(lambda *a, **k: OfflineModel(entered=entered, release=release))
        await runtime.start(service, issue['id'], 'Wait')
        await asyncio.wait_for(entered.wait(), 5)
        tasks = [r.task for r in runtime.active.values()]
        try:
            with pytest.raises(HTTPException) as conflict:
                await runtime.start(service, issue['id'], 'Duplicate')
            assert conflict.value.status_code == 409
            await runtime.cancel(service, issue['id'])
        finally:
            release.set()
            await asyncio.wait_for(asyncio.gather(*tasks), 5)
            await runtime.shutdown()
        restarted = IssueAgentRuntime()
        assert (await restarted.history(service, issue['id']))['runs'][0]['status'] == 'canceled'
        await service.request('PATCH', 'issue_agent_runs', body={'status': 'running'})
        assert (await restarted.history(service, issue['id']))['runs'][0]['status'] == 'interrupted'
        await restarted.shutdown()
    asyncio.run(scenario())


@pytest.mark.parametrize('token', ['', 'short', '../' * 30, 'A' * 64])
def test_invalid_guest_capabilities_are_rejected(token):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url='http://test') as client:
            assert (await client.get('/projects', headers={'X-Ron-Workspace': token})).status_code == 401
    asyncio.run(scenario())


def test_guest_issue_tools_preserve_relationships_and_deliverables_after_reopen(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        from starlette.requests import Request
        from agent.api.core.projects import ProjectService, project_identity

        identity = await project_identity(Request({'type': 'http', 'headers': [(b'x-ron-workspace', b'f' * 64)]}))
        service = ProjectService(identity)
        project = (await service.request('POST', 'projects', body={'name': 'Tools', 'key': 'TL'}))[0]
        issue = await service.create_issue({'project_id': project['id'], 'type': 'task', 'title': 'Tool scope'})
        target = await service.create_issue({'project_id': project['id'], 'type': 'task', 'title': 'Related'})
        tools = {tool.tool_name: tool for tool in issue_tools(service, issue)}
        _, result = await call_tool(tools['link_issue'], {'target_id': target['id'], 'type': 'blocks'})
        assert result['status'] == 'success'
        _, result = await call_tool(tools['save_work_product'], {'version': 1, 'title': 'Report',
            'content': 'Persistent report', 'image_urls': ['https://example.com/preview.png']})
        assert result['status'] == 'success'
        reopened = ProjectService(identity)
        context = await reopened.context(issue['id'])
        assert context['links'][0]['target_id'] == target['id']
        assert context['issue']['work_products'][0]['content'] == 'Persistent report'
        assert context['issue']['work_products'][0]['images'][0]['url'].endswith('preview.png')
        _, result = await call_tool(tools['save_work_product'], {'version': 1, 'title': 'Lost update', 'content': 'No'})
        assert result['status'] == 'error'
        other = (await service.request('POST', 'projects', body={'name': 'Other', 'key': 'OT'}))[0]
        outside = await service.create_issue({'project_id': other['id'], 'type': 'task', 'title': 'Outside scope'})
        _, result = await call_tool(tools['link_issue'], {'target_id': outside['id']})
        assert result['status'] == 'error'

    asyncio.run(scenario())