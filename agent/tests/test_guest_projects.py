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

def test_guest_documents_save_nest_conflict_and_delete_with_children(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url='http://test',
                                    headers={'X-Ron-Workspace': 'c' * 64}) as client:
            project = (await client.post('/projects', json={'name': 'Docs', 'key': 'DOCS'})).json()
            created = await client.post('/projects/documents', json={'project_id': project['id'], 'title': 'Runbook',
                'content': '<h1>Deploy</h1><workflow-block data-graph="{}"></workflow-block>'})
            assert created.status_code == 200, created.text
            page = created.json()
            assert page['version'] == 1 and page['parent_id'] is None
            child = (await client.post('/projects/documents', json={'project_id': project['id'], 'parent_id': page['id'],
                'title': 'Rollback'})).json()
            assert child['content'] == '' and child['parent_id'] == page['id']

            listed = (await client.get(f"/projects/{project['id']}/documents")).json()
            assert [row['title'] for row in listed] == ['Runbook', 'Rollback']
            assert (await client.get(f"/projects/documents/{page['id']}")).json()['content'].startswith('<h1>Deploy')

            saved = await client.patch(f"/projects/documents/{page['id']}", json={'version': 1, 'title': 'Release runbook'})
            assert saved.status_code == 200 and saved.json()['version'] == 2
            assert (await client.patch(f"/projects/documents/{page['id']}", json={'version': 1, 'title': 'Stale'})).status_code == 409
            # A page cannot become its own descendant's child.
            cycle = await client.patch(f"/projects/documents/{page['id']}", json={'version': 2, 'parent_id': child['id']})
            assert cycle.status_code == 422
            assert (await client.patch(f"/projects/documents/{page['id']}", json={'version': 2, 'title': '   '})).status_code == 422

            other = {'X-Ron-Workspace': 'd' * 64}
            assert (await client.get(f"/projects/documents/{page['id']}", headers=other)).status_code == 404
            assert (await client.delete(f"/projects/documents/{page['id']}", headers=other)).status_code == 404

            deleted = await client.delete(f"/projects/documents/{page['id']}")
            assert deleted.status_code == 200 and deleted.json() == {'deleted': True}
            assert (await client.get(f"/projects/{project['id']}/documents")).json() == []
            assert (await client.get(f"/projects/documents/{child['id']}")).status_code == 404

    asyncio.run(scenario())



def test_guest_documents_link_to_issues_across_projects_and_unlink_on_delete(tmp_path, monkeypatch):
    """A page links to issues in its own and other projects; duplicates conflict; deleting the page removes its links."""
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url='http://test',
                                    headers={'X-Ron-Workspace': 'e' * 64}) as client:
            docs = (await client.post('/projects', json={'name': 'Docs', 'key': 'DOCS'})).json()
            ops = (await client.post('/projects', json={'name': 'Ops', 'key': 'OPS'})).json()
            here = (await client.post('/projects/issues', json={'project_id': docs['id'], 'type': 'task', 'title': 'Write runbook'})).json()
            there = (await client.post('/projects/issues', json={'project_id': ops['id'], 'type': 'task', 'title': 'Rotate keys'})).json()
            page = (await client.post('/projects/documents', json={'project_id': docs['id'], 'title': 'Runbook'})).json()
            child = (await client.post('/projects/documents', json={'project_id': docs['id'], 'parent_id': page['id'], 'title': 'Rollback'})).json()

            # Issues relate across projects, and so do pages.
            cross = await client.post('/projects/links', json={'source_id': here['id'], 'target_id': there['id'], 'type': 'blocks'})
            assert cross.status_code == 200, cross.text
            first = await client.post('/projects/document-links', json={'document_id': page['id'], 'issue_id': here['id']})
            assert first.status_code == 200, first.text
            second = (await client.post('/projects/document-links', json={'document_id': page['id'], 'issue_id': there['id']})).json()
            await client.post('/projects/document-links', json={'document_id': child['id'], 'issue_id': there['id']})
            assert (await client.post('/projects/document-links', json={'document_id': page['id'], 'issue_id': here['id']})).status_code == 409
            assert (await client.get('/projects/document-links')).status_code == 422

            by_page = (await client.get('/projects/document-links', params={'document_id': page['id']})).json()
            assert sorted(link['issue_id'] for link in by_page) == sorted([here['id'], there['id']])
            by_issue = (await client.get('/projects/document-links', params={'issue_id': there['id']})).json()
            assert sorted(link['document_id'] for link in by_issue) == sorted([page['id'], child['id']])
            assert {doc['title'] for doc in (await client.get('/projects/documents')).json()} == {'Runbook', 'Rollback'}

            other = {'X-Ron-Workspace': 'f' * 64}
            assert (await client.get('/projects/document-links', params={'issue_id': there['id']}, headers=other)).json() == []
            assert (await client.delete(f"/projects/document-links/{second['id']}", headers=other)).status_code == 404

            assert (await client.delete(f"/projects/document-links/{second['id']}")).json() == {'deleted': True}
            assert [link['document_id'] for link in (await client.get('/projects/document-links', params={'issue_id': there['id']})).json()] == [child['id']]
            # Deleting a page deletes its child pages and every link they had.
            await client.delete(f"/projects/documents/{page['id']}")
            assert (await client.get('/projects/document-links', params={'issue_id': there['id']})).json() == []
            assert (await client.get('/projects/document-links', params={'issue_id': here['id']})).json() == []

    asyncio.run(scenario())

