/**
 * Pure helpers for the `/bidi` WebSocket: query construction, the client
 * frames that exist, and a reducer over the native `strands.bidi` output
 * events (`agent/api/core/harness-sdk/strands-py/src/strands/bidi/types/events.py`)
 * plus the Ron-specific frames the endpoint adds (`ready`, `journal`, `error`,
 * `bidi_interaction_status`, `bidi_tool_cancel`).
 *
 * No React, no `@/` imports so `node --test` can run the colocated test.
 */

import type { GeminiVoiceId, ReasoningEffort } from './voice-settings.ts'
import { EXTENDED_LIVE_MODEL, type LiveModelId } from './voice-settings.ts'

// ─── Connection ──────────────────────────────────────────────────────────────

export interface LiveConnectionParams {
  userId: string
  agentScope: string
  browser: 'user' | 'cloud'
  model: LiveModelId
  voice: GeminiVoiceId
  effort: ReasoningEffort
  /** Panel session id for panel/build/search scopes; issue id for `issue:<id>`. */
  conversationId: string
}

/** `effort` is only meaningful for extended thinking; the regular model has no thinking config. */
export function liveQuery(params: LiveConnectionParams): URLSearchParams {
  const query = new URLSearchParams({
    agent_scope: params.agentScope,
    browser: params.browser,
    model: params.model,
    voice: params.voice,
    // The native thread the BidiAgent opens (restores + writes via its SnapshotSessionManager).
    session_id: params.conversationId,
    conversation_id: params.conversationId,
  })
  if (!isIssueScope(params.agentScope)) query.set('user_id', params.userId)
  if (params.model === EXTENDED_LIVE_MODEL) query.set('effort', params.effort)
  return query
}

export const isIssueScope = (scope: string): boolean => scope.startsWith('issue:')

/**
 * The first frame for issue-scoped sessions. Mirrors `createProjectsRequest`:
 * a bearer token when signed in, otherwise the 64-hex guest workspace id.
 * Returns null for non-issue scopes (no auth frame is sent at all).
 */
export function authFrame(scope: string, identity: { userId: string; accessToken: string | null }): { type: 'auth'; token?: string; workspace?: string } | null {
  if (!isIssueScope(scope)) return null
  const guest = identity.userId.startsWith('guest:') && /^[a-f0-9]{64}$/.test(identity.userId.slice(6))
  if (guest) return { type: 'auth', workspace: identity.userId.slice(6) }
  if (identity.accessToken) return { type: 'auth', token: identity.accessToken }
  return null
}

// ─── Context frame ───────────────────────────────────────────────────────────

export interface LiveContextTurn { role: 'user' | 'assistant'; text: string }
export interface LiveContext {
  page_url?: string
  page_title?: string
  selected_text?: string
  page_text?: string
  history?: LiveContextTurn[]
  issue?: { id: string; title?: string; description?: string }
}

export const CONTEXT_LIMITS = {
  pageText: 12_000, selectedText: 4_000, historyTurns: 12, turnText: 2_000, issueDescription: 4_000, title: 300,
} as const

const clip = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/**
 * Bound the context the renderer shares with Gemini. The provider retains
 * whatever it receives; this only caps size. Latest history turns win.
 */
export function boundContext(input: LiveContext): LiveContext {
  const out: LiveContext = {}
  const url = clip(input.page_url, 2_000); if (url) out.page_url = url
  const title = clip(input.page_title, CONTEXT_LIMITS.title); if (title) out.page_title = title
  const selected = clip(input.selected_text, CONTEXT_LIMITS.selectedText); if (selected) out.selected_text = selected
  const page = clip(input.page_text, CONTEXT_LIMITS.pageText); if (page) out.page_text = page
  if (input.history?.length) {
    const history = input.history
      .map((turn) => ({ role: turn.role, text: clip(turn.text, CONTEXT_LIMITS.turnText) }))
      .filter((turn): turn is LiveContextTurn => Boolean(turn.text) && (turn.role === 'user' || turn.role === 'assistant'))
      .slice(-CONTEXT_LIMITS.historyTurns)
    if (history.length) out.history = history
  }
  if (input.issue?.id) {
    out.issue = { id: input.issue.id }
    const issueTitle = clip(input.issue.title, CONTEXT_LIMITS.title); if (issueTitle) out.issue.title = issueTitle
    const description = clip(input.issue.description, CONTEXT_LIMITS.issueDescription); if (description) out.issue.description = description
  }
  return out
}

