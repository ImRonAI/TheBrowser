"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WebPreview, WebPreviewBody } from '@/components/ai-elements/web-preview'
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { MessageResponse } from '@/components/ai-elements/response'
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from '@/components/ai-elements/chain-of-thought'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ai-elements/accordion'
import { Button } from '@/components/ai-elements/button'
import { MicIcon, MicOffIcon, MonitorUpIcon, CameraIcon, SquareIcon, PauseIcon, PhoneIcon, RefreshCwIcon } from 'lucide-react'
import { VoiceSettings } from './VoiceSettings'
import { useVoiceSettingsStore } from '@/stores/voiceSettingsStore'
import { micConstraints, isMicUnavailableError, personaState, personaCaption } from '@/lib/voice-settings'
import {
  EMPTY_LIVE_STATE, authFrame, canHandOff, contextFrame, isIssueScope, isScopeBlocker, liveQuery, pendingTools,
  reduceLiveEvent, withPlayback, type LiveContext, type LiveContextTurn, type LiveState, type LiveTurn,
} from '@/lib/voice-events'
import { liveKey, liveOwner, liveTurnsFor, useLiveSessionStore } from '@/stores/liveSessionStore'
import { acquireScreenCapture, clearLiveTools, noteLiveTools, rememberSnapshot } from '@/stores/agentPresenceStore'
import { cn } from '@/utils/cn'
import { recordingCanSend, recordingMimeType } from '@/lib/bidi-recording'
import pcmWorkletUrl from '@/lib/bidi-pcm.worklet.js?url'
import { getAccessToken } from '@/api/supabase'
import { useLivePlayback } from './useLivePlayback'
import { useMusicPlayback } from './useMusicPlayback'
import { useLiveMusicStore } from '@/stores/liveMusicStore'
import { useMascotStore } from '@/stores/mascotStore'
import { genreFromPrompts } from '@/lib/mascot'
import { COMPACT_SCALE, OubliStage, PINNED_SCALE } from './OubliStage'
import { LIVE_API_BASE_URL } from '@/pages/types/api'
import { checkLiveApi, liveSocketUrl } from '@/lib/live-api'
import { projectEndpoint } from '@/lib/project-endpoint'

type Capture = { stream: MediaStream; recorder: MediaRecorder }

/** Graceful stop: how long to wait for `bidi_connection_stop` before force-closing. */
const STOP_GRACE_MS = 15_000

export interface VoiceAgentProps {
  userId?: string
  agentScope?: string
  browser?: 'user' | 'cloud'
  /** Panel session id (or issue id) the Live session is paired with. */
  conversationId: string
  /** Visible Chat history to share as context; never includes tool calls. */
  sharedHistory?: LiveContextTurn[]
  /** Issue scope: the saved issue, read-only context. */
  issue?: { id: string; title?: string; description?: string }
  /** Pending external prompt (Ask Ron) is consumed through this surface when it is the visible mode. */
  externalPrompt?: string | null
  onExternalPromptConsumed?: () => void
  /** Called by the parent before switching modes; resolves false when tools are still pending. */
  registerHandOff?: (handOff: (() => Promise<boolean>) | null) => void
  /** Which view owns this conversation's socket; a second view sees a blocker instead of a second session. */
  owner?: string
  compact?: boolean
}