def test_guest_page_conversations_are_saved_with_the_page(tmp_path, monkeypatch):
    """Ask Ron conversations are indexed per page with a store-assigned session; reuse reorders; page delete removes them."""
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url='http://test',
                                    headers={'X-Ron-Workspace': 'c' * 64}) as client:
            project = (await client.post('/projects', json={'name': 'Docs', 'key': 'DOCS'})).json()
            page = (await client.post('/projects/documents', json={'project_id': project['id'], 'title': 'Runbook'})).json()
            other = (await client.post('/projects/documents', json={'project_id': project['id'], 'title': 'Notes'})).json()
            base = f"/projects/documents/{page['id']}/conversations"

            first = await client.post(base, json={'title': 'Draft the runbook', 'goal': False})
            assert first.status_code == 200, first.text
            first = first.json()
            assert first['session_id'] == f"doc-{first['id']}" and first['document_id'] == page['id'] and first['goal'] is False
            goal = (await client.post(base, json={'title': 'Finish every section', 'goal': True})).json()
            assert goal['goal'] is True and goal['session_id'] == f"doc-{goal['id']}"
            # The client never chooses the session or the owner.
            assert (await client.post(base, json={'title': 'x', 'session_id': 'doc-mine'})).status_code == 422
            assert (await client.post(base, json={'title': '   '})).status_code == 422
            assert (await client.post('/projects/documents/00000000-0000-0000-0000-000000000000/conversations',
                                      json={'title': 'Orphan'})).status_code == 404

            listed = (await client.get(base)).json()
            assert [row['id'] for row in listed] == [goal['id'], first['id']]
            # Continuing a conversation makes it the one the page reopens.
            touched = await client.patch(f"/projects/document-conversations/{first['id']}", json={'title': first['title']})
            assert touched.status_code == 200, touched.text
            assert [row['id'] for row in (await client.get(base)).json()] == [first['id'], goal['id']]
            assert (await client.patch(f"/projects/document-conversations/{first['id']}", json={'goal': True})).status_code == 422
            assert (await client.get(f"/projects/documents/{other['id']}/conversations")).json() == []
            assert (await client.get(base, headers={'X-Ron-Workspace': 'd' * 64})).json() == []

            await client.delete(f"/projects/documents/{page['id']}")
            assert (await client.get(base)).json() == []

    asyncio.run(scenario())


