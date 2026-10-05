/**
 * Pure voice-panel settings: Gemini Live models, prebuilt voices,
 * reasoning-effort levels, microphone constraints and Persona presence
 * helpers.
 *
 * `model`, `voice` and `effort` are sent as `/bidi` query parameters by
 * `liveQuery` (voice-events.ts); `micConstraints` threads the chosen input
 * device into `getUserMedia`. No React, no `@/` imports so `node --test`
 * can run the colocated test.
 */

export type LiveModelId = 'gemini-3.8-live-extended-thinking' | 'gemini-3.8-live'
export const EXTENDED_LIVE_MODEL: LiveModelId = 'gemini-3.8-live-extended-thinking'
export const REGULAR_LIVE_MODEL: LiveModelId = 'gemini-3.8-live'
// Regular Live is the default: Extended Thinking usually skips the browser toolCall and reports a
// "system error" instead (see agent/api/endpoints/bidi.py DEFAULT_MODEL).
export const DEFAULT_LIVE_MODEL: LiveModelId = REGULAR_LIVE_MODEL

/** Mirrors `LIVE_MODEL_IDS` in agent/api/core/bidi_agent.py. */
export const LIVE_MODELS: readonly { id: LiveModelId; label: string; description: string; thinking: boolean }[] = [
  { id: EXTENDED_LIVE_MODEL, label: 'Gemini 3.8 Live · Extended Thinking', description: 'Deeper reasoning with a selectable effort; tools run non-blocking.', thinking: true },
  { id: REGULAR_LIVE_MODEL, label: 'Gemini 3.8 Live', description: 'Lowest latency. No thinking configuration.', thinking: false },
]

export function isLiveModel(value: unknown): value is LiveModelId {
  return typeof value === 'string' && LIVE_MODELS.some((model) => model.id === value)
}

export const liveModelLabel = (id: LiveModelId): string => LIVE_MODELS.find((model) => model.id === id)?.label ?? id
export const supportsEffort = (id: LiveModelId): boolean => LIVE_MODELS.find((model) => model.id === id)?.thinking ?? false

export type ReasoningEffort = 'low' | 'medium' | 'high'

export const REASONING_EFFORTS: readonly { id: ReasoningEffort; label: string; description: string }[] = [
  { id: 'low', label: 'Low', description: 'Fastest replies. Minimal deliberation before speaking.' },
  { id: 'medium', label: 'Medium', description: 'Balanced latency and reasoning depth.' },
  { id: 'high', label: 'High', description: 'Deepest reasoning. Slower first response.' },
]

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'high'

/** Default caption; the live caption comes from `liveModelLabel(selected model)`. */
export const VOICE_MODEL_LABEL = liveModelLabel(DEFAULT_LIVE_MODEL)

export type GeminiVoiceId = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede' | 'Leda' | 'Orus' | 'Zephyr'

export const GEMINI_VOICES: readonly {
  id: GeminiVoiceId; name: string; description: string; gender: 'male' | 'female'
}[] = [
  { id: 'Puck', name: 'Puck', description: 'Upbeat', gender: 'male' },
  { id: 'Charon', name: 'Charon', description: 'Informative', gender: 'male' },
  { id: 'Kore', name: 'Kore', description: 'Firm', gender: 'female' },
  { id: 'Fenrir', name: 'Fenrir', description: 'Excitable', gender: 'male' },
  { id: 'Aoede', name: 'Aoede', description: 'Breezy', gender: 'female' },
  { id: 'Leda', name: 'Leda', description: 'Youthful', gender: 'female' },
  { id: 'Orus', name: 'Orus', description: 'Firm', gender: 'male' },
  { id: 'Zephyr', name: 'Zephyr', description: 'Bright', gender: 'female' },
]

export const DEFAULT_GEMINI_VOICE: GeminiVoiceId = 'Kore'

export function isGeminiVoice(value: unknown): value is GeminiVoiceId {
  return typeof value === 'string' && GEMINI_VOICES.some((voice) => voice.id === value)
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.some((effort) => effort.id === value)
}

/** The only permitted functional hookup: pins `getUserMedia` to the chosen device. */
export function micConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    video: false,
  }
}

/** True when the failure means the saved device is gone, so the pin should be cleared. */
export function isMicUnavailableError(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const name = (cause as { name?: unknown }).name
  return name === 'OverconstrainedError' || name === 'NotFoundError'
}

export type VoiceStatus = 'idle' | 'connecting' | 'ready'
export type VoiceSource = 'screen' | 'camera' | null
/** Mirrors `PersonaState` from the AI Elements persona without importing React. */
export type PersonaStateLike = 'idle' | 'listening' | 'thinking' | 'speaking' | 'asleep'

export function personaState(status: VoiceStatus, activity: PersonaStateLike): PersonaStateLike {
  if (status === 'idle') return 'asleep'
  if (status === 'connecting') return 'thinking'
  return activity
}

const ACTIVITY_LABEL: Record<PersonaStateLike, string> = {
  listening: 'Listening', speaking: 'Speaking', thinking: 'Thinking', idle: 'Ready', asleep: 'Ready',
}

export function personaCaption(status: VoiceStatus, activity: PersonaStateLike, mic: boolean, source: VoiceSource): string {
  if (status === 'idle') return 'Not connected'
  if (status === 'connecting') return 'Connecting…'
  const sharing = source === 'screen' ? 'Sharing screen' : source === 'camera' ? 'Sharing camera' : null
  return [ACTIVITY_LABEL[activity], sharing, mic ? 'Mic on' : 'Mic muted'].filter(Boolean).join(' · ')
}
