"use client";

import { useCallback, useEffect, useRef, useState } from 'react'
import { WebPreview, WebPreviewBody } from '@/components/ai-elements/web-preview'
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { MessageResponse } from '@/components/ai-elements/response'
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from '@/components/ai-elements/chain-of-thought'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ai-elements/accordion'
import { Button } from '@/components/ai-elements/button'
import { AudioLinesIcon, ChevronDownIcon, MicIcon, MicOffIcon, MonitorUpIcon, CameraIcon, SquareIcon, PauseIcon, PhoneIcon, RefreshCwIcon } from 'lucide-react'
import { VoiceSettings } from './VoiceSettings'
import { useVoiceSettingsStore } from '@/stores/voiceSettingsStore'
import { micConstraints, isMicUnavailableError, personaState, personaCaption } from '@/lib/voice-settings'
import {
  EMPTY_LIVE_STATE, authFrame, canHandOff, contextFrame, isIssueScope, isScopeBlocker, liveQuery, pendingTools,
  reduceLiveEvent, withPlayback, type LiveContext, type LiveState, type LiveTurn,
} from '@/lib/voice-events'
import { liveKey, liveOwner, useLiveSessionStore } from '@/stores/liveSessionStore'
import { acquireScreenCapture, clearLiveTools, noteLiveTools, rememberSnapshot } from '@/stores/agentPresenceStore'
import { cn } from '@/utils/cn'
import { recordingCanSend, videoFrameMessage, VIDEO_FRAME_INTERVAL_MS } from '@/lib/bidi-recording'
import pcmWorkletUrl from '@/lib/bidi-pcm.worklet.js?url'
import { getAccessToken } from '@/api/supabase'
import { useLivePlayback } from './useLivePlayback'
import { useMusicPlayback } from './useMusicPlayback'
import { useLiveMusicStore } from '@/stores/liveMusicStore'
import { LIVE_API_BASE_URL } from '@/pages/types/api'
import { checkLiveApi, liveSocketUrl } from '@/lib/live-api'
import { projectEndpoint } from '@/lib/project-endpoint'

type Capture = { stream: MediaStream; timer: number }

/** Graceful stop: how long to wait for `bidi_connection_stop` before force-closing. */
const STOP_GRACE_MS = 15_000

/** Live console: round hairline controls. The live microphone is volt, Pause is ink, Stop sharing is danger. */
const CONSOLE_BUTTON = cn(
  'size-10 rounded-full border-surface-200 bg-surface-0 text-ink-secondary shadow-none transition-colors duration-150',
  'hover:bg-surface-50 hover:text-ink disabled:opacity-40',
  'focus-visible:ring-2 focus-visible:ring-blurple-600/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
  'dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse-secondary dark:hover:bg-surface-850 dark:hover:text-ink-inverse',
  'dark:focus-visible:ring-blurple-400/70 dark:focus-visible:ring-offset-surface-900',
)
const CONSOLE_VOLT = 'border-transparent bg-blurple-600 text-white hover:bg-blurple-700 hover:text-white active:bg-blurple-800 dark:border-transparent dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300 dark:hover:text-ink'
const CONSOLE_INK = 'border-transparent bg-ink text-white hover:bg-surface-800 hover:text-white dark:border-transparent dark:bg-ink-inverse dark:text-ink dark:hover:bg-surface-200 dark:hover:text-ink'
const CONSOLE_DANGER = 'border-transparent bg-danger text-white hover:bg-danger/90 hover:text-white dark:border-transparent dark:bg-danger dark:text-white dark:hover:bg-danger/90 dark:hover:text-white'
const WARNING_NOTE = 'rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
const DANGER_NOTE = 'rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'

export interface VoiceAgentProps {
  userId?: string
  agentScope?: string
  /** The native thread (`session_id`) this Live session opens: the BidiAgent restores and writes it natively. */
  sessionId: string
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

export function VoiceAgent({ userId = 'default', agentScope = 'panel', sessionId, issue,
  externalPrompt, onExternalPromptConsumed, registerHandOff, owner = 'panel', compact = false }: VoiceAgentProps) {
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE_STATE)
  // Live always drives the user's own browser; the server moves a thread to the cloud browser only on takeover.
  const browser = 'user' as const
  const conversationId = sessionId
  const historyKey = liveKey(userId, agentScope, sessionId)
  const holder = useLiveSessionStore((s) => liveOwner(s, historyKey))
  const claimed = holder === owner
  const [source, setSource] = useState<'screen' | 'camera' | null>(null)
  const [mic, setMic] = useState(false)
  const [error, setError] = useState('')
  const [permissionDeniedKind, setPermissionDeniedKind] = useState<'microphone' | 'camera' | null>(null)
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

