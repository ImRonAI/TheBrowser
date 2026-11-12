"""Personal pages and moving pages into projects (022_personal_documents.sql) end to end: the real Projects router,
the real guest SQLite workspace (X-Ron-Workspace) and, for publishing a personal page as a skill, the real
TeachingService storage and native skill loader. No Supabase account or connection."""
import asyncio
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from starlette.requests import Request
from strands.vended_plugins.skills import Skill

from agent.api.core import teaching
from agent.api.core.projects import ProjectService, project_identity
from agent.api.core.teaching import TeachingService, _scope
from agent.api.endpoints.projects import router
from agent.api.endpoints.teaching import router as teaching_router
from agent.tests.test_document_skills import GUEST, skill_page

WORKSPACE = 'a' * 64
OTHER = 'b' * 64


def client(app: FastAPI | None = None, workspace: str = WORKSPACE) -> httpx.AsyncClient:
    if app is None:
        app = FastAPI()
        app.include_router(router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                             headers={'X-Ron-Workspace': workspace}, timeout=120)


async def service(workspace: str = WORKSPACE) -> ProjectService:
    return ProjectService(await project_identity(Request({'type': 'http', 'headers': [(b'x-ron-workspace', workspace.encode())]})))


def test_personal_pages_belong_to_their_author_and_child_pages_follow_their_parent(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        projects = await service()
        async with client() as http:
            docs = (await http.post('/projects', json={'name': 'Docs', 'key': 'DOCS'})).json()
            ops = (await http.post('/projects', json={'name': 'Ops', 'key': 'OPS'})).json()

            created = await http.post('/projects/documents', json={'title': 'Journal', 'content': '<p>Day one</p>'})
            assert created.status_code == 200, created.text
            journal = created.json()
            assert (journal['project_id'], journal['parent_id'], journal['version']) == (None, None, 1)
            assert journal['created_by'] == projects.identity.user_id and journal['content'] == '<p>Day one</p>'
            explicit = (await http.post('/projects/documents', json={'project_id': None, 'title': 'Ideas'})).json()
            assert explicit['project_id'] is None

            # A child page is in its parent's project: personal under a personal page, the project's under its page.
            monday = (await http.post('/projects/documents', json={'parent_id': journal['id'], 'title': 'Monday'})).json()
            assert (monday['project_id'], monday['parent_id']) == (None, journal['id'])
            runbook = (await http.post('/projects/documents', json={'project_id': docs['id'], 'title': 'Runbook'})).json()
            rollback = (await http.post('/projects/documents', json={'parent_id': runbook['id'], 'title': 'Rollback'})).json()
            assert (rollback['project_id'], rollback['parent_id']) == (docs['id'], runbook['id'])
            same = await http.post('/projects/documents', json={'project_id': docs['id'], 'parent_id': runbook['id'], 'title': 'Checks'})
            assert same.status_code == 200 and same.json()['project_id'] == docs['id']
            for parent, project in ((runbook['id'], ops['id']), (journal['id'], docs['id'])):
                mismatch = await http.post('/projects/documents', json={'project_id': project, 'parent_id': parent, 'title': 'Mismatch'})
                assert mismatch.status_code == 422 and mismatch.json()['detail'] == "A child page belongs to its parent page's project"
            missing = await http.post('/projects/documents', json={'parent_id': str(uuid4()), 'title': 'Orphan'})
            assert missing.status_code == 404 and missing.json()['detail'] == 'Parent page not found or not accessible'
            assert (await http.post('/projects/documents', json={'project_id': str(uuid4()), 'title': 'Nowhere'})).status_code == 404

            # The store keeps the parent rule itself, whoever calls it.
            for body, reason in (({'project_id': ops['id'], 'parent_id': runbook['id']}, 'Parent page must belong to the same project'),
                                 ({'project_id': None, 'parent_id': runbook['id']}, 'Parent page must be one of your personal pages'),
                                 ({'project_id': docs['id'], 'parent_id': journal['id']}, 'Parent page must belong to the same project')):
                with pytest.raises(HTTPException) as error:
                    await projects.request('POST', 'project_documents', body={'title': 'Direct', **body})
                assert (error.value.status_code, error.value.detail) == (422, reason)

            # Every page I can open, personal ones included; a project's Docs list has only that project's pages.
            everything = {(row['title'], row['project_id']) for row in (await http.get('/projects/documents')).json()}
            assert everything == {('Journal', None), ('Ideas', None), ('Monday', None), ('Runbook', docs['id']),
                                  ('Rollback', docs['id']), ('Checks', docs['id'])}
            assert [row['title'] for row in (await http.get(f"/projects/{docs['id']}/documents")).json()] == ['Runbook', 'Rollback', 'Checks']
            assert (await http.get(f"/projects/{ops['id']}/documents")).json() == []
            assert {row['title'] for row in await projects.rows('project_documents', project_id='is.null')} == {'Journal', 'Ideas', 'Monday'}

            # Personal pages are edited like any page, and nest only under their own author's personal pages.
            saved = await http.patch(f"/projects/documents/{monday['id']}", json={'version': 1, 'title': 'Monday notes'})
            assert saved.status_code == 200 and saved.json()['version'] == 2 and saved.json()['project_id'] is None
            assert (await http.patch(f"/projects/documents/{monday['id']}", json={'version': 2, 'parent_id': runbook['id']})).status_code == 422
            assert (await http.patch(f"/projects/documents/{journal['id']}", json={'version': 1, 'parent_id': monday['id']})).status_code == 422
            # A page changes project only by moving.
            assert (await http.patch(f"/projects/documents/{journal['id']}", json={'version': 1, 'project_id': docs['id']})).status_code == 422
            with pytest.raises(HTTPException) as error:
                await projects.request('PATCH', 'project_documents', params={'id': f"eq.{journal['id']}"}, body={'project_id': docs['id']})
            assert (error.value.status_code, error.value.detail) == (422, 'Move pages with move_document')

        # Nobody else sees a personal page, or can nest a page under it.
        async with client(workspace=OTHER) as stranger:
            assert (await stranger.get('/projects/documents')).json() == []
            assert (await stranger.get(f"/projects/documents/{journal['id']}")).status_code == 404
            assert (await stranger.post('/projects/documents', json={'parent_id': journal['id'], 'title': 'Mine'})).status_code == 404
            assert (await stranger.delete(f"/projects/documents/{journal['id']}")).status_code == 404

    asyncio.run(scenario())


def test_moving_a_page_takes_its_subtree_into_the_project_and_keeps_links_and_conversations(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        async with client() as http:
            docs = (await http.post('/projects', json={'name': 'Docs', 'key': 'DOCS'})).json()
            ops = (await http.post('/projects', json={'name': 'Ops', 'key': 'OPS'})).json()
            issue = (await http.post('/projects/issues', json={'project_id': ops['id'], 'type': 'task', 'title': 'Ship it'})).json()
            plan = (await http.post('/projects/documents', json={'title': 'Plan', 'content': '<p>Launch</p>'})).json()
            steps = (await http.post('/projects/documents', json={'parent_id': plan['id'], 'title': 'Steps'})).json()
            details = (await http.post('/projects/documents', json={'parent_id': steps['id'], 'title': 'Details'})).json()
            aside = (await http.post('/projects/documents', json={'title': 'Aside'})).json()
            link = (await http.post('/projects/document-links', json={'document_id': steps['id'], 'issue_id': issue['id']})).json()
            conversation = (await http.post(f"/projects/documents/{plan['id']}/conversations", json={'title': 'Outline the plan'})).json()

            moved = await http.post(f"/projects/documents/{plan['id']}/move", json={'project_id': docs['id']})
            assert moved.status_code == 200, moved.text
            root = moved.json()
            # The moved page comes back whole, now in the project.
            assert (root['id'], root['project_id'], root['parent_id'], root['version'], root['content']) == (
                plan['id'], docs['id'], None, 2, '<p>Launch</p>')
            for page, parent in ((steps, plan['id']), (details, steps['id'])):
                now = (await http.get(f"/projects/documents/{page['id']}")).json()
                assert (now['project_id'], now['parent_id'], now['version']) == (docs['id'], parent, 2)
            assert (await http.get(f"/projects/documents/{aside['id']}")).json()['project_id'] is None
            assert [row['title'] for row in (await http.get(f"/projects/{docs['id']}/documents")).json()] == ['Plan', 'Steps', 'Details']
            assert [row['id'] for row in (await http.get('/projects/document-links', params={'document_id': steps['id']})).json()] == [link['id']]
            assert [row['id'] for row in (await http.get(f"/projects/documents/{plan['id']}/conversations")).json()] == [conversation['id']]

            # Moving a nested page to another project takes it out of its parent; its own subtree follows it.
            branch = (await http.post(f"/projects/documents/{steps['id']}/move", json={'project_id': ops['id']})).json()
            assert (branch['project_id'], branch['parent_id'], branch['version']) == (ops['id'], None, 3)
            assert (await http.get(f"/projects/documents/{details['id']}")).json()['project_id'] == ops['id']
            assert (await http.get(f"/projects/documents/{details['id']}")).json()['parent_id'] == steps['id']
            assert (await http.get(f"/projects/documents/{plan['id']}")).json()['project_id'] == docs['id']
            assert [row['title'] for row in (await http.get(f"/projects/{docs['id']}/documents")).json()] == ['Plan']

            # 404 for a page I cannot open, 403 for a project I cannot access, 422 when it is already there.
            for page_id, body, status, detail in (
                (str(uuid4()), {'project_id': docs['id']}, 404, 'Document not found or not accessible'),
                (aside['id'], {'project_id': str(uuid4())}, 403, 'Project not accessible'),
                (plan['id'], {'project_id': docs['id']}, 422, 'The page is already in that project'),
            ):
                refused = await http.post(f"/projects/documents/{page_id}/move", json=body)
                assert (refused.status_code, refused.json()['detail']) == (status, detail)
            # A page in a project stays in one: there is no move back to personal, and the body is checked.
            for body in ({'project_id': None}, {}, {'project_id': ops['id'], 'parent_id': None}):
                assert (await http.post(f"/projects/documents/{plan['id']}/move", json=body)).status_code == 422

            async with client(workspace=OTHER) as stranger:
                theirs = (await stranger.post('/projects', json={'name': 'Theirs', 'key': 'TH'})).json()
                assert (await stranger.post(f"/projects/documents/{aside['id']}/move", json={'project_id': theirs['id']})).status_code == 404
                refused = await http.post(f"/projects/documents/{aside['id']}/move", json={'project_id': theirs['id']})
                assert (refused.status_code, refused.json()['detail']) == (403, 'Project not accessible')
                assert (await stranger.get(f"/projects/{theirs['id']}/documents")).json() == []
            assert (await http.get(f"/projects/documents/{aside['id']}")).json()['project_id'] is None

    asyncio.run(scenario())


@pytest.fixture
def app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))
    monkeypatch.setenv('PANEL_A2A_ENABLED', '1')
    monkeypatch.setattr(teaching, '_service', TeachingService(tmp_path / 'teaching'))
    application = FastAPI()
    application.include_router(router)
    application.include_router(teaching_router)
    return application


