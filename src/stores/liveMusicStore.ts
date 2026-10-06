import { create } from 'zustand'
import { EMPTY_MUSIC_STATE, takeFromFrame, type MusicState } from '../lib/voice-events.ts'

/**
 * Mirror of the Live session's music state for surfaces that do not own the
 * `/bidi` socket (the Vibe → Music deck). `VoiceAgent` publishes here while it
 * is connected: the socket, the Lyria session and the audio sink stay in the
 * component; this store only carries state and the sink's volume setter.
 */
export interface LiveMusicControls {
  setVolume: (value: number) => void
}

interface LiveMusicStore {
  /** Live socket status for the publishing VoiceAgent (`idle` when none is mounted/connected). */
  liveStatus: 'idle' | 'connecting' | 'ready'
  /** `ready.music`: the music_* tools exist on the connected session. */
  available: boolean
  music: MusicState
  /** Audio currently scheduled in the music sink. */
  playing: boolean
  volume: number
  controls: LiveMusicControls | null
  publish: (update: Partial<Pick<LiveMusicStore, 'liveStatus' | 'available' | 'music' | 'playing'>>) => void
  /** Apply a `MusicTake` returned by the deck's own `/music/take*` calls (the socket does not echo them). */
  publishTake: (take: Record<string, unknown>) => void
  attach: (controls: LiveMusicControls | null) => void
  setVolume: (value: number) => void
  reset: () => void
}

export const useLiveMusicStore = create<LiveMusicStore>()((set, get) => ({
  liveStatus: 'idle',
  available: false,
  music: EMPTY_MUSIC_STATE,
  playing: false,
  volume: 0.8,
  controls: null,
  publish: (update) => set(update),
  publishTake: (take) => set((state) => ({ music: { ...state.music, take: takeFromFrame(state.music.take, take) } })),
  attach: (controls) => { controls?.setVolume(get().volume); set({ controls }) },
  setVolume: (value) => {
    const volume = Math.max(0, Math.min(1, value))
    get().controls?.setVolume(volume)
    set({ volume })
  },
  reset: () => set({ liveStatus: 'idle', available: false, music: EMPTY_MUSIC_STATE, playing: false }),
}))

/** Human label for the deck header. */
export function musicCaption(store: Pick<LiveMusicStore, 'liveStatus' | 'available' | 'music' | 'playing'>): string {
  if (store.liveStatus === 'idle') return 'Connect Live to start the music'
  if (store.liveStatus === 'connecting') return 'Connecting Live…'
  if (!store.available) return 'This Live session has no music tools (RON_LIVE_MUSIC=0)'
  if (store.music.error) return `Music error: ${store.music.error}`
  if (!store.music.connected) return 'Ask Ron for some music'
  if (store.music.playback === 'paused') return 'Paused'
  if (store.music.playback === 'stopped') return 'Stopped · ask Ron to play'
  return store.playing ? 'Live from Lyria RealTime' : 'Generating…'
}