export const contextFrame = (context: LiveContext) => ({ type: 'context' as const, context: boundContext(context) })

/** Visible conversation → plain history turns. Tool calls, reasoning and activity are never replayed. */
export function historyFromMessages(messages: { role: 'user' | 'assistant'; parts: { kind: string; text?: string }[] }[]): LiveContextTurn[] {
  const turns: LiveContextTurn[] = []
  for (const message of messages) {
    const text = message.parts.filter((part) => part.kind === 'text' && typeof part.text === 'string' && !part.text.startsWith('ron-article:'))
      .map((part) => part.text as string).join('\n').trim()
    if (text) turns.push({ role: message.role, text })
  }
  return turns
}

// ─── Output events → UI state ────────────────────────────────────────────────

export type LiveActivity = 'idle' | 'listening' | 'thinking' | 'speaking'
export type LiveStatus = 'idle' | 'connecting' | 'ready'

export interface LiveTurn {
  id: string
  role: 'user' | 'assistant'
  /** `transcript` = speech, `text` = typed/text output, `tool` = tool call card. */
  kind: 'transcript' | 'text' | 'tool'
  text: string
  final: boolean
  /** Tool-only: cancelled by Gemini (toolCallCancellation) — result is dropped by the provider. */
  cancelled?: boolean
  toolName?: string
  toolInput?: unknown
}

export interface LiveState {
  status: LiveStatus
  /** What the model is doing. Playback is tracked separately by the audio sink. */
  activity: LiveActivity
  /** `processing` means Gemini reported interaction_status=in_progress (extended thinking still working). */
  processing: boolean
  /** Last `bidi_interaction_status` seen was in_progress; lets response_stop defer completion on extended thinking. */
  lastStatusInProgress?: boolean
  playing: boolean
  turns: LiveTurn[]
  reasoning: string
  model?: string
  voice?: string
  effort?: string
  conversationId?: string
  /** Tool names fixed at connect (from `ready.tools`). */
  tools?: string[]
  /** `ready.music`: the Live Music (Lyria RealTime) tools are registered on this session. */
  musicAvailable?: boolean
  /** `ready.agent_id`: the BidiAgent id, used by the music deck to address this session's stream (`/music/*`). */
  agentId?: string
  /** Live Music stream state, folded from the `music_*` frames (`agent/api/core/live_music.py`). */
  music: MusicState
  /** `snapshot` = a persisted Live snapshot for this conversation restored and client history was ignored. */
  historySource?: 'snapshot' | 'client' | 'none'
  /** Last `context_applied.mode`. */
  contextMode?: 'initial' | 'realtime' | 'queued'
  journalHtml?: string
  journalSaved?: boolean
  error?: string
  errorCode?: string
  /** Non-fatal server warnings (e.g. browser_tools_unavailable). */
  warnings: string[]
  /** Set by bidi_connection_restart when a turn was cut off. */
  restartNotice?: string
  /** Tool ids whose results are unknown after a stop (server `stopped.pending_tools`). */
  unknownResults?: string[]
  usage?: { input: number; output: number; total: number }
}

// ─── Live Music (Lyria RealTime) ─────────────────────────────────────────────

