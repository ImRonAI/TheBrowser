"use client";

import { useEffect, useRef, useState } from 'react'
import { Persona, type PersonaState } from '@/components/ai-elements/persona'
import { WebPreview, WebPreviewBody } from '@/components/ai-elements/web-preview'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ButtonGroup } from '@/components/ui/button-group'
import { MicIcon, MicOffIcon, MonitorUpIcon, CameraIcon, SquareIcon, PhoneIcon, PhoneOffIcon, SendHorizontalIcon } from 'lucide-react'
import { VoiceSettings } from './VoiceSettings'
import { useVoiceSettingsStore } from '@/stores/voiceSettingsStore'
import { micConstraints, isMicUnavailableError, personaState, personaCaption, VOICE_MODEL_LABEL } from '@/lib/voice-settings'
import { cn } from '@/utils/cn'
import { recordingCanSend, recordingMimeType } from '@/lib/bidi-recording'
import pcmWorkletUrl from '@/lib/bidi-pcm.worklet.js?url'
import { RuntimeLoader } from '@rive-app/react-webgl2'
import riveWasmUrl from '@rive-app/webgl2/rive.wasm?url'
import { articleDraftKey, EMPTY_ARTICLE_DRAFT, useArticleDraftStore } from '@/stores/articleDraftStore'
import { ArticleAttachmentCard } from '@/components/interests/ArticleAttachmentCard'

// Rive defaults to fetching its runtime from unpkg/jsdelivr, which the app CSP
// (connect-src 'self' …) blocks, so the Persona never rendered. Serve the
// bundled copy from this origin instead.
RuntimeLoader.setWasmUrl(riveWasmUrl)

type Capture = { stream: MediaStream; recorder: MediaRecorder }

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-900'

