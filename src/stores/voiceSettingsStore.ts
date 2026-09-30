import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  DEFAULT_GEMINI_VOICE, DEFAULT_REASONING_EFFORT, isGeminiVoice, isReasoningEffort,
  type GeminiVoiceId, type ReasoningEffort,
} from '../lib/voice-settings.ts'

/**
 * Voice panel preferences. UI state only: `voice` and `effort` are never sent
 * to the voice API; `micDeviceId` is threaded into `getUserMedia` by VoiceAgent.
 */
interface VoiceSettingsState {
  micDeviceId: string | undefined
  voice: GeminiVoiceId
  effort: ReasoningEffort
  setMicDeviceId: (id: string | undefined) => void
  setVoice: (voice: GeminiVoiceId) => void
  setEffort: (effort: ReasoningEffort) => void
}

type PersistedVoiceSettings = Pick<VoiceSettingsState, 'micDeviceId' | 'voice' | 'effort'>

export const useVoiceSettingsStore = create<VoiceSettingsState>()(persist((set) => ({
  micDeviceId: undefined,
  voice: DEFAULT_GEMINI_VOICE,
  effort: DEFAULT_REASONING_EFFORT,
  setMicDeviceId: (micDeviceId) => set({ micDeviceId }),
  setVoice: (voice) => set({ voice }),
  setEffort: (effort) => set({ effort }),
}), {
  name: 'ron-voice-settings',
  version: 1,
  storage: createJSONStorage(() => localStorage),
  partialize: ({ micDeviceId, voice, effort }): PersistedVoiceSettings => ({ micDeviceId, voice, effort }),
  merge: (persisted, current) => {
    const saved = (persisted ?? {}) as Partial<Record<keyof PersistedVoiceSettings, unknown>>
    return {
      ...current,
      micDeviceId: typeof saved.micDeviceId === 'string' && saved.micDeviceId ? saved.micDeviceId : undefined,
      voice: isGeminiVoice(saved.voice) ? saved.voice : DEFAULT_GEMINI_VOICE,
      effort: isReasoningEffort(saved.effort) ? saved.effort : DEFAULT_REASONING_EFFORT,
    }
  },
}))
