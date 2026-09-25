"""Native Strands/A2A integration with an in-memory RLS transport double."""
import asyncio
import copy
import json
from dataclasses import replace
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from agent.api.core import issue_agents
from agent.api.core.issue_agent_storage import IssueAgentStorage
from agent.api.core.issue_agents import IssueAgentRuntime, issue_tools
from agent.api.core.projects import ProjectIdentity, project_identity
from agent.api.endpoints.projects import router
from agent.tests.test_panel_tools import OfflineModel, call_tool


class Database:
    def __init__(self):
        self.agents, self.runs, self.blobs = {}, {}, {}
        self.issues = {}
        self.access = set()

    def service(self, user=None, issue=None):
        user, issue = user or str(uuid4()), issue or str(uuid4())
        self.issues.setdefault(issue, {"id": issue, "project_id": str(uuid4()), "version": 1, "title": "Test issue"})
        self.access.add((user, issue))
        return Service(self, user), issue


class Service:
    def __init__(self, db, user):
        self.db = db
        self.identity = ProjectIdentity(user, 'user-jwt', 'https://offline.invalid', 'public')

    async def issue(self, issue_id):
        if (self.identity.user_id, issue_id) not in self.db.access:
            raise HTTPException(404, "Issue not accessible")
        return copy.deepcopy(self.db.issues[issue_id])

    def allowed(self, agent_id):
        agent = self.db.agents.get(agent_id)
        return agent and agent['user_id'] == self.identity.user_id and (agent['user_id'], agent['issue_id']) in self.db.access

    async def rows(self, table, **filters):
        return await self.request('GET', table, params=filters)

    async def request(self, method, resource, *, params=None, body=None):
        params = params or {}
        if resource == 'rpc/start_issue_agent_run':
            await self.issue(body['p_issue'])
            agent = next((a for a in self.db.agents.values() if a['issue_id'] == body['p_issue'] and a['user_id'] == self.identity.user_id), None)
            if not agent:
                agent = {'id': str(uuid4()), 'issue_id': body['p_issue'], 'user_id': self.identity.user_id,
                         'provider': body['p_provider'], 'model_id': body['p_model']}
                self.db.agents[agent['id']] = agent
            if any(r['agent_id'] == agent['id'] and r['status'] == 'running' for r in self.db.runs.values()):
                raise HTTPException(409, 'Already running')
            run = {'id': str(uuid4()), 'agent_id': agent['id'], 'message': body['p_message'], 'output': '',
                   'status': 'running', 'error': None, 'created_at': datetime.now(timezone.utc).isoformat()}
            self.db.runs[run['id']] = run
            return copy.deepcopy({'agent': agent, 'run': run})
        if resource == 'rpc/put_issue_agent_blob':
            if not self.allowed(body['p_agent']):
                raise HTTPException(403, 'Snapshot access denied')
            self.db.blobs[(body['p_agent'], body['p_key'])] = body['p_payload']
            return None
        if resource == 'issue_agents':
            candidates = [a for a in self.db.agents.values() if self.allowed(a['id'])]
        elif resource == 'issue_agent_runs':
            candidates = [r for r in self.db.runs.values() if self.allowed(r['agent_id'])]
        elif resource == 'issue_agent_blobs':
            candidates = [{'agent_id': a, 'key': k, 'payload': v} for (a, k), v in self.db.blobs.items() if self.allowed(a)]
        else:
            raise AssertionError(resource)
        for key, value in params.items():
            if isinstance(value, str) and value.startswith('eq.'):
                candidates = [row for row in candidates if str(row.get(key)) == value[3:]]
        if method == 'PATCH':
            for row in candidates:
                row.update(body)
        elif method == 'DELETE':
            for row in candidates:
                del self.db.blobs[(row['agent_id'], row['key'])]
        if params.get('order', '').startswith('created_at'):
            candidates.sort(key=lambda row: row['created_at'], reverse=True)
        offset = int(params.get('offset', 0))
        limit = int(params.get('limit', len(candidates)))
        return copy.deepcopy(candidates[offset:offset + limit])

    async def update_issue(self, issue_id, version, values):
        issue = await self.issue(issue_id)
        if version != issue['version']:
            raise HTTPException(409, 'Version conflict')
        issue.update(values, version=version + 1)
        self.db.issues[issue_id] = issue
        return issue

    async def create_issue(self, values):
        return values


def configured(monkeypatch):
    monkeypatch.setattr(issue_agents, 'default_selection', lambda: ('openai', 'offline'))


