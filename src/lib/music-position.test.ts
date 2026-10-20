import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChunkSchedule, formatPosition, musicEditMessage } from './music-position.ts'

test('positionAt names the one chunk audible now and its stream offset', () => {
  const schedule = new ChunkSchedule()
  schedule.add(10, 2)
  schedule.add(12, 2)
  assert.equal(schedule.positionAt(9.9), null, 'before the first chunk')
  const first = schedule.positionAt(10.5)!
  assert.equal(first.chunk.index, 0)
  assert.equal(first.intoChunk, 0.5)
  assert.equal(first.streamSeconds, 0.5)
  const second = schedule.positionAt(13)!
  assert.equal(second.chunk.index, 1)
  assert.equal(second.chunk.offsetSeconds, 2)
  assert.equal(second.streamSeconds, 3)
  assert.equal(schedule.positionAt(14), null, 'after the last chunk')
})

test('stream time keeps counting across an underrun reschedule and pruning', () => {
  const schedule = new ChunkSchedule()
  schedule.add(0, 2)
  schedule.clear() // underrun: pending nodes dropped, clock not reset
  const next = schedule.add(30, 2)
  assert.equal(next.index, 1)
  assert.equal(next.offsetSeconds, 2)
  assert.equal(schedule.scheduledSeconds, 4)
  schedule.add(32, 2)
  schedule.prune(31)
  assert.equal(schedule.positionAt(30.5)?.chunk.index, 1, 'the playing chunk is kept')
  schedule.prune(32.5)
  assert.equal(schedule.positionAt(30.5), null, 'finished chunks are dropped')
  assert.equal(schedule.positionAt(33)?.chunk.index, 2)
})

test('formatPosition and the edit message pin the chunk window and prompts in effect', () => {
  assert.equal(formatPosition(0), '0:00.0')
  assert.equal(formatPosition(62.25), '1:02.3')
  const schedule = new ChunkSchedule()
  schedule.add(0, 2); schedule.add(2, 2)
  const position = schedule.positionAt(2.7)!
  const message = musicEditMessage(position, [{ text: 'lofi hip hop', weight: 1 }, { text: 'rain', weight: 0.4 }], ' add a warm Rhodes piano ')
  assert.equal(message, '[music edit at 0:02.0–0:04.0] Prompts in effect: lofi hip hop ×1, rain ×0.4. Steer the live music from now on: add a warm Rhodes piano')
  assert.match(musicEditMessage(position, [], 'x'), /Prompts in effect: none/)
})