  function stopVideo() {
    const current = capture.current
    capture.current = null
    if (current) {
      window.clearInterval(current.timer)
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
      issue,
    }
  }, [issue])

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
      setPermissionDeniedKind(null)
      if (kind === 'camera') {
        const access = await window.electron?.media?.ensureAccess('camera')
        if (access && !access.granted) {
          setPermissionDeniedKind('camera')
          setError('macOS blocked camera access for this app. Enable Camera permission in System Settings → Privacy & Security → Camera.')
          return
        }
      }
      stream = kind === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
        : await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 15 }, audio: false })
      if (epoch !== generation.current || ws?.readyState !== WebSocket.OPEN) { stream.getTracks().forEach(track => track.stop()); return }
      const canvas = document.createElement('canvas')
      const current: Capture = { stream, timer: 0 }
      capture.current = current
      ws.send(JSON.stringify({ type: 'video_start', source: kind, mime_type: 'image/jpeg' }))
      const sendFrame = () => {
        if (capture.current !== current || !video.current || ws.readyState !== WebSocket.OPEN) return
        try {
          const message = videoFrameMessage(video.current, canvas)
          if (!message) return
          if (!recordingCanSend(ws.bufferedAmount, message.length)) {
            setError('Video transport fell behind. Sharing stopped rather than sending stale video.')
            stopVideo()
            return
          }
          ws.send(message)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Screen/camera capture failed.')
          stopVideo()
        }
      }
      stream.getVideoTracks()[0].onended = stopVideo
      if (video.current) video.current.srcObject = stream
      current.timer = window.setInterval(sendFrame, VIDEO_FRAME_INTERVAL_MS)
      setSource(kind)
    } catch (cause) {
      stream?.getTracks().forEach(track => track.stop())
      stopVideo()
      const msg = cause instanceof Error ? cause.message : 'Capture permission was denied.'
      if (kind === 'camera' && (cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'PermissionDeniedError') || /permission denied/i.test(msg))) {
        setPermissionDeniedKind('camera')
        setError('macOS blocked camera access for this app. Enable Camera permission in System Settings → Privacy & Security → Camera.')
      } else {
        setError(msg)
      }
    } finally { capturePending.current = false }
  }

  async function startMic() {
    const epoch = generation.current
    try {
      setError('')
      setPermissionDeniedKind(null)
      const access = await window.electron?.media?.ensureAccess('microphone')
      if (access && !access.granted) {
        setPermissionDeniedKind('microphone')
        setError('macOS blocked microphone access for this app (or the terminal/IDE that launched it). Enable Microphone permission in System Settings → Privacy & Security → Microphone.')
        return
      }
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
      const msg = cause instanceof Error ? cause.message : 'Microphone unavailable.'
      if (isMicUnavailableError(cause)) {
        useVoiceSettingsStore.getState().setMicDeviceId(undefined)
        setError('The selected microphone is unavailable. Choose another microphone.')
      } else if (cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'PermissionDeniedError') || /permission denied/i.test(msg)) {
        setPermissionDeniedKind('microphone')
        setError('macOS blocked microphone access for this app (or the terminal/IDE that launched it). Enable Microphone permission in System Settings → Privacy & Security → Microphone.')
      } else setError(msg)
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
  // The thread's history lives in the native session (Threads list / `GET /sessions/{id}/thread`); this
  // view shows the turns of the current socket, which the BidiAgent restored into and appends to natively.
  const turns = live.turns
  const foreignOwner = Boolean(holder) && !claimed

  // Styling only: any active capture (screen, camera, microphone) reads as recording.
  const capturing = !!source || mic
  return <div className="relative flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 basis-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-thin px-4 pb-4 pt-4">
        {foreignOwner && <div role="alert" className={WARNING_NOTE}>
          A Live session for this conversation is already open in another view (<span className="font-mono">{holder}</span>). Stop it there before connecting here.
        </div>}
        <div className={cn('shrink-0 rounded-2xl border border-surface-200 bg-surface-0 px-3 pb-3 pt-2.5 dark:border-surface-800 dark:bg-surface-900', compact && 'pb-2.5 pt-2')}>
          <section aria-label="Live status" className={cn('flex w-full items-start justify-between gap-3 border-b border-surface-200 pb-2.5 dark:border-surface-800', compact && 'pb-2')}>
            <p role="status" className="flex min-w-0 items-start gap-2 pt-1 text-[13px] font-medium leading-snug text-ink dark:text-ink-inverse">
              <span aria-hidden className={cn('mt-[5px] size-2 shrink-0 rounded-full', status === 'ready' ? 'bg-success' : status === 'connecting' ? 'bg-amber-400' : 'bg-surface-300 dark:bg-surface-600')} />
              <span className="min-w-0">{stopping ? 'Finishing pending work…' : caption}{status === 'ready' && live.processing && !live.playing ? ' · working' : ''}</span>
            </p>
            {active && <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold',
              capturing ? 'bg-ink text-white dark:bg-ink-inverse dark:text-ink' : 'bg-surface-100 text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary')}>
              <span aria-hidden className={cn('size-1.5 rounded-full', capturing ? 'bg-danger' : 'bg-blurple-600 dark:bg-blurple-400')} />
              {source === 'screen' ? 'Sharing screen' : source === 'camera' ? 'Sharing camera' : mic ? 'Microphone on' : presence === 'speaking' ? 'Speaking' : 'Active'}
            </span>}
          </section>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-3">
            <Button type="button" size="icon" variant="outline" className={cn(CONSOLE_BUTTON, mic && CONSOLE_VOLT)} disabled={status !== 'ready' || stopping} aria-pressed={mic} aria-label={mic ? 'Mute microphone' : 'Turn on microphone'} title={mic ? 'Mute microphone' : 'Turn on microphone'} onClick={() => mic ? stopMic() : void startMic()}>
              {mic ? <MicIcon /> : <MicOffIcon />}
            </Button>
            <Button type="button" size="icon" variant="outline" className={CONSOLE_BUTTON} disabled={status !== 'ready' || !!source || stopping} aria-label="Share screen" title="Share screen" onClick={() => void startVideo('screen')}><MonitorUpIcon /></Button>
            <Button type="button" size="icon" variant="outline" className={CONSOLE_BUTTON} disabled={status !== 'ready' || !!source || stopping} aria-label="Share camera" title="Share camera" onClick={() => void startVideo('camera')}><CameraIcon /></Button>
            {source && <Button type="button" size="icon" variant="outline" className={cn(CONSOLE_BUTTON, CONSOLE_DANGER)} aria-label="Stop sharing" title="Stop sharing" onClick={stopVideo}><SquareIcon /></Button>}
            <Button type="button" size="icon" variant="outline" className={CONSOLE_BUTTON} disabled={status !== 'ready' || stopping} aria-label="Share current page and conversation as context" title="Share this page and conversation as context" onClick={() => void sendContext()}><RefreshCwIcon /></Button>
            {status === 'ready' && <Button type="button" size="icon" variant="outline" className={cn(CONSOLE_BUTTON, CONSOLE_INK)} disabled={stopping} aria-label="Pause Live session" title="Pause Live session" onClick={() => void gracefulStop(true)}><PauseIcon /></Button>}
          </div>
        </div>
        {status !== 'ready' && <Button type="button" className="h-10 w-full shrink-0 rounded-xl bg-blurple-600 text-[13px] font-semibold text-white shadow-none transition-colors duration-150 hover:bg-blurple-700 active:bg-blurple-800 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-blurple-600/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300 dark:focus-visible:ring-blurple-400/70 dark:focus-visible:ring-offset-surface-900" onClick={() => void connect()}
          disabled={status === 'connecting' || stopping || foreignOwner}
          aria-label="Connect Live">
          <PhoneIcon />
          {status === 'connecting' ? 'Connecting…' : 'Connect Live'}
        </Button>}
        <Accordion type="single" collapsible className="shrink-0 rounded-2xl border border-surface-200 bg-surface-0 px-3 dark:border-surface-800 dark:bg-surface-900">
          <AccordionItem value="conversation" className="border-none">
            <AccordionTrigger className="py-3 text-[13px] font-semibold text-ink hover:no-underline dark:text-ink-inverse">
              <span className="flex items-center gap-2">Live conversation{turns.length > 0 && <span aria-hidden className="font-mono text-[11px] font-medium tabular-nums text-ink-muted dark:text-ink-inverse-muted">{turns.length}</span>}</span>
            </AccordionTrigger>
            <AccordionContent>
              <VoiceSettings micDeviceId={settings.micDeviceId} onMicDeviceChange={settings.setMicDeviceId} micLocked={mic}
                model={settings.model} onModelChange={settings.setModel}
                voice={settings.voice} onVoiceChange={settings.setVoice} effort={settings.effort} onEffortChange={settings.setEffort}
                sessionLocked={status !== 'idle'} />
              <Conversation className="relative mt-4 min-h-[12rem] border-t border-surface-200 pt-4 dark:border-surface-800">
                <ConversationContent className="gap-3 p-0">
                  {!turns.length && !live.reasoning && <ConversationEmptyState icon={<AudioLinesIcon className="size-5" aria-hidden />} title="Nothing said yet" description="Talk or type. Every turn lands here." className="py-6 text-xs" />}
                  <LiveTranscript turns={turns} reasoning={live.reasoning} streaming={live.processing} />
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        {live.warnings.map((warning) => <p key={warning} role="status" className={WARNING_NOTE}>{warning}</p>)}
        {live.restartNotice && <p role="status" className={WARNING_NOTE}>{live.restartNotice}</p>}
        {live.unknownResults?.length ? <p role="status" className={WARNING_NOTE}>
          Stopped with <span className="font-mono tabular-nums">{live.unknownResults.length}</span> tool result{live.unknownResults.length === 1 ? '' : 's'} unknown. Nothing was replayed; check the affected files or pages before continuing.
        </p> : null}
        <video ref={video} autoPlay muted playsInline className={source ? 'w-full shrink-0 rounded-xl border border-surface-200 bg-surface-950 dark:border-surface-800' : 'hidden'} />
        {blocker && <div role="alert" className={DANGER_NOTE}>
          <p className="font-semibold">Live is not available for this {isIssueScope(agentScope) ? 'issue' : 'agent'}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{blocker}</p>
        </div>}
        {error && !blocker && <div role="alert" className={DANGER_NOTE}>
          <p className="whitespace-pre-wrap break-words">{error}</p>
          {permissionDeniedKind && window.electron?.media?.openSettings && (
            <Button type="button" size="sm" variant="outline" className="mt-2.5 h-8 rounded-lg border-red-200 bg-surface-0 px-3 text-xs font-semibold text-red-800 shadow-none hover:bg-red-100 hover:text-red-900 dark:border-red-900/60 dark:bg-surface-900 dark:text-red-200 dark:hover:bg-red-950/60 dark:hover:text-red-100"
              onClick={() => void window.electron?.media?.openSettings(permissionDeniedKind)}>
              Open {permissionDeniedKind === 'camera' ? 'Camera' : 'Microphone'} settings
            </Button>
          )}
        </div>}
        {pending.length > 0 && <p role="status" className="text-[11px] text-ink-muted dark:text-ink-inverse-muted"><span className="font-mono tabular-nums">{pending.length}</span> tool call{pending.length === 1 ? '' : 's'} running · switching to Chat waits for them</p>}
        {live.journalHtml && <details className="group shrink-0 rounded-2xl border border-surface-200 bg-surface-0 p-3 dark:border-surface-800 dark:bg-surface-900">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-ink dark:text-ink-inverse [&::-webkit-details-marker]:hidden">
            <span>Session journal</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn('truncate font-mono text-[11px] font-medium', live.journalSaved ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-300')}>{live.journalSaved ? 'saved to configured storage' : 'save failed'}</span>
              <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180 dark:text-ink-inverse-muted" />
            </span>
          </summary>
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
      <MessageContent variant={turn.role === 'assistant' ? 'flat' : 'contained'} className={cn('min-w-0 text-sm leading-relaxed', turn.role === 'user' && 'group-[.is-user]:bg-surface-100 group-[.is-user]:text-ink dark:group-[.is-user]:bg-surface-800 dark:group-[.is-user]:text-ink-inverse')}>
        <MessageResponse>{turn.text || '…'}</MessageResponse>
      </MessageContent>
    </Message>)}
    {showChain && <ChainOfThought className="my-3 space-y-2 text-xs" defaultOpen={streaming} isStreaming={streaming}>
      <ChainOfThoughtHeader>{streaming ? 'Thinking…' : 'Chain of thought'}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {reasoning.trim() && <ChainOfThoughtStep label="Thinking" status={streaming ? 'active' : 'complete'}>
          <p className="whitespace-pre-wrap break-words text-xs text-ink-muted dark:text-ink-inverse-muted">{reasoning}</p>
        </ChainOfThoughtStep>}
        {tools.map((turn) => <ChainOfThoughtStep key={turn.id} label={`Using ${turn.toolName ?? 'tool'}`}
          status={turn.cancelled ? 'complete' : turn.final ? 'complete' : 'active'}
          description={turn.cancelled ? 'cancelled' : turn.final ? 'done' : 'running…'}>
          {turn.toolInput !== undefined && <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-50 p-2 font-mono text-[11px] leading-relaxed text-ink-secondary scrollbar-thin dark:bg-surface-850 dark:text-ink-inverse-secondary">{typeof turn.toolInput === 'string' ? turn.toolInput : JSON.stringify(turn.toolInput, null, 2)}</pre>}
          {turn.text.trim() && <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-muted scrollbar-thin dark:text-ink-inverse-muted">{turn.text}</pre>}
        </ChainOfThoughtStep>)}
      </ChainOfThoughtContent>
    </ChainOfThought>}
  </>
}
