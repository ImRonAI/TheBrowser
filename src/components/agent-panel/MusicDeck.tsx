import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogInIcon, PauseIcon, PlayIcon, RotateCcwIcon, SaveIcon, SquareIcon, Trash2Icon, Volume2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group'
import {
  AudioPlayer, AudioPlayerControlBar, AudioPlayerDurationDisplay, AudioPlayerElement, AudioPlayerMuteButton,
  AudioPlayerPlayButton, AudioPlayerTimeDisplay, AudioPlayerTimeRange,
} from '@/components/ai-elements/audio-player'
import { Badge } from '@/components/ai-elements/badge'
import { getSession } from '@/api/supabase'
import { LIVE_API_BASE_URL } from '@/pages/types/api'
import {
  createMusicRequest, describeConfig, formatSeconds, musicAddPlaylistSongs, musicControl, musicDeleteSong, musicDiscardTake,
  musicPlaylists, musicSave, musicSongs, SIGN_IN_MESSAGE, SOURCE_LABELS, type MusicAction, type PlaylistSummary, type SavedSong,
} from '@/lib/music-api'
import { musicCaption, useLiveMusicStore } from '@/stores/liveMusicStore'
import { isGuestUserId, openSignIn } from '@/lib/sign-in'
import { MusicEditBox } from './MusicEditBox'
import { PlaylistShelf } from './PlaylistShelf'
import { usePlaylistPlayer } from './usePlaylistPlayer'
import { cn } from '@/utils/cn'

/**
 * The Live Music deck in the panel's Live view. Transport (Play / Pause /
 * Stop / Reset context) calls the backend's playback controls for THIS Live session
 * (`POST /music/control`, the same code path as the agent's `music_playback_control`
 * tool), so the deck and the agent never disagree about state. Volume is local to the
 * music sink. Saved songs play through the AI Elements `AudioPlayer` (media-chrome); playlists,
 * albums and the whole library play continuously (in order or shuffled) through `PlaylistShelf`.
 */
