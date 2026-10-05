import assert from 'node:assert/strict'
import test from 'node:test'
import { checkLiveApi, liveApiBase, liveSocketUrl } from './live-api.ts'

test('panel and teaching derive HTTP and WebSocket routes from one base', () => {
  const base = liveApiBase('http://localhost:8766/', 'http://localhost:8765')
  assert.equal(base, 'http://localhost:8766')
  assert.equal(liveSocketUrl(base, '/bidi'), 'ws://localhost:8766/bidi')
  assert.equal(liveSocketUrl(base, '/teaching/sessions/lesson/observe'), 'ws://localhost:8766/teaching/sessions/lesson/observe')
  assert.equal(liveSocketUrl('https://example.test/api', '/bidi'), 'wss://example.test/api/bidi')
  assert.equal(liveApiBase(undefined, 'http://localhost:8765'), 'http://localhost:8765')
  for (const invalid of ['file:///tmp/test', 'http://user:password@localhost', 'http://localhost/?token=x']) {
    assert.throws(() => liveApiBase(invalid, 'http://localhost:8765'))
  }
})

test('an older backend fails clearly instead of leaving the model disconnected', async () => {
  await assert.rejects(checkLiveApi('http://localhost:8765', async () => new Response('{}', { status: 404 })), /does not include.*routes/)
  await assert.rejects(checkLiveApi('http://localhost:8766', async () => { throw new Error('offline') }), /Cannot reach/)
  await checkLiveApi('http://localhost:8766', async (url) => {
    assert.equal(url, 'http://localhost:8766/bidi/settings')
    return new Response(JSON.stringify({ models: ['gemini-3.8-live-extended-thinking'] }))
  })
})