@pytest.mark.asyncio
async def test_a_personal_page_publishes_as_a_skill(app: FastAPI) -> None:
    async with client(app) as http:
        voice = (await http.post('/projects/documents', json={'title': 'Voice guide', 'content': '<p>Short sentences.</p>'})).json()
        page = (await http.post('/projects/documents', json={'title': 'Weekly brief',
                                                              'content': skill_page().replace('{doc}', voice['id'])})).json()
        assert page['project_id'] is None
        assert (await http.get(f"/projects/documents/{page['id']}/skill", params=GUEST)).json() == {'skill': None}

        published = await http.post(f"/projects/documents/{page['id']}/skill", json=GUEST)
        assert published.status_code == 200, published.text
        skill_id = f"doc-{page['id'].replace('-', '')}"
        assert published.json()['status'] == 'published' and published.json()['skill']['id'] == skill_id
        reference = f"references/voice-guide-{voice['id'].replace('-', '')[:8]}.md"
        assert reference in published.json()['skill']['files']
        listed = (await http.get('/teaching/skills', params=GUEST)).json()['skills']
        assert [(item['id'], item['name']) for item in listed] == [(skill_id, 'weekly-brief')]
        assert (await http.get(f"/projects/documents/{page['id']}/skill", params=GUEST)).json()['skill']['current'] is True

        service = teaching.get_teaching_service()
        manifest = await service.read_skill('default', 'panel', skill_id)
        assert manifest['source_document'] == {'id': page['id'], 'project_id': None, 'title': 'Weekly brief', 'version': 1}
        directory = service.root / _scope('default', 'panel') / 'skills' / skill_id / 'weekly-brief'
        assert Skill.from_file(directory, strict=True).name == 'weekly-brief'
        assert (directory / reference).read_text().startswith('# Voice guide')

        # Another workspace cannot publish my personal page.
        async with client(app, workspace=OTHER) as stranger:
            assert (await stranger.post(f"/projects/documents/{page['id']}/skill", json=GUEST)).status_code == 404
