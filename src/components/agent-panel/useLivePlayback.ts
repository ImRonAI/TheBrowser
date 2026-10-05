import { useCallback, useRef } from 'react'
import { decodePcm16 } from '@/lib/voice-events'

/**
 * Scheduled PCM16 playback for native `bidi_audio_delta` frames. Shared by the
 * Live panel and the Teaching Studio so both speak with the same sink and the
 * same barge-in semantics (`stop()` flushes everything scheduled).
 */
export function useLivePlayback(onPlaying: (playing: boolean) => void) {
  const context = useRef<AudioContext | null>(null)
  const nodes = useRef(new Set<AudioBufferSourceNode>())
  const playAt = useRef(0)
  const notify = useRef(onPlaying)
  notify.current = onPlaying

  const start = useCallback(async (): Promise<boolean> => {
    if (!context.current) context.current = new AudioContext()
    try { await context.current.resume(); return true } catch { return false }
  }, [])

  const stop = useCallback(() => {
    nodes.current.forEach((node) => { try { node.stop() } catch { /* Already ended. */ } })
    nodes.current.clear()
    playAt.current = 0
    notify.current(false)
  }, [])

  const close = useCallback(() => {
    stop()
    void context.current?.close()
    context.current = null
  }, [stop])

  const play = useCallback((frame: Record<string, unknown>) => {
    const sink = context.current
    if (!sink) return
    const decoded = decodePcm16(frame)
    if (!decoded) return
    const buffer = sink.createBuffer(decoded.channels, decoded.frames, decoded.sampleRate)
    for (let channel = 0; channel < decoded.channels; channel++) buffer.getChannelData(channel).set(decoded.samples[channel])
    const node = sink.createBufferSource()
    node.buffer = buffer
    node.connect(sink.destination)
    playAt.current = Math.max(sink.currentTime, playAt.current)
    // More than 15 s queued means the sink fell behind; drop the backlog instead of drifting.
    if (playAt.current - sink.currentTime > 15) stop()
    node.start(Math.max(sink.currentTime, playAt.current))
    playAt.current = Math.max(sink.currentTime, playAt.current) + buffer.duration
    nodes.current.add(node)
    notify.current(true)
    node.onended = () => { nodes.current.delete(node); if (!nodes.current.size) notify.current(false) }
  }, [stop])

  return { start, stop, close, play }
}
