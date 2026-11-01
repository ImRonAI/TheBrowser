import { useCallback, useRef } from 'react'
import { decodeMusicPcm16 } from '@/lib/voice-events'
import { ChunkSchedule, type MusicPosition } from '@/lib/music-position'

/**
 * Scheduled playback for Lyria RealTime `music_audio_delta` frames (48 kHz stereo
 * PCM16, 2 s per chunk, generated roughly in real time). Separate from the voice
 * sink (`useLivePlayback`, 24 kHz mono) so barge-in never cuts the music and the
 * music has its own gain, lead buffer and analyser.
 *
 * `LEAD_SECONDS` of audio is queued before the first chunk starts so network and
 * generation jitter do not produce gaps; a backlog over `MAX_BACKLOG_SECONDS` is
 * dropped so a stalled tab does not drift minutes behind the stream.
 */
const LEAD_SECONDS = 2
const MAX_BACKLOG_SECONDS = 20

export function useMusicPlayback(onPlaying: (playing: boolean) => void) {
  const context = useRef<AudioContext | null>(null)
  const gain = useRef<GainNode | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const bins = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const nodes = useRef(new Set<AudioBufferSourceNode>())
  const playAt = useRef(0)
  const started = useRef(false)
  /** Every scheduled chunk's [start, end): the finest position Lyria RealTime lets a client name. */
  const schedule = useRef(new ChunkSchedule())
  /** Last requested volume; applied when the GainNode is created so a pre-start setVolume is not lost. */
  const volume = useRef(1)
  const notify = useRef(onPlaying)
  notify.current = onPlaying

  const start = useCallback(async (): Promise<boolean> => {
    if (!context.current) {
      const sink = new AudioContext({ sampleRate: 48000 })
      context.current = sink
      gain.current = sink.createGain()
      gain.current.gain.value = volume.current
      analyser.current = sink.createAnalyser()
      analyser.current.fftSize = 2048
      analyser.current.smoothingTimeConstant = 0.6
      gain.current.connect(analyser.current)
      analyser.current.connect(sink.destination)
      bins.current = new Uint8Array(new ArrayBuffer(analyser.current.frequencyBinCount))
    }
    try { await context.current.resume(); return true } catch { return false }
  }, [])

  const stop = useCallback(() => {
    nodes.current.forEach((node) => { try { node.stop() } catch { /* Already ended. */ } })
    nodes.current.clear()
    schedule.current.clear()
    playAt.current = 0
    started.current = false
    notify.current(false)
  }, [])

  const close = useCallback(() => {
    stop()
    void context.current?.close()
    context.current = null
    gain.current = null
    analyser.current = null
    bins.current = null
  }, [stop])

  const setVolume = useCallback((value: number) => {
    volume.current = Math.max(0, Math.min(1, value))
    if (gain.current) gain.current.gain.value = volume.current
  }, [])

  const play = useCallback((frame: Record<string, unknown>) => {
    const sink = context.current
    const out = gain.current
    if (!sink || !out) return
    const decoded = decodeMusicPcm16(frame)
    if (!decoded) return
    const buffer = sink.createBuffer(decoded.channels, decoded.frames, decoded.sampleRate)
    for (let channel = 0; channel < decoded.channels; channel++) buffer.getChannelData(channel).set(decoded.samples[channel])
    const node = sink.createBufferSource()
    node.buffer = buffer
    node.connect(out)
    if (!started.current || playAt.current < sink.currentTime) {
      // First chunk after start/underrun: schedule with a lead so the next chunk has time to arrive.
      playAt.current = sink.currentTime + LEAD_SECONDS
      started.current = true
    }
    if (playAt.current - sink.currentTime > MAX_BACKLOG_SECONDS) { stop(); playAt.current = sink.currentTime + LEAD_SECONDS; started.current = true }
    node.start(playAt.current)
    schedule.current.prune(sink.currentTime)
    schedule.current.add(playAt.current, buffer.duration)
    playAt.current += buffer.duration
    nodes.current.add(node)
    notify.current(true)
    node.onended = () => { nodes.current.delete(node); if (!nodes.current.size) notify.current(false) }
  }, [stop])

  /** Byte frequency data of the music currently audible, with the bin width in Hz; null when silent. */
  const frequencyData = useCallback((): { data: Uint8Array; binHz: number } | null => {
    const sink = context.current, tap = analyser.current, data = bins.current
    if (!sink || !tap || !data || !nodes.current.size) return null
    tap.getByteFrequencyData(data)
    return { data, binHz: sink.sampleRate / tap.fftSize }
  }, [])

  /** The chunk audible right now (its [start, end) window and stream offset); null when nothing is playing. */
  const position = useCallback((): MusicPosition | null => {
    const sink = context.current
    return sink ? schedule.current.positionAt(sink.currentTime) : null
  }, [])

  return { start, stop, close, play, setVolume, frequencyData, position }
}
