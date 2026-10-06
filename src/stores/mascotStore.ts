import { create } from 'zustand'
import type { Genre } from '../lib/mascot.ts'

/**
 * What Oubli (the Agent Panel mascot) is reacting to right now. Both panel
 * surfaces publish here: `usePanelChat`/`AgentPanel` for the text agent
 * (reasoning deltas, run status, tool activity) and `VoiceAgent` for Live
 * (interaction status, tool calls, music). The audio analyser taps are not
 * state; `VoiceAgent` registers them as functions so the rig can poll them
 * every animation frame without re-rendering React.
 */
export type FrequencyTap = () => { data: Uint8Array; binHz: number } | null

export type ThoughtListener = (event: { kind: 'delta'; text: string } | { kind: 'settle' } | { kind: 'clear' }) => void

interface MascotStore {
  /** The user is asking Ron something right now (Ask Ron menu, composer submit, Live listening). */
  asking: boolean
  /** A run is in progress (text agent `running`, or Live `processing`). */
  processing: boolean
  /** A tool call is executing. */
  working: boolean
  /** Gemini Live reported reasoning / waiting (`interaction_status in_progress`). */
  thinking: boolean
  /** Live socket is open. */
  liveOpen: boolean
  /** Costume derived from the Lyria prompts; null = plain Oubli. */
  genre: Genre | null
  bpm: number
  musicOn: boolean
  voiceTap: FrequencyTap | null
  musicTap: FrequencyTap | null
  set: (update: Partial<Pick<MascotStore, 'asking' | 'processing' | 'working' | 'thinking' | 'liveOpen' | 'genre' | 'bpm' | 'musicOn'>>) => void
  attachTaps: (taps: { voice: FrequencyTap | null; music: FrequencyTap | null }) => void
  /** Thought-bubble stream; `Oubli` subscribes, publishers call `thought(...)`. */
  thought: (event: Parameters<ThoughtListener>[0]) => void
  subscribeThought: (listener: ThoughtListener) => () => void
}

const listeners = new Set<ThoughtListener>()

export const useMascotStore = create<MascotStore>()((set) => ({
  asking: false, processing: false, working: false, thinking: false, liveOpen: false,
  genre: null, bpm: 0, musicOn: false, voiceTap: null, musicTap: null,
  set: (update) => set(update),
  attachTaps: ({ voice, music }) => set({ voiceTap: voice, musicTap: music }),
  thought: (event) => { listeners.forEach((listener) => listener(event)) },
  subscribeThought: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
}))

/** A brief "asking" flash so Oubli peeks out even when the request resolves instantly. */
let askTimer: ReturnType<typeof setTimeout> | undefined
export function flashAsking(ms = 6000): void {
  useMascotStore.getState().set({ asking: true })
  if (askTimer) clearTimeout(askTimer)
  askTimer = setTimeout(() => useMascotStore.getState().set({ asking: false }), ms)
}
