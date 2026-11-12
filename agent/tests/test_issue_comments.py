"""Issue comments (021_issue_comments.sql) end to end: the real Projects router and the real guest SQLite workspace
(X-Ron-Workspace), plus the ProjectService methods the agents' tools call. No Supabase account or connection."""
import asyncio
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from starlette.requests import Request

from agent.api.core.projects import COMMENT_MAX, ProjectService, project_identity
from agent.api.endpoints.projects import router

WORKSPACE = 'c' * 64


def client(workspace: str = WORKSPACE) -> httpx.AsyncClient:
    app = FastAPI()
    app.include_router(router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                             headers={'X-Ron-Workspace': workspace})


async def service(workspace: str = WORKSPACE) -> ProjectService:
    return ProjectService(await project_identity(Request({'type': 'http', 'headers': [(b'x-ron-workspace', workspace.encode())]})))


def test_people_comment_on_an_issue_then_edit_and_delete_their_comments(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        me = (await service()).identity.user_id
        async with client() as http:
            project = (await http.post('/projects', json={'name': 'Talk', 'key': 'TALK'})).json()
            issue = (await http.post('/projects/issues', json={'project_id': project['id'], 'type': 'task', 'title': 'Discuss'})).json()
            base = f"/projects/issues/{issue['id']}/comments"
            assert (await http.get(base)).json() == []

            created = await http.post(base, json={'body': '  Looks good to me.\n'})
            assert created.status_code == 200, created.text
            first = created.json()
            # The store stamps the identity: author, display name, the issue's project; the body is trimmed.
            assert first == {'id': first['id'], 'issue_id': issue['id'], 'project_id': project['id'], 'author_id': me,
                             'author_name': 'You', 'author_kind': 'user', 'agent_name': None, 'body': 'Looks good to me.',
                             'version': 1, 'created_at': first['created_at'], 'updated_at': first['created_at'], 'edited_at': None}
            second = (await http.post(base, json={'body': 'Second thought'})).json()
            longest = await http.post(base, json={'body': f"  {'x' * COMMENT_MAX}  "})
            assert longest.status_code == 200 and len(longest.json()['body']) == COMMENT_MAX
            assert [row['id'] for row in (await http.get(base)).json()] == [first['id'], second['id'], longest.json()['id']]
            assert [row['id'] for row in (await http.get(base, params={'offset': 1, 'limit': 1})).json()] == [second['id']]

            # A person cannot post an agent's comment or choose the author, and blank or oversized bodies are 422s.
            assert (await http.post(base, json={'body': 'Forged', 'author_kind': 'agent', 'agent_name': 'Ren'})).status_code == 422
            assert (await http.post(base, json={'body': 'Forged', 'author_id': str(uuid4())})).status_code == 422
            for body in ('', '   \n\t', 'x' * (COMMENT_MAX + 1)):
                assert (await http.post(base, json={'body': body})).status_code == 422

            # Edits replace the body at the current version; a stale version is a 409.
            edited = await http.patch(f"/projects/comments/{first['id']}", json={'version': 1, 'body': 'Looks great.'})
            assert edited.status_code == 200, edited.text
            assert edited.json()['body'] == 'Looks great.' and edited.json()['version'] == 2 and edited.json()['edited_at']
            assert edited.json()['created_at'] == first['created_at'] and edited.json()['author_id'] == me
            stale = await http.patch(f"/projects/comments/{first['id']}", json={'version': 1, 'body': 'Lost update'})
            assert stale.status_code == 409 and stale.json()['detail'].startswith("Comment changed or you can't edit it")
            assert (await http.patch(f"/projects/comments/{first['id']}", json={'version': 2, 'body': '  '})).status_code == 422
            assert (await http.patch(f"/projects/comments/{first['id']}", json={'version': 2, 'body': 'x', 'author_kind': 'agent'})).status_code == 422
            assert (await http.get(base)).json()[0]['body'] == 'Looks great.'

            # Another workspace sees neither the issue nor its comments, and cannot change them.
            async with client('d' * 64) as stranger:
                assert (await stranger.get(base)).status_code == 404
                assert (await stranger.post(base, json={'body': 'Hello?'})).status_code == 404
                assert (await stranger.patch(f"/projects/comments/{second['id']}", json={'version': 1, 'body': 'Mine now'})).status_code == 409
                assert (await stranger.delete(f"/projects/comments/{second['id']}")).status_code == 404
            assert (await http.get(f"/projects/issues/{uuid4()}/comments")).status_code == 404
            assert (await http.post(f"/projects/issues/{uuid4()}/comments", json={'body': 'Nowhere'})).status_code == 404

            assert (await http.delete(f"/projects/comments/{second['id']}")).json() == {'deleted': True}
            assert (await http.delete(f"/projects/comments/{second['id']}")).status_code == 404
            assert [row['id'] for row in (await http.get(base)).json()] == [first['id'], longest.json()['id']]

        # A new connection reads the same comments from disk.
        async with client() as http:
            assert [row['body'] for row in (await http.get(base)).json()][0] == 'Looks great.'

    asyncio.run(scenario())


def test_agents_comment_under_their_name_and_their_comments_are_deleted_never_edited(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        projects = await service()
        project = (await projects.request('POST', 'projects', body={'name': 'Agents', 'key': 'AGT'}))[0]
        issue = await projects.create_issue({'project_id': project['id'], 'type': 'task', 'title': 'Split the work'})

        note = await projects.add_comment(issue['id'], '\nI split the work into three subtasks.\n', agent_name=' Issue agent ')
        assert (note['author_kind'], note['agent_name'], note['author_id']) == ('agent', 'Issue agent', projects.identity.user_id)
        assert note['body'] == 'I split the work into three subtasks.' and note['project_id'] == project['id']
        person = await projects.add_comment(issue['id'], 'Thanks!', agent_name='   ')
        assert (person['author_kind'], person['agent_name']) == ('user', None)
        assert [row['id'] for row in await projects.comments(issue['id'])] == [note['id'], person['id']]

        for call, status in ((lambda: projects.add_comment(issue['id'], 'x', agent_name='a' * 121), 422),
                             (lambda: projects.add_comment(issue['id'], ' '), 422),
                             (lambda: projects.add_comment(str(uuid4()), 'No issue', agent_name='Project agent'), 404),
                             (lambda: projects.comments(str(uuid4())), 404)):
            with pytest.raises(HTTPException) as error:
                await call()
            assert error.value.status_code == status
        # The store keeps the agent rule itself: an agent's comment carries its name, a person's none.
        for body in ({'author_kind': 'agent'}, {'author_kind': 'user', 'agent_name': 'Ren'}, {'author_kind': 'bot', 'agent_name': 'Ren'}):
            with pytest.raises(HTTPException) as error:
                await projects.request('POST', 'issue_comments', body={'issue_id': issue['id'], 'body': 'Rule', **body})
            assert error.value.status_code == 422
        # Only the body of a comment ever changes.
        with pytest.raises(HTTPException) as error:
            await projects.request('PATCH', 'issue_comments', params={'id': f"eq.{person['id']}"}, body={'author_kind': 'agent'})
        assert error.value.status_code == 422 and error.value.detail == 'Comment identity is immutable'

        async with client() as http:
            refused = await http.patch(f"/projects/comments/{note['id']}", json={'version': 1, 'body': 'Rewritten by a person'})
            assert refused.status_code == 403 and refused.json()['detail'] == "Agent comments can't be edited"
            assert (await http.get(f"/projects/issues/{issue['id']}/comments")).json()[0]['body'] == note['body']
            assert (await http.delete(f"/projects/comments/{note['id']}")).json() == {'deleted': True}
        assert [row['id'] for row in await projects.comments(issue['id'])] == [person['id']]
        # Its author edits a person's comment through the same service.
        assert (await projects.edit_comment(person['id'], 1, 'Thanks, all!'))['version'] == 2

    asyncio.run(scenario())
