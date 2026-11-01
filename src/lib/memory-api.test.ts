import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SIGN_IN_MESSAGE, composeEntry, createMemoryRequest, entryBody, entryTitle, memoryAdd, memoryDelete, memoryEntries,
  memoryHeaders, memoryStores, memoryUpdate,
} from './memory-api.ts'

const session = { user: { id: 'u1' }, access_token: 'jwt' }

test('headers carry the bearer token of the signed-in owner only', () => {
  assert.deepEqual(memoryHeaders('u1', session), { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' })
  assert.throws(() => memoryHeaders('u1', null), { message: SIGN_IN_MESSAGE })
  assert.throws(() => memoryHeaders('default', session), { message: SIGN_IN_MESSAGE })
})

test('requests hit the documented routes with the right methods and bodies', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as unknown as typeof fetch
  const request = createMemoryRequest('http://127.0.0.1:8765/', async () => session, 'u1', fetcher)
  await memoryStores(request)
  await memoryEntries(request, 'facts')
  await memoryAdd(request, 'remember', '# Coffee\nOat flat white')
  await memoryUpdate(request, 'remember', 'coffee.md', '# Coffee\nBlack')
  await memoryDelete(request, 'remember', 'coffee.md')
  assert.deepEqual(calls.map((c) => [c.init.method, c.url]), [
    ['GET', 'http://127.0.0.1:8765/memory/stores'],
    ['GET', 'http://127.0.0.1:8765/memory/entries?store=facts'],
    ['POST', 'http://127.0.0.1:8765/memory/entries'],
    ['PUT', 'http://127.0.0.1:8765/memory/entries'],
    ['DELETE', 'http://127.0.0.1:8765/memory/entries?store=remember&key=coffee.md'],
  ])
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), { store: 'remember', content: '# Coffee\nOat flat white' })
  assert.deepEqual(JSON.parse(String(calls[3].init.body)), { store: 'remember', key: 'coffee.md', content: '# Coffee\nBlack' })
})

test('server errors surface the FastAPI detail', async () => {
  const fetcher = (async () => new Response(JSON.stringify({ detail: 'Sign in to view and edit memory' }), { status: 401 })) as unknown as typeof fetch
  const request = createMemoryRequest('http://x', async () => session, 'u1', fetcher)
  await assert.rejects(memoryStores(request), { message: 'Sign in to view and edit memory' })
})

test('entries split into the native heading and body; new entries use that shape', () => {
  const entry = { store: 'facts', key: 'drinks.md', content: '# Drinks\nLikes tea\nNo sugar' }
  assert.equal(entryTitle(entry), 'Drinks')
  assert.equal(entryBody(entry), 'Likes tea\nNo sugar')
  assert.equal(entryTitle({ store: 'facts', key: 'note.md', content: 'plain' }), 'note')
  assert.equal(composeEntry(' Drinks ', ' Likes tea '), '# Drinks\nLikes tea')
  assert.throws(() => composeEntry('', 'x'))
  assert.throws(() => composeEntry('x', '  '))
})
