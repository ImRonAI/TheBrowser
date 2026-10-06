/**
 * Playback queue for saved songs: a playlist/album (or the whole library) played
 * continuously in order or shuffled, with optional repeat. Pure: no React, no DOM,
 * no `@/` imports (node-testable). `usePlaylistPlayer` drives one `<audio>` from it.
 */

export type PlayMode = 'sequential' | 'shuffle'
export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueState {
  /** Song ids in playlist order (never mutated by shuffling). */
  ids: string[]
  /** Playback order: a permutation of `ids` (identity in sequential mode). */
  order: string[]
  /** Index into `order`; -1 when nothing is selected. */
  cursor: number
  mode: PlayMode
  repeat: RepeatMode
}

export const EMPTY_QUEUE: QueueState = { ids: [], order: [], cursor: -1, mode: 'sequential', repeat: 'off' }

/** Fisher–Yates with an injectable RNG; `first`, when given, is moved to the front so playback continues seamlessly. */
export function shuffled(ids: readonly string[], random: () => number = Math.random, first?: string): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  if (first !== undefined) {
    const at = out.indexOf(first)
    if (at > 0) { out.splice(at, 1); out.unshift(first) }
  }
  return out
}

/** Build a queue from a song list; `startId` selects the first track (defaults to the first in order). */
export function createQueue(ids: readonly string[], options: { mode?: PlayMode; repeat?: RepeatMode; startId?: string; random?: () => number } = {}): QueueState {
  const mode = options.mode ?? 'sequential'
  const repeat = options.repeat ?? 'off'
  const list = [...ids]
  const start = options.startId !== undefined && list.includes(options.startId) ? options.startId : list[0]
  const order = mode === 'shuffle' ? shuffled(list, options.random, start) : list
  return { ids: list, order, cursor: list.length ? order.indexOf(start!) : -1, mode, repeat }
}

export const currentId = (queue: QueueState): string | null => (queue.cursor >= 0 ? queue.order[queue.cursor] ?? null : null)

/** Switch mode without interrupting the current track: shuffling keeps the current song first; sequential re-aligns the cursor. */
export function setMode(queue: QueueState, mode: PlayMode, random: () => number = Math.random): QueueState {
  if (mode === queue.mode) return queue
  const current = currentId(queue) ?? undefined
  const order = mode === 'shuffle' ? shuffled(queue.ids, random, current) : [...queue.ids]
  return { ...queue, mode, order, cursor: current ? order.indexOf(current) : (order.length ? 0 : -1) }
}

export const setRepeat = (queue: QueueState, repeat: RepeatMode): QueueState => ({ ...queue, repeat })

/**
 * Advance when a track ends (`reason: 'ended'`) or the user skips (`'skip'`).
 * - `repeat: 'one'` replays the current track on `ended` (a skip still moves on).
 * - At the end: `repeat: 'all'` wraps (reshuffling in shuffle mode so the next pass differs); `off` stops (`cursor: -1`).
 */
export function next(queue: QueueState, reason: 'ended' | 'skip' = 'ended', random: () => number = Math.random): QueueState {
  if (!queue.order.length) return queue
  if (reason === 'ended' && queue.repeat === 'one' && queue.cursor >= 0) return queue
  const following = queue.cursor + 1
  if (following < queue.order.length) return { ...queue, cursor: following }
  if (queue.repeat === 'off') return { ...queue, cursor: -1 }
  const order = queue.mode === 'shuffle' ? shuffled(queue.ids, random) : queue.order
  // Avoid playing the same track twice in a row across the wrap when there is a choice.
  if (queue.mode === 'shuffle' && order.length > 1 && order[0] === currentId(queue)) [order[0], order[1]] = [order[1], order[0]]
  return { ...queue, order, cursor: 0 }
}

/** Go back one track; at the start, wraps only when `repeat` is `all`. */
export function previous(queue: QueueState): QueueState {
  if (!queue.order.length) return queue
  if (queue.cursor > 0) return { ...queue, cursor: queue.cursor - 1 }
  return queue.repeat === 'all' ? { ...queue, cursor: queue.order.length - 1 } : { ...queue, cursor: 0 }
}

/** Jump to a specific song (keeps the current order). */
export function jumpTo(queue: QueueState, id: string): QueueState {
  const at = queue.order.indexOf(id)
  return at >= 0 ? { ...queue, cursor: at } : queue
}

/** The tracks still to come after the current one, in play order. */
export function upcoming(queue: QueueState): string[] {
  return queue.cursor >= 0 ? queue.order.slice(queue.cursor + 1) : []
}

/** Total seconds of a song list (missing durations count as 0). */
export function totalSeconds(songs: readonly { duration_seconds?: number | null }[]): number {
  return songs.reduce((sum, song) => sum + (typeof song.duration_seconds === 'number' ? song.duration_seconds : 0), 0)
}
