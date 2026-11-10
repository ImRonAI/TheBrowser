import assert from 'node:assert/strict'
import test from 'node:test'
import { timelineBar } from './timeline-bar.ts'

const DAY = 24 * 60 * 60 * 1000
// The project timeline's window: 7 days back to 45 days ahead, 52 days wide.
const today = Date.UTC(2026, 10, 9)
const windowStart = today - 7 * DAY
const windowEnd = today + 45 * DAY
const at = (days: number) => today + days * DAY
const pct = (days: number) => (days / 52) * 100
const bar = (startDays: number, endDays: number) => timelineBar(at(startDays), at(endDays), windowStart, windowEnd)

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)

test('work inside the window is drawn where it is, at its own length', () => {
  const result = bar(3, 13)
  assert.equal(result?.placement, 'inside')
  if (result?.placement !== 'inside') return
  close(result.leftPct, pct(10))
  close(result.widthPct, pct(10))
  assert.equal(result.clippedStart, false)
  assert.equal(result.clippedEnd, false)
})

test('work that ended before the window is labelled, not drawn at the window start', () => {
  assert.deepEqual(bar(-40, -20), { placement: 'before' })
})

test('work that starts after the window is labelled, not drawn past the right edge', () => {
  assert.deepEqual(bar(50, 60), { placement: 'after' })
})

test('work that started before the window shows only its part inside the window', () => {
  // Started 30 days ago, ends in 5 days: the bar runs from the window start to day 5, 12 days.
  const result = bar(-30, 5)
  assert.equal(result?.placement, 'inside')
  if (result?.placement !== 'inside') return
  close(result.leftPct, 0)
  close(result.widthPct, pct(12))
  assert.equal(result.clippedStart, true)
  assert.equal(result.clippedEnd, false)
})

test('work running past the window ends at the right edge', () => {
  const result = bar(40, 90)
  assert.equal(result?.placement, 'inside')
  if (result?.placement !== 'inside') return
  close(result.leftPct, pct(47))
  close(result.leftPct + result.widthPct, 100)
  assert.equal(result.clippedEnd, true)
})

test('work spanning the whole window fills it', () => {
  const result = bar(-10, 60)
  assert.deepEqual(result, { placement: 'inside', leftPct: 0, widthPct: 100, clippedStart: true, clippedEnd: true })
})

test('a one-day item keeps a visible minimum width and stays inside the window', () => {
  const short = bar(10, 10)
  assert.equal(short?.placement, 'inside')
  if (short?.placement !== 'inside') return
  close(short.widthPct, 1.5)
  close(short.leftPct, pct(17))
  // On the last moment of the window the minimum width is moved left, not drawn past the edge.
  const last = timelineBar(windowEnd, windowEnd, windowStart, windowEnd)
  assert.equal(last?.placement, 'inside')
  if (last?.placement !== 'inside') return
  close(last.leftPct + last.widthPct, 100)
})

test('an end before the start is the same span the other way round', () => {
  assert.deepEqual(bar(13, 3), bar(3, 13))
})

test('an unparsable date gives no bar, and an empty window is a programming error', () => {
  assert.equal(timelineBar(Number.NaN, at(3), windowStart, windowEnd), null)
  assert.equal(timelineBar(at(3), new Date('not a date').getTime(), windowStart, windowEnd), null)
  assert.throws(() => timelineBar(at(0), at(1), windowEnd, windowStart), RangeError)
})
