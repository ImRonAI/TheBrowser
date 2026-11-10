import { create } from 'zustand'
import { EMPTY_MUSIC_STATE, takeFromFrame, type MusicState } from '../lib/voice-events.ts'
import type { MusicPosition } from '../lib/music-position.ts'

/**
 * Mirror of the Live session's music state for surfaces that do not own the
 * `/bidi` socket (the music side tab and deck). `VoiceAgent` publishes here while it
 * is connected: the socket, the Lyria session and the audio sink stay in the
 * component; this store only carries state plus the sink's volume setter, its
 * position reader and the socket's text sender (for the deck's Edit box).
 */
export interface LiveMusicControls {
  setVolume: (value: number) => void
  /** The chunk audible now in the music sink (`useMusicPlayback.position`). */
  position?: () => MusicPosition | null
  /** Send a typed user turn to the Live agent (`VoiceAgent.sendText`); false when not connected. */
  sendText?: (text: string) => boolean
}

interface LiveMusicStore {
  /** The music side panel is slid open. */
  open: boolean
  setOpen: (open: boolean) => void
  /** Live socket status for the publishing VoiceAgent (`idle` when none is mounted/connected). */
  liveStatus: 'idle' | 'connecting' | 'ready'
  /** `ready.music`: the music_* tools exist on the connected session. */
  available: boolean
  /** The Live socket's random per-session `agent_id` and the user it was opened for (`/music/*` identity). */
  agentId?: string
  userId: string
  music: MusicState
  /** Audio currently scheduled in the music sink. */
  playing: boolean
  volume: number
  controls: LiveMusicControls | null
  publish: (update: Partial<Pick<LiveMusicStore, 'liveStatus' | 'available' | 'music' | 'playing' | 'agentId' | 'userId'>>) => void
  /** Apply a `MusicTake` returned by the deck's own `/music/take*` calls (the socket does not echo them). */
  publishTake: (take: Record<string, unknown>) => void
  attach: (controls: LiveMusicControls | null) => void
  setVolume: (value: number) => void
  reset: () => void
}

export const useLiveMusicStore = create<LiveMusicStore>()((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  liveStatus: 'idle',
  available: false,
  agentId: undefined,
  userId: 'default',
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
  reset: () => set({ liveStatus: 'idle', available: false, agentId: undefined, music: EMPTY_MUSIC_STATE, playing: false, open: false }),
}))

/**
 * The deck is shown only when there is music to control: a Lyria session is open (connected,
 * playing or paused, or still generating its first chunk) or a recorded take is waiting to be
 * saved/discarded. A Live session that merely *could* play music keeps the deck hidden -- the
 * user asks Ron for music by voice and the deck appears with it.
 */
export function shouldShowMusicDeck(store: Pick<LiveMusicStore, 'liveStatus' | 'music' | 'playing'>): boolean {
  if (store.liveStatus !== 'ready') return false
  const m = store.music
  return m.connected || store.playing || m.take.seconds > 0 || m.playback === 'paused' || m.playback === 'playing' || Boolean(m.error)
}

/** Human label for the deck header. */
export function musicCaption(store: Pick<LiveMusicStore, 'liveStatus' | 'available' | 'music' | 'playing'>): string {
  if (store.liveStatus === 'idle') return 'Connect Live to start the music'
  if (store.liveStatus === 'connecting') return 'Connecting Live…'
  if (!store.available) return 'This Live session has no music tools (RON_LIVE_MUSIC=0)'
  if (store.music.error) return `Music error: ${store.music.error}`
  if (!store.music.connected) return 'Ask Ren for some music'
  if (store.music.playback === 'paused') return 'Paused'
  if (store.music.playback === 'stopped') return 'Stopped · ask Ren to play'
  return store.playing ? 'Live from Lyria RealTime' : 'Generating…'
}
