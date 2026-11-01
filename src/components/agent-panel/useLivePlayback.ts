import { useCallback, useRef } from 'react'
import { decodePcm16 } from '@/lib/voice-events'

/**
 * Scheduled PCM16 playback for native `bidi_audio_delta` frames. Shared by the
 * Live panel and the Teaching Studio so both speak with the same sink and the
 * same barge-in semantics (`stop()` flushes everything scheduled).
 *
 * Every buffer is routed through an `AnalyserNode` before the destination, so
 * `frequencyData()` describes exactly what the listener hears (there is no second
 * audio graph and no clock drift).
 */
export function useLivePlayback(onPlaying: (playing: boolean) => void) {
  const context = useRef<AudioContext | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const bins = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const nodes = useRef(new Set<AudioBufferSourceNode>())
  const playAt = useRef(0)
  const notify = useRef(onPlaying)
  notify.current = onPlaying

  const start = useCallback(async (): Promise<boolean> => {
    if (!context.current) {
      context.current = new AudioContext()
      analyser.current = context.current.createAnalyser()
      analyser.current.fftSize = 1024
      analyser.current.smoothingTimeConstant = 0.55
      analyser.current.connect(context.current.destination)
      bins.current = new Uint8Array(new ArrayBuffer(analyser.current.frequencyBinCount))
    }
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
    analyser.current = null
    bins.current = null
  }, [stop])

  const play = useCallback((frame: Record<string, unknown>) => {
    const sink = context.current
    const tap = analyser.current
    if (!sink || !tap) return
    const decoded = decodePcm16(frame)
    if (!decoded) return
    const buffer = sink.createBuffer(decoded.channels, decoded.frames, decoded.sampleRate)
    for (let channel = 0; channel < decoded.channels; channel++) buffer.getChannelData(channel).set(decoded.samples[channel])
    const node = sink.createBufferSource()
    node.buffer = buffer
    node.connect(tap)
    playAt.current = Math.max(sink.currentTime, playAt.current)
    // More than 15 s queued means the sink fell behind; drop the backlog instead of drifting.
    if (playAt.current - sink.currentTime > 15) stop()
    node.start(Math.max(sink.currentTime, playAt.current))
    playAt.current = Math.max(sink.currentTime, playAt.current) + buffer.duration
    nodes.current.add(node)
    notify.current(true)
    node.onended = () => { nodes.current.delete(node); if (!nodes.current.size) notify.current(false) }
  }, [stop])

  /** Byte frequency data of the audio currently playing, with the bin width in Hz; null when idle. */
  const frequencyData = useCallback((): { data: Uint8Array; binHz: number } | null => {
    const sink = context.current, tap = analyser.current, data = bins.current
    if (!sink || !tap || !data || !nodes.current.size) return null
    tap.getByteFrequencyData(data)
    return { data, binHz: sink.sampleRate / tap.fftSize }
  }, [])

  return { start, stop, close, play, frequencyData }
}
