import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listThreads, readThread, relativeTime } from './threads-api.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('listThreads hits GET /sessions with user_id (and destination) and returns the read model', async () => {
  const calls: string[] = []
  const fetcher = (async (url: RequestInfo | URL) => { calls.push(String(url)); return json({ threads: [{ session_id: 's1' }], sign_in_required: false }) }) as typeof fetch
  const result = await listThreads('http://localhost:8765/', 'u-1', 'panel', fetcher)
  assert.equal(calls[0], 'http://localhost:8765/sessions?user_id=u-1&destination=panel')
  assert.equal(result.threads[0].session_id, 's1')
})

test('readThread hits GET /sessions/{id}/thread and surfaces HTTP errors', async () => {
  const fetcher = (async (url: RequestInfo | URL) => String(url).includes('/missing/') ? json({ detail: 'Unknown thread' }, 404)
    : json({ session_id: 'agent-1', messages: [{ seq: 0, kind: 'user_prompt' }] })) as typeof fetch
  const thread = await readThread('http://localhost:8765', 'u-1', 'agent-1', fetcher)
  assert.equal(thread.messages[0].kind, 'user_prompt')
  await assert.rejects(readThread('http://localhost:8765', 'u-1', 'missing', fetcher), /404/)
})

test('relativeTime buckets', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  assert.equal(relativeTime('2026-10-07T11:59:50Z', now), 'just now')
  assert.equal(relativeTime('2026-10-07T11:45:00Z', now), '15m ago')
  assert.equal(relativeTime('2026-10-07T09:00:00Z', now), '3h ago')
  assert.equal(relativeTime('2026-10-04T12:00:00Z', now), '3d ago')
})