export function MusicDeck({ userId, agentId, className }: { userId: string; agentId?: string; className?: string }) {
  const deck = useLiveMusicStore()
  const { music, available, liveStatus, playing, volume, setVolume, publishTake, controls } = deck
  const signedIn = !isGuestUserId(userId)
  const request = useMemo(() => createMusicRequest(LIVE_API_BASE_URL, getSession, userId), [userId])
  const [busy, setBusy] = useState<MusicAction | 'save' | 'discard' | null>(null)
  const [notice, setNotice] = useState('')
  const [title, setTitle] = useState('')
  const [songs, setSongs] = useState<SavedSong[]>([])
  const [signInRequired, setSignInRequired] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  /** Playlists for "Save to playlist" ('' = library only). */
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [targetPlaylist, setTargetPlaylist] = useState('')

  const run = useCallback(async (label: MusicAction | 'save' | 'discard', action: () => Promise<unknown>) => {
    if (!signedIn) { setNotice(SIGN_IN_MESSAGE); return }
    if (!agentId) { setNotice('Connect Live first.'); return }
    setBusy(label); setNotice('')
    try { await action() } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Music deck request failed.') }
    finally { setBusy(null) }
  }, [agentId, signedIn])

  const control = (action: MusicAction) => run(action, () => musicControl(request, agentId!, action))
  // Save the take as a song; optionally append it to a playlist (`/music/save` then `/music/playlists/{id}/songs`,
  // the same two calls the agent's music_save + music_playlist_add make).
  const save = () => run('save', async () => {
    const result = await musicSave(request, agentId!, title)
    let where = ''
    if (targetPlaylist) {
      const list = await musicAddPlaylistSongs(request, targetPlaylist, [result.song_id])
      where = ` → ${list.kind === 'album' ? 'album' : 'playlist'} “${list.title}”`
    }
    setNotice(`Saved “${result.title}” (${formatSeconds(result.duration_seconds)}, ${result.segments} segment${result.segments === 1 ? '' : 's'})${where}.`)
    setTitle('')
    await loadSongs()
  })
  useEffect(() => {
    if (!signedIn) return
    musicPlaylists(request).then((result) => setPlaylists(result.playlists)).catch(() => setPlaylists([]))
  }, [signedIn, request])
  const discard = () => run('discard', async () => { publishTake(await musicDiscardTake(request, agentId!) as unknown as Record<string, unknown>) })

  const loadSongs = useCallback(async () => {
    try {
      const result = await musicSongs(request)
      setSongs(result.songs); setSignInRequired(result.sign_in_required)
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not load your songs.') }
  }, [request])
  // The continuous player re-fetches signed URLs through this when one has expired.
  const refreshSongs = useCallback(async () => { const result = await musicSongs(request); setSongs(result.songs); return result.songs }, [request])
  const player = usePlaylistPlayer(signedIn ? refreshSongs : undefined)
  // Keep the saved-song player at the deck's volume too.
  const setPlayerVolume = player.setVolume
  useEffect(() => { setPlayerVolume(volume) }, [volume, setPlayerVolume])
  useEffect(() => { if (libraryOpen && signedIn) void loadSongs() }, [libraryOpen, signedIn, loadSongs])

  const connected = music.connected && liveStatus === 'ready'
  const transportDisabled = !signedIn || !agentId || !available || busy !== null
  const chips = describeConfig(music.config)
  const takeSeconds = music.take.seconds

  return <section aria-label="Live music deck" className={cn('rounded-2xl border border-surface-200 bg-white/60 p-3 text-xs dark:border-surface-700 dark:bg-surface-850/60', className)}>
    <div className="flex items-center justify-between gap-2">
      <p role="status" className="min-w-0 truncate font-medium">{musicCaption(deck)}</p>
      <Badge variant={playing ? 'default' : 'secondary'} className="shrink-0">{connected ? music.playback : 'off'}</Badge>
    </div>

    <ButtonGroup orientation="horizontal" aria-label="Live music transport" className="mt-3">
      <Button size="icon-sm" variant="outline" aria-label="Play" disabled={transportDisabled || music.playback === 'playing'} onClick={() => void control('play')}><PlayIcon /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Pause" disabled={transportDisabled || music.playback !== 'playing'} onClick={() => void control('pause')}><PauseIcon /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Stop" disabled={transportDisabled || !connected} onClick={() => void control('stop')}><SquareIcon /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Reset context (hard transition, keeps prompts)" disabled={transportDisabled || !connected} onClick={() => void control('reset_context')}><RotateCcwIcon /></Button>
      <ButtonGroupText className="gap-2 bg-transparent">
        <Volume2Icon className="size-3.5" aria-hidden />
        <input type="range" min={0} max={1} step={0.01} value={volume} aria-label="Music volume" className="h-1 w-24 accent-indigo-600" onChange={(event) => setVolume(Number(event.target.value))} />
      </ButtonGroupText>
    </ButtonGroup>

    {music.prompts.length > 0 && <ul aria-label="Weighted prompts" className="mt-3 flex flex-wrap gap-1.5">
      {music.prompts.map((prompt, index) => <li key={`${prompt.text}-${index}`} className="rounded-full border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 dark:border-indigo-900 dark:bg-indigo-950/30">
        {prompt.text} <span className="tabular-nums opacity-60">×{prompt.weight}</span>
      </li>)}
    </ul>}
    {chips.length > 0 && <p className="mt-2 text-ink-muted dark:text-ink-inverse-muted">{chips.join(' · ')}</p>}

    {controls?.position && controls.sendText && <MusicEditBox className="mt-3" position={controls.position} prompts={music.prompts}
      sendText={controls.sendText} disabled={!connected || music.playback !== 'playing'} />}
    {music.filtered.length > 0 && <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-900 dark:bg-amber-950/20">
      Lyria ignored: {music.filtered.map((item) => `“${item.text ?? '?'}” (${item.reason ?? 'filtered'})`).join(', ')}
    </p>}

    <div className="mt-3 flex items-center gap-2">
      <span className="tabular-nums text-ink-muted dark:text-ink-inverse-muted" aria-label="Recorded take">● {formatSeconds(takeSeconds)} recorded</span>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Song title" aria-label="Song title"
        className="min-w-0 flex-1 rounded-lg border border-surface-200 bg-white/70 px-2 py-1 dark:border-surface-700 dark:bg-surface-850" />
      <Button size="sm" variant="outline" disabled={!signedIn || !agentId || takeSeconds <= 0 || busy !== null} onClick={() => void save()} aria-label="Save recorded music"><SaveIcon />Save</Button>
      <Button size="icon-sm" variant="ghost" disabled={!signedIn || !agentId || takeSeconds <= 0 || busy !== null} onClick={() => void discard()} aria-label="Delete recorded take"><Trash2Icon /></Button>
    </div>
    {signedIn && playlists.length > 0 && <label className="mt-2 flex items-center gap-2 text-ink-muted dark:text-ink-inverse-muted">
      <span className="shrink-0">Save to</span>
      <select value={targetPlaylist} onChange={(event) => setTargetPlaylist(event.target.value)} aria-label="Playlist to add the saved song to"
        className="min-w-0 flex-1 rounded-lg border border-surface-200 bg-white/70 px-2 py-1 text-ink dark:border-surface-700 dark:bg-surface-850 dark:text-ink-inverse">
        <option value="">Library only</option>
        {playlists.map((list) => <option key={list.id} value={list.id}>{list.kind === 'album' ? 'Album' : 'Playlist'} · {list.title}</option>)}
      </select>
    </label>}
    {!signedIn && <div role="status" className="mt-2 flex flex-wrap items-center gap-2 text-ink-muted dark:text-ink-inverse-muted">
      <span>Ren plays music for you by voice. Sign in to control the transport and save what you hear.</span>
      <Button size="sm" variant="outline" onClick={() => openSignIn()} aria-label="Sign in to Ren"><LogInIcon />Sign in</Button>
    </div>}
    {notice && <p role="status" className="mt-2 whitespace-pre-wrap break-words">{notice}</p>}

    <details className="mt-3" open={libraryOpen} onToggle={(event) => setLibraryOpen((event.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-medium">Saved songs{songs.length ? ` · ${songs.length}` : ''}</summary>
      {(signInRequired || !signedIn) && <p className="mt-2 flex flex-wrap items-center gap-2 text-ink-muted dark:text-ink-inverse-muted">
        <span>Sign in to Ren to save and replay music.</span>
        <Button size="sm" variant="ghost" onClick={() => openSignIn()}><LogInIcon />Sign in</Button>
      </p>}
      {signedIn && libraryOpen && <PlaylistShelf request={request} songs={songs} player={player} onNotice={setNotice} />}
      <p className="mt-3 font-medium">Songs</p>
      <ul className="mt-2 space-y-3">
        {songs.map((song) => <li key={song.id} className="rounded-xl border border-surface-200 p-2 dark:border-surface-700">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-medium">{song.title} <span className="tabular-nums font-normal opacity-60">{formatSeconds(song.duration_seconds)}</span> <Badge variant="outline" className="ml-1 align-middle">{SOURCE_LABELS[song.source] ?? song.source}</Badge></p>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${song.title}`} onClick={() => void run('discard', async () => { await musicDeleteSong(request, song.id); await loadSongs() })}><Trash2Icon /></Button>
          </div>
          {song.signed_url && <AudioPlayer className="mt-2">
            <AudioPlayerElement src={song.signed_url} preload="none" />
            <AudioPlayerControlBar>
              <AudioPlayerPlayButton />
              <AudioPlayerTimeDisplay />
              <AudioPlayerTimeRange />
              <AudioPlayerDurationDisplay />
              <AudioPlayerMuteButton />
            </AudioPlayerControlBar>
          </AudioPlayer>}
          {song.prompts.length > 0 && <p className="mt-1 truncate text-ink-muted dark:text-ink-inverse-muted">{song.prompts.map((p) => p.text).join(' · ')}</p>}
          {song.prompt && <p className="mt-1 truncate text-ink-muted dark:text-ink-inverse-muted">{song.prompt}</p>}
          {song.lyrics && song.lyrics !== '<instrumental>' && <details className="mt-1"><summary className="cursor-pointer text-ink-muted dark:text-ink-inverse-muted">Lyrics</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{song.lyrics}</pre></details>}
        </li>)}
      </ul>
    </details>
  </section>
}