def test_goal_uses_native_judge_and_revises_before_completion(monkeypatch):
    configured(monkeypatch)

    class JudgeModel(OfflineModel):
        async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
            self.calls.append(messages)
            passed = len(self.calls) >= 2
            name = next(t['name'] for t in tool_specs if t['name'] == 'JudgeOutcome')
            yield {'messageStart': {'role': 'assistant'}}
            yield {'contentBlockStart': {'contentBlockIndex': 0, 'start': {'toolUse': {'toolUseId': str(uuid4()), 'name': name}}}}
            yield {'contentBlockDelta': {'contentBlockIndex': 0, 'delta': {'toolUse': {'input': json.dumps({'passed': passed, 'feedback': None if passed else 'Revise the description.'})}}}}
            yield {'contentBlockStop': {'contentBlockIndex': 0}}
            yield {'messageStop': {'stopReason': 'tool_use'}}

    async def scenario():
        db = Database()
        owner, issue = db.service()
        worker, judge = OfflineModel('Description'), JudgeModel()
        runtime = IssueAgentRuntime(lambda *a, **k: worker if k['hosted_tools'] else judge)
        record = await runtime.start(owner, issue, '/goal Write a complete description')
        await asyncio.wait_for(asyncio.gather(*(r.task for r in runtime.active.values())), 10)
        assert db.runs[record['run']['id']]['status'] == 'completed'
        assert len(worker.calls) == 2
        assert len(judge.calls) == 2
        history = await runtime.history(owner, issue)
        verdict = history['runs'][0]['activity'][-1]
        assert verdict['name'] == 'goal_judge'
        assert verdict['result']['passed'] is True
        assert len(verdict['result']['attempts']) == 2
        await runtime.shutdown()

    asyncio.run(scenario())


def test_native_a2a_durable_restart_task_and_user_isolation(monkeypatch):
    configured(monkeypatch)

    async def scenario():
        db = Database()
        owner, first = db.service()
        _, second = db.service(owner.identity.user_id)
        member, _ = db.service(issue=first)
        models = []

        def model_factory(provider, model_id, **kwargs):
            assert kwargs == {'hosted_tools': True}
            model = OfflineModel('task reply')
            models.append(model)
            return model

        runtime = IssueAgentRuntime(model_factory)
        record = await runtime.start(owner, first, 'private-first')
        await asyncio.gather(*(run.task for run in runtime.active.values()))
        assert db.runs[record['run']['id']]['status'] == 'completed'
        assert db.runs[record['run']['id']]['output'] == 'task reply'
        assert any('snapshot_latest' in key for _, key in db.blobs)
        assert any(key.startswith('a2a/') for _, key in db.blobs)
        assert {t['name'] for t in models[0].calls[0]['tools']} == {'read_issue', 'update_issue', 'edit_issue', 'create_child', 'read_issue_context', 'link_issue', 'save_work_product'}
        await runtime.shutdown()

        restarted = IssueAgentRuntime(model_factory)
        resumed = await restarted.start(owner, first, 'second turn')
        await asyncio.gather(*(run.task for run in restarted.active.values()))
        assert resumed['agent']['id'] == record['agent']['id']
        assert 'private-first' in json.dumps(models[1].calls[0]['messages'])
        await restarted.start(owner, second, 'different-task')
        await asyncio.gather(*(run.task for run in restarted.active.values()))
        assert 'private-first' not in json.dumps(models[2].calls[0]['messages'])
        assert (await restarted.history(member, first))['runs'] == []
        await restarted.start(member, first, 'different-user')
        await asyncio.gather(*(run.task for run in restarted.active.values()))
        assert 'private-first' not in json.dumps(models[3].calls[0]['messages'])
        assert len(db.agents) == 3
        await restarted.shutdown()

    asyncio.run(scenario())


def test_concurrency_cancel_and_interrupted_recovery(monkeypatch):
    configured(monkeypatch)

    async def scenario():
        db = Database()
        owner, issue = db.service()
        entered, release = asyncio.Event(), asyncio.Event()
        runtime = IssueAgentRuntime(lambda *a, **k: OfflineModel(entered=entered, release=release))
        record = await runtime.start(owner, issue, 'blocked')
        await asyncio.wait_for(entered.wait(), 5)
        with pytest.raises(HTTPException) as conflict:
            await runtime.start(owner, issue, 'duplicate')
        assert conflict.value.status_code == 409
        assert (await runtime.history(owner, issue))['runs'][0]['status'] == 'running'
        tasks = [run.task for run in runtime.active.values()]
        await asyncio.wait_for(runtime.cancel(owner, issue), 5)
        release.set()
        await asyncio.wait_for(asyncio.gather(*tasks), 5)
        assert db.runs[record['run']['id']]['status'] == 'canceled'
        db.runs[record['run']['id']]['status'] = 'running'
        history = await runtime.history(owner, issue)
        assert history['runs'][0]['status'] == 'interrupted'
        await runtime.shutdown()

    asyncio.run(scenario())


