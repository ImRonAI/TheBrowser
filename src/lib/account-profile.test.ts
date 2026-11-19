import assert from 'node:assert/strict'
import test from 'node:test'
import { createProfileClient, firstSync, graphChanged, profileOf, sameProfile, type AccountProfile } from './account-profile.ts'

const node = { id: 'ai', label: 'AI', weight: 0.9, category: 'ai' as const, source: 'onboarding' as const, lastUpdated: 1,
  position: { x: 10, y: 20 }, velocity: { x: 0, y: 0 } }
const empty = profileOf({ answers: [], isComplete: false }, { nodes: [], connections: [], isInitialized: false }, 0)
const done = (updatedAt: number, answer = 'AI, F1'): AccountProfile => profileOf(
  { answers: [{ question: 'What topics are you most interested in?', answer, timestamp: 5 }], isComplete: true },
  { nodes: [node], connections: [{ id: 'ai-f1', from: 'ai', to: 'f1', strength: 0.4 }], isInitialized: true }, updatedAt)

test('profileOf keeps what the account holds and leaves the layout on the device', () => {
  const profile = done(7)
  assert.deepEqual(profile.interests.nodes, [{ id: 'ai', label: 'AI', weight: 0.9, category: 'ai', source: 'onboarding', lastUpdated: 1 }])
  assert.equal(profile.updated_at, 7)
})

test('sameProfile compares content, whatever the key order, absent reasons or save time', () => {
  const fromServer = JSON.parse(JSON.stringify({ ...done(9), interests: { ...done(9).interests,
    nodes: [{ lastUpdated: 1, reason: null, source: 'onboarding', category: 'ai', weight: 0.9, label: 'AI', id: 'ai' }] } }))
  assert.equal(sameProfile(done(1), fromServer), true)
  assert.equal(sameProfile(done(1), done(1, 'Cooking')), false)
})

test('graphChanged ignores the graph moving on screen and sees a new weight', () => {
  const graph = { nodes: [node], connections: [], isInitialized: true }
  assert.equal(graphChanged({ ...graph, nodes: [{ ...node, position: { x: 11, y: 21 } }] }, graph), false)
  assert.equal(graphChanged({ ...graph, nodes: [{ ...node, weight: 0.5 }] }, graph), true)
  assert.equal(graphChanged({ ...graph, connections: [] }, graph), true)
})

test('firstSync: a user can start on either device', () => {
  // Survey done on the phone, desktop signs in fresh: desktop takes it.
  assert.deepEqual(firstSync(done(100), { profile: empty, owner: null, updatedAt: 0 }, 'u1'), { kind: 'apply', profile: done(100) })
  // Survey done before signing in (or before the account kept it): the account takes it.
  assert.deepEqual(firstSync(null, { profile: done(0), owner: null, updatedAt: 0 }, 'u1'), { kind: 'push' })
  // This device changed the account's profile since the account last heard from it.
  assert.deepEqual(firstSync(done(100), { profile: done(200, 'Cooking'), owner: 'u1', updatedAt: 200 }, 'u1'), { kind: 'push' })
  // Another device changed it later.
  assert.deepEqual(firstSync(done(300, 'Cooking'), { profile: done(200), owner: 'u1', updatedAt: 200 }, 'u1'), { kind: 'apply', profile: done(300, 'Cooking') })
  // Already the same.
  assert.deepEqual(firstSync(done(100), { profile: done(100), owner: 'u1', updatedAt: 100 }, 'u1'), { kind: 'none' })
  // The device holds another account's profile and this account has none: start over.
  assert.deepEqual(firstSync(null, { profile: done(50), owner: 'u0', updatedAt: 50 }, 'u1'), { kind: 'reset' })
  // Nothing anywhere yet.
  assert.deepEqual(firstSync(null, { profile: empty, owner: null, updatedAt: 0 }, 'u1'), { kind: 'none' })
})

test('the client reads and saves the account profile', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(init === undefined ? { url: String(url) } : { url: String(url), init })
    return new Response(JSON.stringify({ profile: init?.method === 'PUT' ? done(3) : null }), { status: 200 })
  }) as typeof fetch
  const client = createProfileClient('http://127.0.0.1:8765/', 'a b', fetcher)
  assert.equal(await client.read(), null)
  assert.equal((await client.save(done(3))).updated_at, 3)
  assert.ok(calls[0] && calls[1])
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/context/profile?user_id=a%20b')
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { user_id: 'a b', profile: done(3) })
  const refused = createProfileClient('', 'u', (async () => new Response(JSON.stringify({ detail: 'Sign in' }), { status: 401 })) as typeof fetch)
  await assert.rejects(refused.read(), /Sign in/)
})
