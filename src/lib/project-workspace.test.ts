import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guestWorkspace } from './project-workspace.ts'
import { createProjectsRequest } from './projects-api.ts'

test('guest workspace survives reload and differs between browser profiles', () => {
  const storage = () => {
    const data = new Map<string, string>()
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  }
  const first = storage()
  assert.deepEqual(guestWorkspace(first), guestWorkspace(first))
  assert.notEqual(guestWorkspace(first).id, guestWorkspace(storage()).id)
  assert.match(guestWorkspace(first).token, /^[a-f0-9]{64}$/)
})

test('signed-out requests use the workspace capability, never a fake account JWT', async () => {
  const token = 'a'.repeat(64)
  let calls = 0
  const fetcher: typeof fetch = async (_url, init) => {
    calls++
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('X-Ron-Workspace'), token)
    assert.equal(headers.get('Authorization'), null)
    return Response.json([])
  }
  await createProjectsRequest('http://localhost', async () => null, `guest:${token}`, fetcher)('')
  assert.equal(calls, 1)
  const changed = createProjectsRequest('http://localhost', async () => ({ user: { id: 'account' }, access_token: 'jwt' }), `guest:${token}`, fetcher)
  await assert.rejects(changed('', 'POST', {}), /Session changed/)
  assert.equal(calls, 1)
})