def test_scope_tools_deny_completion_cross_task_and_stale_versions():
    async def scenario():
        db = Database()
        owner, issue = db.service()
        tools = {t.tool_name: t for t in issue_tools(owner, await owner.issue(issue))}
        for values in [{'status': 'done'}, {'project_id': str(uuid4())}, {'assignees': []}, {'parent_id': None}]:
            _, result = await call_tool(tools['update_issue'], {'version': 1, 'values': values})
            assert result['status'] == 'error'
        await call_tool(tools['update_issue'], {'version': 1, 'values': {'description': 'Saved'}})
        assert db.issues[issue]['description'] == 'Saved'
        _, edited = await call_tool(tools['edit_issue'], {'version': 2, 'values': {'description': 'Edited'}})
        assert edited['status'] == 'success'
        _, attachment = await call_tool(tools['save_work_product'], {'version': 3, 'title': 'Research',
            'content': 'Persistent findings', 'source_url': 'https://example.com', 'image_urls': ['https://example.com/preview.png']})
        assert attachment['status'] == 'success'
        assert db.issues[issue]['work_products'][0]['content'] == 'Persistent findings'
        for values in [{'version': 3, 'title': 'Stale', 'content': 'overwrite'},
                       {'version': 4, 'title': 'Unsafe', 'content': 'x', 'image_urls': ['javascript:alert(1)']}]:
            _, result = await call_tool(tools['save_work_product'], values)
            assert result['status'] == 'error'
        assert len(db.issues[issue]['work_products']) == 1
        _, child = await call_tool(tools['create_child'], {'type': 'subtask', 'title': 'Bound child'})
        assert child['status'] == 'success'
        assert 'backlog' in json.dumps(child) and 'medium' in json.dumps(child)
        assert issue in json.dumps(child)
        _, result = await call_tool(tools['update_issue'], {'version': 1, 'values': {'description': 'Stale'}})
        assert result['status'] == 'error'
        db.access.clear()
        _, result = await call_tool(tools['read_issue'], {})
        assert result['status'] == 'error'
        _, result = await call_tool(tools['create_child'], {'type': 'subtask', 'title': 'No access'})
        assert result['status'] == 'error'

    asyncio.run(scenario())


def test_storage_failure_cannot_report_completed(monkeypatch):
    configured(monkeypatch)

    async def scenario():
        db = Database()
        owner, issue = db.service()
        async def fail(*args, **kwargs):
            raise RuntimeError('Storage offline')
        monkeypatch.setattr(IssueAgentStorage, 'write', fail)
        runtime = IssueAgentRuntime(lambda *a, **k: OfflineModel())
        record = await runtime.start(owner, issue, 'test')
        await asyncio.wait_for(asyncio.gather(*(run.task for run in runtime.active.values())), 5)
        assert db.runs[record['run']['id']]['status'] == 'failed'
        await runtime.shutdown()

    asyncio.run(scenario())


@pytest.mark.parametrize('refresh_credentials', [False, True])
def test_detached_token_expiry_and_authorized_poll_refresh(monkeypatch, refresh_credentials):
    configured(monkeypatch)

    async def scenario():
        db = Database()
        owner, issue = db.service()
        entered, release = asyncio.Event(), asyncio.Event()
        expired = False
        original_request = owner.request

        async def authenticated_request(*args, **kwargs):
            if expired and owner.identity.token == 'user-jwt':
                raise HTTPException(401, 'JWT expired')
            return await original_request(*args, **kwargs)

        monkeypatch.setattr(owner, 'request', authenticated_request)
        model = OfflineModel(entered=entered, release=release)
        runtime = IssueAgentRuntime(lambda *a, **k: model)
        record = await runtime.start(owner, issue, 'Detached request')
        task = runtime.active[runtime.key(owner, issue)].task
        await asyncio.wait_for(entered.wait(), 5)
        expired = True
        refreshed = Service(db, owner.identity.user_id)
        refreshed.identity = replace(refreshed.identity, token='refreshed-jwt')
        if refresh_credentials:
            # Only an authorized poll for this same user and issue can update
            # the credentials shared by tools, native snapshots and the journal.
            await runtime.history(refreshed, issue)
            assert owner.identity.token == 'refreshed-jwt'
        release.set()
        await asyncio.wait_for(task, 5)
        assert not runtime.active
        assert len(model.calls) == 1
        if refresh_credentials:
            assert db.runs[record['run']['id']]['status'] == 'completed'
        else:
            # Expired credentials cannot mark a durable run successful. A fresh
            # authorized read recovers the orphan without replaying execution.
            assert db.runs[record['run']['id']]['status'] == 'running'
            history = await runtime.history(refreshed, issue)
            assert history['runs'][0]['status'] == 'interrupted'
            assert len(model.calls) == 1
        await runtime.shutdown()

    asyncio.run(scenario())