def test_guest_issue_agent_draws_a_workflow_into_the_description(tmp_path, monkeypatch):
    """add_workflow_to_description appends the editor's workflow block (shapes, arrow labels) with version checks."""
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        from starlette.requests import Request
        from agent.api.core.projects import ProjectService, project_identity

        identity = await project_identity(Request({'type': 'http', 'headers': [(b'x-ron-workspace', b'd' * 64)]}))
        service = ProjectService(identity)
        project = (await service.request('POST', 'projects', body={'name': 'Flows', 'key': 'FLO'}))[0]
        issue = await service.create_issue({'project_id': project['id'], 'type': 'task', 'title': 'Checkout', 'description': '<p>Intro</p>'})
        tools = {tool.tool_name: tool for tool in issue_tools(service, issue)}
        _, result = await call_tool(tools['add_workflow_to_description'], {'version': 1, 'title': 'Checkout flow', 'steps': [
            {'id': 'cart', 'label': 'Cart', 'kind': 'start'}, {'id': 'pay', 'label': 'Paid?', 'kind': 'gateway'},
            {'id': 'done', 'label': 'Order placed', 'kind': 'end'}],
            'connections': [{'source': 'cart', 'target': 'pay'}, {'source': 'pay', 'target': 'done', 'label': 'Yes'}]})
        assert result['status'] == 'success'
        description = (await service.issue(issue['id']))['description']
        assert description.startswith('<p>Intro</p><workflow-block data-id="') and '<li>Paid?</li>' in description
        assert '&quot;kind&quot;: &quot;decision&quot;' in description and '&quot;label&quot;: &quot;Yes&quot;' in description
        _, result = await call_tool(tools['add_workflow_to_description'], {'version': 1, 'title': 'Stale', 'steps': [{'id': 'a', 'label': 'A'}]})
        assert result['status'] == 'error'

    asyncio.run(scenario())


def test_guest_issue_context_is_saved_versioned_and_read_by_the_issue_agent(tmp_path, monkeypatch):
    """The issue's Context section (`context`, migration 020) round-trips like work_products."""
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url='http://test',
                                    headers={'X-Ron-Workspace': 'c' * 64}) as client:
            project = (await client.post('/projects', json={'name': 'Context', 'key': 'CTX'})).json()
            issue = (await client.post('/projects/issues', json={'project_id': project['id'], 'type': 'task', 'title': 'With context'})).json()
            assert issue['context'] == []
            entry = {'id': 'ctx-1', 'kind': 'link', 'title': 'Tokio', 'content': '# Tokio\n\nAsync runtime', 'source': 'https://tokio.rs/',
                     'url': 'https://tokio.rs/', 'images': [], 'files': [], 'added': '2026-11-06T10:00:00Z', 'attachedAt': '2026-11-06T11:00:00Z'}
            saved = await client.patch(f"/projects/issues/{issue['id']}", json={'version': 1, 'context': [entry]})
            assert saved.status_code == 200, saved.text
            assert saved.json()['version'] == 2 and saved.json()['context'] == [entry]
            assert saved.json()['work_products'] == []
            assert (await client.patch(f"/projects/issues/{issue['id']}", json={'version': 2, 'context': {'id': 'x'}})).status_code == 422
            current = (await client.get(f"/projects/issues/{issue['id']}/context")).json()['issue']
            assert current['context'][0]['content'] == '# Tokio\n\nAsync runtime'
        return issue

    asyncio.run(scenario())


