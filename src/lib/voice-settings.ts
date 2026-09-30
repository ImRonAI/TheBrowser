/**
 * Pure voice-panel settings: Gemini Live prebuilt voices, reasoning-effort
 * levels, microphone constraints and Persona presence helpers.
 *
 * UI state only — nothing here is sent to the voice API. The single
 * functional hookup is `micConstraints`, which threads the chosen input
 * device into `getUserMedia`. No React, no `@/` imports so `node --test`
 * can run the colocated test.
 */

export type ReasoningEffort = 'low' | 'medium' | 'high'

export const REASONING_EFFORTS: readonly { id: ReasoningEffort; label: string; description: string }[] = [
  { id: 'low', label: 'Low', description: 'Fastest replies. Minimal deliberation before speaking.' },
  { id: 'medium', label: 'Medium', description: 'Balanced latency and reasoning depth.' },
  { id: 'high', label: 'High', description: 'Deepest reasoning. Slower first response.' },
]

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'high'

/** Caption only; the model itself is selected by the backend. */
export const VOICE_MODEL_LABEL = 'Gemini 3.8 Live · Extended Thinking'

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