export function VoiceAgent({ userId = 'default', agentScope = 'panel', browser = 'user', conversationId, sharedHistory, issue,
  externalPrompt, onExternalPromptConsumed, registerHandOff, owner = 'panel', compact = false }: VoiceAgentProps) {
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE_STATE)
  const historyKey = liveKey(userId, agentScope, conversationId)
  const savedTurns = useLiveSessionStore((s) => liveTurnsFor(s, historyKey))
  const holder = useLiveSessionStore((s) => liveOwner(s, historyKey))
  const claimed = holder === owner
  const [source, setSource] = useState<'screen' | 'camera' | null>(null)
  const [mic, setMic] = useState(false)
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(false)
  const socket = useRef<WebSocket | null>(null)
  const capture = useRef<Capture | null>(null)
  const capturePending = useRef(false)
  const generation = useRef(0)
  const microphone = useRef<MediaStream | null>(null)
  const micAudio = useRef<AudioContext | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const state = useRef(live)
  state.current = live
  const stopResolvers = useRef<((closed: boolean) => void)[]>([])
  const stopAcknowledged = useRef(false)
  const settings = useVoiceSettingsStore()
  const status = live.status
  const apiBaseUrl = isIssueScope(agentScope) ? projectEndpoint(userId, LIVE_API_BASE_URL) : LIVE_API_BASE_URL

  const commit = useCallback((next: LiveState) => { state.current = next; setLive(next); noteLiveTools(historyKey, next.turns) }, [historyKey])
  const sink = useLivePlayback(useCallback((playing: boolean) => commit(withPlayback(state.current, playing)), [commit]))
  // Lyria RealTime audio (`music_audio_delta`) has its own 48 kHz stereo sink; barge-in never cuts it.
  const musicSink = useMusicPlayback(useCallback((playing: boolean) => useLiveMusicStore.getState().publish({ playing }), []))
  const musicStore = useLiveMusicStore
  useEffect(() => {
    if (agentScope !== 'panel') return
    musicStore.getState().publish({ liveStatus: live.status, available: Boolean(live.musicAvailable), music: live.music, agentId: live.agentId, userId })
  }, [agentScope, live.status, live.musicAvailable, live.music, live.agentId, userId, musicStore])
  // Oubli: the analyser taps (voice = mouth, music = body), Live flags, costume and beat clock.
  useEffect(() => {
    if (agentScope !== 'panel') return
    useMascotStore.getState().attachTaps({ voice: sink.frequencyData, music: musicSink.frequencyData })
    return () => { useMascotStore.getState().attachTaps({ voice: null, music: null }); useMascotStore.getState().set({ liveOpen: false, thinking: false, working: false, musicOn: false, genre: null, bpm: 0 }) }
  }, [agentScope, sink.frequencyData, musicSink.frequencyData])
  useEffect(() => {
    if (agentScope !== 'panel') return
    const bpm = typeof live.music.config.bpm === 'number' ? live.music.config.bpm : 0
    useMascotStore.getState().set({
      liveOpen: live.status === 'ready', thinking: live.processing, working: live.turns.some((turn) => turn.kind === 'tool' && !turn.final),
      musicOn: live.music.connected && live.music.playback === 'playing', genre: genreFromPrompts(live.music.prompts), bpm,
    })
  }, [agentScope, live.status, live.processing, live.turns, live.music])

  function stopVideo() {
    const current = capture.current
    capture.current = null
    if (current) {
      current.recorder.ondataavailable = null
      current.recorder.onerror = null
      if (current.recorder.state !== 'inactive') current.recorder.stop()
      current.stream.getTracks().forEach(track => track.stop())
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'video_stop' }))
    }
    if (video.current) video.current.srcObject = null
    setSource(null)
  }

  useEffect(() => {
    if (source !== 'screen') return
    return acquireScreenCapture()
  }, [source])
  useEffect(() => () => clearLiveTools(historyKey), [historyKey])

  function stopMic() {
    const wasOn = microphone.current !== null
    microphone.current?.getTracks().forEach(track => track.stop())
    microphone.current = null
    void micAudio.current?.close()
    micAudio.current = null
    setMic(false)
    // Native RealtimeInput(audio_stream_end=True): tells Gemini the audio turn ended (manual end, not VAD).
    if (wasOn && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ realtime_input: { audio_stream_end: true } }))
  }

  function stopPlayback() { sink.stop() }

  /** Hard teardown. Pending tool results on the server are abandoned, never replayed. */
  function disconnect() {
    generation.current++
    stopVideo()
    stopMic()
    stopPlayback()
    const ws = socket.current
    socket.current = null
    ws?.close()
    sink.close()
    musicSink.close()
    setStopping(false)
    useLiveSessionStore.getState().release(historyKey, owner)
    commit({ ...EMPTY_LIVE_STATE, turns: state.current.turns, journalHtml: state.current.journalHtml, journalSaved: state.current.journalSaved,
      model: state.current.model, voice: state.current.voice, effort: state.current.effort, unknownResults: state.current.unknownResults,
      historySource: state.current.historySource })
    stopResolvers.current.splice(0).forEach((resolve) => resolve(stopAcknowledged.current))
  }

  /**
   * Controlled hand-off: capture stops immediately, then the server is asked to
   * stop. Resolves false when tools are still pending and the user has to decide.
   */
  const gracefulStop = useCallback((force = false): Promise<boolean> => {
    const ws = socket.current
    if (state.current.unknownResults?.length && !ws) {
      if (!confirm('Some tool outcomes are unknown. Continue only after checking the affected files or pages. Have you checked them?')) return Promise.resolve(false)
      commit({ ...state.current, unknownResults: undefined })
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) { if (socket.current) disconnect(); return Promise.resolve(true) }
    stopVideo(); stopMic()
    stopPlayback()
    const gate = canHandOff(state.current)
    if (!gate.ok && !force) { setError(gate.reason ?? 'Live session is busy.'); return Promise.resolve(false) }
    setStopping(true)
    stopAcknowledged.current = false
    ws.send(JSON.stringify({ type: 'stop' }))
    return new Promise<boolean>((resolve) => {
      stopResolvers.current.push(resolve)
      window.setTimeout(() => {
        if (socket.current !== ws) return
        commit({ ...state.current, unknownResults: pendingTools(state.current).map(turn => turn.id) })
        setError('The server did not confirm stopping. Check pending tool outcomes before reconnecting or switching modes.')
        disconnect()
      }, STOP_GRACE_MS)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    registerHandOff?.(() => gracefulStop(false))
    return () => registerHandOff?.(null)
  }, [registerHandOff, gracefulStop])

  // Scope/browser/conversation changes end the paired session; the view keeps its turns.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => disconnect(), [userId, agentScope, browser, conversationId])

  const buildContext = useCallback(async (): Promise<LiveContext> => {
    let page: Record<string, unknown> = {}
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      page = (await Promise.race([
        window.electron?.browser?.getPanelContext?.(),
        new Promise<undefined>((resolve) => { deadline = setTimeout(() => resolve(undefined), 2000) }),
      ])) ?? {}
    } catch { /* Optional. */ }
    finally { if (deadline) clearTimeout(deadline) }
    return {
      page_url: typeof page.url === 'string' ? page.url : undefined,
      page_title: typeof page.title === 'string' ? page.title : undefined,
      selected_text: typeof page.selected_text === 'string' ? page.selected_text : undefined,
      page_text: typeof page.text === 'string' ? page.text : undefined,
      history: sharedHistory,
      issue,
    }
  }, [sharedHistory, issue])

  // Handshake (agent/api/endpoints/bidi.py `handshake`): the server waits for
  // the first client frame before `ready`, so the initial context goes out in
  // `onopen` right after the auth frame (empty context is still a frame). Later
  // sends are explicit user actions and become realtime/queued text. History is
  // incremental: only turns not yet sent on this socket go out, never a replay.
  const historySentUpTo = useRef(0)
  const sendContext = useCallback(async (target?: WebSocket) => {
    const ws = target ?? socket.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const built = await buildContext()
    const fullHistory = built.history ?? []
    const frame = contextFrame({ ...built, history: fullHistory.slice(historySentUpTo.current) })
    if (socket.current !== ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(frame))
    historySentUpTo.current = fullHistory.length
  }, [buildContext])

  async function connect() {
    if (socket.current || state.current.status !== 'idle') return
    if (!useLiveSessionStore.getState().claim(historyKey, owner)) {
      setError('This conversation already has a Live session open in another view. Stop it there first.')
      return
    }
    const epoch = generation.current
    setError('')
    commit({ ...state.current, status: 'connecting', error: undefined, errorCode: undefined, restartNotice: undefined })
    stopAcknowledged.current = false
    if (!await sink.start()) { setError('Audio output could not start.'); disconnect(); return }
    if (!await musicSink.start()) { setError('Music output could not start.'); disconnect(); return }
    try { await checkLiveApi(apiBaseUrl) }
    catch (cause) {
      if (epoch === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Live backend unavailable.')
        disconnect()
      }
      return
    }
    if (epoch !== generation.current) return
    const { model, voice, effort } = useVoiceSettingsStore.getState()
    const auth = authFrame(agentScope, { userId, accessToken: isIssueScope(agentScope) ? await getAccessToken() : null })
    if (epoch !== generation.current) return
    if (isIssueScope(agentScope) && !auth) {
      setError('Issue Live needs your signed-in session or guest workspace to authorize this task. Reload Projects and try again.')
      disconnect(); return
    }
    const params = liveQuery({ userId, agentScope, browser, model, voice, effort, conversationId })
    historySentUpTo.current = 0
    const ws = new WebSocket(`${liveSocketUrl(apiBaseUrl, '/bidi')}?${params}`)
    socket.current = ws
    const timeout = window.setTimeout(() => {
      if (socket.current === ws) { setError('Live connection timed out.'); disconnect() }
    }, 30000)
    ws.onopen = () => {
      if (socket.current !== ws) return
      if (auth) ws.send(JSON.stringify(auth))
      void sendContext(ws)
    }
    ws.onmessage = event => {
      if (socket.current !== ws) return
      let data: unknown
      try { data = JSON.parse(event.data) } catch { setError('Could not decode a Live event.'); return }
      const frame = data as { type?: string } | null
      if (frame?.type === 'bidi_audio_delta') { sink.play(data as Record<string, unknown>); return }
      if (frame?.type === 'music_audio_delta') {
        musicSink.play(data as Record<string, unknown>)
        commit(reduceLiveEvent(state.current, data).state)
        return
      }
      if (frame?.type === 'music_closed') musicSink.stop()
      if (frame?.type === 'tool_result') {
        const result = (data as { tool_result?: { content?: unknown } }).tool_result
        if (result) rememberSnapshot(result.content ?? result)
      }
      const { state: next, effects } = reduceLiveEvent(state.current, data)
      recordFinalTurns(state.current, next)
      commit(next)
      if (agentScope === 'panel') {
        const mascot = useMascotStore.getState()
        if (frame?.type === 'bidi_reasoning_delta') mascot.thought({ kind: 'delta', text: String((data as { delta?: unknown }).delta ?? '') })
        else if (frame?.type === 'bidi_reasoning_block') { mascot.thought({ kind: 'clear' }); mascot.thought({ kind: 'delta', text: String((data as { text?: unknown }).text ?? '') }) }
        else if (frame?.type === 'bidi_response_stop' || frame?.type === 'bidi_barge_in') mascot.thought({ kind: 'settle' })
        else if (frame?.type === 'bidi_response_start') mascot.thought({ kind: 'clear' })
      }
      if (frame?.type === 'ready') clearTimeout(timeout)
      if (frame?.type === 'error') { clearTimeout(timeout); setError(next.error ?? 'Live session failed.') }
      for (const effect of effects) {
        if (effect === 'stop_playback') stopPlayback()
        if (effect === 'close' && !stopResolvers.current.length) { clearTimeout(timeout); disconnect() }
      }
      // `stopped` is the server's stop acknowledgement (close 1000 follows); resolve the hand-off now.
      if (frame?.type === 'stopped') {
        stopAcknowledged.current = !next.unknownResults?.length
        clearTimeout(timeout); disconnect()
      }
    }
    ws.onerror = () => setError(`Cannot reach the Live agent at ${apiBaseUrl}.`)
    ws.onclose = () => {
      clearTimeout(timeout)
      if (socket.current !== ws) return
      const pending = pendingTools(state.current).map(turn => turn.id)
      if (!stopAcknowledged.current && pending.length) {
        commit({ ...state.current, unknownResults: pending })
        setError('The connection closed before tool results arrived. Check the affected work before continuing.')
      }
      disconnect()
    }
  }

  /** Final transcript/text turns are kept in the per-conversation store so Chat can show them read-only. */
  function recordFinalTurns(previous: LiveState, next: LiveState) {
    if (previous.turns === next.turns) return
    const before = new Map(previous.turns.map((turn) => [turn.id, turn]))
    for (const turn of next.turns) {
      if (turn.kind === 'tool' || !turn.final || !turn.text.trim()) continue
      const old = before.get(turn.id)
      if (old?.final && old.text === turn.text) continue
      useLiveSessionStore.getState().record(historyKey, { id: turn.id, role: turn.role, text: turn.text.trim(), kind: turn.kind, at: Date.now() })
    }
  }

  async function startVideo(kind: 'screen' | 'camera') {
    if (capturePending.current || capture.current || status !== 'ready') return
    capturePending.current = true
    const epoch = generation.current
    const ws = socket.current
    let stream: MediaStream | null = null
    try {
      setError('')
      const mimeType = recordingMimeType(type => MediaRecorder.isTypeSupported(type))
      stream = kind === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
        : await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 15 }, audio: false })
      if (epoch !== generation.current || ws?.readyState !== WebSocket.OPEN) { stream.getTracks().forEach(track => track.stop()); return }
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 })
      capture.current = { stream, recorder }
      ws.send(JSON.stringify({ type: 'video_start', source: kind, mime_type: mimeType }))
      recorder.ondataavailable = event => {
        if (!event.data.size || capture.current?.recorder !== recorder) return
        if (ws.readyState !== WebSocket.OPEN || !recordingCanSend(ws.bufferedAmount, event.data.size)) {
          setError('Video transport fell behind. Sharing stopped rather than sending stale/corrupt video.')
          stopVideo()
          return
        }
        ws.send(event.data)
      }
      recorder.onerror = () => { setError('Screen/camera recording failed.'); stopVideo() }
      stream.getVideoTracks()[0].onended = stopVideo
      if (video.current) video.current.srcObject = stream
      recorder.start(250)
      setSource(kind)
    } catch (cause) {
      stream?.getTracks().forEach(track => track.stop())
      stopVideo()
      setError(cause instanceof Error ? cause.message : 'Capture permission was denied.')
    } finally { capturePending.current = false }
  }

  async function startMic() {
    const epoch = generation.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia(micConstraints(useVoiceSettingsStore.getState().micDeviceId))
      if (epoch !== generation.current || microphone.current) { stream.getTracks().forEach(track => track.stop()); return }
      microphone.current = stream
      const context = new AudioContext({ sampleRate: 16000 })
      micAudio.current = context
      await context.audioWorklet.addModule(pcmWorkletUrl)
      if (epoch !== generation.current || micAudio.current !== context) return
      const node = new AudioWorkletNode(context, 'ron-pcm')
      let pending: number[] = []
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (socket.current?.readyState !== WebSocket.OPEN || micAudio.current !== context) return
        pending.push(...event.data)
        if (pending.length < 1600) return
        const bytes = new Uint8Array(pending.length * 2)
        const view = new DataView(bytes.buffer)
        pending.forEach((value, i) => view.setInt16(i * 2, Math.max(-1, Math.min(1, value)) * 32767, true))
        pending = []
        if (socket.current.bufferedAmount > 256 * 1024) { setError('Microphone transport fell behind.'); stopMic(); return }
        socket.current.send(JSON.stringify({ audio_delta: { format: 'pcm', source: { bytes: btoa(String.fromCharCode(...bytes)) } } }))
      }
      context.createMediaStreamSource(stream).connect(node)
      const silent = context.createGain()
      silent.gain.value = 0
      node.connect(silent).connect(context.destination)
      await context.resume()
      setMic(true)
    } catch (cause) {
      stopMic()
      if (isMicUnavailableError(cause)) {
        useVoiceSettingsStore.getState().setMicDeviceId(undefined)
        setError('The selected microphone is unavailable. Choose another microphone.')
      } else setError(cause instanceof Error ? cause.message : 'Microphone unavailable.')
    }
  }

  const sendText = useCallback((value: string) => {
    const ws = socket.current
    if (!value.trim() || ws?.readyState !== WebSocket.OPEN || state.current.status !== 'ready') return false
    ws.send(JSON.stringify({ text: value }))
    const id = `typed-${crypto.randomUUID()}`
    commit({ ...state.current, processing: true, activity: 'thinking',
      turns: [...state.current.turns, { id, role: 'user', kind: 'text', text: value, final: true }] })
    useLiveSessionStore.getState().record(historyKey, { id, role: 'user', text: value.trim(), kind: 'text', at: Date.now() })
    return true
  }, [commit])

  // Ask Ron while Live is the visible mode: dispatch here, never to the hidden Chat session.
  useEffect(() => {
    if (!externalPrompt || status !== 'ready') return
    if (sendText(externalPrompt)) onExternalPromptConsumed?.()
  }, [externalPrompt, status, sendText, onExternalPromptConsumed])

  // The music side panel (`MusicSidePanel`, outside this component) drives the sink's volume, reads the
  // audible chunk for its Edit box and sends that edit to this Live agent as a typed turn.
  useEffect(() => {
    if (agentScope !== 'panel') return
    musicStore.getState().attach({ setVolume: musicSink.setVolume, position: musicSink.position, sendText })
    return () => { musicStore.getState().attach(null); musicStore.getState().reset() }
  }, [agentScope, musicSink.setVolume, musicSink.position, sendText, musicStore])

  const agentSpeaking = status === 'ready' && (live.playing || live.turns.some((turn) => turn.role === 'assistant' && turn.kind !== 'tool' && !turn.final))
  const presence = agentSpeaking ? 'speaking' : personaState(status, live.activity)
  const caption = personaCaption(status, live.activity, mic, source)
  const active = !!source || mic || live.playing
  const pending = pendingTools(live)
  const blocker = isScopeBlocker(live.errorCode) ? live.error : null
  // While disconnected, show the per-conversation saved transcript (same source Chat reads);
  // while connected, the live reducer turns (which include tool cards and streaming deltas).
  const turns = useMemo<LiveTurn[]>(() => status === 'idle' && !live.turns.length
    ? savedTurns.map((turn) => ({ id: turn.id, role: turn.role, kind: turn.kind, text: turn.text, final: true }))
    : live.turns, [status, live.turns, savedTurns])
  const foreignOwner = Boolean(holder) && !claimed

  const iconButton = 'size-9'
  return <div className="relative flex h-full min-h-0 w-full flex-1 flex-col">
      {active && <div aria-hidden className="pointer-events-none absolute inset-2 z-0 rounded-2xl border-2 border-indigo-500/60 shadow-glow-accent motion-safe:animate-pulse-subtle" />}
      <div className="relative z-[1] flex min-h-0 flex-1 basis-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-thin px-4 pb-4 pt-4">
        {foreignOwner && <div role="alert" className="rounded-xl border border-amber-300/60 bg-amber-50/80 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
          A Live session for this conversation is already open in another view ({holder}). Stop it there before connecting here.
        </div>}
        <section aria-label="Agent presence" className="mb-4 flex w-full shrink-0 flex-col items-center gap-1 [&>.oubli-frame]:w-full">
          {agentScope === 'panel'
            ? <OubliStage pinned scale={compact ? COMPACT_SCALE : PINNED_SCALE} />
            : <div aria-hidden className={cn('rounded-full bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 shadow-lg shadow-indigo-600/30', presence === 'speaking' && 'motion-safe:animate-pulse')} style={{ width: compact ? 48 : 72, height: compact ? 48 : 72 }} />}
          <p role="status" className="flex items-center gap-2 text-xs font-medium text-ink-muted dark:text-ink-inverse-muted">
            <span aria-hidden className={cn('h-2 w-2 rounded-full', status === 'ready' ? 'bg-indigo-500' : status === 'connecting' ? 'bg-amber-400 motion-safe:animate-pulse' : 'bg-surface-300 dark:bg-surface-600')} />
            {stopping ? 'Finishing pending work…' : caption}{status === 'ready' && live.processing && !live.playing ? ' · working' : ''}
          </p>
        </section>
        <div className="flex shrink-0 items-center justify-center gap-2">
          <Button type="button" size="icon" variant="outline" className={iconButton} disabled={status !== 'ready' || stopping} aria-pressed={mic} aria-label={mic ? 'Mute microphone' : 'Enable microphone'} onClick={() => mic ? stopMic() : void startMic()}>
            {mic ? <MicIcon /> : <MicOffIcon />}
          </Button>
          <Button type="button" size="icon" variant="outline" className={iconButton} disabled={status !== 'ready' || !!source || stopping} aria-label="Share screen" onClick={() => void startVideo('screen')}><MonitorUpIcon /></Button>
          <Button type="button" size="icon" variant="outline" className={iconButton} disabled={status !== 'ready' || !!source || stopping} aria-label="Share camera" onClick={() => void startVideo('camera')}><CameraIcon /></Button>
          {source && <Button type="button" size="icon" variant="outline" className={iconButton} aria-label="Stop sharing" onClick={stopVideo}><SquareIcon /></Button>}
          <Button type="button" size="icon" variant="outline" className={iconButton} disabled={status !== 'ready' || stopping} aria-label="Share current page and conversation as context" onClick={() => void sendContext()}><RefreshCwIcon /></Button>
          {status === 'ready' && <Button type="button" size="icon" variant="outline" className={iconButton} disabled={stopping} aria-label="Pause Live session" onClick={() => void gracefulStop(true)}><PauseIcon /></Button>}
        </div>
        <Accordion type="single" collapsible className="rounded-xl border border-surface-200 px-3 dark:border-surface-700">
          <AccordionItem value="conversation" className="border-none">
            <AccordionTrigger className="py-3 text-xs hover:no-underline">Live conversation</AccordionTrigger>
            <AccordionContent>
              <VoiceSettings micDeviceId={settings.micDeviceId} onMicDeviceChange={settings.setMicDeviceId} micLocked={mic}
                model={settings.model} onModelChange={settings.setModel}
                voice={settings.voice} onVoiceChange={settings.setVoice} effort={settings.effort} onEffortChange={settings.setEffort}
                sessionLocked={status !== 'idle'} />
              <Conversation className="relative mt-3 min-h-[12rem]">
                <ConversationContent className="gap-3 p-0">
                  {!turns.length && !live.reasoning && <ConversationEmptyState title="Nothing yet" description="Spoken and typed turns appear here." className="py-6 text-xs" />}
                  <LiveTranscript turns={turns} reasoning={live.reasoning} streaming={live.processing} />
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        {status !== 'ready' && <Button type="button" className="mt-8 w-full" onClick={() => void connect()}
          disabled={status === 'connecting' || stopping || foreignOwner}
          aria-label="Connect Live">
          <PhoneIcon />
          {status === 'connecting' ? 'Connecting…' : 'Connect Live'}
        </Button>}
        {live.warnings.map((warning) => <p key={warning} role="status" className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/20">{warning}</p>)}
        {live.restartNotice && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/20">{live.restartNotice}</p>}
        {live.unknownResults?.length ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/20">
          Stopped with {live.unknownResults.length} tool result{live.unknownResults.length === 1 ? '' : 's'} unknown. Nothing was replayed; check the affected files or pages before continuing.
        </p> : null}
        <video ref={video} autoPlay muted playsInline className={source ? 'w-full rounded-xl bg-black shadow-lg' : 'hidden'} />
        {blocker && <div role="alert" className="rounded-xl border border-red-300/60 bg-red-50/80 p-3 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-semibold">Live is not available for this {isIssueScope(agentScope) ? 'issue' : 'agent'}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{blocker}</p>
        </div>}
        {error && !blocker && <div role="alert" className="rounded-xl border border-red-300/60 bg-red-50/80 p-3 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"><p className="whitespace-pre-wrap break-words">{error}</p></div>}
        {pending.length > 0 && <p role="status" className="text-[11px] text-ink-muted dark:text-ink-inverse-muted">{pending.length} tool call{pending.length === 1 ? '' : 's'} running · switching to Chat waits for them</p>}
        {live.journalHtml && <details className="rounded-xl border border-surface-200 p-3 dark:border-surface-700">
          <summary className="cursor-pointer text-xs font-medium">Session journal · {live.journalSaved ? 'saved to configured storage' : 'save failed'}</summary>
          <WebPreview className="mt-3 h-72"><WebPreviewBody srcDoc={live.journalHtml} sandbox="" title="Live session journal" /></WebPreview>
        </details>}
      </div>
    </div>
}

function LiveTranscript({ turns, reasoning, streaming }: { turns: LiveTurn[]; reasoning: string; streaming: boolean }) {
  const tools = turns.filter((turn) => turn.kind === 'tool')
  const speech = turns.filter((turn) => turn.kind !== 'tool')
  const showChain = Boolean(reasoning.trim()) || tools.length > 0
  return <>
    {speech.map((turn) => <Message key={turn.id} from={turn.role}>
      <MessageContent variant={turn.role === 'assistant' ? 'flat' : 'contained'} className={cn('min-w-0 text-body-sm', turn.role === 'user' && 'group-[.is-user]:bg-gradient-to-br group-[.is-user]:from-indigo-600 group-[.is-user]:to-indigo-800 group-[.is-user]:text-white')}>
        <MessageResponse>{turn.text || '…'}</MessageResponse>
      </MessageContent>
    </Message>)}
    {showChain && <ChainOfThought className="my-3 space-y-2 text-xs" defaultOpen={streaming} isStreaming={streaming}>
      <ChainOfThoughtHeader>{streaming ? 'Thinking…' : 'Chain of Thought'}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {reasoning.trim() && <ChainOfThoughtStep label="Thinking" status={streaming ? 'active' : 'complete'}>
          <p className="whitespace-pre-wrap break-words text-xs text-ink-muted dark:text-ink-inverse-muted">{reasoning}</p>
        </ChainOfThoughtStep>}
        {tools.map((turn) => <ChainOfThoughtStep key={turn.id} label={`Using ${turn.toolName ?? 'tool'}`}
          status={turn.cancelled ? 'complete' : turn.final ? 'complete' : 'active'}
          description={turn.cancelled ? 'cancelled' : turn.final ? 'done' : 'running…'}>
          {turn.toolInput !== undefined && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{typeof turn.toolInput === 'string' ? turn.toolInput : JSON.stringify(turn.toolInput, null, 2)}</pre>}
          {turn.text.trim() && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs opacity-80">{turn.text}</pre>}
        </ChainOfThoughtStep>)}
      </ChainOfThoughtContent>
    </ChainOfThought>}
  </>
}