export interface WeightedPrompt { text: string; weight: number }
export type MusicPlayback = 'idle' | 'playing' | 'paused' | 'stopped'
export interface MusicState {
  /** Lyria session open on the backend (`music_ready` … `music_closed`). */
  connected: boolean
  model?: string
  playback: MusicPlayback
  prompts: WeightedPrompt[]
  config: Record<string, unknown>
  /** Prompts Lyria's safety filter dropped, newest last (kept to 10). */
  filtered: { text?: string; reason?: string }[]
  error?: string
  /** Audio chunks received on this socket (each is 2 s of 48 kHz stereo PCM). */
  chunks: number
  /** Rolling take held on the backend for saving (`music_take`, also estimated from audio deltas). */
  take: { seconds: number; segments: MusicSegment[]; maxSeconds?: number }
}
export interface MusicSegment { start_s: number; duration_s: number; prompts: WeightedPrompt[]; config: Record<string, unknown> }

export const EMPTY_MUSIC_STATE: MusicState = { connected: false, playback: 'idle', prompts: [], config: {}, filtered: [], chunks: 0, take: { seconds: 0, segments: [] } }

export const EMPTY_LIVE_STATE: LiveState = { status: 'idle', activity: 'idle', processing: false, playing: false, turns: [], reasoning: '', warnings: [], music: EMPTY_MUSIC_STATE }

/** Frame types the Live Music session emits on the `/bidi` socket. `music_audio_delta` is handled by the music sink before the reducer. */
export const isMusicFrame = (type: string): boolean => type.startsWith('music_')

/** Reduce one `music_*` frame into `MusicState`. Unknown music frames leave the state untouched. */
export function reduceMusicEvent(music: MusicState, data: Record<string, unknown>): MusicState {
  switch (str(data.type)) {
    case 'music_ready':
      return { ...music, connected: true, model: str(data.model) || music.model, error: undefined }
    case 'music_setup_complete':
      return { ...music, connected: true }
    case 'music_prompts': {
      const prompts = Array.isArray(data.prompts)
        ? data.prompts.filter((p): p is WeightedPrompt => !!p && typeof p === 'object' && typeof (p as WeightedPrompt).text === 'string' && typeof (p as WeightedPrompt).weight === 'number')
        : music.prompts
      return { ...music, connected: true, prompts }
    }
    case 'music_config':
      return { ...music, connected: true, config: data.config && typeof data.config === 'object' ? data.config as Record<string, unknown> : music.config }
    case 'music_playback': {
      const state = str(data.state)
      return { ...music, connected: true, playback: state === 'playing' || state === 'paused' || state === 'stopped' ? state : music.playback }
    }
    case 'music_audio_delta': {
      // Each chunk is bytes/(rate*channels*2) seconds; the backend's take grows by the same amount.
      const bytes = typeof data.audio === 'string' ? Math.floor(data.audio.length * 3 / 4) : 0
      const rate = typeof data.sample_rate === 'number' && data.sample_rate > 0 ? data.sample_rate : 48000
      const channels = data.channels === 1 ? 1 : 2
      const seconds = bytes / (rate * channels * 2)
      // The backend recorder is rolling: never report more than it can hold.
      const total = music.take.seconds + seconds
      const clamped = music.take.maxSeconds ? Math.min(total, music.take.maxSeconds) : total
      return { ...music, connected: true, playback: music.playback === 'idle' ? 'playing' : music.playback, chunks: music.chunks + 1,
        take: { ...music.take, seconds: clamped } }
    }
    case 'music_take':
      return { ...music, take: takeFromFrame(music.take, data) }
    case 'music_filtered_prompt':
      return { ...music, filtered: [...music.filtered, { text: str(data.text) || undefined, reason: str(data.reason) || undefined }].slice(-10) }
    case 'music_error':
      return { ...music, error: str(data.message) || 'Live music failed.' }
    case 'music_closed':
      return { ...music, connected: false, playback: 'idle' }
    default:
      return music
  }
}

/** Fold a backend `MusicTake` shape (`music_take` frame or `/music/take*` response) into the state. */
export function takeFromFrame(current: MusicState['take'], data: Record<string, unknown>): MusicState['take'] {
  const segments = Array.isArray(data.segments) ? data.segments as MusicSegment[] : current.segments
  const maxSeconds = typeof data.max_seconds === 'number' && data.max_seconds > 0 ? data.max_seconds : current.maxSeconds
  return { seconds: typeof data.seconds === 'number' ? data.seconds : current.seconds, segments, maxSeconds }
}

