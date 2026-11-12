import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectsRequest } from './projects-api.ts'
import {
  EMAIL_MAX, emailProblem, initials, inviteMember, isCurrentMember, isSharedProject, listMembers, mapMember, orderMembers,
  removeMember, withMember, type ProjectMember,
} from './project-members.ts'

const GUEST = `guest:${'a'.repeat(64)}`

const row = (overrides: Record<string, unknown> = {}) => ({
  user_id: 'u2', name: 'Alice Smith', email: 'alice@example.com', role: 'member', joined_at: '2026-11-10T09:00:00Z', ...overrides,
})

const member = (userId: string, role: ProjectMember['role'], joinedAt: number | null, name = userId): ProjectMember =>
  ({ userId, name, email: `${userId}@example.com`, role, joinedAt })

function recordingRequest(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
    const next = responses.shift()
    if (!next) throw new Error(`Unexpected request: ${init.method ?? 'GET'} ${url}`)
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const request = createProjectsRequest('http://localhost:8765', async () => ({ user: { id: 'u1' }, access_token: 't' }), 'u1', fetcher)
  return { request, calls }
}

const route = (call: { url: string; method: string }) => `${call.method} ${call.url.replace('http://localhost:8765/projects', '')}`

test('a member row maps to the renderer shape, naming people the way the API does', () => {
  assert.deepEqual(mapMember(row()), {
    userId: 'u2', name: 'Alice Smith', email: 'alice@example.com', role: 'member', joinedAt: Date.parse('2026-11-10T09:00:00Z'),
  })
  // A guest workspace's one row: named "You", no address.
  assert.deepEqual(mapMember({ user_id: 'g1', name: 'You', email: '', role: 'owner', joined_at: null }),
    { userId: 'g1', name: 'You', email: '', role: 'owner', joinedAt: null })
  assert.equal(mapMember(row({ name: '  ' })).name, 'alice')
  assert.equal(mapMember(row({ name: null, email: null })).name, 'Someone')
  assert.equal(mapMember(row({ joined_at: 'not a date' })).joinedAt, null)
  // Anything but the owner is a member: only the owner manages people.
  assert.equal(mapMember(row({ role: 'editor' })).role, 'member')
})

test('the owner is listed first, then people in the order they joined', () => {
  const ordered = orderMembers([member('late', 'member', 30), member('unknown', 'member', null), member('owner', 'owner', 50), member('early', 'member', 10)])
  assert.deepEqual(ordered.map((item) => item.userId), ['owner', 'early', 'late', 'unknown'])
  // Inviting someone already on the project answers their row again: it replaces it, it is not repeated.
  const again = withMember(ordered, { ...member('early', 'member', 10), name: 'Early Bird' })
  assert.deepEqual(again.map((item) => item.userId), ['owner', 'early', 'late', 'unknown'])
  assert.equal(again[1].name, 'Early Bird')
  assert.deepEqual(withMember(ordered, member('new', 'member', 40)).map((item) => item.userId), ['owner', 'early', 'late', 'new', 'unknown'])
})

test('people, invites and removals go through the documented routes and bodies', async () => {
  const { request, calls } = recordingRequest([
    { status: 200, body: [row(), row({ user_id: 'u1', name: 'Tim Hunter', email: 'tim@example.com', role: 'owner', joined_at: '2026-11-01T00:00:00Z' })] },
    { status: 200, body: row({ user_id: 'u3', name: 'Bo Lee', email: 'bo@example.com', joined_at: '2026-11-11T08:00:00Z' }) },
    { status: 200, body: { deleted: true } },
  ])
  const people = await listMembers(request, 'p1')
  assert.deepEqual(people.map((item) => [item.name, item.role]), [['Tim Hunter', 'owner'], ['Alice Smith', 'member']])
  const invited = await inviteMember(request, 'p1', '  bo@example.com ')
  assert.equal(invited.userId, 'u3')
  await removeMember(request, 'p1', 'u2')
  assert.deepEqual(calls.map(route), ['GET /p1/members', 'POST /p1/members', 'DELETE /p1/members/u2'])
  assert.deepEqual(calls[1].body, { email: 'bo@example.com' })
})

test('an address that is not an email is refused before any request', async () => {
  const { request, calls } = recordingRequest([])
  assert.equal(emailProblem('bo@example.com'), null)
  assert.match(emailProblem('   ') ?? '', /Enter the email address/)
  for (const value of ['bo', 'bo@example', 'bo @example.com', '@example.com', 'bo@@example.com'])
    assert.match(emailProblem(value) ?? '', /full email address/, value)
  assert.match(emailProblem(`${'b'.repeat(EMAIL_MAX)}@example.com`) ?? '', /at most 320/)
  const refused = await inviteMember(request, 'p1', 'bo@example').catch((error) => error)
  assert.equal(refused.status, 422)
  assert.match(refused.message, /full email address/)
  assert.equal(calls.length, 0)
})

test('the API’s reasons reach the invite form, and an unconfirmed removal is an error', async () => {
  const { request } = recordingRequest([
    { status: 404, body: { detail: 'No Ren account uses nobody@example.com' } },
    { status: 403, body: { detail: 'Only the project owner can invite people' } },
    { status: 200, body: { deleted: false } },
  ])
  const missing = await inviteMember(request, 'p1', 'nobody@example.com').catch((error) => error)
  assert.equal(missing.status, 404)
  assert.equal(missing.message, 'No Ren account uses nobody@example.com')
  const forbidden = await inviteMember(request, 'p1', 'bo@example.com').catch((error) => error)
  assert.equal(forbidden.status, 403)
  await assert.rejects(removeMember(request, 'p1', 'u2'), /not confirmed/)
})

test('initials come from the first two words of a name', () => {
  assert.equal(initials('Tim Hunter'), 'TH')
  assert.equal(initials('Tim Hunter MS RN CCM'), 'TH')
  assert.equal(initials('tim.hunter'), 'TH')
  assert.equal(initials('alice'), 'A')
  assert.equal(initials('  (bo) lee '), 'BL')
  assert.equal(initials('José Álvarez'), 'JÁ')
  assert.equal(initials(''), '?')
})

test('who is "you", and which projects were shared with you', () => {
  assert.equal(isCurrentMember(member('u1', 'member', 1), 'u1'), true)
  assert.equal(isCurrentMember(member('u2', 'owner', 1), 'u1'), false)
  assert.equal(isCurrentMember(member('u1', 'owner', 1), null), false)
  // A guest's API identity is a derived id, never their renderer id; they own their workspace.
  assert.equal(isCurrentMember(member('derived', 'owner', 1), GUEST), true)
  assert.equal(isSharedProject({ ownerId: 'u2' }, 'u1'), true)
  assert.equal(isSharedProject({ ownerId: 'u1' }, 'u1'), false)
  assert.equal(isSharedProject({ ownerId: undefined }, 'u1'), false)
  assert.equal(isSharedProject({ ownerId: 'derived' }, GUEST), false)
  assert.equal(isSharedProject({ ownerId: 'u2' }, null), false)
})