def test_issue_agent_routes_require_identity_and_reject_scope_inputs(monkeypatch):
    async def scenario():
        app = FastAPI()
        app.include_router(router)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            path = f'/projects/issues/{uuid4()}/agent'
            assert (await client.get(path)).status_code == 401
            assert (await client.post(path + '/messages', json={'message': 'Hello'})).status_code == 401
            assert (await client.post(path + '/cancel')).status_code == 401
            app.dependency_overrides[project_identity] = lambda: ProjectIdentity(str(uuid4()), 'jwt', 'http://test', 'key')
            for extra in ['context_id', 'user_id', 'agent_id', 'tools', 'provider']:
                assert (await client.post(path + '/messages', json={'message': 'Hello', extra: 'forged'})).status_code == 422
            assert (await client.post(path + '/messages', json={'message': ' '})).status_code == 422
            assert (await client.get(path)).status_code == 503

    asyncio.run(scenario())


def test_cancel_before_agent_build_and_closed_runtime(monkeypatch):
    configured(monkeypatch)

    async def scenario():
        db = Database()
        owner, issue = db.service()
        models = []
        def build(*a, **k):
            model = OfflineModel()
            models.append(model)
            return model
        runtime = IssueAgentRuntime(build)
        record = await runtime.start(owner, issue, 'Cancel before invocation')
        task = next(iter(runtime.active.values())).task
        await runtime.cancel(owner, issue)
        await task
        assert db.runs[record['run']['id']]['status'] == 'canceled'
        assert not models[0].calls
        await runtime.shutdown()
        with pytest.raises(HTTPException) as closed:
            await runtime.start(owner, issue, 'No new runs')
        assert closed.value.status_code == 503

    asyncio.run(scenario())


def test_revocation_blocks_history_cancel_and_new_runs(monkeypatch):
    configured(monkeypatch)

    async def scenario():
        db = Database()
        owner, issue = db.service()
        runtime = IssueAgentRuntime(lambda *a, **k: OfflineModel())
        db.access.clear()
        for call in [lambda: runtime.history(owner, issue), lambda: runtime.start(owner, issue, 'Denied'),
                     lambda: runtime.cancel(owner, issue)]:
            with pytest.raises(HTTPException) as denied:
                await call()
            assert denied.value.status_code == 404
        assert not db.agents and not runtime.active

    asyncio.run(scenario())


def test_database_snapshot_bytes_and_namespace_isolation(monkeypatch):
    configured(monkeypatch)

    async def scenario():
        db = Database()
        owner, issue = db.service()
        record = await owner.request('POST', 'rpc/start_issue_agent_run', body={
            'p_issue': issue, 'p_provider': 'openai', 'p_model': 'offline', 'p_message': 'test'})
        storage = IssueAgentStorage(owner, record['agent']['id'])
        await storage.write('snapshots/one', b'\x00\xffnative-bytes')
        await storage.write('other/two', b'two')
        assert await storage.read('snapshots/one') == b'\x00\xffnative-bytes'
        assert await storage.list('snapshots/') == ['snapshots/one']
        await storage.delete('snapshots/one')
        assert await storage.read('snapshots/one') is None
        with pytest.raises(Exception, match='Relative path'):
            await storage.write('../escape', b'bad')
        member, _ = db.service(issue=issue)
        other = IssueAgentStorage(member, record['agent']['id'])
        assert await other.read('other/two') is None
        with pytest.raises(HTTPException):
            await other.write('other/two', b'injection')

    asyncio.run(scenario())