/** Decode a `music_audio_delta` frame: base64 PCM16 LE, stereo 48 kHz by default (Lyria's `audio/l16;rate=48000;channels=2`). */
export function decodeMusicPcm16(frame: Record<string, unknown>, decodeBase64: (text: string) => Uint8Array = defaultBase64): DecodedPcm | null {
  return decodePcm16({ ...frame, channels: frame.channels === 1 ? 1 : 2, sample_rate: typeof frame.sample_rate === 'number' && frame.sample_rate > 0 ? frame.sample_rate : 48000 }, decodeBase64)
}

/** Side effects the component must perform; the reducer itself is pure. */
export type LiveEffect = 'stop_playback' | 'close'

export interface LiveReduction { state: LiveState; effects: LiveEffect[] }

const MAX_TURNS = 200
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function upsertTurn(turns: LiveTurn[], id: string, make: () => LiveTurn, update: (turn: LiveTurn) => LiveTurn): LiveTurn[] {
  const index = turns.findIndex((turn) => turn.id === id)
  const next = index >= 0 ? turns.map((turn, i) => (i === index ? update(turn) : turn)) : [...turns, update(make())]
  return next.length > MAX_TURNS ? next.slice(next.length - MAX_TURNS) : next
}

/** Reduce one parsed `/bidi` frame. Unknown frame types are ignored. */
export function reduceLiveEvent(state: LiveState, event: unknown): LiveReduction {
  if (!event || typeof event !== 'object') return { state, effects: [] }
  const data = event as Record<string, unknown>
  const type = str(data.type)
  const effects: LiveEffect[] = []
  const derive = (next: LiveState): LiveState => ({ ...next, activity: deriveActivity(next) })
  if (isMusicFrame(type)) return { effects, state: { ...state, music: reduceMusicEvent(state.music ?? EMPTY_MUSIC_STATE, data) } }

  switch (type) {
    case 'ready': {
      const source = str(data.history_source)
      return { effects, state: derive({ ...state, status: 'ready', error: undefined, errorCode: undefined, unknownResults: undefined,
        model: str(data.model) || state.model, voice: str(data.voice) || state.voice, effort: str(data.effort) || state.effort,
        conversationId: str(data.conversation_id) || state.conversationId,
        tools: Array.isArray(data.tools) ? data.tools.map(String) : state.tools,
        musicAvailable: data.music === true, agentId: str(data.agent_id) || undefined,
        music: { ...EMPTY_MUSIC_STATE, take: { ...EMPTY_MUSIC_STATE.take, maxSeconds: typeof data.music_max_seconds === 'number' && data.music_max_seconds > 0 ? data.music_max_seconds : undefined } },
        historySource: source === 'snapshot' || source === 'client' || source === 'none' ? source : state.historySource }) }
    }
    case 'error':
      effects.push('stop_playback')
      return { effects, state: derive({ ...state, error: str(data.message) || 'Live session failed.', errorCode: str(data.code) || undefined, processing: false }) }
    case 'warning': {
      const text = str(data.message) || str(data.code)
      return { effects, state: text && !state.warnings.includes(text) ? { ...state, warnings: [...state.warnings, text] } : state }
    }
    case 'context_applied': {
      const mode = str(data.mode)
      return { effects, state: mode === 'initial' || mode === 'realtime' || mode === 'queued' ? { ...state, contextMode: mode } : state }
    }
    case 'stopped': {
      // Server acknowledged stop; the socket closes 1000 next. Unknown results are reported, never replayed.
      const pending = Array.isArray(data.pending_tools) ? data.pending_tools.map(String) : []
      effects.push('stop_playback')
      return { effects, state: derive({ ...state, processing: false, unknownResults: pending.length ? pending : undefined,
        turns: state.turns.map((turn) => (turn.kind === 'tool' && !turn.final ? { ...turn, final: true, cancelled: pending.includes(turn.id) ? turn.cancelled : turn.cancelled } : turn)) }) }
    }
    case 'tool_result': {
      const result = data.tool_result && typeof data.tool_result === 'object' ? data.tool_result as Record<string, unknown> : null
      const id = result ? str(result.toolUseId) : ''
      if (!id) return { effects, state }
      const failed = result ? str(result.status) === 'error' : false
      return { effects, state: { ...state, turns: state.turns.map((turn) => (turn.id === id ? { ...turn, final: true, text: failed ? 'error' : 'done' } : turn)) } }
    }
    case 'journal':
      return { effects, state: { ...state, journalHtml: str(data.html) || state.journalHtml, journalSaved: data.saved === true } }
    case 'bidi_connection_restart':
      return { effects, state: { ...state, restartNotice: data.turn_interrupted === true
        ? 'The Live connection restarted and cut off the last turn. Repeat it if you did not get an answer.' : undefined } }
    case 'bidi_connection_stop':
      effects.push('stop_playback', 'close')
      return { effects, state: derive({ ...state, status: 'idle', processing: false, music: { ...state.music, connected: false, playback: 'idle' } }) }
    case 'bidi_response_start':
      return { effects, state: derive({ ...state, processing: true }) }
    case 'bidi_response_stop':
      // Output ended; extended thinking may still report in_progress via interaction_status.
      return { effects, state: derive({ ...state, processing: state.processing && state.lastStatusInProgress === true }) }
    case 'bidi_interaction_status': {
      const inProgress = str(data.status) === 'in_progress' || str(data.status) === 'requires_action'
      return { effects, state: derive({ ...state, processing: inProgress, lastStatusInProgress: inProgress }) }
    }
    case 'bidi_barge_in':
      effects.push('stop_playback')
      return { effects, state: derive({ ...state, processing: false, playing: false }) }
    case 'bidi_transcript_delta':
    case 'bidi_transcript_block':
    case 'bidi_transcript_stop': {
      const id = str(data.content_id) || `transcript-${state.turns.length}`
      const role = data.role === 'assistant' ? 'assistant' : 'user'
      const turns = upsertTurn(state.turns, id, () => ({ id, role, kind: 'transcript', text: '', final: false }), (turn) => {
        if (type === 'bidi_transcript_delta') return { ...turn, text: turn.text + str(data.delta) }
        if (type === 'bidi_transcript_block') return { ...turn, text: str(data.transcript) || turn.text, final: true }
        return { ...turn, final: true }
      })
      return { effects, state: { ...state, turns } }
    }
    case 'bidi_text_delta':
    case 'bidi_text_block':
    case 'bidi_text_stop': {
      const id = str(data.content_id) || `text-${state.turns.length}`
      const turns = upsertTurn(state.turns, id, () => ({ id, role: 'assistant', kind: 'text', text: '', final: false }), (turn) => {
        if (type === 'bidi_text_delta') return { ...turn, text: turn.text + str(data.delta) }
        if (type === 'bidi_text_block') return { ...turn, text: str(data.text) || turn.text, final: true }
        return { ...turn, final: true }
      })
      return { effects, state: { ...state, turns } }
    }
    case 'bidi_reasoning_delta':
      return { effects, state: derive({ ...state, processing: true, reasoning: (state.reasoning + str(data.delta)).slice(-8_000) }) }
    case 'bidi_reasoning_block':
      return { effects, state: { ...state, reasoning: (str(data.text) || state.reasoning).slice(-8_000) } }
    case 'bidi_tool_use_blocks': {
      const uses = Array.isArray(data.tool_uses) ? data.tool_uses : []
      let turns = state.turns
      for (const use of uses) {
        if (!use || typeof use !== 'object') continue
        const record = use as Record<string, unknown>
        const id = str(record.toolUseId) || `tool-${turns.length}`
        turns = upsertTurn(turns, id, () => ({ id, role: 'assistant', kind: 'tool', text: '', final: false, toolName: str(record.name) || 'tool', toolInput: record.input }), (turn) => turn)
      }
      return { effects, state: derive({ ...state, processing: true, turns }) }
    }
    case 'bidi_tool_cancel': {
      const ids = new Set(Array.isArray(data.tool_use_ids) ? data.tool_use_ids.map(String) : [])
      // Gemini no longer wants the result, but the host tool may still be executing.
      return { effects, state: { ...state, turns: state.turns.map((turn) => (ids.has(turn.id) ? { ...turn, cancelled: true } : turn)) } }
    }
    case 'bidi_usage': {
      const input = Number(data.inputTokens ?? 0), output = Number(data.outputTokens ?? 0), total = Number(data.totalTokens ?? input + output)
      return { effects, state: { ...state, usage: { input, output, total } } }
    }
    default:
      return { effects, state }
  }
}

