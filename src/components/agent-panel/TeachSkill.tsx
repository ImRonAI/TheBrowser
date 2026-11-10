import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LIVE_API_BASE_URL } from '@/pages/types/api'
import { checkLiveApi, liveSocketUrl } from '@/lib/live-api'
import { ArrowRight, BookOpen, Camera, CameraOff, CheckCheck, Clock3, FileText, Layers3, Loader2, Maximize2, Mic, MicOff, Minimize2, Monitor, Plus, Radio, Send, Square, X } from 'lucide-react'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { useSkillLibraryStore } from '@/stores/skillLibraryStore'
import { acquireScreenCapture } from '@/stores/agentPresenceStore'
import { useVoiceSettingsStore } from '@/stores/voiceSettingsStore'
import { useAgentUi } from '@/context/AgentUiContext'
import { micConstraints } from '@/lib/voice-settings'
import pcmWorkletUrl from '@/lib/bidi-pcm.worklet.js?url'
import { FRAME_JPEG_QUALITY, MIC_SAMPLE_RATE, bytesToBase64, captureSummary, classifyMediaError, drainPcmChunks, frameSize, pipRect, type CapturePlan, type MediaOutcome } from '@/lib/teaching-media'
import { useLivePlayback } from './useLivePlayback'
import './teaching-studio.css'

interface JournalEntry { sequence: number; created_at: string; kind: string; text: string }
interface TeachingSession {
  id: string; title: string; objective: string; context?: string
  status: 'created' | 'observing' | 'recorded' | 'reviewing' | 'awaiting_approval' | 'compiling' | 'ready' | 'error'
  journal: JournalEntry[]; error: string | null; skill_id: string | null
  review_failure?: boolean
  review?: { revision: number; created_at: string; journal_digest: string; html: string } | null
  approval?: { revision: number; approved_at: string; journal_digest: string } | null
  demonstration?: { status: 'running' | 'completed' | 'blocked' | 'failed' | 'skipped'; started_at: string; finished_at?: string; evidence?: string; result?: string } | null
}
interface LearnedSkill { id: string; name: string; description: string; files: string[]; tool_group?: { name: string; members: { id: string; kind: string; target: string }[]; steps: { step: number; member_ids: string[] }[] } }
type CaptureState = 'idle' | 'starting' | 'observing' | 'debriefing' | 'stopping'

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The teaching request failed.'
const elapsedLabel = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The browser window capture could not be read.'))
    image.src = src
  })
}

/** Cover-crop the camera into a circle. The square `pip` is the circle's box. */
function drawCameraCircle(context: CanvasRenderingContext2D, camera: HTMLVideoElement, pip: { x: number; y: number; width: number; height: number }) {
  const radius = pip.width / 2
  const cx = pip.x + radius
  const cy = pip.y + radius
  context.save()
  context.beginPath()
  context.arc(cx, cy, radius, 0, Math.PI * 2)
  context.closePath()
  context.clip()
  const scale = Math.max(pip.width / camera.videoWidth, pip.height / camera.videoHeight)
  context.drawImage(camera, cx - (camera.videoWidth * scale) / 2, cy - (camera.videoHeight * scale) / 2, camera.videoWidth * scale, camera.videoHeight * scale)
  context.restore()
  context.beginPath()
  context.arc(cx, cy, radius, 0, Math.PI * 2)
  context.strokeStyle = 'rgba(255,255,255,0.92)'
  context.lineWidth = Math.max(2, Math.round(radius * 0.08))
  context.stroke()
}

export function TeachSkill(props: { userId: string; agentId: string; apiBaseUrl?: string; chrome?: boolean }) {
  return <TeachingWorkspace key={`${props.userId}:${props.agentId}`} {...props} />
}

