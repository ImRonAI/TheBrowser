import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { MAX_LIVE_HISTORY, liveKey, liveOwner, liveTurnsFor, unsharedLiveTurns, useLiveSessionStore } from './liveSessionStore.ts'

const entry = (id: string, text: string, role: 'user' | 'assistant' = 'user') => ({ id, role, text, kind: 'transcript' as const, at: 1 })

beforeEach(() => useLiveSessionStore.setState({ conversations: {}, owners: {} }))

test('keys isolate user, scope and conversation', () => {
  assert.notEqual(liveKey('u', 'panel', 'a'), liveKey('u', 'panel', 'b'))
  assert.notEqual(liveKey('u', 'panel', 'a'), liveKey('u', 'issue:1', 'a'))
  assert.notEqual(liveKey('u', 'panel', 'a'), liveKey('v', 'panel', 'a'))
})

test('record upserts by id, incremental sharing never replays', () => {
  const key = liveKey('u', 'panel', 'agent-1')
  const store = useLiveSessionStore.getState()
  store.record(key, entry('t1', 'hel'))
  store.record(key, entry('t1', 'hello'))
  store.record(key, entry('t2', 'hi', 'assistant'))
  assert.deepEqual(liveTurnsFor(useLiveSessionStore.getState(), key).map((t) => t.text), ['hello', 'hi'])
  assert.deepEqual(unsharedLiveTurns(useLiveSessionStore.getState(), key), [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }])
  store.markShared(key, 2)
  assert.deepEqual(unsharedLiveTurns(useLiveSessionStore.getState(), key), [])
  store.record(key, entry('t3', 'next'))
  assert.deepEqual(unsharedLiveTurns(useLiveSessionStore.getState(), key), [{ role: 'user', text: 'next' }])
  // Turns stay viewable after sharing.
  assert.equal(liveTurnsFor(useLiveSessionStore.getState(), key).length, 3)
})

test('clear removes only that conversation (newChat isolation)', () => {
  const a = liveKey('u', 'panel', 'agent-a'), b = liveKey('u', 'panel', 'agent-b')
  const store = useLiveSessionStore.getState()
  store.record(a, entry('1', 'a')); store.record(b, entry('1', 'b'))
  store.clear(a)
  assert.deepEqual(liveTurnsFor(useLiveSessionStore.getState(), a), [])
  assert.equal(liveTurnsFor(useLiveSessionStore.getState(), b).length, 1)
})

test('history is bounded and sharedUpTo shifts with dropped turns', () => {
  const key = liveKey('u', 'panel', 'x')
  const store = useLiveSessionStore.getState()
  for (let i = 0; i < MAX_LIVE_HISTORY + 10; i++) store.record(key, entry(`t${i}`, `turn ${i}`))
  store.markShared(key, MAX_LIVE_HISTORY)
  store.record(key, entry('tail', 'tail'))
  const state = useLiveSessionStore.getState()
  assert.equal(liveTurnsFor(state, key).length, MAX_LIVE_HISTORY)
  assert.deepEqual(unsharedLiveTurns(state, key).map((t) => t.text), ['tail'])
})

test('claim is exclusive per key and released only by the owner', () => {
  const key = liveKey('u', 'issue:1', '1')
  const store = useLiveSessionStore.getState()
  assert.equal(store.claim(key, 'pane'), true)
  assert.equal(store.claim(key, 'pane'), true)
  assert.equal(store.claim(key, 'description'), false)
  store.release(key, 'description')
  assert.equal(liveOwner(useLiveSessionStore.getState(), key), 'pane')
  store.release(key, 'pane')
  assert.equal(liveOwner(useLiveSessionStore.getState(), key), undefined)
  assert.equal(useLiveSessionStore.getState().claim(key, 'description'), true)
})
