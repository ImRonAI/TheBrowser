/**
 * Where an issue's bar sits on a timeline window, as percentages of the window's width.
 *
 * `before` / `after`: the work ends before the window starts or starts after it ends, so it gets a
 * label instead of a bar pinned to an edge. `inside`: the part of the work within the window;
 * `clippedStart` / `clippedEnd` say the work carries on past that edge.
 */
export type TimelineBar =
  | { placement: 'before' | 'after' }
  | { placement: 'inside'; leftPct: number; widthPct: number; clippedStart: boolean; clippedEnd: boolean }

/**
 * Clamps both ends of the work (epoch ms) to the window, so the bar shows only the part of the work
 * inside it: a bar never starts before the window, never runs past its right edge, and is at least
 * `minWidthPct` wide so a one-day item stays visible. An end earlier than the start is read as the
 * same span the other way round. Returns null for a date that is not a number (an unparsable date).
 */
export function timelineBar(start: number, end: number, windowStart: number, windowEnd: number, minWidthPct = 1.5): TimelineBar | null {
  const total = windowEnd - windowStart
  if (!(total > 0)) throw new RangeError('The timeline window must end after it starts.')
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  if (to < windowStart) return { placement: 'before' }
  if (from > windowEnd) return { placement: 'after' }
  const visibleFrom = Math.max(from, windowStart)
  const visibleTo = Math.min(to, windowEnd)
  const widthPct = Math.min(100, Math.max(((visibleTo - visibleFrom) / total) * 100, minWidthPct))
  const leftPct = Math.min(((visibleFrom - windowStart) / total) * 100, 100 - widthPct)
  return { placement: 'inside', leftPct, widthPct, clippedStart: from < windowStart, clippedEnd: to > windowEnd }
}
