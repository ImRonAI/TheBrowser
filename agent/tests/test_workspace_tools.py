"""Agent tools over Ren Projects, called as the real native tools against the real guest SQLite workspace
(X-Ron-Workspace): the issue agent's comments (issue_tools), the project agent's comments (project_agent_tools) and
Ren's workspace tools (core/workspace_tools.py), ending with a project created from a personal document.
No Supabase account, token, model or network."""
import asyncio
import json
import re
from pathlib import Path
from uuid import uuid4

from starlette.requests import Request

from agent.api.core import issue_agents, project_agent, workspace_tools
from agent.api.core.issue_agents import ISSUE_AGENT_NAME, issue_tools
from agent.api.core.projects import COMMENT_MAX, ProjectService, project_identity
from agent.tests.test_panel_tools import call_tool

ROOT = Path(__file__).resolve().parents[2]
WORKSPACE, STRANGER = 'a' * 64, 'b' * 64

PLAN = ('# Beta launch\n\nShip the **beta** to 20 testers.\n\n## Work\n\n'
        '- Invite testers\n- Collect feedback')


async def guest(workspace: str = WORKSPACE) -> ProjectService:
    """The Projects API's own identity check for a guest workspace capability."""
    return ProjectService(await project_identity(Request({'type': 'http', 'headers': [(b'x-ron-workspace', workspace.encode())]})))


async def run(value, **inputs):
    """Call a native tool: ('success', decoded JSON) or ('error', the text the agent reads)."""
    _, result = await call_tool(value, inputs)
    text = result['content'][0]['text']
    return result['status'], json.loads(text) if result['status'] == 'success' else text


def test_issue_agents_read_the_whole_discussion_and_comment_as_the_issue_agent(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))
    # Small pages, so reading the discussion has to follow every page to its end.
    monkeypatch.setattr(issue_agents, 'COMMENT_PAGE', 2)

    async def scenario():
        service = await guest()
        project = (await service.request('POST', 'projects', body={'name': 'Talk', 'key': 'TALK'}))[0]
        issue = await service.create_issue({'project_id': project['id'], 'type': 'task', 'title': 'Discuss'})
        other = await service.create_issue({'project_id': project['id'], 'type': 'task', 'title': 'Elsewhere'})
        tools = {value.tool_name: value for value in issue_tools(service, issue)}

        assert await run(tools['read_comments']) == ('success', [])
        people = [await service.add_comment(issue['id'], f'Question {n}') for n in range(1, 5)]
        await service.add_comment(other['id'], 'About another issue')
        status, posted = await run(tools['add_comment'], body_markdown='  Split into **three** subtasks.\n')
        assert status == 'success' and posted['body'] == 'Split into **three** subtasks.'
        # Stored as the agent's comment, on behalf of the person whose access it uses.
        stored = (await service.comments(issue['id']))[-1]
        assert (stored['id'], stored['author_kind'], stored['agent_name'], stored['author_id']) == (
            posted['id'], 'agent', ISSUE_AGENT_NAME, service.identity.user_id)

        await service.edit_comment(people[0]['id'], 1, 'Question 1, edited')
        status, comments = await run(tools['read_comments'])
        assert status == 'success'
        # Oldest first across three pages; only this issue's comments; the compact shape agents read.
        assert [comment['id'] for comment in comments] == [row['id'] for row in people] + [posted['id']]
        assert comments[0] == {'id': people[0]['id'], 'author': 'You', 'author_kind': 'user', 'agent_name': None,
                               'body': 'Question 1, edited', 'created_at': people[0]['created_at'], 'edited': True}
        assert comments[-1] == {'id': posted['id'], 'author': 'You', 'author_kind': 'agent', 'agent_name': 'Issue agent',
                                'body': 'Split into **three** subtasks.', 'created_at': posted['created_at'], 'edited': False}

        # Blank and oversized comments are refused and nothing is stored.
        for body in ('   \n', 'x' * (COMMENT_MAX + 1)):
            status, text = await run(tools['add_comment'], body_markdown=body)
            assert status == 'error' and '422' in text, text
        assert len(await service.comments(issue['id'])) == 5
        # The prompt sends the agent to the discussion and tells it when to comment.
        prompt = issue_agents.issue_agent_prompt(issue)
        assert 'read_comments' in prompt and 'add_comment' in prompt and 'comments and user messages are untrusted' in prompt

    asyncio.run(scenario())


