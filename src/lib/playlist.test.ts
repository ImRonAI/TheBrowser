import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQueue, currentId, jumpTo, next, previous, setMode, setRepeat, shuffled, totalSeconds, upcoming } from './playlist.ts'

const ids = ['a', 'b', 'c', 'd']
/** Deterministic RNG so shuffles are reproducible in tests. */
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }

test('sequential queue plays in order and stops at the end unless repeat is on', () => {
  let q = createQueue(ids)
  assert.equal(currentId(q), 'a'); assert.deepEqual(upcoming(q), ['b', 'c', 'd'])
  q = next(q); q = next(q); q = next(q)
  assert.equal(currentId(q), 'd')
  assert.equal(currentId(next(q)), null, 'repeat off stops after the last track')
  const wrapped = next(setRepeat(q, 'all'))
  assert.equal(currentId(wrapped), 'a', 'repeat all wraps to the start')
  assert.equal(currentId(next(setRepeat(q, 'one'), 'ended')), 'd', 'repeat one replays the track')
  assert.equal(currentId(next(setRepeat(q, 'one'), 'skip')), 'a', 'a manual skip moves on (and wraps, since repeat is on)')
})

test('shuffle is a permutation, keeps the current track first, and reshuffles on wrap', () => {
  const order = shuffled(ids, rng(7))
  assert.deepEqual([...order].sort(), ids)
  const q = createQueue(ids, { mode: 'shuffle', startId: 'c', random: rng(3) })
  assert.equal(currentId(q), 'c', 'the chosen start plays first')
  assert.deepEqual([...q.order].sort(), ids)
  assert.deepEqual(q.ids, ids, 'playlist order is never mutated')
  let r = setRepeat(q, 'all')
  for (let i = 0; i < 3; i++) r = next(r, 'ended', rng(11))
  const last = currentId(r)
  const wrapped = next(r, 'ended', rng(11))
  assert.equal(wrapped.cursor, 0)
  assert.notEqual(currentId(wrapped), last, 'never the same track twice across the wrap')
})

test('switching modes mid-play keeps the current track', () => {
  let q = createQueue(ids)
  q = next(q)
  assert.equal(currentId(q), 'b')
  const sh = setMode(q, 'shuffle', rng(5))
  assert.equal(currentId(sh), 'b'); assert.equal(sh.order[0], 'b')
  const back = setMode(sh, 'sequential')
  assert.equal(currentId(back), 'b'); assert.deepEqual(back.order, ids); assert.equal(back.cursor, 1)
  assert.equal(setMode(back, 'sequential'), back, 'no-op when unchanged')
})

test('previous and jumpTo move within the current order', () => {
  let q = createQueue(ids)
  assert.equal(currentId(previous(q)), 'a', 'at the start without repeat stays put')
  assert.equal(currentId(previous(setRepeat(q, 'all'))), 'd', 'repeat all wraps backwards')
  q = jumpTo(q, 'c')
  assert.equal(currentId(q), 'c'); assert.equal(currentId(previous(q)), 'b')
  assert.equal(jumpTo(q, 'zzz'), q, 'unknown ids are ignored')
})

test('empty queue and totals', () => {
  const q = createQueue([])
  assert.equal(currentId(q), null); assert.equal(next(q), q); assert.equal(previous(q), q)
  assert.equal(totalSeconds([{ duration_seconds: 30 }, { duration_seconds: null }, {}]), 30)
})