/** Audio sink playback state is owned by the component; fold it in here so `activity` stays derived. */
export function withPlayback(state: LiveState, playing: boolean): LiveState {
  const next = { ...state, playing }
  return { ...next, activity: deriveActivity(next) }
}

/** Playback (speaking) is distinct from processing (thinking / running tools). */
export function deriveActivity(state: Pick<LiveState, 'status' | 'playing' | 'processing'>): LiveActivity {
  if (state.status !== 'ready') return 'idle'
  if (state.playing) return 'speaking'
  if (state.processing) return 'thinking'
  return 'listening'
}

/** Provider cancellation does not establish that host side effects have stopped. */
export const pendingTools = (state: LiveState): LiveTurn[] => state.turns.filter((turn) => turn.kind === 'tool' && !turn.final)

/**
 * Whether the Live surface may hand off to Chat right now. Capture is stopped by
 * the caller first; a graceful handoff waits for pending tools and processing.
 */
export function canHandOff(state: LiveState): { ok: boolean; reason?: string } {
  if (state.unknownResults?.length) return { ok: false, reason: 'Some tool outcomes are unknown. Check the affected work before continuing.' }
  if (state.status === 'idle') return { ok: true }
  const pending = pendingTools(state)
  if (pending.length) return { ok: false, reason: `${pending.length} tool call${pending.length === 1 ? '' : 's'} still running. Wait or stop the Live session.` }
  if (state.processing) return { ok: false, reason: 'Ren is still working on the last turn. Wait or stop the Live session.' }
  return { ok: true }
}

