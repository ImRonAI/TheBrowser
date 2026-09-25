import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectsStore, issuePatch } from './projects-state.ts'
import { allProjectPages, createProjectsRequest, type ProjectsRequest } from '../lib/projects-api.ts'

const projectRow = { id: 'p', key: 'PR', name: 'Project', type: 'research', version: 3,
  lifecycle: 'active', settings: { allowCrossProjectParents: false, fields: [] },
  created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z' }
const issueRow = { id: 'i', project_id: 'p', number: 14, version: 5, parent_id: null,
  type: 'task', title: 'Server title', status: 'backlog', priority: 'medium', rank: 100,
  created_at: projectRow.created_at, updated_at: projectRow.updated_at }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(handler?: (path: string, method: string, body: any) => Promise<unknown>) {
  const calls: { user: string; path: string; method: string; body: any }[] = []
  const store = createProjectsStore((user) => async <T>(path: string, method = 'GET', body?: unknown) => {
    calls.push({ user, path, method, body })
    if (handler && method !== 'GET') return await handler(path, method, body) as T
    if (path.startsWith('?')) return [projectRow] as T
    if (path.startsWith('/p/issues?')) return [issueRow] as T
    return [] as T
  })
  store.getState().setIdentity({ id: 'alice', name: 'Alice' })
  return { store, calls }
}

test('loads server rows, canonical versions and issue numbers with no seeded data', async () => {
  const { store, calls } = setup()
  assert.deepEqual(store.getState().projects, [])
  await store.getState().initialize()
  assert.equal(store.getState().projects[0].version, 3)
  assert.equal(store.getState().issues[0].number, 14)
  assert.equal(store.getState().issues[0].version, 5)
  assert.equal(store.getState().isInitialized, true)
  assert.ok(calls.every((call) => call.user === 'alice'))
  assert.ok(calls.some((call) => call.path.startsWith('/links?')))
})

test('create remains absent until confirmed and uses the server ID and number', async () => {
  const pending = deferred<unknown>()
  const { store } = setup(() => pending.promise)
  const saved = store.getState().createIssue({ projectId: 'p', title: 'Draft', type: 'task' })
  assert.equal(store.getState().pendingSaves, 1)
  assert.deepEqual(store.getState().issues, [])
  pending.resolve(issueRow)
  const result = await saved
  assert.equal(result.issue?.id, 'i')
  assert.equal(result.issue?.number, 14)
  assert.equal(store.getState().pendingSaves, 0)
})

test('failed create does not fabricate saved rows and exposes the failure', async () => {
  const { store } = setup(async () => { throw new Error('Database unavailable') })
  const result = await store.getState().createProject({ name: 'Project', type: 'research' })
  assert.equal(result.error, 'Database unavailable')
  assert.equal(store.getState().error, result.error)
  assert.deepEqual(store.getState().projects, [])
})

test('stale writes preserve confirmed state and are never silently retried', async () => {
  const { store, calls } = setup(async () => { throw new Error('Issue changed; reload before saving') })
  await store.getState().initialize()
  const result = await store.getState().updateIssue('i', { title: 'Lost update' })
  assert.match(result.error!, /reload/)
  assert.equal(store.getState().issues[0].title, 'Server title')
  assert.equal(store.getState().issues[0].version, 5)
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1)
})

test('queued updates use each preceding server-confirmed version', async () => {
  let version = 5
  const { store, calls } = setup(async (_path, _method, body) => {
    assert.equal(body.version, version)
    return { ...issueRow, ...body, version: ++version }
  })
  await store.getState().initialize()
  await Promise.all([store.getState().updateIssue('i', { title: 'First' }),
    store.getState().updateIssue('i', { status: 'done' })])
  assert.deepEqual(calls.filter((call) => call.method === 'PATCH').map((call) => call.body.version), [5, 6])
  assert.equal(store.getState().issues[0].version, 7)
})

