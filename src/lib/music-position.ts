/**
 * Playback position over the Lyria RealTime chunk schedule.
 *
 * Lyria RealTime streams raw PCM with no server timestamp, index or seek (the protocol's only
 * playback messages are play/pause/stop/reset_context), so the finest time window a client can
 * name is one received chunk: the `[start, end)` the renderer scheduled it at. `useMusicPlayback`
 * records every scheduled chunk here; the deck asks `positionAt(now)` for the one audible now.
 * Pure (no `@/` imports) so `node --experimental-strip-types` can run the colocated test.
 */

export interface ScheduledChunk {
  /** Running index since the stream started (survives schedule resets after underruns). */
  index: number
  /** AudioContext time the chunk starts and ends. */
  startAt: number
  endAt: number
  /** Stream-time offset of the chunk start, in seconds since the first chunk. */
  offsetSeconds: number
  durationSeconds: number
}

export interface MusicPosition {
  chunk: ScheduledChunk
  /** Seconds into the chunk at `now`. */
  intoChunk: number
  /** Seconds since the first chunk, at `now`. */
  streamSeconds: number
}

export class ChunkSchedule {
  private chunks: ScheduledChunk[] = []
  private nextIndex = 0
  private streamOffset = 0

  /** Record a chunk scheduled at `startAt` for `durationSeconds`. Returns the entry. */
  add(startAt: number, durationSeconds: number): ScheduledChunk {
    const chunk: ScheduledChunk = {
      index: this.nextIndex++, startAt, endAt: startAt + durationSeconds,
      offsetSeconds: this.streamOffset, durationSeconds,
    }
    this.streamOffset += durationSeconds
    this.chunks.push(chunk)
    return chunk
  }

  /** Drop chunks that finished before `now` (keeps the schedule bounded). */
  prune(now: number): void {
    let keep = 0
    while (keep < this.chunks.length && this.chunks[keep].endAt < now) keep++
    if (keep) this.chunks.splice(0, keep)
  }

  /** The chunk audible at `now`, or null between/after chunks. */
  positionAt(now: number): MusicPosition | null {
    for (const chunk of this.chunks) {
      if (now >= chunk.startAt && now < chunk.endAt) {
        const intoChunk = now - chunk.startAt
        return { chunk, intoChunk, streamSeconds: chunk.offsetSeconds + intoChunk }
      }
    }
    return null
  }

  /** Forget the pending schedule (stop/underrun); the stream clock keeps counting. */
  clear(): void {
    this.chunks = []
  }

  get scheduledSeconds(): number {
    return this.streamOffset
  }
}

/** `m:ss.t` for a chunk boundary readout (tenths, since chunks are seconds long). */
export function formatPosition(seconds: number): string {
  const whole = Math.max(0, seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole - minutes * 60
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`
}

/** The text the deck sends to the Live agent for an edit pinned to one chunk window. */
export function musicEditMessage(position: MusicPosition, prompts: { text: string; weight: number }[], instruction: string): string {
  const start = formatPosition(position.chunk.offsetSeconds)
  const end = formatPosition(position.chunk.offsetSeconds + position.chunk.durationSeconds)
  const inEffect = prompts.length ? prompts.map((prompt) => `${prompt.text} ×${prompt.weight}`).join(', ') : 'none'
  return `[music edit at ${start}–${end}] Prompts in effect: ${inEffect}. Steer the live music from now on: ${instruction.trim()}`
}