/** Turns worth carrying into Chat context: final speech/text only. */
export function liveHistory(state: LiveState): LiveContextTurn[] {
  return state.turns.filter((turn) => turn.kind !== 'tool' && turn.final && turn.text.trim()).map((turn) => ({ role: turn.role, text: turn.text.trim() }))
}

/** Error codes that mean the backend refused the scope: show a blocker, not a retry prompt. */
export const isScopeBlocker = (code: string | undefined): boolean => code === 'unsupported_scope' || code === 'unauthorized' || code === 'forbidden'

// ─── Audio ───────────────────────────────────────────────────────────────────

export interface DecodedPcm { channels: number; sampleRate: number; frames: number; samples: Float32Array[] }

/** Decode a native `bidi_audio_delta` frame (base64 PCM16 LE, interleaved) into per-channel floats. */
export function decodePcm16(frame: Record<string, unknown>, decodeBase64: (text: string) => Uint8Array = defaultBase64): DecodedPcm | null {
  if (typeof frame.audio !== 'string' || !frame.audio) return null
  if (frame.format !== undefined && frame.format !== 'pcm') return null
  const bytes = decodeBase64(frame.audio)
  const channels = frame.channels === 2 ? 2 : 1
  const sampleRate = typeof frame.sample_rate === 'number' && frame.sample_rate > 0 ? frame.sample_rate : 24000
  const frames = Math.floor(bytes.byteLength / 2 / channels)
  if (!frames) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const samples = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < channels; channel++) samples[channel][i] = view.getInt16((i * channels + channel) * 2, true) / 32768
  return { channels, sampleRate, frames, samples }
}

function defaultBase64(text: string): Uint8Array {
  if (typeof atob === 'function') return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
  return new Uint8Array(Buffer.from(text, 'base64'))
}