test('switching accounts drops late writes and cancels queued writes, even after switching back', async () => {
  const pending = deferred<unknown>()
  const started = deferred<void>()
  const { store, calls } = setup(async () => { started.resolve(); return pending.promise })
  await store.getState().initialize()
  const first = store.getState().updateIssue('i', { title: 'Old account write' })
  const second = store.getState().updateIssue('i', { status: 'done' })
  await started.promise
  store.getState().setIdentity(null)
  store.getState().setIdentity({ id: 'alice', name: 'Alice' })
  pending.resolve({ ...issueRow, version: 6 })
  assert.match((await first).error!, /Session changed/)
  assert.match((await second).error!, /Session changed/)
  assert.deepEqual(store.getState().issues, [])
  assert.equal(store.getState().error, null)
  assert.equal(store.getState().pendingSaves, 0)
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1)
})

test('switching accounts drops late loads without clearing the new account loading state', async () => {
  const pending = deferred<unknown>()
  const store = createProjectsStore(() => async <T>() => await pending.promise as T)
  store.getState().setIdentity({ id: 'alice', name: 'Alice' })
  const load = store.getState().initialize()
  await Promise.resolve()
  store.getState().setIdentity({ id: 'bob', name: 'Bob' })
  pending.resolve([])
  await load
  assert.equal(store.getState().userId, 'bob')
  assert.equal(store.getState().isInitialized, false)
  assert.deepEqual(store.getState().projects, [])
})

test('nullable clears are explicit and immutable/audit fields never enter a patch', () => {
  assert.deepEqual(issuePatch({ dueDate: undefined, parentId: null, id: 'forged', version: 99,
    number: 100, createdBy: 'outsider', projectId: 'other', title: 'OK' }),
  { title: 'OK', parent_id: null, due_date: null })
  assert.deepEqual(issuePatch({ title: 'Only title' }), { title: 'Only title' })
})

test('failed review refresh reports failure and retains the confirmed snapshot', async () => {
  const store = createProjectsStore(() => async () => { throw new Error('Synthetic refresh failure') })
  store.getState().setIdentity({ id: 'alice', name: 'Alice' })
  const { store: loaded } = setup()
  await loaded.getState().initialize()
  store.setState({ projects: loaded.getState().projects, issues: loaded.getState().issues })
  const result = await store.getState().refreshFromServer()
  assert.equal(result.error, 'Synthetic refresh failure')
  assert.equal(store.getState().issues[0].title, 'Server title')
  assert.equal(store.getState().isLoading, false)
})

test('review refresh cannot report success when skipped or the account changes', async () => {
  const pending = deferred<unknown>()
  const store = createProjectsStore(() => async <T>() => await pending.promise as T)
  store.getState().setIdentity({ id: 'alice', name: 'Alice' })
  const refresh = store.getState().refreshFromServer()
  assert.match((await store.getState().refreshFromServer()).error!, /already in progress/)
  await Promise.resolve()
  store.getState().setIdentity({ id: 'bob', name: 'Bob' })
  pending.resolve([])
  assert.match((await refresh).error!, /Session changed/)
  assert.deepEqual(store.getState().issues, [])
})

test('project settings updates preserve fields and hierarchy configuration', async () => {
  const { store, calls } = setup(async (_path, _method, body) => ({ ...projectRow, ...body, version: 4 }))
  await store.getState().initialize()
  await store.getState().updateProject('p', { settings: { allowCrossProjectParents: false } })
  assert.deepEqual(calls.find((c) => c.method === 'PATCH')?.body,
    { version: 3, settings: { allowCrossProjectParents: false, fields: [] } })
})

test('long-lived issue drafts cannot silently use a newer loaded version', async () => {
  const { store, calls } = setup()
  await store.getState().initialize()
  const result = await store.getState().updateIssue('i', { title: 'Draft from v4' }, 4)
  assert.match(result.error!, /draft is retained/)
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0)
  assert.equal(store.getState().issues[0].title, 'Server title')
})