def test_issue_agent_reads_a_related_page_as_it_is_now(tmp_path, monkeypatch):
    """A page added from the Related documents field is attached empty; read_issue returns its current Markdown."""
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        from starlette.requests import Request
        from agent.api.core.projects import ProjectService, project_identity

        identity = await project_identity(Request({'type': 'http', 'headers': [(b'x-ron-workspace', b'9' * 64)]}))
        service = ProjectService(identity)
        project = (await service.request('POST', 'projects', body={'name': 'Pages', 'key': 'PGS'}))[0]
        other = (await service.request('POST', 'projects', body={'name': 'Elsewhere', 'key': 'ELW'}))[0]
        page = (await service.request('POST', 'project_documents', body={'project_id': project['id'], 'title': 'Rollout plan', 'content': ''}))[0]
        foreign = (await service.request('POST', 'project_documents', body={'project_id': other['id'], 'title': 'Other', 'content': '<p>Not this project</p>'}))[0]
        issue = await service.create_issue({'project_id': project['id'], 'type': 'task', 'title': 'Ship it'})
        entry = lambda doc, project_id: {'id': f"document:{doc['id']}", 'kind': 'document', 'title': doc['title'], 'content': '',
                                         'source': f"ron://project/{project_id}/docs/{doc['id']}", 'url': '', 'images': [], 'files': [],
                                         'added': '2026-11-07T10:00:00Z', 'attachedAt': '2026-11-07T10:00:00Z'}
        note = {'id': 'note-1', 'kind': 'note', 'title': 'Note', 'content': 'Keep me', 'source': '', 'url': '', 'images': [], 'files': []}
        issue = await service.update_issue(issue['id'], 1, {'context': [entry(page, project['id']), entry(foreign, other['id']), note]})
        # The user writes the page after linking it.
        await service.request('PATCH', 'project_documents', params={'id': f"eq.{page['id']}", 'version': f"eq.{page['version']}"},
                              body={'title': 'Rollout plan v2', 'content': '<h2>Steps</h2><ul><li><p>Canary</p></li></ul>'})

        tools = {tool.tool_name: tool for tool in issue_tools(service, issue)}
        _, result = await call_tool(tools['read_issue'], {})
        assert result['status'] == 'success'
        block = result['content'][0]
        context = (block['json'] if 'json' in block else json.loads(block['text']))['context']
        assert context[0]['title'] == 'Rollout plan v2'
        assert context[0]['content'].startswith('## Steps') and 'Canary' in context[0]['content']
        assert context[1] == entry(foreign, other['id'])  # another project's page is not read
        assert context[2] == note
        # Storage keeps the entry as attached; only the read is current.
        assert (await service.issue(issue['id']))['context'][0]['content'] == ''

    asyncio.run(scenario())


def test_guest_project_history_is_compacted_status_estimate_and_type_transitions(tmp_path, monkeypatch):
    """GET /projects/{id}/history reads the workspace audit trail and keeps only flow-relevant changes."""
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url='http://test',
                                    headers={'X-Ron-Workspace': 'd' * 64}) as client:
            project = (await client.post('/projects', json={'name': 'Flow', 'key': 'FLW'})).json()
            other = (await client.post('/projects', json={'name': 'Elsewhere', 'key': 'ELS'})).json()
            issue = (await client.post('/projects/issues', json={'project_id': project['id'], 'type': 'task', 'title': 'Flow item'})).json()
            await client.post('/projects/issues', json={'project_id': other['id'], 'type': 'task', 'title': 'Not this project'})
            version = issue['version']
            for patch in [{'status': 'in-progress'}, {'title': 'Renamed only'}, {'estimate': 3}, {'type': 'bug'},
                          {'status': 'done'}]:
                response = await client.patch(f"/projects/issues/{issue['id']}", json={'version': version, **patch})
                assert response.status_code == 200, response.text
                version = response.json()['version']

            history = await client.get(f"/projects/{project['id']}/history")
            assert history.status_code == 200, history.text
            body = history.json()
            assert body['project_id'] == project['id'] and body['truncated'] is False and body['rows_read'] == 6
            steps = [(t['status'], t['estimate'], t['type']) for t in body['transitions']]
            # The title-only update is not a transition; the other project's issue is not included.
            assert steps == [('backlog', None, 'task'), ('in-progress', None, 'task'), ('in-progress', 3.0, 'task'),
                             ('in-progress', 3.0, 'bug'), ('done', 3.0, 'bug')]
            assert {t['issue_id'] for t in body['transitions']} == {issue['id']}
            moments = [t['at'] for t in body['transitions']]
            assert moments == sorted(moments) and all(isinstance(at, int) for at in moments)
            assert body['since'] == moments[0]

            assert (await client.get(f"/projects/{project['id']}/history", headers={'X-Ron-Workspace': 'e' * 64})).status_code == 404

    asyncio.run(scenario())


