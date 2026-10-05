import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  DEFAULT_GEMINI_VOICE, DEFAULT_LIVE_MODEL, DEFAULT_REASONING_EFFORT, isGeminiVoice, isLiveModel, isReasoningEffort,
  type GeminiVoiceId, type LiveModelId, type ReasoningEffort,
} from '../lib/voice-settings.ts'

/**
 * Live panel preferences. `model`, `voice` and `effort` become `/bidi` query
 * parameters on the next connect (an open session keeps its own selection);
 * `micDeviceId` is threaded into `getUserMedia` by VoiceAgent.
 */
interface VoiceSettingsState {
  micDeviceId: string | undefined
  model: LiveModelId
  voice: GeminiVoiceId
  effort: ReasoningEffort
  setMicDeviceId: (id: string | undefined) => void
  setModel: (model: LiveModelId) => void
  setVoice: (voice: GeminiVoiceId) => void
  setEffort: (effort: ReasoningEffort) => void
}

type PersistedVoiceSettings = Pick<VoiceSettingsState, 'micDeviceId' | 'model' | 'voice' | 'effort'>

export const useVoiceSettingsStore = create<VoiceSettingsState>()(persist((set) => ({
  micDeviceId: undefined,
  model: DEFAULT_LIVE_MODEL,
  voice: DEFAULT_GEMINI_VOICE,
  effort: DEFAULT_REASONING_EFFORT,
  setMicDeviceId: (micDeviceId) => set({ micDeviceId }),
  setModel: (model) => set({ model }),
  setVoice: (voice) => set({ voice }),
  setEffort: (effort) => set({ effort }),
}), {
  name: 'ron-voice-settings',
  version: 2,
  // v1 lacked `model`; `merge` fills the default so nothing is dropped.
  migrate: (persisted) => persisted as PersistedVoiceSettings,
  storage: createJSONStorage(() => localStorage),
  partialize: ({ micDeviceId, model, voice, effort }): PersistedVoiceSettings => ({ micDeviceId, model, voice, effort }),
  merge: (persisted, current) => {
    const saved = (persisted ?? {}) as Partial<Record<keyof PersistedVoiceSettings, unknown>>
    return {
      ...current,
      micDeviceId: typeof saved.micDeviceId === 'string' && saved.micDeviceId ? saved.micDeviceId : undefined,
      model: isLiveModel(saved.model) ? saved.model : DEFAULT_LIVE_MODEL,
      voice: isGeminiVoice(saved.voice) ? saved.voice : DEFAULT_GEMINI_VOICE,
      effort: isReasoningEffort(saved.effort) ? saved.effort : DEFAULT_REASONING_EFFORT,
    }
  },
}))