test('queued edits from the same issue version conflict rather than overwriting', async () => {
  const { store, calls } = setup(async (_path, _method, body) => ({ ...issueRow, ...body, version: 6 }))
  await store.getState().initialize()
  const first = store.getState().updateIssue('i', { title: 'First' }, 5)
  const second = store.getState().updateIssue('i', { title: 'Second' }, 5)
  assert.equal((await first).issue?.title, 'First')
  assert.match((await second).error!, /changed/)
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1)
})

test('configuration drafts reject stale base versions without sending a mutation', async () => {
  const { store, calls } = setup()
  await store.getState().initialize()
  assert.match((await store.getState().updateProject('p', { settings: { allowCrossProjectParents: false } }, 2)).error!, /retained draft/)
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0)
})

test('successful HTTP deletion without confirmation does not remove local links', async () => {
  const { store } = setup(async () => ({}))
  store.setState({ issueLinks: [{ id: 'l', sourceId: 'i', targetId: 'j', type: 'blocks', createdAt: 1 }] })
  assert.match((await store.getState().removeIssueLink('l')).error!, /not confirmed/)
  assert.equal(store.getState().issueLinks.length, 1)
})

test('confirmed relationship deletion removes the canonical edge', async () => {
  const { store } = setup(async () => ({ deleted: true }))
  store.setState({ issueLinks: [{ id: 'l', sourceId: 'i', targetId: 'j', type: 'blocks', createdAt: 1 }] })
  assert.equal((await store.getState().removeIssueLink('l')).error, undefined)
  assert.equal(store.getState().issueLinks.length, 0)
})

test('failed relationship delete preserves existing links', async () => {
  const { store } = setup(async () => { throw new Error('Access removed') })
  store.setState({ issueLinks: [{ id: 'l', sourceId: 'i', targetId: 'j', type: 'blocks', createdAt: 1 }] })
  assert.equal((await store.getState().removeIssueLink('l')).error, 'Access removed')
  assert.equal(store.getState().issueLinks.length, 1)
})

test('pagination follows all pages, including a final empty page', async () => {
  const paths: string[] = []
  const request: ProjectsRequest = async <T>(path: string) => {
    paths.push(path)
    return (paths.length === 1 ? Array.from({ length: 200 }, (_, i) => i) : []) as T
  }
  assert.equal((await allProjectPages(request, '/p/issues')).length, 200)
  assert.deepEqual(paths, ['/p/issues?offset=0&limit=200', '/p/issues?offset=200&limit=200'])
})

test('transport binds the current JWT to the expected account and never sends service credentials', async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer user-token')
    assert.equal(init?.method, 'PATCH')
    return Response.json({ version: 6 })
  }
  const request = createProjectsRequest('http://localhost:8765', async () => ({ user: { id: 'alice' }, access_token: 'user-token' }), 'alice', fetcher)
  assert.deepEqual(await request('/issues/i', 'PATCH', { version: 5 }), { version: 6 })
  const wrong = createProjectsRequest('http://localhost:8765', async () => ({ user: { id: 'bob' }, access_token: 'other' }), 'alice',
    async () => { assert.fail('Must not send a request with another account token') })
  await assert.rejects(wrong('', 'POST', {}), /Session changed/)
})

test('network failure and FastAPI validation errors are visible without retrying writes', async () => {
  let calls = 0
  const session = async () => ({ user: { id: 'alice' }, access_token: 'token' })
  const request = createProjectsRequest('http://localhost:8765', session, 'alice', async () => {
    calls++
    throw new Error('Connection lost')
  })
  await assert.rejects(request('', 'POST', {}), /Reload before retrying/)
  assert.equal(calls, 1)
  const invalid = createProjectsRequest('http://localhost:8765', session, 'alice', async () =>
    Response.json({ detail: [{ msg: 'Invalid project key' }] }, { status: 422 }))
  await assert.rejects(invalid('', 'POST', {}), /Invalid project key/)
})