def test_a_blocking_relationship_moves_the_blocked_issue_to_blocked_and_back(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application()), base_url='http://test',
                                     headers={'X-Ron-Workspace': 'e' * 64}) as client:
            project = (await client.post('/projects', json={'name': 'Blocking', 'key': 'BL'})).json()

            async def issue(title, status):
                created = (await client.post('/projects/issues', json={'project_id': project['id'], 'type': 'task', 'title': title})).json()
                if status == 'backlog':
                    return created
                return (await client.patch(f"/projects/issues/{created['id']}", json={'version': created['version'], 'status': status})).json()

            async def status(issue_id):
                return (await client.get(f"/projects/issues/{issue_id}/context")).json()['issue']['status']

            api, ui, docs, shipped = (await issue('API', 'in-progress'), await issue('UI', 'review'),
                                      await issue('Docs', 'backlog'), await issue('Shipped', 'done'))

            # API blocks UI: UI moves to Blocked and the response carries the moved issue.
            link = (await client.post('/projects/links', json={'source_id': api['id'], 'target_id': ui['id'], 'type': 'blocks'})).json()
            assert link['blocked_issue']['id'] == ui['id'] and link['blocked_issue']['status'] == 'blocked'
            assert await status(ui['id']) == 'blocked'
            # A second blocker leaves it Blocked; other relationship types never move anything.
            second = (await client.post('/projects/links', json={'source_id': docs['id'], 'target_id': ui['id'], 'type': 'blocks'})).json()
            assert 'blocked_issue' not in second
            relates = (await client.post('/projects/links', json={'source_id': api['id'], 'target_id': docs['id'], 'type': 'relates'})).json()
            assert 'blocked_issue' not in relates and await status(docs['id']) == 'backlog'
            # A finished issue blocks nothing; a finished issue is never moved to Blocked.
            assert 'blocked_issue' not in (await client.post('/projects/links', json={'source_id': shipped['id'], 'target_id': docs['id'], 'type': 'blocks'})).json()
            assert 'blocked_issue' not in (await client.post('/projects/links', json={'source_id': api['id'], 'target_id': shipped['id'], 'type': 'blocks'})).json()
            assert await status(docs['id']) == 'backlog' and await status(shipped['id']) == 'done'

            # Removing one of two blockers keeps UI Blocked.
            removed = (await client.delete(f"/projects/links/{link['id']}")).json()
            assert removed == {'deleted': True} and await status(ui['id']) == 'blocked'
            # Finishing the last blocker returns UI to the status it had before Blocked.
            docs_now = (await client.get(f"/projects/issues/{docs['id']}/context")).json()['issue']
            finished = (await client.patch(f"/projects/issues/{docs['id']}", json={'version': docs_now['version'], 'status': 'done'})).json()
            assert finished['status'] == 'done'
            assert [(i['id'], i['status']) for i in finished['unblocked_issues']] == [(ui['id'], 'review')]
            assert await status(ui['id']) == 'review'

            # Removing the only blocking relationship also restores the earlier status.
            fresh = await issue('Fresh', 'backlog')
            again = (await client.post('/projects/links', json={'source_id': api['id'], 'target_id': fresh['id'], 'type': 'blocks'})).json()
            assert await status(fresh['id']) == 'blocked'
            released = (await client.delete(f"/projects/links/{again['id']}")).json()
            assert released['deleted'] is True and released['unblocked_issues'][0]['status'] == 'backlog'
            assert await status(fresh['id']) == 'backlog'
            # The moves are ordinary audited updates.
            history = (await client.get(f"/projects/issues/{fresh['id']}/context")).json()['activity']
            assert [json.loads(entry['new_value'])['status'] for entry in history][:2] == ['backlog', 'blocked']

    asyncio.run(scenario())