function TeachingWorkspace({ userId, agentId, apiBaseUrl = LIVE_API_BASE_URL, chrome = false }: { userId: string; agentId: string; apiBaseUrl?: string; chrome?: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [context, setContext] = useState('')
  const [feedback, setFeedback] = useState('')
  const [approved, setApproved] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [source, setSource] = useState('')
  const { isPanelOpen } = useAgentUi()
  const panelWidth = usePanelAgentStore((state) => state.panelWidth)
  const panelMode = usePanelAgentStore((state) => state.panelMode)
  const [browserShare, setBrowserShare] = useState(false)
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [note, setNote] = useState('')
  const [session, setSession] = useState<TeachingSession | null>(null)
  const [sessions, setSessions] = useState<TeachingSession[]>([])
  const [skills, setSkills] = useState<LearnedSkill[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [capture, setCapture] = useState<CaptureState>('idle')
  const captureRef = useRef<CaptureState>('idle')
  captureRef.current = capture
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backendReady, setBackendReady] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [artifact, setArtifact] = useState<{ path: string; content: string } | null>(null)
  // Voice commentary is capability-gated: only offered when the observer's `ready`
  // frame advertises `audio: true`; otherwise typed notes are the only channel.
  const [audioSupported, setAudioSupported] = useState(false)
  // True once the observer relays native bidi_audio_delta; until then the UI says Ron is observer-only (no voice).
  const [speaking, setSpeaking] = useState(false)
  const [heardAudio, setHeardAudio] = useState(false)
  const playback = useLivePlayback(setSpeaking)
  const [micOn, setMicOn] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const micStream = useRef<MediaStream | null>(null)
  const micContext = useRef<AudioContext | null>(null)
  // Camera is a small circle, bottom-right, on every 1 fps frame the model sees.
  const [cameraOn, setCameraOn] = useState(false)
  const [plan, setPlan] = useState<CapturePlan | null>(null)
  const cameraStream = useRef<MediaStream | null>(null)
  const cameraVideo = useRef<HTMLVideoElement | null>(null)
  const cameraPreviewEl = useRef<HTMLVideoElement | null>(null)
  // Audio frames are only valid once the observer confirmed `ready.audio`; nothing is sent before that.
  const audioReady = useRef(false)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const sharing = useRef(false)
  const pageSrcRef = useRef('')
  const pagePreview = useRef<HTMLImageElement | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const frameTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishAfterStop = useRef(false)
  // True once at least one `observation` journal entry exists for the live session, so an ended
  // share with nothing recorded (denied permission, instant stop) never requests a process review.
  const observed = useRef(false)
  const starting = useRef(false)
  const stopping = useRef(false)
  const generation = useRef(0)
  const scope = new URLSearchParams({ user_id: userId, agent_id: agentId }).toString()
  const agentLabel = agentId.startsWith('issue:') ? 'Task Ren' : agentId === 'build' ? 'Build agent' : agentId === 'search' ? 'Search agent' : 'Ren'

  useEffect(() => {
    if (!open) return
    let current = true
    setBackendReady(false)
    void checkLiveApi(apiBaseUrl).then(() => { if (current) setBackendReady(true) }).catch(() => undefined)
    return () => { current = false }
  }, [open, apiBaseUrl])

  useEffect(() => {
    const inset = open && !minimized ? panelWidth : 0
    usePanelAgentStore.getState().setTeachingInset(inset)
    if (!open || minimized) return
    void window.electron?.browser?.setPanelOpen(true)
    void window.electron?.browser?.setPanelMode(panelMode)
    return () => {
      usePanelAgentStore.getState().setTeachingInset(0)
      void window.electron?.browser?.setPanelOpen(isPanelOpen)
    }
  }, [open, minimized, isPanelOpen, panelMode, panelWidth])

  useEffect(() => { setApproved(false) }, [session?.id, session?.review?.revision, session?.review_failure])
  const sharingScreen = capture === 'starting' || capture === 'observing'
  useEffect(() => {
    if (!sharingScreen) return
    return acquireScreenCapture()
  }, [sharingScreen])
  useEffect(() => {
    if (capture !== 'observing' && capture !== 'debriefing') return
    const since = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - since) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [capture])
  const attachPreview = useCallback((element: HTMLVideoElement | null) => {
    if (element) { element.srcObject = stream.current; void element.play().catch(() => undefined) }
  }, [capture, minimized])

  const request = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${apiBaseUrl}/teaching${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.current?.signal,
    })
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null)
      const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null
      throw new Error(typeof detail === 'string' ? detail : `Teaching request failed (${response.status}).`)
    }
    return response.json() as Promise<T>
  }, [apiBaseUrl])

  const stopMic = useCallback(() => {
    const wasOn = micStream.current !== null
    micStream.current?.getTracks().forEach((track) => track.stop())
    micStream.current = null
    void micContext.current?.close()
    micContext.current = null
    setMicOn(false)
    // Native RealtimeInput(audio_stream_end=True) when the user stops talking on purpose.
    if (wasOn && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'audio_stream_end' }))
  }, [])

  const stopCamera = useCallback(() => {
    cameraStream.current?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    cameraStream.current = null
    if (cameraVideo.current) { cameraVideo.current.pause(); cameraVideo.current.srcObject = null }
    cameraVideo.current = null
    if (cameraPreviewEl.current) cameraPreviewEl.current.srcObject = null
    setCameraOn(false)
  }, [])

  const attachCameraPreview = useCallback((element: HTMLVideoElement | null) => {
    cameraPreviewEl.current = element
    if (element && cameraStream.current) { element.srcObject = cameraStream.current; void element.play().catch(() => undefined) }
  }, [])

  /** Screen sharing only: frames stop, the window/display stream is released. Microphone and camera stay for the debrief. */
  const stopSharing = useCallback(() => {
    if (frameTimer.current) clearInterval(frameTimer.current)
    frameTimer.current = null
    pageSrcRef.current = ''
    setBrowserShare(false)
    stream.current?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    stream.current = null
    if (video.current) { video.current.pause(); video.current.srcObject = null }
    video.current = null
  }, [])

  /** Everything the demonstration holds: screen, camera, microphone. Minimize never calls this; close and stop do. */
  const stopCapture = useCallback(() => {
    stopSharing()
    sharing.current = false
    stopCamera()
    stopMic()
  }, [stopSharing, stopCamera, stopMic])

  /** Attach an already-granted camera stream (from the start gesture or the toggle). */
  const useCameraStream = async (media: MediaStream) => {
    cameraStream.current = media
    media.getVideoTracks().forEach((track) => { track.onended = () => stopCamera() })
    const element = document.createElement('video')
    element.muted = true; element.playsInline = true; element.srcObject = media
    cameraVideo.current = element
    await element.play().catch(() => undefined)
    if (cameraPreviewEl.current) { cameraPreviewEl.current.srcObject = media; void cameraPreviewEl.current.play().catch(() => undefined) }
    setCameraOn(true)
  }

  const startCamera = async (): Promise<MediaOutcome> => {
    if (cameraStream.current) return 'granted'
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 15 }, audio: false })
      if (!mounted.current || !sharing.current) { media.getTracks().forEach((track) => track.stop()); return 'unavailable' }
      await useCameraStream(media)
      return 'granted'
    } catch (cause) { return classifyMediaError(cause) }
  }

  /** Stream PCM16 16 kHz mono as `{type:'audio'}` frames; `granted` stream may come from the start gesture. */
  const startMic = async (granted?: MediaStream): Promise<MediaOutcome> => {
    if (micStream.current) return 'granted'
    setMicError(null)
    let media = granted ?? null
    try {
      if (!media) media = await navigator.mediaDevices.getUserMedia(micConstraints(useVoiceSettingsStore.getState().micDeviceId))
      if (!mounted.current || !sharing.current) { media.getTracks().forEach((track) => track.stop()); return 'unavailable' }
      micStream.current = media
      const context = new AudioContext({ sampleRate: MIC_SAMPLE_RATE })
      micContext.current = context
      await context.audioWorklet.addModule(pcmWorkletUrl)
      if (micContext.current !== context) return 'unavailable'
      const node = new AudioWorkletNode(context, 'ron-pcm')
      let pending: number[] = []
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const live = socket.current
        if (!live || live.readyState !== WebSocket.OPEN || micContext.current !== context || !audioReady.current) return
        pending.push(...event.data)
        const { chunks, rest } = drainPcmChunks(pending)
        pending = rest
        if (live.bufferedAmount > 1_000_000) return
        for (const chunk of chunks) live.send(JSON.stringify({ type: 'audio', data: bytesToBase64(chunk) }))
      }
      context.createMediaStreamSource(media).connect(node)
      const silent = context.createGain(); silent.gain.value = 0
      node.connect(silent).connect(context.destination)
      await context.resume()
      setMicOn(true)
      return 'granted'
    } catch (cause) {
      media?.getTracks().forEach((track) => track.stop())
      stopMic()
      const outcome = classifyMediaError(cause)
      if (outcome === 'unavailable' && (cause as { name?: string })?.name === 'OverconstrainedError') useVoiceSettingsStore.getState().setMicDeviceId(undefined)
      setMicError(outcome === 'denied' ? 'Microphone permission was denied. Typed notes still work.' : 'No usable microphone. Typed notes still work.')
      return outcome
    }
  }
  const disconnect = useCallback(() => {
    generation.current += 1
    starting.current = false
    stopCapture()
    playback.close()
    if (deadline.current) clearTimeout(deadline.current)
    deadline.current = null
    const connection = socket.current
    socket.current = null
    if (connection) {
      connection.onclose = null; connection.onerror = null; connection.onmessage = null
      connection.close()
    }
    starting.current = false; stopping.current = false
  }, [stopCapture, playback.close])

  useEffect(() => {
    mounted.current = true
    controller.current = new AbortController()
    return () => {
      mounted.current = false
      controller.current?.abort()
      disconnect()
    }
  }, [disconnect])

  const refresh = useCallback(async () => {
    const [history, learned] = await Promise.all([
      request<{ sessions: TeachingSession[] }>(`/sessions?${scope}`),
      request<{ skills: LearnedSkill[] }>(`/skills?${scope}`),
    ])
    if (mounted.current) { setSessions(history.sessions); setSkills(learned.skills) }
  }, [request, scope])

  // Opening the studio loads its history and skill library.
  useEffect(() => {
    if (!open) return
    void refresh().catch((cause: unknown) => { if (mounted.current) setError(message(cause)) })
  }, [open, refresh])

  // "Open in Skill library" (e.g. after a page is published as a skill) opens this agent's studio on the library.
  const libraryRequest = useSkillLibraryStore((state) => state.request)
  const handledLibrary = useRef(useSkillLibraryStore.getState().request?.nonce ?? 0)
  useEffect(() => {
    if (!libraryRequest || libraryRequest.agentId !== agentId || libraryRequest.nonce <= handledLibrary.current) return
    handledLibrary.current = libraryRequest.nonce
    setOpen(true); setMinimized(false); setLibraryOpen(true); setHighlight(libraryRequest.skillId)
  }, [libraryRequest, agentId])
  useEffect(() => {
    if (!open || minimized || !libraryOpen) return
    const target = document.getElementById(highlight ? `teaching-skill-${highlight}` : `${id}-library`)
    target?.scrollIntoView({ block: 'nearest' })
  }, [open, minimized, libraryOpen, highlight, skills, id])

  const demonstrating = session?.demonstration?.status === 'running'
  useEffect(() => {
    if (!session || (!['compiling', 'reviewing'].includes(session.status) && !demonstrating)) return
    let current = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const saved = await request<TeachingSession>(`/sessions/${encodeURIComponent(session.id)}?${scope}`)
        if (!current) return
        setSession(saved)
        if (['compiling', 'reviewing'].includes(saved.status) || saved.demonstration?.status === 'running') timer = setTimeout(() => void poll(), 2000)
        else await refresh()
      } catch (cause) {
        if (current) { setError(message(cause)); timer = setTimeout(() => void poll(), 5000) }
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => { current = false; clearTimeout(timer) }
  }, [session?.id, session?.status, demonstrating, request, refresh, scope])

  const transition = async (sessionId: string, action: 'finish' | 'review' | 'approve', extra: Record<string, unknown> = {}) => {
    setBusy(true); setError(null)
    try {
      const saved = await request<TeachingSession>(`/sessions/${encodeURIComponent(sessionId)}/${action}`, { user_id: userId, agent_id: agentId, ...extra })
      if (mounted.current) {
        setSession(saved)
        if (!['compiling', 'reviewing'].includes(saved.status)) await refresh()
        if (action === 'review') { setFeedback(''); setApproved(false) }
      }
    } catch (cause) {
      if (mounted.current) setError(message(cause))
    } finally { if (mounted.current) setBusy(false) }
  }

  /** "Finish demonstration": sharing ends, the same Live session continues as a spoken debrief (no time limit). */
  const finishDemo = () => {
    const connection = socket.current
    if (stopping.current || captureRef.current !== 'observing' || !connection || connection.readyState !== WebSocket.OPEN) return
    stopSharing()
    finishAfterStop.current = true
    setCapture('debriefing')
    connection.send(JSON.stringify({ type: 'finish_demo' }))
    if (!micStream.current && audioSupported) void startMic()
  }

  const stop = (finish: boolean) => {
    if (stopping.current) return
    stopCapture()
    const connection = socket.current
    if (!connection || connection.readyState !== WebSocket.OPEN) {
      disconnect(); setCapture('idle')
      setError('Observation disconnected. Reopen the saved recording before creating the skill.')
      return
    }
    stopping.current = true; finishAfterStop.current = finish
    setCapture('stopping')
    connection.send(JSON.stringify({ type: 'stop' }))
    if (deadline.current) clearTimeout(deadline.current)
    deadline.current = setTimeout(() => {
      disconnect(); setCapture('idle')
      setError('Screen sharing stopped, but the journal was not confirmed saved. Reopen this recording to check its status.')
    }, 60000)
  }

  const start = async () => {
    if (starting.current || socket.current || !backendReady || !title.trim() || !objective.trim()) return
    starting.current = true
    const attempt = ++generation.current
    setCapture('starting'); setError(null); setTranscript(''); setArtifact(null); setAudioSupported(false); setMicError(null); setHeardAudio(false); setPlan(null)
    audioReady.current = false
    void playback.start()
    try {
      // The shared view is the browser window. Electron captures the active tab
      // (or the window beside this panel). A browser without that bridge falls
      // back to the display picker. Camera and microphone never block the share.
      let browserFrames = false
      let preview: HTMLVideoElement | null = null
      const captureBrowser = window.electron?.browser?.screenshot
      if (captureBrowser) {
        const probe = await captureBrowser()
        if (!mounted.current || attempt !== generation.current) return
        if (!probe) throw new Error('The browser window has no page to share yet.')
        browserFrames = true
        sharing.current = true
        pageSrcRef.current = probe
        setBrowserShare(true)
        setSource('Browser window')
      } else {
        if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is unavailable in this window.')
        const media = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false })
        if (!mounted.current || attempt !== generation.current) { media.getTracks().forEach((track) => track.stop()); return }
        sharing.current = true
        stream.current = media
        setSource(media.getVideoTracks()[0]?.label || 'Selected screen')
        media.getVideoTracks().forEach((track) => { track.onended = () => finishDemo() })
        preview = document.createElement('video')
        preview.muted = true; preview.playsInline = true; preview.srcObject = media
        video.current = preview
        await preview.play()
        if (!mounted.current || attempt !== generation.current) return
      }
      let micOutcome: MediaOutcome = 'unavailable'
      let cameraOutcome: MediaOutcome = 'unavailable'
      let micMedia: MediaStream | null = null
      try {
        const both = await navigator.mediaDevices.getUserMedia({ ...micConstraints(useVoiceSettingsStore.getState().micDeviceId), video: { width: 640, height: 360, frameRate: 15 } })
        if (!mounted.current || attempt !== generation.current) { both.getTracks().forEach((track) => track.stop()); return }
        const videoTracks = both.getVideoTracks(), audioTracks = both.getAudioTracks()
        if (videoTracks.length) { await useCameraStream(new MediaStream(videoTracks)); cameraOutcome = 'granted' }
        if (audioTracks.length) micMedia = new MediaStream(audioTracks)
      } catch (cause) {
        // Combined request failed: retry each alone so a missing camera does not cost the microphone (and vice versa).
        const combined = classifyMediaError(cause)
        cameraOutcome = combined === 'denied' ? 'denied' : await startCamera()
        if (combined !== 'denied') {
          try { micMedia = await navigator.mediaDevices.getUserMedia(micConstraints(useVoiceSettingsStore.getState().micDeviceId)) }
          catch (micCause) { micOutcome = classifyMediaError(micCause) }
        } else micOutcome = 'denied'
        if (!mounted.current || attempt !== generation.current) { micMedia?.getTracks().forEach((track) => track.stop()); return }
      }
      if (micMedia) micOutcome = await startMic(micMedia)
      setPlan({ screen: 'granted', mic: micOutcome, camera: cameraOutcome })
      if (!mounted.current || attempt !== generation.current) return
      const resumable = session && ['created', 'recorded', 'error'].includes(session.status) && !session.review && session.title === title.trim() && session.objective === objective.trim() && (session.context || '') === context.trim()
      const created = resumable ? session : await request<TeachingSession>('/sessions', { user_id: userId, agent_id: agentId, title: title.trim(), objective: objective.trim(), context: context.trim() })
      if (!mounted.current || attempt !== generation.current) return
      observed.current = created.journal.some((entry) => entry.kind === 'observation')
      setSession(created)
      const url = new URL(`${liveSocketUrl(apiBaseUrl, `/teaching/sessions/${encodeURIComponent(created.id)}/observe`)}?${scope}`)
      const connection = new WebSocket(url)
      socket.current = connection
      const fail = (detail: string) => {
        disconnect(); setCapture('idle'); setError(detail)
        void request<TeachingSession>(`/sessions/${encodeURIComponent(created.id)}?${scope}`)
          .then((saved) => { if (mounted.current) setSession(saved) }).catch(() => undefined)
      }
      deadline.current = setTimeout(() => fail('Gemini did not confirm observation. Screen sharing has stopped.'), 45000)
      connection.onerror = () => fail('Could not connect to Gemini observation. Your teaching draft is retained.')
      connection.onclose = () => fail('Observation disconnected. Screen sharing has stopped; reopen the recording to check the saved journal.')
      connection.onmessage = (event: MessageEvent<string>) => {
        let data: unknown
        try { data = JSON.parse(event.data) } catch { fail('The observer returned an invalid message.'); return }
        if (!data || typeof data !== 'object' || !('type' in data)) return
        if (data.type === 'bidi_audio_delta') { setHeardAudio(true); playback.play(data as Record<string, unknown>); return }
        if (data.type === 'bidi_barge_in') { playback.stop(); return }
        if (data.type === 'ready') {
          if (stopping.current) return
          if (deadline.current) clearTimeout(deadline.current)
          deadline.current = null; starting.current = false
          const audio = 'audio' in data && data.audio === true
          setAudioSupported(audio)
          audioReady.current = audio
          if (!audio && micStream.current) { stopMic(); setMicError('This observer does not accept voice commentary; microphone released.') }
          setCapture('observing'); setSession((current) => current ? { ...current, status: 'observing' } : current)
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          if (!context) { fail('Screen capture could not create an image.'); return }
          const paint = (page: CanvasImageSource, pageWidth: number, pageHeight: number) => {
            const size = frameSize({ width: pageWidth, height: pageHeight })
            if (!size.width || !size.height || connection.readyState !== WebSocket.OPEN) return
            canvas.width = size.width; canvas.height = size.height
            context.drawImage(page, 0, 0, size.width, size.height)
            const cam = cameraVideo.current
            const pip = cam && cameraStream.current ? pipRect(size, { width: cam.videoWidth, height: cam.videoHeight }) : null
            if (cam && pip && cam.videoWidth && cam.videoHeight) drawCameraCircle(context, cam, pip)
            connection.send(JSON.stringify({ type: 'frame', data: canvas.toDataURL('image/jpeg', FRAME_JPEG_QUALITY).split(',')[1], timestamp: new Date().toISOString() }))
          }
          let painting = false
          const sendFrame = async () => {
            if (painting || connection.readyState !== WebSocket.OPEN || connection.bufferedAmount > 1_000_000) return
            painting = true
            try {
              if (browserFrames) {
                const dataUrl = await window.electron?.browser?.screenshot?.()
                if (!dataUrl) return
                const image = await loadImage(dataUrl)
                pageSrcRef.current = dataUrl
                if (pagePreview.current) pagePreview.current.src = dataUrl
                paint(image, image.naturalWidth, image.naturalHeight)
              } else if (preview?.videoWidth && preview.videoHeight) paint(preview, preview.videoWidth, preview.videoHeight)
            } catch { /* skip a frame that failed to decode */ }
            finally { painting = false }
          }
          if (frameTimer.current) clearInterval(frameTimer.current)
          void sendFrame(); frameTimer.current = setInterval(() => void sendFrame(), 1000)
        } else if (data.type === 'journal' && 'entry' in data) {
          const entry = data.entry
          if (entry && typeof entry === 'object' && 'sequence' in entry && typeof entry.sequence === 'number' && 'text' in entry && typeof entry.text === 'string' && 'kind' in entry && typeof entry.kind === 'string' && 'created_at' in entry && typeof entry.created_at === 'string') {
            const saved: JournalEntry = { sequence: entry.sequence, text: entry.text, kind: entry.kind, created_at: entry.created_at }
            if (saved.kind === 'observation') observed.current = true
            setSession((current) => current ? { ...current, journal: [...current.journal.filter((item) => item.sequence !== saved.sequence), saved].sort((a, b) => a.sequence - b.sequence) } : current)
          }
        } else if (data.type === 'debrief') { setCapture('debriefing'); setMinimized(false) }
        else if (data.type === 'transcript' && 'text' in data && typeof data.text === 'string') setTranscript(data.text)
        else if (data.type === 'error') fail('message' in data && typeof data.message === 'string' ? data.message : 'Gemini observation failed.')
        else if (data.type === 'stopped') {
          // Analyze only when the demonstration finished (user Finish, or the observer's finish_observation)
          // and actually recorded observations. The review is a document for human approval; nothing is published here.
          const finished = 'finished' in data && data.finished === true
          const finish = (finishAfterStop.current || finished) && observed.current
          disconnect(); setCapture('idle')
          setSession((current) => current ? { ...current, status: 'recorded' } : current)
          setMinimized(false)
          if (finish) void transition(created.id, 'finish')
          else void refresh().catch((cause: unknown) => { if (mounted.current) setError(message(cause)) })
        }
      }
    } catch (cause) {
      if (attempt !== generation.current) return
      starting.current = false
      disconnect()
      if (mounted.current) { setCapture('idle'); setError(message(cause)) }
    }
  }

  const load = async (sessionId: string) => {
    setBusy(true); setError(null)
    try {
      const saved = await request<TeachingSession>(`/sessions/${encodeURIComponent(sessionId)}?${scope}`)
      if (mounted.current) { setSession(saved); setTitle(saved.title); setObjective(saved.objective); setContext(saved.context || ''); setArtifact(null); setApproved(false) }
    } catch (cause) { if (mounted.current) setError(message(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const readFile = async (skillId: string, path: string) => {
    setBusy(true); setError(null)
    try {
      const file = await request<{ path: string; content: string }>(`/skills/${encodeURIComponent(skillId)}/files?${scope}&path=${encodeURIComponent(path)}`)
      if (mounted.current) setArtifact(file)
    } catch (cause) { if (mounted.current) setError(message(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const active = capture !== 'idle'
  const conversing = capture === 'observing' || capture === 'debriefing'
  const processing = session?.status === 'compiling' || session?.status === 'reviewing'
  const locked = active || busy || processing
  const review = session?.review
  const savedSkill = skills.find((skill) => skill.id === session?.skill_id)
  const stage = session?.status === 'ready' ? 3 : review || processing ? 2 : active || session?.journal.length ? 1 : 0
  const close = () => { disconnect(); setCapture('idle'); setOpen(false); setMinimized(false) }
  const journal = <section className="teaching-journal"><div className="teaching-section-heading"><h3>Observation journal</h3><span className="teaching-meta">{session?.journal.length || 0} entries</span></div>
    {session?.journal.length ? <ol aria-label="Teaching journal" aria-live="polite">{session.journal.map((entry) => <li key={entry.sequence}><span className="teaching-meta">{String(entry.sequence).padStart(2, '0')} · {entry.kind} · {new Date(entry.created_at).toLocaleTimeString()}</span><p>{entry.text}</p></li>)}</ol> : <div className="teaching-empty"><BookOpen size={24} /></div>}
  </section>
  const commentary = <form className="teaching-commentary" onSubmit={(event) => {
    event.preventDefault()
    if (!note.trim() || !conversing || socket.current?.readyState !== WebSocket.OPEN) return
    socket.current.send(JSON.stringify({ type: 'note', text: note.trim() })); setNote('')
  }}><label htmlFor={`${id}-note`}>Explain this step</label><div><textarea id={`${id}-note`} rows={2} value={note} maxLength={10000} disabled={!conversing} onChange={(event) => setNote(event.target.value)} placeholder="Add a decision, detail, or exception…" />
    {audioSupported && <button type="button" className="teaching-icon" aria-pressed={micOn} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} title={micOn ? 'Mute microphone' : 'Unmute microphone'} disabled={!conversing} onClick={() => micOn ? stopMic() : void startMic()}>{micOn ? <Mic size={17} /> : <MicOff size={17} />}</button>}
    <button type="button" className="teaching-icon" aria-pressed={cameraOn} aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'} title={cameraOn ? 'Camera off (removes you from the frame)' : 'Camera on (adds you as a small circle, bottom right)'} disabled={capture !== 'observing'} onClick={() => cameraOn ? stopCamera() : void startCamera().then((outcome) => setPlan((current) => current ? { ...current, camera: outcome } : current))}>{cameraOn ? <Camera size={17} /> : <CameraOff size={17} />}</button>
    <button className="teaching-icon" aria-label="Send commentary" disabled={!note.trim() || !conversing} type="submit"><Send size={17} /></button></div>
    {conversing && !audioSupported && <small className="teaching-meta">Voice commentary unavailable on this observer · typed notes only</small>}
    {micOn && <small className="teaching-meta">● Microphone on · streaming to Gemini{speaking ? ' · Ren speaking' : heardAudio ? '' : ''}</small>}
    {micError && <small role="alert" className="teaching-error">{micError}</small>}
  </form>

  return <section className={chrome ? 'relative shrink-0' : 'teaching-launch shrink-0 border-b border-surface-200 dark:border-surface-800'}>
    <button type="button" aria-expanded={open} aria-label="Teach Ren" title="Teach Ren"
      className={chrome ? 'flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-ink-secondary transition-colors hover:bg-surface-200/60 hover:text-ink dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse' : 'teaching-launch-button'}
      onClick={() => { setOpen(true); setMinimized(false) }}>
      <BookOpen size={chrome ? 16 : 19} strokeWidth={chrome ? 1.75 : 2} />{chrome ? <span className="hidden xl:inline">Teach Ren</span> : <><span><strong>Teach a skill</strong><small>Show Ren how you work</small></span><ArrowRight size={16} /></>}
    </button>
    {open && minimized && <aside className="teaching-dock" style={chrome ? { position: 'absolute', right: 0, top: '100%', width: 320, maxHeight: '70vh', overflowY: 'auto' } : undefined} aria-label="Teaching in progress">
      <div className="teaching-section-heading"><span className="teaching-meta">{capture === 'observing' ? `● Observing${micOn ? ' · mic' : ''}${cameraOn ? ' · camera' : ''}` : capture === 'debriefing' ? `● Debrief${micOn ? ' · mic' : ''}` : 'Teaching draft'} · {elapsedLabel(elapsed)}</span><button className="teaching-icon" aria-label="Expand teaching studio" onClick={() => setMinimized(false)}><Maximize2 size={16} /></button></div>
      <strong>{title || 'Teach a skill'}</strong>
      <p className="teaching-dock-entry">{session?.journal.at(-1)?.text || 'Waiting for an observation.'}</p>
      {error && <p role="alert" className="teaching-error">{error}</p>}
      {capture === 'observing' && <>{cameraOn && <video ref={attachCameraPreview} className="teaching-camera-pip teaching-camera-dock" muted playsInline aria-label="Your camera" />}<small className="teaching-meta">Capture continues while minimized. Close stops everything.</small>{commentary}<button className="teaching-button primary" onClick={finishDemo}><Square size={14} />Finish demonstration</button></>}
      {capture === 'debriefing' && <><small className="teaching-meta">Debrief in progress · Ren is talking it through with you.</small>{commentary}<button className="teaching-button primary" onClick={() => stop(true)}><Square size={14} />End conversation</button></>}
    </aside>}
    {open && !minimized && typeof document !== 'undefined' && document.getElementById('ron-teaching-slot') && createPortal(
      <div className="absolute inset-0 z-50 flex pointer-events-none">
        <section id={id} aria-label="Teach Ren" className="teaching-studio relative ml-auto h-full max-w-full pointer-events-auto" style={{ width: panelWidth }}>
        <header className="teaching-header"><div className="teaching-mark" aria-hidden="true">R</div><h2 className="teaching-title min-w-0 flex-1">{agentLabel}</h2>
          <div className="teaching-actions"><button className="teaching-icon" aria-label="Minimize teaching studio" onClick={() => setMinimized(true)}><Minimize2 size={19} /></button><button className="teaching-icon" aria-label="Close teaching studio and stop sharing" onClick={close}><X size={20} /></button></div>
        </header>
        <ol className="teaching-stages" aria-label="Teaching stages">{['Brief', 'Demonstrate', 'Review', 'Saved'].map((label, index) => <li key={label} aria-current={stage === index ? 'step' : undefined} data-complete={stage > index}><span>{String(index + 1).padStart(2, '0')}</span>{label}</li>)}</ol>
        <div className="teaching-body">
          {(error || session?.error) && <p role="alert" className="teaching-error">{error || session?.error}</p>}
          {processing && <div role="status" className="teaching-progress"><Loader2 className="animate-spin" size={19} /><div><strong>{session?.status === 'reviewing' ? 'Analyzing workflow and capabilities' : 'Building the approved skill'}</strong><p>{session?.status === 'reviewing' ? 'Ren is following the Learning a New Skill protocol: organizing the saved observations and determining which existing or new tools, MCP servers, skills, and subagents the workflow needs. Nothing is created until you approve.' : 'Saving the skill, ordered SOP, and reusable capability group.'}</p></div></div>}
          {session?.status === 'ready' ? <section className="teaching-saved"><CheckCheck size={36} /><p className="teaching-meta">ADDED TO THIS AGENT’S LIBRARY</p><h2>{savedSkill?.name || session.title}</h2><p>{savedSkill?.description || 'Your approved process is saved as a reusable skill.'}</p><div className="teaching-saved-assets"><span><BookOpen size={18} />Skill</span><span><FileText size={18} />Ordered SOP</span>{savedSkill?.tool_group && <span><Layers3 size={18} />{savedSkill.tool_group.members.length} capabilities</span>}</div>
            {session.demonstration && <div role="status" className="teaching-progress">{session.demonstration.status === 'running' ? <Loader2 className="animate-spin" size={19} /> : <CheckCheck size={19} />}<div><strong>{session.demonstration.status === 'running' ? 'Ren is demonstrating the skill' : `Demonstration ${session.demonstration.status}`}</strong><p>{session.demonstration.status === 'running' ? 'Following the new SOP once with the approved tools, so you can watch it work.' : session.demonstration.result || session.demonstration.evidence || ''}</p></div></div>}
            <button className="teaching-button" onClick={() => { setSession(null); setTitle(''); setObjective(''); setContext(''); setFeedback(''); setError(null); setArtifact(null) }}><Plus size={16} />Teach another skill</button></section>
          : review ? <section className="teaching-review"><div className="teaching-section-heading"><div><p className="teaching-meta">LEARNING A NEW SKILL / PROCESS DOCUMENT / REVISION {review.revision}</p><h2>Read it before Ren learns it.</h2><p className="teaching-footnote">The document lists the workflow and the capabilities it requires — existing tools, MCP servers, skills, and subagents Ren found, plus anything new or unavailable.</p></div><span className="teaching-meta">{session?.journal.length} evidence entries · {session?.approval?.revision === review.revision ? 'Approved' : 'Not yet published'}</span></div>
            <iframe title={`Learning a New Skill — process document revision ${review.revision}`} sandbox="" srcDoc={review.html} className="teaching-document" />
            <div className="teaching-review-controls"><div><label htmlFor={`${id}-feedback`}>Anything to correct?</label><textarea id={`${id}-feedback`} value={feedback} onChange={(event) => setFeedback(event.target.value)} disabled={locked} rows={3} maxLength={10000} placeholder="Describe the change Ren should make to this process…" /><button className="teaching-button" disabled={locked || !feedback.trim()} onClick={() => session && void transition(session.id, 'review', { revision: review.revision, feedback: feedback.trim() })}>Revise process</button>{session?.review_failure && <button className="teaching-button" disabled={locked} onClick={() => void transition(session.id, 'finish')}>Retry process review</button>}</div><div className="teaching-approval"><label><input type="checkbox" checked={approved} disabled={locked} onChange={(event) => setApproved(event.target.checked)} /><span>I have reviewed revision {review.revision} and approve this process.</span></label><button className="teaching-button primary" disabled={locked || !!session?.review_failure || (!approved && session?.approval?.revision !== review.revision)} onClick={() => session && void transition(session.id, 'approve', { revision: review.revision })}>{session?.approval?.revision === review.revision ? 'Retry approved generation' : 'Approve and generate'}<ArrowRight size={16} /></button><p>Creates the skill, SOP, and capability group from this exact revision.</p></div></div>
          </section>
          : <><div className="teaching-desk">
            <section className="teaching-brief">
              <label htmlFor={`${id}-title`}>Workflow name</label><input id={`${id}-title`} value={title} maxLength={200} disabled={locked} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Prepare the weekly report" />
              <label htmlFor={`${id}-outcome`}>Intended outcome</label><textarea id={`${id}-outcome`} value={objective} maxLength={10000} disabled={locked} rows={3} onChange={(event) => setObjective(event.target.value)} placeholder="What should be accomplished? What does success look like?" />
              <label htmlFor={`${id}-context`}>Context & prerequisites <span className="teaching-optional">optional</span></label><textarea id={`${id}-context`} value={context} maxLength={10000} disabled={locked} rows={2} onChange={(event) => setContext(event.target.value)} placeholder="Accounts, starting conditions, or decisions Ren should know…" />
              <div className="teaching-capture-actions">
                {!active && <button className="teaching-button primary" disabled={locked || !backendReady || !title.trim() || !objective.trim()} onClick={() => void start()}><Monitor size={17} />{session?.journal.length ? 'Resume teaching' : 'Start teaching'}<ArrowRight size={16} /></button>}
                {capture === 'starting' && <button className="teaching-button" onClick={() => { disconnect(); setCapture('idle') }}>Cancel connection</button>}
                {capture === 'observing' && <button className="teaching-button primary" onClick={finishDemo}><Square size={14} />Finish demonstration</button>}
                {capture === 'debriefing' && <button className="teaching-button primary" onClick={() => stop(true)}><Square size={14} />End conversation</button>}
                {session && !active && !review && session.journal.length > 0 && !processing && <button className="teaching-button" disabled={busy} onClick={() => void transition(session.id, 'finish')}><FileText size={16} />Prepare process document</button>}
              </div>
            </section>
            <section className="teaching-observation"><div className="teaching-section-heading"><span className="teaching-meta"><Radio size={13} />{capture === 'observing' ? 'GEMINI CONNECTED' : capture === 'debriefing' ? 'DEBRIEF · GEMINI CONNECTED' : capture === 'starting' ? 'CONNECTING TO GEMINI' : 'OBSERVATION DESK'}</span><span className="teaching-meta"><Clock3 size={13} />{elapsedLabel(elapsed)}</span></div>
              <div className="teaching-preview">{active ? <>
                {browserShare
                  ? <img ref={(element) => { pagePreview.current = element; if (element && pageSrcRef.current) element.src = pageSrcRef.current }} alt="Browser window" />
                  : <video ref={attachPreview} muted playsInline aria-label="Shared screen preview" />}
                {cameraOn && <video ref={attachCameraPreview} className="teaching-camera-pip" muted playsInline aria-label="Your camera, a small circle at the bottom right" />}
              </> : <div><Monitor size={38} strokeWidth={1} /></div>}</div>
              {source && active && <p className="teaching-source">{source}{plan ? ` · ${captureSummary({ ...plan, camera: cameraOn ? 'granted' : plan.camera === 'granted' ? 'unavailable' : plan.camera, mic: micOn ? 'granted' : plan.mic === 'granted' ? 'unavailable' : plan.mic })}` : ''}</p>}
              {plan && active && (plan.camera === 'denied' || plan.mic === 'denied') && <p role="status" className="teaching-capture-status">{plan.camera === 'denied' && plan.mic === 'denied' ? 'Camera and microphone permission denied — screen only. Allow them in system settings and use the toggles to retry.' : plan.camera === 'denied' ? 'Camera permission denied — Ren sees the screen only.' : 'Microphone permission denied — use typed notes or the mic toggle to retry.'}</p>}
              <p role="status" className="teaching-capture-status">{capture === 'starting' ? 'Waiting for Gemini to confirm observation…' : capture === 'stopping' ? 'Saving the final journal entries…' : capture === 'debriefing' ? 'Sharing has ended. Ren will tell you what he understood, ask his questions, and propose how he will automate it. Correct him out loud or by typing; press End conversation when you are done.' : capture === 'observing' ? 'The browser window is shared. Your camera stays in the corner. Minimize the studio to work.' : session?.journal.length ? 'Recording saved. Prepare the document when you are ready.' : 'The browser window is not being shared.'}</p>
              {journal}{active && commentary}{transcript && <p className="teaching-transcript">{transcript}</p>}
            </section>
          </div></>}
          <footer className="teaching-library"><details><summary>Teaching history <span>{sessions.length}</span></summary>{sessions.length ? <ul>{sessions.map((saved) => <li key={saved.id}><button disabled={locked} onClick={() => void load(saved.id)}><span>{saved.title}</span><small>{saved.status.replaceAll('_', ' ')}</small><ArrowRight size={14} /></button></li>)}</ul> : <p>No saved teaching sessions yet.</p>}</details>
            <details id={`${id}-library`} open={libraryOpen} onToggle={(event) => setLibraryOpen(event.currentTarget.open)}><summary>Skill library <span>{skills.length}</span></summary>{skills.length ? skills.map((skill) => <article key={skill.id} id={`teaching-skill-${skill.id}`} aria-current={highlight === skill.id ? 'true' : undefined}><h3>{skill.name}</h3><p>{skill.description}</p><div className="teaching-files">{skill.files.map((path) => <button key={path} disabled={locked} onClick={() => void readFile(skill.id, path)}><FileText size={14} />{path}</button>)}</div></article>) : <p>Approved skills will appear here.</p>}</details>
          </footer>
          {artifact && <section className="teaching-artifact"><div className="teaching-section-heading"><h3>{artifact.path}</h3><button className="teaching-icon" aria-label="Close skill file" onClick={() => setArtifact(null)}><X size={16} /></button></div><pre>{artifact.content}</pre></section>}
        </div>
        </section>
      </div>,
      document.getElementById('ron-teaching-slot')!,
    )}
  </section>
}
