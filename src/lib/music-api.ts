/**
 * Renderer client for the Live Music deck (`agent/api/endpoints/music.py`): transport
 * controls and the take recorder of the current Live session, and the saved-song
 * library. Identity mirrors `createProjectsRequest` (bearer token, or the guest
 * workspace header, which cannot save). No React, no `@/` imports (node-testable).
 */

import type { MusicSegment, WeightedPrompt } from './voice-events.ts'

export type MusicAction = 'play' | 'pause' | 'stop' | 'reset_context'

export interface SavedSong {
  id: string
  title: string
  /** `lyria-realtime` (recorded Live take), `lyria` (Lyria 3.5 / Clip), `elevenlabs` (ElevenLabs Music). */
  source: 'lyria-realtime' | 'lyria' | 'elevenlabs'
  model: string
  duration_seconds: number
  format: string
  storage_path: string
  prompt: string
  lyrics: string
  prompts: WeightedPrompt[]
  config: Record<string, unknown>
  timeline: MusicSegment[]
  composition_plan: Record<string, unknown>
  created_at: string
  signed_url: string | null
}

export const SOURCE_LABELS: Record<SavedSong['source'], string> = { 'lyria-realtime': 'Live take', lyria: 'Lyria 3.5', elevenlabs: 'ElevenLabs' }

export interface MusicTake { seconds: number; segments: MusicSegment[]; sample_rate?: number; channels?: number; max_seconds?: number }
export interface SaveResult { song_id: string; title: string; duration_seconds: number; storage_path: string; segments: number; signed_url: string | null }

type Session = { user: { id: string }; access_token: string } | null

/**
 * The deck is a signed-in surface: `/music/*` binds every Live music session to the Supabase
 * `user_id` the socket was opened with, which a guest workspace can never match. `userId` is the
 * panel's user (`useAuthStore(... ?? 'default')`); anything but the signed-in user's own id is refused
 * here with the same message the server returns.
 */
export const SIGN_IN_MESSAGE = 'Sign in to Ren to use the music deck (guest sessions cannot).'

export function musicHeaders(userId: string, session: Session): Record<string, string> {
  if (!session || session.user.id !== userId) throw new Error(SIGN_IN_MESSAGE)
  return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
}

export type MusicRequest = <T>(path: string, method?: string, body?: unknown) => Promise<T>

export function createMusicRequest(baseUrl: string, getSession: () => Promise<Session>, userId: string, fetcher: typeof fetch = fetch): MusicRequest {
  return async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const headers = musicHeaders(userId, await getSession())
    let response: Response
    try {
      response = await fetcher(`${baseUrl.replace(/\/$/, '')}/music${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
      })
    } catch {
      throw new Error('Cannot reach the music deck backend.')
    }
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = data?.detail
      throw new Error(typeof detail === 'string' ? detail : `Music request failed (${response.status})`)
    }
    return data as T
  }
}

export const musicControl = (request: MusicRequest, agentId: string, action: MusicAction) =>
  request<{ action: MusicAction; playback: string }>('/control', 'POST', { agent_id: agentId, action })
export const musicDiscardTake = (request: MusicRequest, agentId: string) => request<MusicTake>('/take/discard', 'POST', { agent_id: agentId })
export const musicSave = (request: MusicRequest, agentId: string, title: string) => request<SaveResult>('/save', 'POST', { agent_id: agentId, title })
export const musicSongs = (request: MusicRequest) => request<{ songs: SavedSong[]; sign_in_required: boolean }>('/songs')
export const musicDeleteSong = (request: MusicRequest, songId: string) => request<{ deleted: boolean }>(`/songs/${encodeURIComponent(songId)}`, 'DELETE')

// ─── Playlists / albums ──────────────────────────────────────────────────────

export type PlaylistKind = 'playlist' | 'album'
export interface PlaylistSummary {
  id: string
  kind: PlaylistKind
  title: string
  description: string
  song_count: number
  created_at: string
  updated_at: string
}
export interface Playlist extends PlaylistSummary {
  /** Songs in position order; each carries a signed playback URL. */
  songs: (SavedSong & { position: number })[]
  duration_seconds: number
}

const pl = (id: string) => `/playlists/${encodeURIComponent(id)}`
export const musicPlaylists = (request: MusicRequest) => request<{ playlists: PlaylistSummary[]; sign_in_required: boolean }>('/playlists')
export const musicPlaylist = (request: MusicRequest, playlistId: string) => request<Playlist>(pl(playlistId))
export const musicCreatePlaylist = (request: MusicRequest, body: { title: string; kind?: PlaylistKind; description?: string; song_ids?: string[] }) =>
  request<Playlist>('/playlists', 'POST', body)
export const musicUpdatePlaylist = (request: MusicRequest, playlistId: string, body: { title?: string; description?: string; kind?: PlaylistKind }) =>
  request<Playlist>(pl(playlistId), 'PATCH', body)
export const musicDeletePlaylist = (request: MusicRequest, playlistId: string) => request<{ deleted: boolean }>(pl(playlistId), 'DELETE')
export const musicAddPlaylistSongs = (request: MusicRequest, playlistId: string, songIds: string[]) => request<Playlist>(`${pl(playlistId)}/songs`, 'POST', { song_ids: songIds })
export const musicReorderPlaylist = (request: MusicRequest, playlistId: string, songIds: string[]) => request<Playlist>(`${pl(playlistId)}/songs`, 'PUT', { song_ids: songIds })
export const musicRemovePlaylistSong = (request: MusicRequest, playlistId: string, songId: string) =>
  request<Playlist>(`${pl(playlistId)}/songs/${encodeURIComponent(songId)}`, 'DELETE')

/** `m:ss` for deck readouts. */
export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Human summary of a generation config for a chip row (`120 bpm · D major/B minor · density 0.4`). */
export function describeConfig(config: Record<string, unknown>): string[] {
  const out: string[] = []
  if (typeof config.bpm === 'number') out.push(`${config.bpm} bpm`)
  if (typeof config.scale === 'string' && config.scale !== 'SCALE_UNSPECIFIED') out.push(config.scale.toLowerCase().replace(/_major_/, ' major / ').replace(/_minor$/, ' minor').replace(/_/g, ' '))
  for (const key of ['density', 'brightness', 'guidance', 'temperature', 'top_k', 'seed'] as const) if (typeof config[key] === 'number') out.push(`${key.replace('_', ' ')} ${config[key]}`)
  for (const key of ['mute_bass', 'mute_drums', 'only_bass_and_drums'] as const) if (config[key] === true) out.push(key.replace(/_/g, ' '))
  if (typeof config.music_generation_mode === 'string' && config.music_generation_mode !== 'QUALITY') out.push(config.music_generation_mode.toLowerCase())
  return out
}