export function VoiceAgent({ userId = 'default', agentScope = 'panel', browser = 'user' }: {
  userId?: string; agentScope?: string; browser?: 'user' | 'cloud'
}) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'ready'>('idle')
  const [activity, setActivity] = useState<PersonaState>('idle')
  const [source, setSource] = useState<'screen' | 'camera' | null>(null)
  const [mic, setMic] = useState(false)
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState('')
  const [text, setText] = useState('')
  const [journal, setJournal] = useState('')
  const [journalSaved, setJournalSaved] = useState(false)
  const draftKey = articleDraftKey(userId, 'voice')
  const attached = useArticleDraftStore((s) => (s.drafts[draftKey] || EMPTY_ARTICLE_DRAFT).articles)
  const socket = useRef<WebSocket | null>(null)
  const capture = useRef<Capture | null>(null)
  const capturePending = useRef(false)
  const generation = useRef(0)
  const microphone = useRef<MediaStream | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const micAudio = useRef<AudioContext | null>(null)
  const playback = useRef(new Set<AudioBufferSourceNode>())
  const playAt = useRef(0)
  const video = useRef<HTMLVideoElement | null>(null)

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

  function stopMic() {
    microphone.current?.getTracks().forEach(track => track.stop())
    microphone.current = null
    void micAudio.current?.close()
    micAudio.current = null
    setMic(false)
  }

  function stopPlayback() {
    playback.current.forEach(node => { try { node.stop() } catch { /* Already ended. */ } })
    playback.current.clear()
    playAt.current = 0
  }

  function disconnect() {
    generation.current++
    stopVideo()
    stopMic()
    stopPlayback()
    const ws = socket.current
    socket.current = null
    ws?.close()
    void audio.current?.close()
    audio.current = null
    setStatus('idle')
    setActivity('idle')
  }

  useEffect(() => () => disconnect(), [userId, agentScope, browser])

  async function connect() {
    if (socket.current) return
    const epoch = generation.current
    setError('')
    setStatus('connecting')
    audio.current = new AudioContext()
    try { await audio.current.resume() } catch { setError('Audio output could not start.'); disconnect(); return }
    if (epoch !== generation.current) return
    const params = new URLSearchParams({ user_id: userId, agent_scope: agentScope, browser })
    const ws = new WebSocket(`ws://localhost:8765/bidi?${params}`)
    socket.current = ws
    const timeout = window.setTimeout(() => {
      if (socket.current === ws) { setError('Voice connection timed out.'); disconnect() }
    }, 30000)
    ws.onmessage = event => {
      if (socket.current !== ws) return
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'ready') { clearTimeout(timeout); setStatus('ready'); setActivity('listening') }
        if (data.type === 'journal') { setJournal(data.html); setJournalSaved(data.saved) }
        if (data.type === 'error' || data.type === 'bidi_error') setError(data.message || 'Voice session failed.')
        if (data.type === 'bidi_transcript_delta') setTranscript(previous => (previous + data.delta).slice(-16000))
        if (data.type === 'bidi_interruption') { stopPlayback(); setActivity('listening') }
        if (data.type === 'bidi_audio_delta' && audio.current) {
          const bytes = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))
          const view = new DataView(bytes.buffer)
          const channels = data.channels || 1
          const frames = Math.floor(bytes.length / 2 / channels)
          if (!frames) return
          const buffer = audio.current.createBuffer(channels, frames, data.sample_rate || 24000)
          for (let channel = 0; channel < channels; channel++) {
            const samples = buffer.getChannelData(channel)
            for (let i = 0; i < frames; i++) samples[i] = view.getInt16((i * channels + channel) * 2, true) / 32768
          }
          const node = audio.current.createBufferSource()
          node.buffer = buffer
          node.connect(audio.current.destination)
          playAt.current = Math.max(audio.current.currentTime, playAt.current)
          if (playAt.current - audio.current.currentTime > 15) stopPlayback()
          node.start(Math.max(audio.current.currentTime, playAt.current))
          playAt.current = Math.max(audio.current.currentTime, playAt.current) + buffer.duration
          playback.current.add(node)
          setActivity('speaking')
          node.onended = () => { playback.current.delete(node); if (!playback.current.size) setActivity('listening') }
        }
      } catch { setError('Could not decode a voice event.') }
    }
    ws.onerror = () => setError('Cannot reach the voice API on localhost:8765.')
    ws.onclose = () => { clearTimeout(timeout); if (socket.current === ws) disconnect() }
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

  const settings = useVoiceSettingsStore()
  const presence = personaState(status, activity)
  const caption = personaCaption(status, activity, mic, source)
  const live = !!source || mic || activity === 'speaking'
  const iconButton = cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-surface-200/80 bg-white/70 text-ink shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-700 dark:bg-surface-850/80 dark:text-ink-inverse dark:hover:bg-surface-800', focus)

  return <TooltipProvider delayDuration={300}>
    <div className="relative flex size-full min-h-0 flex-col">
      {live && <div aria-hidden className="pointer-events-none absolute inset-2 z-0 rounded-2xl border-2 border-indigo-500/60 shadow-glow-accent motion-safe:animate-pulse-subtle" />}
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-thin px-4 pb-4 pt-6">
        <section aria-label="Agent presence" className="flex flex-col items-center gap-3">
          <Persona className="size-32" state={presence} variant="obsidian" />
          <div className="flex flex-col items-center gap-1 text-center">
            <p role="status" className="flex items-center gap-2 text-xs font-medium text-ink-muted dark:text-ink-inverse-muted">
              <span aria-hidden className={cn('h-2 w-2 rounded-full', status === 'ready' ? 'bg-indigo-500' : status === 'connecting' ? 'bg-amber-400 motion-safe:animate-pulse' : 'bg-surface-300 dark:bg-surface-600')} />
              {caption}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-ink-muted/80 dark:text-ink-inverse-muted/80">{VOICE_MODEL_LABEL}</p>
          </div>
        </section>
        <VoiceSettings micDeviceId={settings.micDeviceId} onMicDeviceChange={settings.setMicDeviceId} micLocked={mic}
          voice={settings.voice} onVoiceChange={settings.setVoice} effort={settings.effort} onEffortChange={settings.setEffort}
          sessionLocked={status !== 'idle'} />
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => status === 'idle' ? void connect() : disconnect()} disabled={status === 'connecting'}
            aria-label={status === 'idle' ? 'Connect voice' : 'Disconnect voice'}
            className={cn('inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold shadow-sm transition-colors disabled:opacity-60', focus,
              status === 'idle' ? 'bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-500'
                : 'border border-red-300/60 bg-red-50/80 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50')}>
            {status === 'idle' ? <PhoneIcon aria-hidden className="size-4" /> : <PhoneOffIcon aria-hidden className="size-4" />}
            <span className="truncate">{status === 'idle' ? 'Connect voice' : status === 'connecting' ? 'Connecting…' : 'Disconnect'}</span>
          </button>
          <Tooltip><TooltipTrigger asChild>
            <button type="button" disabled={status !== 'ready'} aria-pressed={mic} aria-label={mic ? 'Mute microphone' : 'Enable microphone'} onClick={() => mic ? stopMic() : void startMic()}
              className={cn(iconButton, mic && 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-200')}>
              {mic ? <MicIcon aria-hidden className="size-4" /> : <MicOffIcon aria-hidden className="size-4" />}
            </button>
          </TooltipTrigger><TooltipContent>{mic ? 'Mute microphone' : 'Enable microphone'}</TooltipContent></Tooltip>
          <ButtonGroup aria-label="Share" className="[&>*]:rounded-xl">
            <Tooltip><TooltipTrigger asChild><button type="button" className={iconButton} disabled={status !== 'ready' || !!source} aria-label="Share screen" onClick={() => void startVideo('screen')}><MonitorUpIcon aria-hidden className="size-4" /></button></TooltipTrigger><TooltipContent>Share screen</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><button type="button" className={iconButton} disabled={status !== 'ready' || !!source} aria-label="Share camera" onClick={() => void startVideo('camera')}><CameraIcon aria-hidden className="size-4" /></button></TooltipTrigger><TooltipContent>Share camera</TooltipContent></Tooltip>
            {source && <Tooltip><TooltipTrigger asChild><button type="button" onClick={stopVideo} aria-label="Stop sharing" className={cn(iconButton, 'border-red-300/60 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30')}><SquareIcon aria-hidden className="size-4" /></button></TooltipTrigger><TooltipContent>Stop sharing</TooltipContent></Tooltip>}
          </ButtonGroup>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-muted dark:text-ink-inverse-muted">Continuous recording goes to the voice API. Gemini receives backend-decoded video at up to 1 frame/second. Share one screen or camera at a time.</p>
        <video ref={video} autoPlay muted playsInline className={source ? 'w-full rounded-xl bg-black shadow-lg' : 'hidden'} />
        {error && <div role="alert" className="rounded-xl border border-red-300/60 bg-red-50/80 p-3 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"><p className="whitespace-pre-wrap break-words">{error}</p></div>}
        <section aria-label="Transcript" className="rounded-xl border border-surface-200 p-3 dark:border-surface-700">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">Transcript</h3>
          <p className={cn('mt-2 whitespace-pre-wrap break-words text-body-sm', !transcript && 'text-ink-muted dark:text-ink-inverse-muted')}>{transcript || 'Ron’s spoken replies appear here.'}</p>
        </section>
        {journal && <details className="rounded-xl border border-surface-200 p-3 dark:border-surface-700">
          <summary className="cursor-pointer text-xs font-medium">Session journal · {journalSaved ? 'saved to configured storage' : 'save failed'}</summary>
          <WebPreview className="mt-3 h-72"><WebPreviewBody srcDoc={journal} sandbox="" title="Voice session journal" /></WebPreview>
        </details>}
      </div>
      <footer className="relative z-[1] flex-shrink-0 border-t border-indigo-100/50 bg-white/60 p-4 dark:border-surface-800/80 dark:bg-surface-900/60">
        {attached.length > 0 && (
          <section aria-label="Attached articles" data-voice-attachments={attached.length} className="mb-3 max-h-44 overflow-y-auto scrollbar-thin">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">Attached for this voice session · not sent</p>
            {attached.map((a) => (
              <ArticleAttachmentCard key={a.id} article={a} onRemove={() => useArticleDraftStore.getState().remove(draftKey, a.id)} />
            ))}
          </section>
        )}
        <form className={cn('flex items-center gap-2 rounded-2xl border bg-white px-3 py-2 transition-all dark:bg-surface-850', text ? 'border-indigo-300 shadow-md shadow-indigo-500/10 ring-2 ring-indigo-500/10 dark:border-indigo-700' : 'border-surface-200/80 shadow-sm dark:border-surface-700')}
          onSubmit={event => {
            event.preventDefault()
            if (text.trim() && status === 'ready') { socket.current?.send(JSON.stringify({ text })); setText(''); setActivity('thinking') }
          }}>
          <input aria-label="Message voice agent" placeholder={status === 'ready' ? 'Type to Ron while you talk…' : 'Connect voice to send text'} disabled={status !== 'ready'} value={text} onChange={event => setText(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-body-md outline-none placeholder:text-ink-muted/60 disabled:opacity-60" />
          <button type="submit" disabled={status !== 'ready' || !text.trim()} aria-label="Send message" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-ink px-3 text-xs font-semibold text-white disabled:opacity-30 dark:bg-ink-inverse dark:text-surface-900"><SendHorizontalIcon aria-hidden className="size-3.5" />Send</button>
        </form>
        <p className="mt-2 text-center text-[10px] text-ink-muted dark:text-ink-inverse-muted">Voice and effort apply when you connect · microphone can be changed while muted</p>
      </footer>
    </div>
  </TooltipProvider>
}