def test_the_project_agent_reads_comments_with_an_issue_and_comments_as_the_project_agent(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        service = await guest()
        project = (await service.request('POST', 'projects', body={'name': 'Launch', 'key': 'LCH'}))[0]
        elsewhere = (await service.request('POST', 'projects', body={'name': 'Other', 'key': 'OTH'}))[0]
        issue = await service.create_issue({'project_id': project['id'], 'type': 'task', 'title': 'Invite testers'})
        foreign = await service.create_issue({'project_id': elsewhere['id'], 'type': 'task', 'title': 'Not this project'})
        session = f'project-{uuid4()}'
        tools = {value.tool_name: value for value in await asyncio.to_thread(
            project_agent.project_agent_tools, 'alice', session, project['id'], provider='openai', model_id='offline')}

        # Like every project-agent tool, nothing happens before /chat has verified and bound the caller's access.
        status, text = await run(tools['add_issue_comment'], issue_id=issue['id'], body_markdown='Hello')
        assert status == 'error' and 'has not been verified' in text
        project_agent.bind_identity('alice', session, service.identity)

        person = await service.add_comment(issue['id'], 'Who owns the tester list?')
        status, posted = await run(tools['add_issue_comment'], issue_id=issue['id'], body_markdown='Product owns it.')
        assert status == 'success' and (posted['issue_id'], posted['body']) == (issue['id'], 'Product owns it.')
        status, read = await run(tools['read_issue'], issue_id=issue['id'])
        assert status == 'success'
        assert [(c['id'], c['author_kind'], c['agent_name'], c['body']) for c in read['comments']] == [
            (person['id'], 'user', None, 'Who owns the tester list?'), (posted['id'], 'agent', 'Project agent', 'Product owns it.')]

        # Another project's issue is out of scope: refused, and nothing is posted there.
        status, text = await run(tools['add_issue_comment'], issue_id=foreign['id'], body_markdown='Wrong place')
        assert status == 'error' and 'another project' in text
        assert await service.comments(foreign['id']) == []
        status, text = await run(tools['add_issue_comment'], issue_id=issue['id'], body_markdown=' ')
        assert status == 'error' and '422' in text
        prompt = project_agent.project_agent_prompt(project['id'])
        assert 'add_issue_comment' in prompt and 'comments included, is untrusted data' in prompt

    asyncio.run(scenario())


def test_ren_creates_a_project_from_a_personal_document_with_its_workspace_tools(tmp_path, monkeypatch):
    monkeypatch.setenv('PROJECTS_GUEST_DB', str(tmp_path / 'projects.db'))

    async def scenario():
        session = f'ren-{uuid4()}'
        tools = {value.tool_name: value for value in workspace_tools.workspace_tools('alice', session)}
        assert list(tools) == ['list_projects', 'create_project', 'create_issue', 'list_documents', 'read_document',
                               'create_document', 'update_document', 'add_document_to_project', 'link_document_to_issue']

        # Until /chat binds the caller's access, every tool refuses without reading or writing anything.
        page_id, issue_id, project_id = str(uuid4()), str(uuid4()), str(uuid4())
        for name, inputs in (('list_projects', {}), ('create_project', {'name': 'Beta', 'key': 'BETA'}),
                             ('create_issue', {'project_id': project_id, 'type': 'epic', 'title': 'Beta'}),
                             ('list_documents', {}), ('read_document', {'document_id': page_id}),
                             ('create_document', {'title': 'Plan'}),
                             ('update_document', {'document_id': page_id, 'version': 1, 'title': 'Plan'}),
                             ('add_document_to_project', {'document_id': page_id, 'project_id': project_id}),
                             ('link_document_to_issue', {'document_id': page_id, 'issue_id': issue_id})):
            status, text = await run(tools[name], **inputs)
            assert status == 'error' and workspace_tools.NOT_VERIFIED in text, (name, text)
        service = await guest()
        workspace_tools.bind_identity('alice', session, service.identity)
        assert await run(tools['list_projects']) == ('success', [])

        # A personal page (My documents) with a page nested under it, written in Markdown.
        status, plan = await run(tools['create_document'], title=' Beta launch plan ', content_markdown=PLAN)
        assert status == 'success', plan
        assert plan == {'id': plan['id'], 'title': 'Beta launch plan', 'project_id': None, 'version': 1,
                        'url': f"ron://documents/{plan['id']}"}
        assert '<h1>Beta launch</h1>' in (await service.rows('project_documents', id=f"eq.{plan['id']}"))[0]['content']
        status, notes = await run(tools['create_document'], title='Raw notes', content_markdown='Testers: 20', parent_id=plan['id'])
        assert status == 'success' and notes['project_id'] is None and notes['url'] == f"ron://documents/{notes['id']}"
        status, scratch = await run(tools['create_document'], title='Scratch')
        assert status == 'success'
        status, read = await run(tools['read_document'], document_id=plan['id'])
        assert read == {'id': plan['id'], 'title': 'Beta launch plan', 'project_id': None, 'version': 1, 'markdown': PLAN}

        # create_project validates like the Projects API: a known type, a key matching the API's pattern, unique keys.
        status, text = await run(tools['create_project'], name='Beta', key='BETA', type='rocket-science')
        assert status == 'error' and 'type must be one of' in text and 'product-discovery' in text
        status, text = await run(tools['create_project'], name='Beta', key='9BETA')
        assert status == 'error' and 'key' in text
        status, project = await run(tools['create_project'], name=' Beta launch ', key='beta', type='product-discovery',
                                    summary='Ship the beta to 20 testers.')
        assert status == 'success', project
        assert {key: project[key] for key in ('key', 'name', 'type')} == {'key': 'BETA', 'name': 'Beta launch', 'type': 'product-discovery'}
        assert {item['key']: item['level'] for item in project['issue_types']} == {
            'initiative': 1, 'epic': 2, 'story': 3, 'task': 4, 'bug': 4, 'subtask': 5}
        status, text = await run(tools['create_project'], name='Again', key='BETA')
        assert status == 'error' and '409' in text
        status, projects = await run(tools['list_projects'])
        assert [{key: row[key] for key in ('id', 'key', 'name', 'type', 'lifecycle', 'summary')} for row in projects] == [
            {'id': project['id'], 'key': 'BETA', 'name': 'Beta launch', 'type': 'product-discovery', 'lifecycle': 'active',
             'summary': 'Ship the beta to 20 testers.'}]
        assert projects[0]['issue_types'] == project['issue_types']

        # Issues top-down, each exactly one level below its parent; the description is stored as editor HTML.
        status, epic = await run(tools['create_issue'], project_id=project['id'], type='epic', title='Beta launch',
                                 description_markdown='## Goal\n\n- **20** testers')
        assert status == 'success', epic
        assert {key: epic[key] for key in ('key', 'number', 'type', 'title', 'parent_id', 'version')} == {
            'key': 'BETA-1', 'number': 1, 'type': 'epic', 'title': 'Beta launch', 'parent_id': None, 'version': 1}
        status, story = await run(tools['create_issue'], project_id=project['id'], type='story', title='Invite testers',
                                  parent_id=epic['id'], priority='high', labels=['beta'])
        assert status == 'success' and (story['key'], story['parent_id']) == ('BETA-2', epic['id'])
        status, task = await run(tools['create_issue'], project_id=project['id'], type='task', title='Send invites',
                                 parent_id=story['id'])
        assert status == 'success' and (task['key'], task['parent_id']) == ('BETA-3', story['id'])
        stored = await service.issue(epic['id'])
        assert '<h2>Goal</h2>' in stored['description'] and '<strong>20</strong>' in stored['description']
        stored = await service.issue(story['id'])
        assert (stored['status'], stored['priority'], stored['labels']) == ('backlog', 'high', ['beta'])
        # The hierarchy is the project's: a subtask needs a parent one level up, and parents stay in the project.
        status, text = await run(tools['create_issue'], project_id=project['id'], type='subtask', title='Orphan')
        assert status == 'error' and 'Subtasks require a parent' in text
        status, text = await run(tools['create_issue'], project_id=project['id'], type='subtask', title='Skips', parent_id=epic['id'])
        assert status == 'error' and 'exactly one level' in text
        status, text = await run(tools['create_issue'], project_id=project['id'], type='story', title='Bad', priority='urgent')
        assert status == 'error' and 'priority' in text
        status, other = await run(tools['create_project'], name='Other work', key='OTHER', type='research')
        assert status == 'success'
        status, foreign = await run(tools['create_issue'], project_id=other['id'], type='epic', title='Elsewhere')
        assert status == 'success' and foreign['key'] == 'OTHER-1'
        status, text = await run(tools['create_issue'], project_id=project['id'], type='story', title='Cross', parent_id=foreign['id'])
        assert status == 'error' and 'another project' in text
        assert len(await service.rows('issues', project_id=f"eq.{project['id']}")) == 3

        # The document joins the new project, with the page nested under it; the scratch page stays personal.
        status, moved = await run(tools['add_document_to_project'], document_id=plan['id'], project_id=project['id'])
        assert status == 'success', moved
        assert moved == {'id': plan['id'], 'title': 'Beta launch plan', 'project_id': project['id'],
                         'url': f"ron://project/{project['id']}/docs/{plan['id']}"}
        status, text = await run(tools['add_document_to_project'], document_id=plan['id'], project_id=project['id'])
        assert status == 'error' and 'already in that project' in text
        status, pages = await run(tools['list_documents'], project_id=project['id'])
        assert status == 'success'
        assert {(page['id'], page['project_key'], page['parent_id']) for page in pages} == {
            (plan['id'], 'BETA', None), (notes['id'], 'BETA', plan['id'])}
        status, personal = await run(tools['list_documents'], project_id='personal')
        assert [(page['id'], page['project_id'], page['project_key']) for page in personal] == [(scratch['id'], None, None)]
        assert (await run(tools['list_documents'], project_id=' Personal '))[1] == personal
        status, text = await run(tools['list_documents'], project_id='BETA')
        assert status == 'error' and "'BETA' is not a project id; use an id from list_projects" in text
        status, everything = await run(tools['list_documents'])
        assert {page['id'] for page in everything} == {plan['id'], notes['id'], scratch['id']}
        updated = [page['updated_at'] for page in everything]
        assert updated == sorted(updated, reverse=True), 'most recently changed first'
        status, read = await run(tools['read_document'], document_id=plan['id'])
        assert (read['project_id'], read['version'], read['markdown']) == (project['id'], 2, PLAN)

        # A new page in the project; a page nested under it follows its project, never another one.
        status, brief = await run(tools['create_document'], title='Tester brief', content_markdown='Welcome!', project_id=project['id'])
        assert status == 'success' and brief['url'] == f"ron://project/{project['id']}/docs/{brief['id']}"
        status, faq = await run(tools['create_document'], title='FAQ', parent_id=brief['id'])
        assert status == 'success' and faq['project_id'] == project['id']
        status, text = await run(tools['create_document'], title='Astray', parent_id=brief['id'], project_id=other['id'])
        assert status == 'error' and "parent page's project" in text

        # Saving a page uses its latest version; a stale version is a conflict, an empty change a mistake.
        status, saved = await run(tools['update_document'], document_id=plan['id'], version=2,
                                  content_markdown=PLAN + '\n\nTracked in BETA.')
        assert status == 'success' and saved == {'id': plan['id'], 'title': 'Beta launch plan', 'version': 3}
        status, text = await run(tools['update_document'], document_id=plan['id'], version=2, title='Stale')
        assert status == 'error' and '409' in text and 'changed elsewhere' in text
        status, text = await run(tools['update_document'], document_id=plan['id'], version=3)
        assert status == 'error' and 'Pass a new title' in text
        status, renamed = await run(tools['update_document'], document_id=plan['id'], version=3, title='Beta launch')
        assert status == 'success' and renamed == {'id': plan['id'], 'title': 'Beta launch', 'version': 4}
        status, read = await run(tools['read_document'], document_id=plan['id'])
        assert (read['title'], read['version'], read['markdown']) == ('Beta launch', 4, PLAN + '\n\nTracked in BETA.')

        # The page lists the issue and the issue the page (document_issue_links); a pair links once.
        status, link = await run(tools['link_document_to_issue'], document_id=plan['id'], issue_id=epic['id'])
        assert status == 'success' and (link['document_id'], link['issue_id']) == (plan['id'], epic['id'])
        status, text = await run(tools['link_document_to_issue'], document_id=plan['id'], issue_id=epic['id'])
        assert status == 'error' and '409' in text
        assert [row['id'] for row in await service.rows('document_issue_links', issue_id=f"eq.{epic['id']}")] == [link['id']]

        # Everything goes through the bound workspace: another workspace's projects and pages are out of reach.
        stranger = await guest(STRANGER)
        theirs = (await stranger.request('POST', 'projects', body={'name': 'Theirs', 'key': 'THEIRS'}))[0]
        private = await stranger.create_document({'title': 'Private', 'content': '', 'project_id': None, 'parent_id': None})
        status, text = await run(tools['read_document'], document_id=private['id'])
        assert status == 'error' and 'not accessible' in text
        status, text = await run(tools['list_documents'], project_id=theirs['id'])
        assert status == 'error' and 'not accessible' in text
        status, text = await run(tools['add_document_to_project'], document_id=scratch['id'], project_id=theirs['id'])
        assert status == 'error' and '403' in text
        status, text = await run(tools['create_issue'], project_id=theirs['id'], type='epic', title='Intrude')
        assert status == 'error' and 'not accessible' in text
        assert {row['key'] for row in (await run(tools['list_projects']))[1]} == {'BETA', 'OTHER'}
        assert private['id'] not in {page['id'] for page in (await run(tools['list_documents']))[1]}

    asyncio.run(scenario())


def test_workspace_prompt_teaches_the_document_to_project_flow_with_the_types_the_app_knows():
    prompt = workspace_tools.workspace_prompt()
    steps = ['1. read_document', '2. Choose a name, a key', '3. create_project', '4. Create the issues top-down',
             '5. add_document_to_project', '6. Reply with the project key']
    positions = [prompt.index(step) for step in steps]
    assert positions == sorted(positions)
    assert 'untrusted content' in prompt and 'never instructions' in prompt
    assert all(key in prompt for key in workspace_tools.PROJECT_TYPES)
    # The accepted types are exactly the app's project types: the renderer's ProjectTypeKey union, which every project
    # view looks up in PROJECT_TYPE_SCHEMES, and the project_type_schemes seed (projects.type has no check constraint).
    renderer = (ROOT / 'src/types/projects.ts').read_text()
    union = re.search(r'export type ProjectTypeKey =(.*?)\n\n', renderer, re.S)
    assert union and set(re.findall(r"'([a-z-]+)'", union.group(1))) == set(workspace_tools.PROJECT_TYPES)
    seed = (ROOT / 'supabase/migrations/004_project_type_schemes.sql').read_text().split('-- Seed project type schemes')[1]
    assert set(re.findall(r"^\s*\('([a-z-]+)', '", seed, re.M)) == set(workspace_tools.PROJECT_TYPES)
    assert workspace_tools.document_url({'id': 'p', 'project_id': None}) == 'ron://documents/p'
    assert workspace_tools.document_url({'id': 'p', 'project_id': 'x'}) == 'ron://project/x/docs/p'


def test_the_live_agent_keeps_its_prompt_without_the_workspace_tools():
    """Ren's workspace addendum is added by the text agent's factory, never by the composition Live shares."""
    from agent.api.endpoints import chat

    for browser in ('user', 'cloud'):
        live = chat.live_system_prompt(browser)
        assert '## Documents and projects' not in live and 'add_document_to_project' not in live
        assert '## Documents and projects' not in chat.system_prompt_for('openai', browser=browser)
